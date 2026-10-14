# IT Tickets bot

This bot mimics a typical IT helpdesk Slack bot. Instead of feeding a ticketing system, each Ticket goes to an **Agent** the Requester picks from a list of Slack users set at deploy time ([why](docs/adr/0002-requester-picks-from-fixed-agents.md)). The vocabulary is defined in [GLOSSARY.md](GLOSSARY.md).

## How it works

1. A **Requester** runs `/ticket [title]`, or uses the **Create IT ticket** shortcut on any message. The shortcut pre-fills the description and links back to the message.
2. The Requester fills in a modal with the title, description, **Category** and **Urgency**, picks the **Agent** to send it to (listed by their current Slack name), and can tick a box to also post it in #general.
3. The Ticket gets a **Ticket number** (`IT-0001`, `IT-0002`, …).
   - The chosen Agent receives a **Ticket card** with **Take** and **Resolve** buttons. Only they can use them.
   - The Requester receives a **Confirmation**. Updates arrive as replies in its thread.
   - If the Requester ticked the box, an **Announcement** is posted in #general.
4. **Take** moves the Ticket from Open to In progress.
5. **Resolve** moves it from Open or In progress to Resolved, with an optional **Resolution note** for the Requester.
6. The Ticket card updates in place and its buttons disappear once there's nothing left to do. Statuses never move backwards.

Everything happens in DMs with the bot. The only channel post is the opt-in Announcement in #general, which isn't updated as the Ticket's Status changes.

## Code map

| File                                                             | Role                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [src/ticket.ts](src/ticket.ts)                                   | Ticket types and Status rules                                          |
| [src/agents.ts](src/agents.ts)                                   | The configured Agents and how Slack currently names them               |
| [src/helpdesk.ts](src/helpdesk.ts)                               | The lifecycle (open, Take, Resolve) and the Slack messages it sends    |
| [src/ticket-store.ts](src/ticket-store.ts)                       | DynamoDB persistence with conditional Status transitions               |
| [src/messages.ts](src/messages.ts), [src/views.ts](src/views.ts) | Block Kit messages and modals                                          |
| [src/listeners.ts](src/listeners.ts)                             | Bolt wiring for the slash command, shortcut, buttons and modal submits |
| [src/handler.ts](src/handler.ts)                                 | Lambda entry point; loads Slack secrets from SSM once per cold start   |
| [manifest.yaml](manifest.yaml)                                   | Slack app definition                                                   |

Infrastructure lives in [infra/lib/it-tickets-stack.ts](../../infra/lib/it-tickets-stack.ts). Setup steps are in the [root README](../../README.md#one-time-setup).
