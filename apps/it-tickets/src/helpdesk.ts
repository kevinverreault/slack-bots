import type { WebClient } from '@slack/web-api';
import {
  confirmation,
  resolvedUpdate,
  takenUpdate,
  ticketCard,
  type Message,
  type TicketDetails,
} from './messages.js';
import type { MessageRef, Ticket, TicketDraft } from './ticket.js';
import type { TicketStore } from './ticket-store.js';

export type Chat = Pick<WebClient['chat'], 'postMessage' | 'update'>;

export interface HelpdeskDeps {
  store: TicketStore;
  chat: Chat;
  agentId: string;
  now: () => Date;
}

export type ActionOutcome = 'done' | 'not-agent' | 'not-found' | 'stale';

/** The Ticket lifecycle: open, Take, Resolve, and the Slack messages each step produces. */
export function createHelpdesk({ store, chat, agentId, now }: HelpdeskDeps) {
  async function post(channel: string, message: Message, threadTs?: string): Promise<MessageRef> {
    const res = await chat.postMessage({ channel, ...message, thread_ts: threadTs });
    if (!res.channel || !res.ts) throw new Error(`chat.postMessage to ${channel} returned no ts`);
    return { channel: res.channel, ts: res.ts };
  }

  async function refreshCard(ticket: Ticket): Promise<void> {
    await chat.update({ ...ticket.card, ...ticketCard(ticket) });
  }

  async function transition(
    ticketNumber: string,
    actorId: string,
    from: Ticket['status'][],
    changes: Parameters<TicketStore['update']>[2],
    update: (ticket: Ticket) => Message,
  ): Promise<ActionOutcome> {
    if (actorId !== agentId) return 'not-agent';
    const updated = await store.update(ticketNumber, from, changes);
    if (!updated) {
      // Already moved on (e.g. a double click): make sure the card reflects reality.
      const current = await store.get(ticketNumber);
      if (!current) return 'not-found';
      await refreshCard(current);
      return 'stale';
    }
    await refreshCard(updated);
    await post(updated.confirmation.channel, update(updated), updated.confirmation.ts);
    return 'done';
  }

  return {
    async open(draft: TicketDraft): Promise<Ticket> {
      const details: TicketDetails = {
        ...draft,
        number: await store.nextNumber(),
        status: 'Open',
        createdAt: now().toISOString(),
      };
      // Post to the Agent first: a misconfigured Agent fails before the Requester is told anything.
      const card = await post(agentId, ticketCard(details));
      const confirmationRef = await post(draft.requesterId, confirmation(details));
      const ticket: Ticket = { ...details, card, confirmation: confirmationRef };
      await store.create(ticket);
      return ticket;
    },

    take(ticketNumber: string, actorId: string): Promise<ActionOutcome> {
      return transition(
        ticketNumber,
        actorId,
        ['Open'],
        { status: 'In progress', takenAt: now().toISOString() },
        (ticket) => takenUpdate(ticket, agentId),
      );
    },

    resolve(ticketNumber: string, actorId: string, note?: string): Promise<ActionOutcome> {
      return transition(
        ticketNumber,
        actorId,
        ['Open', 'In progress'],
        { status: 'Resolved', resolvedAt: now().toISOString(), resolutionNote: note },
        (ticket) => resolvedUpdate(ticket, agentId),
      );
    },
  };
}

export type Helpdesk = ReturnType<typeof createHelpdesk>;
