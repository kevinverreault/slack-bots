import { App } from 'aws-cdk-lib';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';
import { ItTicketsStack } from '../lib/it-tickets-stack.js';
import { SharedStack } from '../lib/shared-stack.js';

// Local runs may keep these in infra/.env (untracked); CI passes them from GitHub repository variables.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env file
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Set ${name} (in infra/.env locally, or as a GitHub repository variable)`);
  return value;
}

const app = new App();
const env = { account: requireEnv('AWS_ACCOUNT_ID'), region: requireEnv('AWS_REGION') };
const tags = { project: 'slack-bots' };

new GithubOidcStack(app, 'SlackBots-GithubOidc', {
  env,
  tags,
  githubRepo: process.env.GITHUB_REPO ?? 'kevinverreault/slack-bots',
  existingProviderArn: process.env.GITHUB_OIDC_PROVIDER_ARN || undefined,
});

new SharedStack(app, 'SlackBots-Shared', {
  env,
  tags,
  budgetAlertEmail: requireEnv('BUDGET_ALERT_EMAIL'),
});

new ItTicketsStack(app, 'SlackBots-ItTickets', {
  env,
  tags: { ...tags, bot: 'it-tickets' },
  agentSlackUserId: requireEnv('AGENT_SLACK_USER_ID'),
});
