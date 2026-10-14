import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { App, AwsLambdaReceiver, LogLevel } from '@slack/bolt';
import { parseAgentIds } from './agents.js';
import { registerListeners } from './listeners.js';
import { DynamoTicketStore } from './ticket-store.js';

type AwsHandler = ReturnType<AwsLambdaReceiver['toHandler']>;
type AwsEvent = Parameters<AwsHandler>[0];

let ready: Promise<AwsHandler> | undefined;

/** Lambda entry point behind the Function URL. Secrets are loaded once per cold start. */
export async function handler(event: AwsEvent, context: unknown) {
  ready ??= init().catch((err: unknown) => {
    ready = undefined; // let the next invocation retry
    throw err;
  });
  return (await ready)(event, context);
}

async function init(): Promise<AwsHandler> {
  const botTokenParam = requireEnv('BOT_TOKEN_PARAM');
  const signingSecretParam = requireEnv('SIGNING_SECRET_PARAM');
  const secrets = await loadParameters([botTokenParam, signingSecretParam]);
  const botToken = secrets.get(botTokenParam)!;
  const signingSecret = secrets.get(signingSecretParam)!;

  const receiver = new AwsLambdaReceiver({ signingSecret, logLevel: LogLevel.INFO });
  const app = new App({
    receiver,
    // Single-workspace install: hand Bolt the token directly, skipping its auth.test round trip.
    authorize: async () => ({ botToken }),
  });
  registerListeners(app, {
    store: new DynamoTicketStore(requireEnv('TABLE_NAME')),
    agentIds: parseAgentIds(requireEnv('AGENT_SLACK_USER_IDS')),
  });
  return receiver.start();
}

/** Fetches and decrypts SSM parameters, failing if any is missing or empty. */
async function loadParameters(names: string[]): Promise<Map<string, string>> {
  const { Parameters = [] } = await new SSMClient({}).send(
    new GetParametersCommand({ Names: names, WithDecryption: true }),
  );
  const values = new Map(Parameters.map((p) => [p.Name, p.Value]));
  for (const name of names) {
    if (!values.get(name)) throw new Error(`SSM parameter ${name} is missing or empty`);
  }
  return values as Map<string, string>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} is not set`);
  return value;
}
