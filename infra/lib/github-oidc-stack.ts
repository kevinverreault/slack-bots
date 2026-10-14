import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export const DEPLOY_ROLE_NAME = 'slack-bots-github-deploy';

export interface GithubOidcStackProps extends StackProps {
  /** `owner/name` of the GitHub repository allowed to deploy. */
  githubRepo: string;
  /** ARN of an existing GitHub OIDC provider; one is created when omitted (AWS allows one per account). */
  existingProviderArn?: string;
}

/**
 * Lets GitHub Actions on `main` deploy this repo's CDK stacks.
 * Deployed once by hand (see README); everything else is deployed by GitHub.
 */
export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    let providerArn = props.existingProviderArn;
    if (!providerArn) {
      const provider = new iam.OidcProviderNative(this, 'GithubProvider', {
        url: 'https://token.actions.githubusercontent.com',
        clientIds: ['sts.amazonaws.com'],
      });
      // Retained so that switching to `existingProviderArn` (or destroying this stack) never
      // pulls the provider out from under a role that still trusts it. It's free to keep.
      provider.applyRemovalPolicy(RemovalPolicy.RETAIN);
      providerArn = provider.oidcProviderArn;
    }

    const role = new iam.Role(this, 'DeployRole', {
      roleName: DEPLOY_ROLE_NAME,
      description: `GitHub Actions deploys from ${props.githubRepo}@main`,
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:${props.githubRepo}:ref:refs/heads/main`,
        },
      }),
    });

    // The role can do nothing itself except hand off to the roles `cdk bootstrap` created.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-*`],
      }),
    );

    new CfnOutput(this, 'DeployRoleArn', { value: role.roleArn });
  }
}
