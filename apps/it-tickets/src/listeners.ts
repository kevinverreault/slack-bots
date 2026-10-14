import type { App, MessageShortcut } from '@slack/bolt';
import { createHelpdesk, type ActionOutcome, type Chat } from './helpdesk.js';
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
} from './views.js';

export const SLASH_COMMAND = '/ticket';
export const MESSAGE_SHORTCUT = 'ticket_from_message';

export interface ListenerDeps {
  store: TicketStore;
  agentId: string;
  now?: () => Date;
}

/** Wires Slack entry points to the Helpdesk. Every listener does its work before Bolt responds to Slack. */
export function registerListeners(
  app: App,
  { store, agentId, now = () => new Date() }: ListenerDeps,
) {
  const helpdesk = (chat: Chat) => createHelpdesk({ store, chat, agentId, now });

  app.command(SLASH_COMMAND, async ({ ack, body, client }) => {
    await ack();
    await client.views.open({
      trigger_id: body.trigger_id,
      view: ticketModal({ title: body.text.trim() || undefined }),
    });
  });

  app.shortcut<MessageShortcut>(MESSAGE_SHORTCUT, async ({ ack, shortcut, client }) => {
    await ack();
    const domain = shortcut.team?.domain;
    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: ticketModal({
        description: shortcut.message.text,
        sourcePermalink: domain
          ? messagePermalink(domain, shortcut.channel.id, shortcut.message.ts)
          : undefined,
      }),
    });
  });

  app.view(OPEN_TICKET_VIEW, async ({ ack, body, view, client, logger }) => {
    const parsed = parseTicketSubmission(view, body.user.id);
    if (!parsed.ok) {
      await ack({ response_action: 'errors', errors: parsed.errors });
      return;
    }
    await ack();
    try {
      const ticket = await helpdesk(client.chat).open(parsed.value);
      logger.info(`Opened ${ticket.number} for ${ticket.requesterId}`);
    } catch (err) {
      logger.error('Failed to open ticket', err);
      await client.chat.postMessage({ channel: body.user.id, ...openFailed() });
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
    if (body.user.id !== agentId) return;
    await client.views.open({
      trigger_id: body.trigger_id,
      view: resolveModal(action.value ?? ''),
    });
  });

  app.view(RESOLVE_TICKET_VIEW, async ({ ack, body, view, client, logger }) => {
    await ack();
    const { ticketNumber, note } = parseResolveSubmission(view);
    const outcome = await helpdesk(client.chat).resolve(ticketNumber, body.user.id, note);
    logOutcome(logger, 'resolve', ticketNumber, body.user.id, outcome);
  });
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
