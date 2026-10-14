import { beforeEach, describe, expect, it } from 'vitest';
import { createHelpdesk, type Chat } from './helpdesk.js';
import { MemoryTicketStore } from './memory-ticket-store.js';
import type { Ticket, TicketDraft } from './ticket.js';

const AGENT = 'UAGENT';
const OTHER_AGENT = 'UOTHER';
const REQUESTER = 'UREQ';
const draft: TicketDraft = {
  title: 'VPN is down',
  description: "Can't connect since this morning",
  category: 'Network',
  urgency: 'High',
  requesterId: REQUESTER,
  agentId: AGENT,
};

interface Call {
  method: 'postMessage' | 'update';
  args: Record<string, unknown>;
}

/** Records chat calls; each user's DM gets a channel id `D<user>`. */
function fakeChat() {
  const calls: Call[] = [];
  let ts = 0;
  const chat = {
    postMessage: async (args: Record<string, unknown>) => {
      calls.push({ method: 'postMessage', args });
      return { ok: true, channel: `D${String(args.channel)}`, ts: `100.${++ts}` };
    },
    update: async (args: Record<string, unknown>) => {
      calls.push({ method: 'update', args });
      return { ok: true };
    },
  };
  return { chat: chat as unknown as Chat, calls };
}

describe('helpdesk', () => {
  let store: MemoryTicketStore;
  let calls: Call[];
  let helpdesk: ReturnType<typeof createHelpdesk>;
  /** Opens a Ticket for the Agent the Requester chose. */
  let openedFor: (agentId: string) => Promise<Ticket>;

  beforeEach(() => {
    store = new MemoryTicketStore();
    const fake = fakeChat();
    calls = fake.calls;
    helpdesk = createHelpdesk({
      store,
      chat: fake.chat,
      legacyAgentId: AGENT,
      now: () => new Date('2026-10-14T12:00:00Z'),
    });
    openedFor = (agentId) => helpdesk.open({ ...draft, agentId });
  });

  describe('open', () => {
    it('numbers the Ticket, sends a Ticket card to the Agent and a Confirmation to the Requester', async () => {
      const ticket = await helpdesk.open(draft);

      expect(ticket.number).toBe('IT-0001');
      expect(ticket.status).toBe('Open');
      expect(calls.map((c) => c.args.channel)).toEqual([AGENT, REQUESTER]);
      expect(ticket.card).toEqual({ channel: `D${AGENT}`, ts: '100.1' });
      expect(ticket.confirmation).toEqual({ channel: `D${REQUESTER}`, ts: '100.2' });
      expect(await store.get('IT-0001')).toEqual(ticket);
    });

    it('records the Agent the Requester chose', async () => {
      const ticket = await openedFor(OTHER_AGENT);
      expect(ticket.agentId).toBe(OTHER_AGENT);
      expect((await store.get(ticket.number))?.agentId).toBe(OTHER_AGENT);
    });

    it('sends each Ticket card to the Agent the Requester chose, and names them in the Confirmation', async () => {
      const first = await openedFor(AGENT);
      const second = await openedFor(OTHER_AGENT);

      expect(first.card.channel).toBe(`D${AGENT}`);
      expect(second.card.channel).toBe(`D${OTHER_AGENT}`);
      expect(calls.map((c) => c.args.channel)).toEqual([AGENT, REQUESTER, OTHER_AGENT, REQUESTER]);
      expect(calls[1]!.args.text).toContain(`<@${AGENT}> will be in touch`);
      expect(calls[3]!.args.text).toContain(`<@${OTHER_AGENT}> will be in touch`);
    });

    it('offers Take and Resolve on a new Ticket card', async () => {
      await helpdesk.open(draft);
      expect(buttonsOf(calls[0]!)).toEqual(['ticket_take', 'ticket_resolve']);
    });

    it('names the Agent in the Confirmation', async () => {
      await helpdesk.open(draft);
      const confirmation = calls[1]!.args;
      expect(confirmation.text).toContain(`<@${AGENT}> will be in touch`);
      expect(JSON.stringify(confirmation.blocks)).toContain(`<@${AGENT}> will be in touch`);
    });

    it('gives each Ticket the next number', async () => {
      await helpdesk.open(draft);
      expect((await helpdesk.open(draft)).number).toBe('IT-0002');
    });

    it('stores nothing if the Agent cannot be messaged', async () => {
      const failing = createHelpdesk({
        store,
        legacyAgentId: AGENT,
        now: () => new Date(),
        chat: {
          postMessage: async () => {
            throw new Error('channel_not_found');
          },
        } as unknown as Chat,
      });
      await expect(failing.open(draft)).rejects.toThrow('channel_not_found');
      expect(store.tickets.size).toBe(0);
    });
  });

  describe('announce', () => {
    it('posts the Ticket in #general', async () => {
      const ticket = await helpdesk.open({ ...draft, postToGeneral: true });
      calls.length = 0;

      await helpdesk.announce(ticket);

      expect(calls).toHaveLength(1);
      expect(calls[0]!.args.channel).toBe('#general');
      expect(JSON.stringify(calls[0]!.args.blocks)).toContain(ticket.number);
    });

    it('names the Agent in the Announcement', async () => {
      const ticket = await helpdesk.open({ ...draft, postToGeneral: true });
      calls.length = 0;

      await helpdesk.announce(ticket);

      const announcement = calls[0]!.args;
      expect(announcement.text).toContain(`handled by <@${AGENT}>`);
      expect(JSON.stringify(announcement.blocks)).toContain(`handled by <@${AGENT}>`);
    });

    it('names the Agent the Requester chose', async () => {
      const ticket = await openedFor(OTHER_AGENT);
      calls.length = 0;

      await helpdesk.announce(ticket);

      expect(calls[0]!.args.text).toContain(`handled by <@${OTHER_AGENT}>`);
    });
  });

  describe('take', () => {
    it('moves an Open Ticket to In progress, updates the card and tells the Requester in the thread', async () => {
      const ticket = await helpdesk.open(draft);
      calls.length = 0;

      expect(await helpdesk.take(ticket.number, AGENT)).toBe('done');

      expect((await store.get(ticket.number))?.status).toBe('In progress');
      const [update, reply] = calls;
      expect(update).toMatchObject({ method: 'update', args: ticket.card });
      expect(buttonsOf(update!)).toEqual(['ticket_resolve']);
      expect(reply).toMatchObject({
        method: 'postMessage',
        args: { channel: ticket.confirmation.channel, thread_ts: ticket.confirmation.ts },
      });
    });

    it('is refused for anyone but the Agent', async () => {
      const ticket = await helpdesk.open(draft);
      expect(await helpdesk.take(ticket.number, REQUESTER)).toBe('not-agent');
      expect((await store.get(ticket.number))?.status).toBe('Open');
    });

    it('only refreshes the card when the Ticket was already taken', async () => {
      const ticket = await helpdesk.open(draft);
      await helpdesk.take(ticket.number, AGENT);
      calls.length = 0;

      expect(await helpdesk.take(ticket.number, AGENT)).toBe('stale');
      expect(calls.map((c) => c.method)).toEqual(['update']);
    });

    it('reports unknown Tickets', async () => {
      expect(await helpdesk.take('IT-9999', AGENT)).toBe('not-found');
    });

    it("is left to the Ticket's own Agent, not any other Agent", async () => {
      const ticket = await openedFor(OTHER_AGENT);
      calls.length = 0;

      expect(await helpdesk.take(ticket.number, AGENT)).toBe('not-agent');
      expect(await helpdesk.take(ticket.number, OTHER_AGENT)).toBe('done');

      expect((await store.get(ticket.number))?.status).toBe('In progress');
      expect(calls[1]!.args.text).toContain(`<@${OTHER_AGENT}> has taken`);
    });
  });

  describe('resolve', () => {
    it('resolves straight from Open, with the Resolution note relayed to the Requester', async () => {
      const ticket = await helpdesk.open(draft);
      calls.length = 0;

      expect(await helpdesk.resolve(ticket.number, AGENT, 'Restarted the VPN gateway')).toBe(
        'done',
      );

      const stored = await store.get(ticket.number);
      expect(stored).toMatchObject({
        status: 'Resolved',
        resolutionNote: 'Restarted the VPN gateway',
      });
      const [update, reply] = calls;
      expect(buttonsOf(update!)).toEqual([]);
      expect(JSON.stringify(reply!.args.blocks)).toContain('Restarted the VPN gateway');
    });

    it('resolves an In progress Ticket without a note', async () => {
      const ticket = await helpdesk.open(draft);
      await helpdesk.take(ticket.number, AGENT);

      expect(await helpdesk.resolve(ticket.number, AGENT)).toBe('done');
      expect((await store.get(ticket.number))?.resolutionNote).toBeUndefined();
    });

    it("is left to the Ticket's own Agent, not any other Agent", async () => {
      const ticket = await openedFor(OTHER_AGENT);
      calls.length = 0;

      expect(await helpdesk.resolve(ticket.number, AGENT)).toBe('not-agent');
      expect(await helpdesk.resolve(ticket.number, OTHER_AGENT)).toBe('done');

      expect((await store.get(ticket.number))?.status).toBe('Resolved');
      expect(calls[1]!.args.text).toContain(`resolved by <@${OTHER_AGENT}>`);
    });

    it("lets only the Ticket's own Agent open the Resolve form", async () => {
      const ticket = await openedFor(OTHER_AGENT);

      expect(await helpdesk.isAgentOf(ticket.number, OTHER_AGENT)).toBe(true);
      expect(await helpdesk.isAgentOf(ticket.number, AGENT)).toBe(false);
      expect(await helpdesk.isAgentOf('IT-9999', AGENT)).toBe(false);
    });

    it('never moves a Resolved Ticket', async () => {
      const ticket = await helpdesk.open(draft);
      await helpdesk.resolve(ticket.number, AGENT);

      expect(await helpdesk.take(ticket.number, AGENT)).toBe('stale');
      expect(await helpdesk.resolve(ticket.number, AGENT)).toBe('stale');
      expect((await store.get(ticket.number))?.status).toBe('Resolved');
    });
  });

  describe('a Ticket opened before Agents were recorded', () => {
    /** Stores a Ticket the way it was stored before it had an `agentId`. */
    async function legacyTicket(): Promise<string> {
      const { agentId: _agentId, ...legacy } = await helpdesk.open(draft);
      store.tickets.clear();
      await store.create(legacy as Ticket);
      calls.length = 0;
      return legacy.number;
    }

    it('belongs to the legacy Agent', async () => {
      const number = await legacyTicket();

      expect(await helpdesk.isAgentOf(number, AGENT)).toBe(true);
      expect(await helpdesk.take(number, OTHER_AGENT)).toBe('not-agent');
      expect(await helpdesk.take(number, AGENT)).toBe('done');
      expect(calls[1]!.args.text).toContain(`<@${AGENT}> has taken`);
      expect(await helpdesk.resolve(number, AGENT)).toBe('done');
      expect(calls[3]!.args.text).toContain(`resolved by <@${AGENT}>`);
    });
  });
});

function buttonsOf(call: Call): string[] {
  const blocks = call.args.blocks as { type: string; elements?: { action_id: string }[] }[];
  return blocks
    .filter((b) => b.type === 'actions')
    .flatMap((b) => b.elements!.map((e) => e.action_id));
}
