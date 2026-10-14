# slack-bots

A playground of Slack bots running on AWS for (nearly) $0. These are proof-of-concept bots built for fun, not for production.

| Bot                            | What it does                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [IT Tickets](apps/it-tickets/) | Raise IT tickets from Slack with `/ticket` or a message shortcut. Every ticket goes to one configured Agent. |

## Layout

```
apps/<bot>/        bot code (TypeScript, Bolt for JS), its manifest.yaml, GLOSSARY.md and ADRs
infra/             AWS CDK app for every stack
docs/adr/          repo-wide decisions
GLOSSARY-MAP.md    which glossary covers which bot
```

Each bot is a single Lambda behind a public Lambda Function URL. Bolt verifies Slack's request signature on every call. Read [why it's built this way](docs/adr/0001-near-zero-cost-hosting.md).

## Development

```bash
npm install
npm run lint        # eslint + prettier --check
npm run typecheck
npm test            # vitest
npm run synth       # cdk synth; needs infra/.env (see infra/.env.example)
```

## Deployment

GitHub Actions ([ci.yml](.github/workflows/ci.yml)) lints, typechecks, tests and synthesizes every PR. A push to `main` also deploys `SlackBots-Shared` (a $1 monthly AWS Budget alert) and the bot stacks. The deploy uses an OIDC role. That role can only assume the roles `cdk bootstrap` creates, and only from `main`.

### One-time setup

You need admin AWS credentials on your machine (AWS CLI v2 recommended) and a Slack workspace where you can install apps.

1. **Configure locally.** Copy `infra/.env.example` to `infra/.env` and fill it in. To find your Slack member ID (the Agent), open your Slack profile and choose ⋮ → _Copy member ID_.
2. **Bootstrap CDK and create GitHub's deploy role.** This is the only stack that's ever deployed by hand:
   ```bash
   cd infra
   npx cdk bootstrap
   npx cdk deploy SlackBots-GithubOidc
   ```
   If the account already has a GitHub OIDC provider, set `GITHUB_OIDC_PROVIDER_ARN` in `.env` first.
3. **Set the GitHub repository variables** (variables, not secrets: none of them is sensitive). Use the same values as in `.env`:
   ```bash
   gh variable set AWS_ACCOUNT_ID --body 123456789012
   gh variable set AWS_REGION --body ca-central-1
   gh variable set AGENT_SLACK_USER_ID --body U0123456789
   gh variable set BUDGET_ALERT_EMAIL --body you@example.com
   ```
4. **Deploy.** Run the CI workflow (_Actions → CI → Run workflow_, or `gh workflow run CI`). Then read the bot's URL from the `SlackRequestUrl` stack output:
   ```bash
   aws cloudformation describe-stacks --stack-name SlackBots-ItTickets --query "Stacks[0].Outputs" --region ca-central-1
   ```
5. **Create the Slack app.** At <https://api.slack.com/apps>, choose _Create New App → From a manifest_, and paste [apps/it-tickets/manifest.yaml](apps/it-tickets/manifest.yaml) with both `REPLACE_WITH_FUNCTION_URL` placeholders replaced by that URL. Install the app to your workspace.
6. **Store the Slack secrets in SSM.** These SecureString parameters are free. Use the AWS console (Systems Manager → Parameter Store) to keep the values out of your shell history:
   - `/slack-bots/it-tickets/bot-token`: _OAuth & Permissions → Bot User OAuth Token_ (`xoxb-…`)
   - `/slack-bots/it-tickets/signing-secret`: _Basic Information → Signing Secret_
7. Type `/ticket` in Slack.

If you rotate a secret, re-run the workflow (step 4). This starts fresh Lambdas, which read the new value.

### Teardown

```bash
cd infra
npx cdk destroy SlackBots-ItTickets SlackBots-Shared SlackBots-GithubOidc
```

The ticket table is deleted with its stack. Delete the two SSM parameters and the Slack app by hand.
