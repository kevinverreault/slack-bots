import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

export const SSM_PREFIX = '/slack-bots/it-tickets';

export interface ItTicketsStackProps extends StackProps {
  /** Slack member IDs of the Agents a Requester can send a Ticket to. The first also owns Tickets opened before Agents were recorded. */
  agentSlackUserIds: string[];
}

/** The IT tickets bot: one Lambda behind a Function URL, plus a table for Tickets. */
export class ItTicketsStack extends Stack {
  constructor(scope: Construct, id: string, props: ItTicketsStackProps) {
    super(scope, id, props);
    if (props.agentSlackUserIds.length === 0) throw new Error('Configure at least one Agent');

    const table = new dynamodb.TableV2(this, 'Tickets', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Created by hand, never in code (see README).
    const botTokenParam = `${SSM_PREFIX}/bot-token`;
    const signingSecretParam = `${SSM_PREFIX}/signing-secret`;

    const fn = new NodejsFunction(this, 'Handler', {
      entry: fileURLToPath(new URL('../../apps/it-tickets/src/handler.ts', import.meta.url)),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      // More memory = more CPU = faster cold starts, keeping us inside Slack's 3s window.
      memorySize: 1024,
      timeout: Duration.seconds(10),
      logGroup: new logs.LogGroup(this, 'Logs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        TABLE_NAME: table.tableName,
        AGENT_SLACK_USER_IDS: props.agentSlackUserIds.join(','),
        BOT_TOKEN_PARAM: botTokenParam,
        SIGNING_SECRET_PARAM: signingSecretParam,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        format: OutputFormat.CJS,
        minify: true,
        sourceMap: true,
        target: 'node22',
      },
    });

    table.grantReadWriteData(fn);
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameters'],
        resources: [botTokenParam, signingSecretParam].map(
          (name) => `arn:${this.partition}:ssm:${this.region}:${this.account}:parameter${name}`,
        ),
      }),
    );

    // Public on purpose: Bolt verifies Slack's request signature on every call.
    const url = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    new CfnOutput(this, 'SlackRequestUrl', {
      value: url.url,
      description: 'Paste into the Slack app manifest (slash command + interactivity URLs)',
    });
  }
}
