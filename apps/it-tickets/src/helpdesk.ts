import type { WebClient } from '@slack/web-api';
import {
  announcement,
  confirmation,
  resolvedUpdate,
  takenUpdate,
  ticketCard,
  type Message,
  type TicketDetails,
} from './messages.js';
import type { MessageRef, Ticket, TicketDraft } from './ticket.js';
import type { StoredTicket, TicketChanges, TicketStore } from './ticket-store.js';

export type Chat = Pick<WebClient['chat'], 'postMessage' | 'update'>;

export interface HelpdeskDeps {
  store: TicketStore;
  chat: Chat;
  /** The configured Agent: given to each newly opened Ticket, and assumed for stored Tickets without one. */
  agentId: string;
  now: () => Date;
}

/** Where Announcements go. Slack accepts a channel name here; `chat:write.public` lets the bot post without joining. */
export const GENERAL_CHANNEL = '#general';

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

  /** Tickets opened before Agents were recorded belong to the configured Agent. */
  function withAgent(stored: StoredTicket): Ticket {
    return { ...stored, agentId: stored.agentId ?? agentId };
  }

  async function findTicket(ticketNumber: string): Promise<Ticket | undefined> {
    const stored = await store.get(ticketNumber);
    return stored && withAgent(stored);
  }

  async function transition(
    ticketNumber: string,
    actorId: string,
    from: Ticket['status'][],
    changes: TicketChanges,
    update: (ticket: Ticket) => Message,
  ): Promise<ActionOutcome> {
    const ticket = await findTicket(ticketNumber);
    if (!ticket) return 'not-found';
    if (actorId !== ticket.agentId) return 'not-agent';
    const stored = await store.update(ticketNumber, from, changes);
    if (!stored) {
      // Already moved on (e.g. a double click): make sure the card reflects reality.
      const current = await findTicket(ticketNumber);
      if (!current) return 'not-found';
      await refreshCard(current);
      return 'stale';
    }
    const updated = withAgent(stored);
    await refreshCard(updated);
    await post(updated.confirmation.channel, update(updated), updated.confirmation.ts);
    return 'done';
  }

  return {
    async open(draft: TicketDraft): Promise<Ticket> {
      const details: TicketDetails = {
        ...draft,
        number: await store.nextNumber(),
        agentId,
        status: 'Open',
        createdAt: now().toISOString(),
      };
      // Post to the Agent first: a misconfigured Agent fails before the Requester is told anything.
      const card = await post(details.agentId, ticketCard(details));
      const confirmationRef = await post(draft.requesterId, confirmation(details));
      const ticket: Ticket = { ...details, card, confirmation: confirmationRef };
      await store.create(ticket);
      return ticket;
    },

    /** Posts the Ticket in #general. Kept apart from `open` so a failure here can't undo an opened Ticket. */
    async announce(ticket: Ticket): Promise<void> {
      await post(GENERAL_CHANNEL, announcement(ticket));
    },

    /** Whether `userId` is the Agent of an existing Ticket, and so may act on it. */
    async isAgentOf(ticketNumber: string, userId: string): Promise<boolean> {
      return (await findTicket(ticketNumber))?.agentId === userId;
    },

    take(ticketNumber: string, actorId: string): Promise<ActionOutcome> {
      return transition(
        ticketNumber,
        actorId,
        ['Open'],
        { status: 'In progress', takenAt: now().toISOString() },
        takenUpdate,
      );
    },

    resolve(ticketNumber: string, actorId: string, note?: string): Promise<ActionOutcome> {
      return transition(
        ticketNumber,
        actorId,
        ['Open', 'In progress'],
        { status: 'Resolved', resolvedAt: now().toISOString(), resolutionNote: note },
        resolvedUpdate,
      );
    },
  };
}

export type Helpdesk = ReturnType<typeof createHelpdesk>;
