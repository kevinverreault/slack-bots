import type { App, MessageShortcut } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { lookUpAgents } from './agents.js';
import { createHelpdesk, GENERAL_CHANNEL, type ActionOutcome, type Chat } from './helpdesk.js';
import { openFailed, RESOLVE_ACTION, TAKE_ACTION } from './messages.js';
import type { TicketStore } from './ticket-store.js';
import {
  messagePermalink,
  OPEN_TICKET_VIEW,
  parseResolveSubmission,
  parseTicketSubmission,
  RESOLVE_TICKET_VIEW,
  resolveModal,
  ticketModal,
  type TicketModalPrefill,
} from './views.js';

export const SLASH_COMMAND = '/ticket';
export const MESSAGE_SHORTCUT = 'ticket_from_message';

export interface ListenerDeps {
  store: TicketStore;
  /** The configured Agents, in order. The first owns Tickets opened before Agents were recorded. */
  agentIds: string[];
  now?: () => Date;
}

/** Wires Slack entry points to the Helpdesk. Every listener does its work before Bolt responds to Slack. */
export function registerListeners(
  app: App,
  { store, agentIds, now = () => new Date() }: ListenerDeps,
) {
  const helpdesk = (chat: Chat) =>
    createHelpdesk({ store, chat, legacyAgentId: agentIds[0]!, now, logger: app.logger });

  app.command(SLASH_COMMAND, async ({ ack, body, client, logger }) => {
    await ack();
    await openTicketModal(client, logger, {
      triggerId: body.trigger_id,
      agentIds,
      prefill: { title: body.text.trim() || undefined },
    });
  });

  app.shortcut<MessageShortcut>(MESSAGE_SHORTCUT, async ({ ack, shortcut, client, logger }) => {
    await ack();
    const domain = shortcut.team?.domain;
    await openTicketModal(client, logger, {
      triggerId: shortcut.trigger_id,
      agentIds,
      prefill: {
        description: shortcut.message.text,
        sourcePermalink: domain
          ? messagePermalink(domain, shortcut.channel.id, shortcut.message.ts)
          : undefined,
      },
    });
  });

  app.view(OPEN_TICKET_VIEW, async ({ ack, body, view, client, logger }) => {
    const parsed = parseTicketSubmission(view, body.user.id, agentIds);
    if (!parsed.ok) {
      await ack({ response_action: 'errors', errors: parsed.errors });
      return;
    }
    await ack();
    const desk = helpdesk(client.chat);
    let ticket;
    try {
      ticket = await desk.open(parsed.value);
      logger.info(`Opened ${ticket.number} for ${ticket.requesterId}`);
    } catch (err) {
      logger.error('Failed to open ticket', err);
      await client.chat.postMessage({ channel: body.user.id, ...openFailed() });
      return;
    }
    if (!ticket.postToGeneral) return;
    try {
      await desk.announce(ticket);
    } catch (err) {
      // The Ticket is open and both sides know about it; a missing Announcement isn't worth alarming anyone.
      logger.warn(`Failed to announce ${ticket.number} in ${GENERAL_CHANNEL}`, err);
    }
  });

  app.action(TAKE_ACTION, async ({ ack, body, action, client, logger }) => {
    await ack();
    if (action.type !== 'button') return;
    const outcome = await helpdesk(client.chat).take(action.value ?? '', body.user.id);
    logOutcome(logger, 'take', action.value, body.user.id, outcome);
  });

  app.action(RESOLVE_ACTION, async ({ ack, body, action, client }) => {
    await ack();
    if (action.type !== 'button' || !('trigger_id' in body)) return;
    const ticket = await helpdesk(client.chat).ticketForAgent(action.value ?? '', body.user.id);
    if (!ticket) return;
    await client.views.open({
      trigger_id: body.trigger_id,
      view: resolveModal(ticket.number, { announced: !!ticket.announcement }),
    });
  });

  app.view(RESOLVE_TICKET_VIEW, async ({ ack, body, view, client, logger }) => {
    const parsed = parseResolveSubmission(view);
    if (!parsed.ok) {
      await ack({ response_action: 'errors', errors: parsed.errors });
      return;
    }
    await ack();
    const { ticketNumber, ...details } = parsed.value;
    const outcome = await helpdesk(client.chat).resolve(ticketNumber, body.user.id, details);
    logOutcome(logger, 'resolve', ticketNumber, body.user.id, outcome);
  });
}

/**
 * How long the Agent name lookup may take. Bolt only replies to Slack once the listener is done,
 * and Slack shows the Requester an error if that takes over 3s (Slack's client retries a failed call).
 */
const NAME_LOOKUP_BUDGET_MS = 1000;

export interface ModalClient {
  views: Pick<WebClient['views'], 'open' | 'update'>;
  users: Pick<WebClient['users'], 'info'>;
}

/**
 * Opens the ticket modal with the Agents shown by member ID, then swaps in their current Slack
 * names. Opening first keeps us inside the trigger's 3s window however slow the lookups are.
 * Slack keeps what the Requester has already entered, since the blocks keep their IDs.
 */
export async function openTicketModal(
  client: ModalClient,
  logger: { warn(...msg: unknown[]): void },
  {
    triggerId,
    agentIds,
    prefill,
    lookupBudgetMs = NAME_LOOKUP_BUDGET_MS,
  }: {
    triggerId: string;
    agentIds: string[];
    prefill?: TicketModalPrefill;
    lookupBudgetMs?: number;
  },
): Promise<void> {
  const labelledById = agentIds.map((id) => ({ id, name: id }));
  const { view: opened } = await client.views.open({
    trigger_id: triggerId,
    view: ticketModal(labelledById, prefill),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const agents = await Promise.race([
    lookUpAgents(client.users, agentIds, logger),
    new Promise<undefined>(
      (resolve) => (timer = setTimeout(() => resolve(undefined), lookupBudgetMs)),
    ),
  ]).finally(() => clearTimeout(timer));
  if (!agents) {
    logger.warn(`Agent names took over ${lookupBudgetMs}ms; showing member IDs`);
    return;
  }
  if (!opened?.id || agents.every((a) => a.name === a.id)) return;
  try {
    await client.views.update({
      view_id: opened.id,
      hash: opened.hash,
      view: ticketModal(agents, prefill),
    });
  } catch (err) {
    // Most likely the Requester already submitted or closed it; the member IDs did the job.
    logger.warn('Could not show Agent names in the ticket modal', err);
  }
}

function logOutcome(
  logger: { info(...msg: unknown[]): void; warn(...msg: unknown[]): void },
  what: string,
  ticketNumber: string | undefined,
  actorId: string,
  outcome: ActionOutcome,
) {
  const line = `${what} ${ticketNumber} by ${actorId}: ${outcome}`;
  if (outcome === 'done') logger.info(line);
  else logger.warn(line);
}
