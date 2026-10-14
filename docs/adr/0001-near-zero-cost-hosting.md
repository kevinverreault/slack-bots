# Near-zero AWS cost drives the hosting shape

The bots in this repo are low-volume PoCs, and the AWS bill must stay at roughly $0. So each bot runs as a Lambda behind a Lambda Function URL, which is free, rather than API Gateway, which is free only during the 12-month free tier. Socket Mode would need an always-on process, so it is out too. Secrets go in SSM Parameter Store SecureString (free) rather than Secrets Manager ($0.40 per secret per month). Slack requests are handled inline within Slack's 3-second limit, with no queues or async fan-out. A $1 AWS Budget alert guards the constraint.

## Consequences

- Slack's request signature, verified by Bolt, is the only auth on the public endpoint.
- A cold start can occasionally push a modal submission past 3 seconds. The accepted fallback is to reply to Slack immediately and have the Lambda invoke itself to do the work, not to add infrastructure that costs money.
