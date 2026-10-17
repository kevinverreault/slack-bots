import type { WebClient } from '@slack/web-api';
import {
  announcement,
  announcementFollowUp,
  confirmation,
  resolvedUpdate,
  takenUpdate,
  ticketCard,
  type Message,
  type TicketDetails,
} from './messages.js';
import type { MessageRef, Resolution, Ticket, TicketDraft } from './ticket.js';
import type { StoredTicket, TicketChanges, TicketStore } from './ticket-store.js';

export type Chat = Pick<WebClient['chat'], 'postMessage' | 'update'>;

export interface HelpdeskDeps {
  store: TicketStore;
  chat: Chat;
  /** The Agent assumed for stored Tickets opened before Agents were recorded. */
  legacyAgentId: string;
  now: () => Date;
  logger: { warn(...msg: unknown[]): void };
}

/** Where Announcements go. Slack accepts a channel name here; `chat:write.public` lets the bot post without joining. */
export const GENERAL_CHANNEL = '#general';

export type ActionOutcome = 'done' | 'not-agent' | 'not-found' | 'stale';

/** What the Agent says when Resolving a Ticket. */
export interface ResolveDetails {
  resolution: Resolution;
  /** The Resolution note for the Requester. */
  note?: string;
  /** Also post an Announcement follow-up, if the Ticket has an Announcement. */
  postFollowUp?: boolean;
}

/** The Ticket lifecycle: open, Take, Resolve, and the Slack messages each step produces. */
export function createHelpdesk({ store, chat, legacyAgentId, now, logger }: HelpdeskDeps) {
  async function post(channel: string, message: Message, threadTs?: string): Promise<MessageRef> {
    const res = await chat.postMessage({ channel, ...message, thread_ts: threadTs });
    if (!res.channel || !res.ts) throw new Error(`chat.postMessage to ${channel} returned no ts`);
    return { channel: res.channel, ts: res.ts };
  }

  async function refreshCard(ticket: Ticket): Promise<void> {
    await chat.update({ ...ticket.card, ...ticketCard(ticket) });
  }

  /** Tickets opened before Agents were recorded belong to the legacy Agent. */
  function withAgent(stored: StoredTicket): Ticket {
    return { ...stored, agentId: stored.agentId ?? legacyAgentId };
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
    afterwards?: (ticket: Ticket) => Promise<void>,
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
    await afterwards?.(updated);
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
      // Post to the Agent first: an Agent who can't be messaged fails before the Requester is told anything.
      const card = await post(details.agentId, ticketCard(details));
      const confirmationRef = await post(draft.requesterId, confirmation(details));
      const ticket: Ticket = { ...details, card, confirmation: confirmationRef };
      await store.create(ticket);
      return ticket;
    },

    /**
     * Posts the Ticket in #general and records where. Kept apart from `open` so a failure here
     * can't undo an opened Ticket. Failing to record only costs later replies in its thread.
     */
    async announce(ticket: Ticket): Promise<void> {
      const posted = await post(GENERAL_CHANNEL, announcement(ticket));
      try {
        await store.recordAnnouncement(ticket.number, posted);
      } catch (err) {
        logger.warn(`Announced ${ticket.number} but could not record its Announcement`, err);
      }
    },

    /** The Ticket, if it exists and `userId` is its Agent, and so may act on it. */
    async ticketForAgent(ticketNumber: string, userId: string): Promise<Ticket | undefined> {
      const ticket = await findTicket(ticketNumber);
      return ticket?.agentId === userId ? ticket : undefined;
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

    resolve(
      ticketNumber: string,
      actorId: string,
      { resolution, note, postFollowUp = false }: ResolveDetails,
    ): Promise<ActionOutcome> {
      return transition(
        ticketNumber,
        actorId,
        ['Open', 'In progress'],
        { status: 'Resolved', resolvedAt: now().toISOString(), resolution, resolutionNote: note },
        resolvedUpdate,
        async (resolved) => {
          if (!resolved.announcement) return;
          const { channel, ts } = resolved.announcement;
          try {
            await chat.update({ channel, ts, ...announcement(resolved) });
          } catch (err) {
            // As with the follow-up: the Ticket is Resolved and both sides know.
            logger.warn(`Failed to mark the Announcement of ${resolved.number} Resolved`, err);
          }
          if (!postFollowUp) return;
          try {
            await post(channel, announcementFollowUp(resolved), ts);
          } catch (err) {
            // The Ticket is Resolved and both sides know; a missing follow-up isn't worth alarming anyone.
            logger.warn(`Failed to post the Announcement follow-up for ${resolved.number}`, err);
          }
        },
      );
    },
  };
}

export type Helpdesk = ReturnType<typeof createHelpdesk>;
