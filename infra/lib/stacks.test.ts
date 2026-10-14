import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GithubOidcStack } from './github-oidc-stack.js';
import { ItTicketsStack } from './it-tickets-stack.js';

const env = { account: '123456789012', region: 'ca-central-1' };
// Skip esbuild bundling: these tests are about the template, not the Lambda code.
const newApp = () => new App({ context: { 'aws:cdk:bundling-stacks': [] } });

describe('ItTicketsStack', () => {
  const template = Template.fromStack(
    new ItTicketsStack(newApp(), 'Test', { env, agentSlackUserIds: ['UANA', 'UBEN'] }),
  );

  it('exposes the bot through a public Function URL', () => {
    template.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'NONE' });
  });

  it('configures the Agents and secret names, never the secrets themselves', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      MemorySize: 1024,
      Environment: {
        Variables: Match.objectLike({
          AGENT_SLACK_USER_IDS: 'UANA,UBEN',
          BOT_TOKEN_PARAM: '/slack-bots/it-tickets/bot-token',
          SIGNING_SECRET_PARAM: '/slack-bots/it-tickets/signing-secret',
        }),
      },
    });
  });

  it('refuses to deploy without an Agent', () => {
    expect(() => new ItTicketsStack(newApp(), 'NoAgents', { env, agentSlackUserIds: [] })).toThrow(
      'at least one Agent',
    );
  });

  it('keeps logs for a week and deletes the table with the stack', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
    template.hasResource('AWS::DynamoDB::GlobalTable', { DeletionPolicy: 'Delete' });
  });
});

describe('GithubOidcStack', () => {
  const template = Template.fromStack(
    new GithubOidcStack(newApp(), 'Oidc', { env, githubRepo: 'me/repo' }),
  );

  it('trusts only the main branch of the repo', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub': 'repo:me/repo:ref:refs/heads/main',
              },
            },
          }),
        ],
      },
    });
  });

  it("trusts GitHub's immutable subject when given its prefix", () => {
    const immutable = Template.fromStack(
      new GithubOidcStack(newApp(), 'Immutable', {
        env,
        githubRepo: 'me/repo',
        subjectPrefix: 'repo:me@1/repo@2',
      }),
    );
    immutable.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: {
              StringEquals: Match.objectLike({
                'token.actions.githubusercontent.com:sub': 'repo:me@1/repo@2:ref:refs/heads/main',
              }),
            },
          }),
        ],
      },
    });
  });

  it('never deletes the GitHub OIDC provider it creates', () => {
    template.hasResource('AWS::IAM::OIDCProvider', { DeletionPolicy: 'Retain' });
  });

  it('creates no provider when reusing an existing one', () => {
    const reusing = Template.fromStack(
      new GithubOidcStack(newApp(), 'Reuse', {
        env,
        githubRepo: 'me/repo',
        existingProviderArn:
          'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com',
      }),
    );
    reusing.resourceCountIs('AWS::IAM::OIDCProvider', 0);
  });

  it('can only assume the CDK bootstrap roles', () => {
    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    expect(policies).toHaveLength(1);
    expect(policies[0]!.Properties.PolicyDocument.Statement).toEqual([
      expect.objectContaining({ Action: 'sts:AssumeRole', Effect: 'Allow' }),
    ]);
  });
});
