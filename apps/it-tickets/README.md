# IT Tickets bot

This bot mimics a typical IT helpdesk Slack bot. Instead of feeding a ticketing system, every Ticket goes to a single **Agent**, a Slack user set at deploy time ([why](docs/adr/0001-single-agent-no-ticketing-system.md)). The vocabulary is defined in [GLOSSARY.md](GLOSSARY.md).

## How it works

1. A **Requester** runs `/ticket [title]`, or uses the **Create IT ticket** shortcut on any message. The shortcut pre-fills the description and links back to the message.
2. The Requester fills in a modal with the title, description, **Category** and **Urgency**.
3. The Ticket gets a **Ticket number** (`IT-0001`, `IT-0002`, …).
   - The Agent receives a **Ticket card** with **Take** and **Resolve** buttons.
   - The Requester receives a **Confirmation**. Updates arrive as replies in its thread.
4. **Take** moves the Ticket from Open to In progress.
5. **Resolve** moves it from Open or In progress to Resolved, with an optional **Resolution note** for the Requester.
6. The Ticket card updates in place and its buttons disappear once there's nothing left to do. Statuses never move backwards.

Everything happens in DMs with the bot. Nothing is posted in channels.

## Code map

| File                                                             | Role                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [src/ticket.ts](src/ticket.ts)                                   | Ticket types and Status rules                                          |
| [src/helpdesk.ts](src/helpdesk.ts)                               | The lifecycle (open, Take, Resolve) and the Slack messages it sends    |
| [src/ticket-store.ts](src/ticket-store.ts)                       | DynamoDB persistence with conditional Status transitions               |
| [src/messages.ts](src/messages.ts), [src/views.ts](src/views.ts) | Block Kit messages and modals                                          |
| [src/listeners.ts](src/listeners.ts)                             | Bolt wiring for the slash command, shortcut, buttons and modal submits |
| [src/handler.ts](src/handler.ts)                                 | Lambda entry point; loads Slack secrets from SSM once per cold start   |
| [manifest.yaml](manifest.yaml)                                   | Slack app definition                                                   |

Infrastructure lives in [infra/lib/it-tickets-stack.ts](../../infra/lib/it-tickets-stack.ts). Setup steps are in the [root README](../../README.md#one-time-setup).
