import type { WebClient } from '@slack/web-api';
import {
  announcement,
  announcementFollowUp,
  confirmation,
  escalatedAwayCard,
  escalatedUpdate,
  resolvedUpdate,
  takenUpdate,
  ticketCard,
  type Message,
  type TicketDetails,
} from './messages.js';
import {
  canEscalate,
  type MessageRef,
  type Resolution,
  type Ticket,
  type TicketDraft,
} from './ticket.js';
import type { StoredTicket, TicketChanges, TicketStore } from './ticket-store.js';

export type Chat = Pick<WebClient['chat'], 'postMessage' | 'update' | 'delete'>;

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

/** The Ticket lifecycle: open, Take, Resolve, Escalate, and the Slack messages each step produces. */
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

  /** The Ticket has moved on (e.g. a double click): make sure its card reflects reality. */
  async function stale(ticketNumber: string): Promise<ActionOutcome> {
    const current = await findTicket(ticketNumber);
    if (!current) return 'not-found';
    await refreshCard(current);
    return 'stale';
  }

  async function updateAnnouncement(ticket: Ticket, change: string): Promise<void> {
    if (!ticket.announcement) return;
    try {
      await chat.update({ ...ticket.announcement, ...announcement(ticket) });
    } catch (err) {
      // The Ticket has changed and both sides know; a stale Announcement isn't worth alarming anyone.
      logger.warn(`Failed to ${change} the Announcement of ${ticket.number}`, err);
    }
  }

  async function transition(
    ticketNumber: string,
    actorId: string,
    from: Ticket['status'][],
    changes: TicketChanges,
    update: (ticket: Ticket) => Message,
    afterwards?: (ticket: Ticket) => Promise<void>,
  ): Promise<ActionOutcome> {
    const found = await store.get(ticketNumber);
    if (!found) return 'not-found';
    if (actorId !== withAgent(found).agentId) return 'not-agent';
    // Also guard on the Agent, so an Escalation in between turns this into a stale action.
    const stored = await store.update(
      ticketNumber,
      { status: from, agentId: found.agentId ?? null },
      changes,
    );
    if (!stored) return stale(ticketNumber);
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
          await updateAnnouncement(resolved, 'mark Resolved');
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

    /**
     * Makes `toAgentId` the Ticket's Agent, keeping its Status. The new Agent gets a fresh Ticket card,
     * which is the one kept up to date from then on; the previous Agent's card says where it went.
     * The caller makes sure `toAgentId` is another configured Agent.
     */
    async escalate(
      ticketNumber: string,
      actorId: string,
      toAgentId: string,
    ): Promise<ActionOutcome> {
      const found = await store.get(ticketNumber);
      if (!found) return 'not-found';
      const ticket = withAgent(found);
      if (actorId !== ticket.agentId) return 'not-agent';
      if (!canEscalate(ticket)) return stale(ticketNumber);

      const changes = {
        agentId: toAgentId,
        escalatedFrom: ticket.agentId,
        escalatedAt: now().toISOString(),
      };
      // Post to the new Agent first, as in `open`: one who can't be messaged fails before anything changes.
      const card = await post(toAgentId, ticketCard({ ...ticket, ...changes }));
      // Guard on the Status as read too, so the new card can't show actions the Ticket has moved past.
      const stored = await store.update(
        ticketNumber,
        { status: [ticket.status], agentId: found.agentId ?? null, unescalated: true },
        { ...changes, card },
      );
      if (!stored) {
        // Lost a race (e.g. a double submit): the card just sent belongs to no Ticket.
        await chat.delete(card);
        return stale(ticketNumber);
      }

      const escalated = withAgent(stored);
      await chat.update({ ...ticket.card, ...escalatedAwayCard(escalated) });
      await post(
        escalated.confirmation.channel,
        escalatedUpdate(escalated),
        escalated.confirmation.ts,
      );
      await updateAnnouncement(escalated, 'name the new Agent in');
      return 'done';
    },
  };
}

export type Helpdesk = ReturnType<typeof createHelpdesk>;
