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
const FIXED = { resolution: 'Fixed' } as const;

interface Call {
  method: 'postMessage' | 'update' | 'delete';
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
    delete: async (args: Record<string, unknown>) => {
      calls.push({ method: 'delete', args });
      return { ok: true };
    },
  };
  return { chat: chat as unknown as Chat, calls };
}

describe('helpdesk', () => {
  let store: MemoryTicketStore;
  let calls: Call[];
  let warnings: unknown[][];
  /** What the helpdesk takes to be the current time. */
  let clock: Date;
  let helpdesk: ReturnType<typeof createHelpdesk>;
  /** Opens a Ticket for the Agent the Requester chose. */
  let openedFor: (agentId: string) => Promise<Ticket>;
  /** A helpdesk on the same store and warnings that talks to Slack through `chat`. */
  const withChat = (chat: Chat) =>
    createHelpdesk({
      store,
      chat,
      legacyAgentId: AGENT,
      now: () => clock,
      logger: { warn: (...msg) => warnings.push(msg) },
    });

  beforeEach(() => {
    store = new MemoryTicketStore();
    const fake = fakeChat();
    calls = fake.calls;
    warnings = [];
    clock = new Date('2026-10-14T12:00:00Z');
    helpdesk = withChat(fake.chat);
    openedFor = (agentId) => helpdesk.open({ ...draft, agentId });
  });

  /** Opens and announces a Ticket, so it has an Announcement at `D#general` / `100.3`. */
  async function announced(): Promise<Ticket> {
    const ticket = await helpdesk.open({ ...draft, postToGeneral: true });
    await helpdesk.announce(ticket);
    calls.length = 0;
    return ticket;
  }
  /** The chat calls of one kind made to #general. */
  const generalCalls = (method: Call['method']) =>
    calls.filter((c) => c.method === method && c.args.channel === 'D#general');

  describe('open', () => {
    it('numbers the Ticket, sends a Ticket card to the Agent and a Confirmation to the Requester', async () => {
      const ticket = await helpdesk.open(draft);

      expect(ticket.number).toBe('IT-0001');
      expect(ticket.status).toBe('Open');
      expect(calls.map((c) => c.args.channel)).toEqual([AGENT, REQUESTER]);
      expect(ticket.card).toEqual({ channel: `D${AGENT}`, ts: '100.1' });
      expect(ticket.confirmation).toEqual({ channel: `D${REQUESTER}`, ts: '100.2' });
      expect(await store.get('IT-0001')).toEqual(ticket);
      expect(ticket).not.toHaveProperty('announcement');
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

    it('offers Take, Resolve and Escalate on a new Ticket card', async () => {
      await helpdesk.open(draft);
      expect(buttonsOf(calls[0]!)).toEqual(['ticket_take', 'ticket_resolve', 'ticket_escalate']);
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
      const failing = withChat(failingChat('channel_not_found'));
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

    it('records where the Announcement was posted on the Ticket', async () => {
      const ticket = await helpdesk.open({ ...draft, postToGeneral: true });

      await helpdesk.announce(ticket);

      expect((await store.get(ticket.number))?.announcement).toEqual({
        channel: 'D#general',
        ts: '100.3',
      });
    });

    it('records the Announcement even if the Agent already Took the Ticket', async () => {
      const ticket = await helpdesk.open({ ...draft, postToGeneral: true });
      await helpdesk.take(ticket.number, AGENT);

      await helpdesk.announce(ticket);

      expect(await store.get(ticket.number)).toMatchObject({
        status: 'In progress',
        announcement: { channel: 'D#general' },
      });
    });

    it('records no Announcement when the post fails', async () => {
      const ticket = await helpdesk.open({ ...draft, postToGeneral: true });
      const failing = withChat(failingChat('not_in_channel'));

      await expect(failing.announce(ticket)).rejects.toThrow('not_in_channel');
      expect(await store.get(ticket.number)).not.toHaveProperty('announcement');
    });

    it('only warns if the Announcement cannot be recorded, leaving the Ticket open', async () => {
      const ticket = await helpdesk.open({ ...draft, postToGeneral: true });
      store.recordAnnouncement = async () => {
        throw new Error('ProvisionedThroughputExceeded');
      };

      await helpdesk.announce(ticket);

      expect(warnings).toHaveLength(1);
      expect(String(warnings[0]![0])).toContain(ticket.number);
      expect((await store.get(ticket.number))?.status).toBe('Open');
      expect(await helpdesk.take(ticket.number, AGENT)).toBe('done');
    });
  });

  describe('take', () => {
    it('leaves the Announcement in #general as it is', async () => {
      const ticket = await announced();

      expect(await helpdesk.take(ticket.number, AGENT)).toBe('done');

      expect(calls.filter((c) => c.args.channel === 'D#general')).toEqual([]);
    });

    it('moves an Open Ticket to In progress, updates the card and tells the Requester in the thread', async () => {
      const ticket = await helpdesk.open(draft);
      calls.length = 0;

      expect(await helpdesk.take(ticket.number, AGENT)).toBe('done');

      expect((await store.get(ticket.number))?.status).toBe('In progress');
      const [update, reply] = calls;
      expect(update).toMatchObject({ method: 'update', args: ticket.card });
      expect(buttonsOf(update!)).toEqual(['ticket_resolve', 'ticket_escalate']);
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

      expect(
        await helpdesk.resolve(ticket.number, AGENT, {
          ...FIXED,
          note: 'Restarted the VPN gateway',
        }),
      ).toBe('done');

      const stored = await store.get(ticket.number);
      expect(stored).toMatchObject({
        status: 'Resolved',
        resolution: 'Fixed',
        resolutionNote: 'Restarted the VPN gateway',
      });
      const [update, reply] = calls;
      expect(buttonsOf(update!)).toEqual([]);
      expect(JSON.stringify(reply!.args.blocks)).toContain('Restarted the VPN gateway');
    });

    it('resolves an In progress Ticket without a note', async () => {
      const ticket = await helpdesk.open(draft);
      await helpdesk.take(ticket.number, AGENT);

      expect(await helpdesk.resolve(ticket.number, AGENT, { resolution: 'As designed' })).toBe(
        'done',
      );
      expect(await store.get(ticket.number)).toMatchObject({ resolution: 'As designed' });
      expect((await store.get(ticket.number))?.resolutionNote).toBeUndefined();
    });

    it("is left to the Ticket's own Agent, not any other Agent", async () => {
      const ticket = await openedFor(OTHER_AGENT);
      calls.length = 0;

      expect(await helpdesk.resolve(ticket.number, AGENT, FIXED)).toBe('not-agent');
      expect(await helpdesk.resolve(ticket.number, OTHER_AGENT, FIXED)).toBe('done');

      expect((await store.get(ticket.number))?.status).toBe('Resolved');
      expect(calls[1]!.args.text).toContain(`resolved by <@${OTHER_AGENT}>`);
    });

    it("lets only the Ticket's own Agent open the Resolve form", async () => {
      const ticket = await openedFor(OTHER_AGENT);

      expect(await helpdesk.ticketForAgent(ticket.number, OTHER_AGENT)).toEqual(ticket);
      expect(await helpdesk.ticketForAgent(ticket.number, AGENT)).toBeUndefined();
      expect(await helpdesk.ticketForAgent('IT-9999', AGENT)).toBeUndefined();
    });

    it('never moves a Resolved Ticket', async () => {
      const ticket = await helpdesk.open(draft);
      await helpdesk.resolve(ticket.number, AGENT, FIXED);

      expect(await helpdesk.take(ticket.number, AGENT)).toBe('stale');
      expect(await helpdesk.resolve(ticket.number, AGENT, FIXED)).toBe('stale');
      expect((await store.get(ticket.number))?.status).toBe('Resolved');
    });
  });

  describe('resolve with an Announcement follow-up', () => {
    const generalPosts = () => generalCalls('postMessage');

    it("posts it in the Announcement's thread, naming the Agent, Requester and Ticket, with the Resolution note", async () => {
      const ticket = await announced();

      expect(
        await helpdesk.resolve(ticket.number, AGENT, {
          ...FIXED,
          note: 'Restarted the VPN gateway',
          postFollowUp: true,
        }),
      ).toBe('done');

      const [followUp] = generalPosts();
      expect(followUp).toMatchObject({ method: 'postMessage', args: { thread_ts: '100.3' } });
      expect(followUp!.args).not.toHaveProperty('reply_broadcast');
      expect(followUp!.args.text).toContain(`<@${AGENT}>`);
      expect(followUp!.args.text).toContain(`<@${REQUESTER}>`);
      expect(followUp!.args.text).toContain(ticket.number);
      const blocksJson = JSON.stringify(followUp!.args.blocks);
      expect(blocksJson).toContain(`<@${AGENT}>`);
      expect(blocksJson).toContain(`<@${REQUESTER}>`);
      expect(blocksJson).toContain(ticket.number);
      expect(blocksJson).toContain('Restarted the VPN gateway');
    });

    it('still updates the Ticket card and the Requester as usual', async () => {
      const ticket = await announced();

      await helpdesk.resolve(ticket.number, AGENT, { ...FIXED, postFollowUp: true });

      expect(calls.map((c) => [c.method, c.args.channel])).toEqual([
        ['update', ticket.card.channel],
        ['postMessage', ticket.confirmation.channel],
        ['update', 'D#general'],
        ['postMessage', 'D#general'],
      ]);
    });

    it("shows the Resolution on the card, the Requester's Status update, the Announcement and its follow-up", async () => {
      const ticket = await announced();

      await helpdesk.resolve(ticket.number, AGENT, {
        resolution: "Won't fix",
        note: 'Restarted the VPN gateway',
        postFollowUp: true,
      });

      expect(calls).toHaveLength(4);
      for (const call of calls) expect(JSON.stringify(call.args.blocks)).toContain("Won't fix");
    });

    it('posts nothing in #general unless asked', async () => {
      const ticket = await announced();

      await helpdesk.resolve(ticket.number, AGENT, { ...FIXED, note: 'Done' });

      expect(generalPosts()).toEqual([]);
    });

    it('posts nothing in #general for a Ticket without an Announcement', async () => {
      const ticket = await helpdesk.open(draft);
      calls.length = 0;

      expect(await helpdesk.resolve(ticket.number, AGENT, { ...FIXED, postFollowUp: true })).toBe(
        'done',
      );

      expect(calls.map((c) => c.method)).toEqual(['update', 'postMessage']);
    });

    it('never posts it twice for a double Resolve', async () => {
      const ticket = await announced();

      await helpdesk.resolve(ticket.number, AGENT, { ...FIXED, postFollowUp: true });
      expect(await helpdesk.resolve(ticket.number, AGENT, { ...FIXED, postFollowUp: true })).toBe(
        'stale',
      );

      expect(generalPosts()).toHaveLength(1);
    });

    it('only warns if the follow-up fails, leaving the Ticket Resolved and everyone else updated', async () => {
      const ticket = await announced();
      const fake = fakeChat();
      const postMessage = fake.chat.postMessage;
      fake.chat.postMessage = (async (args: { channel: string }) => {
        if (args.channel === 'D#general') throw new Error('is_archived');
        return postMessage(args as never);
      }) as Chat['postMessage'];
      const flaky = withChat(fake.chat);

      expect(await flaky.resolve(ticket.number, AGENT, { ...FIXED, postFollowUp: true })).toBe(
        'done',
      );

      expect((await store.get(ticket.number))?.status).toBe('Resolved');
      expect(fake.calls.map((c) => [c.method, c.args.channel])).toEqual([
        ['update', ticket.card.channel],
        ['postMessage', ticket.confirmation.channel],
        ['update', 'D#general'],
      ]);
      expect(warnings).toHaveLength(1);
      expect(String(warnings[0]![0])).toContain(ticket.number);
    });
  });

  describe('resolve an announced Ticket', () => {
    const announcementEdits = () => generalCalls('update');

    it('edits the Announcement to show it Resolved, when, and how long it was open', async () => {
      const ticket = await announced();
      clock = new Date('2026-10-14T15:20:00Z');

      await helpdesk.resolve(ticket.number, AGENT, { ...FIXED, note: 'Restarted the VPN gateway' });

      const [edit] = announcementEdits();
      expect(edit!.args.ts).toBe('100.3');
      const blocksJson = JSON.stringify(edit!.args.blocks);
      expect(blocksJson).toContain('VPN is down');
      expect(blocksJson).toContain(`handled by <@${AGENT}>`);
      expect(blocksJson).toContain('Resolved');
      expect(blocksJson).toContain(`<!date^${Date.parse('2026-10-14T15:20:00Z') / 1000}^`);
      expect(blocksJson).toContain('3h 20m');
      expect(edit!.args.text).toContain('Resolved');
      expect(edit!.args.text).toContain('3h 20m');
      expect(JSON.stringify(edit!.args)).not.toContain('Restarted the VPN gateway');
    });

    it('never edits it again for a double Resolve', async () => {
      const ticket = await announced();

      await helpdesk.resolve(ticket.number, AGENT, FIXED);
      expect(await helpdesk.resolve(ticket.number, AGENT, FIXED)).toBe('stale');

      expect(announcementEdits()).toHaveLength(1);
    });

    it('only warns if the edit fails, still posting the follow-up and leaving everyone else updated', async () => {
      const ticket = await announced();
      const fake = fakeChat();
      const update = fake.chat.update;
      fake.chat.update = (async (args: { channel: string }) => {
        if (args.channel === 'D#general') throw new Error('message_not_found');
        return update(args as never);
      }) as Chat['update'];
      const flaky = withChat(fake.chat);

      expect(await flaky.resolve(ticket.number, AGENT, { ...FIXED, postFollowUp: true })).toBe(
        'done',
      );

      expect((await store.get(ticket.number))?.status).toBe('Resolved');
      expect(fake.calls.map((c) => [c.method, c.args.channel])).toEqual([
        ['update', ticket.card.channel],
        ['postMessage', ticket.confirmation.channel],
        ['postMessage', 'D#general'],
      ]);
      expect(warnings).toHaveLength(1);
      expect(String(warnings[0]![0])).toContain(ticket.number);
    });
  });

  describe('escalate', () => {
    /** The Ticket card the new Agent received when `ticket` was Escalated to them. */
    const newCardOf = async (ticket: Ticket) => (await store.get(ticket.number))!.card;

    it('gives an Open Ticket to the chosen Agent, keeping it Open', async () => {
      const ticket = await helpdesk.open(draft);
      clock = new Date('2026-10-14T13:00:00Z');

      expect(await helpdesk.escalate(ticket.number, AGENT, OTHER_AGENT)).toBe('done');

      expect(await store.get(ticket.number)).toMatchObject({
        agentId: OTHER_AGENT,
        status: 'Open',
        escalatedFrom: AGENT,
        escalatedAt: '2026-10-14T13:00:00.000Z',
        card: { channel: `D${OTHER_AGENT}` },
      });
    });

    it('sends the new Agent a Ticket card with the actions for its Status, but no Escalate', async () => {
      const ticket = await helpdesk.open(draft);
      calls.length = 0;

      await helpdesk.escalate(ticket.number, AGENT, OTHER_AGENT);

      const [card] = calls;
      expect(card).toMatchObject({ method: 'postMessage', args: { channel: OTHER_AGENT } });
      expect(buttonsOf(card!)).toEqual(['ticket_take', 'ticket_resolve']);
    });

    it("updates the previous Agent's card to say it was Escalated, with no buttons left", async () => {
      const ticket = await helpdesk.open(draft);
      calls.length = 0;

      await helpdesk.escalate(ticket.number, AGENT, OTHER_AGENT);

      const update = calls.find((c) => c.method === 'update')!;
      expect(update.args).toMatchObject(ticket.card);
      expect(buttonsOf(update)).toEqual([]);
      expect(update.args.text).toContain(`Escalated to <@${OTHER_AGENT}>`);
      expect(JSON.stringify(update.args.blocks)).toContain(`Escalated to <@${OTHER_AGENT}>`);
    });

    it('tells the Requester in the Confirmation thread, naming both Agents', async () => {
      const ticket = await helpdesk.open(draft);
      calls.length = 0;

      await helpdesk.escalate(ticket.number, AGENT, OTHER_AGENT);

      expect(calls.map((c) => [c.method, c.args.channel])).toEqual([
        ['postMessage', OTHER_AGENT],
        ['update', ticket.card.channel],
        ['postMessage', ticket.confirmation.channel],
      ]);
      const reply = calls[2]!.args;
      expect(reply.thread_ts).toBe(ticket.confirmation.ts);
      expect(reply.text).toContain(`from <@${AGENT}> to <@${OTHER_AGENT}>`);
      expect(JSON.stringify(reply.blocks)).toContain(`from <@${AGENT}> to <@${OTHER_AGENT}>`);
    });

    it('keeps an In progress Ticket In progress, for the new Agent to Resolve on their card', async () => {
      const ticket = await helpdesk.open(draft);
      await helpdesk.take(ticket.number, AGENT);
      calls.length = 0;

      await helpdesk.escalate(ticket.number, AGENT, OTHER_AGENT);

      expect((await store.get(ticket.number))?.status).toBe('In progress');
      expect(buttonsOf(calls[0]!)).toEqual(['ticket_resolve']);
      const newCard = await newCardOf(ticket);
      calls.length = 0;
      expect(await helpdesk.resolve(ticket.number, OTHER_AGENT, FIXED)).toBe('done');
      expect(calls[0]).toMatchObject({ method: 'update', args: newCard });
      expect(calls[1]!.args.text).toContain(`resolved by <@${OTHER_AGENT}>`);
    });

    it('lets the new Agent Take an Open Ticket, updating their card', async () => {
      const ticket = await helpdesk.open(draft);
      await helpdesk.escalate(ticket.number, AGENT, OTHER_AGENT);
      const newCard = await newCardOf(ticket);
      calls.length = 0;

      expect(await helpdesk.take(ticket.number, OTHER_AGENT)).toBe('done');

      expect(calls[0]).toMatchObject({ method: 'update', args: newCard });
      expect(buttonsOf(calls[0]!)).toEqual(['ticket_resolve']);
      expect(calls[1]!.args.text).toContain(`<@${OTHER_AGENT}> has taken`);
    });

    it('refuses the previous Agent from then on', async () => {
      const ticket = await helpdesk.open(draft);
      await helpdesk.escalate(ticket.number, AGENT, OTHER_AGENT);

      expect(await helpdesk.take(ticket.number, AGENT)).toBe('not-agent');
      expect(await helpdesk.resolve(ticket.number, AGENT, FIXED)).toBe('not-agent');
      expect(await helpdesk.escalate(ticket.number, AGENT, OTHER_AGENT)).toBe('not-agent');
      expect(await helpdesk.ticketForAgent(ticket.number, AGENT)).toBeUndefined();
    });

    it('is refused for anyone but the Agent, sending nothing', async () => {
      const ticket = await helpdesk.open(draft);
      calls.length = 0;

      expect(await helpdesk.escalate(ticket.number, REQUESTER, OTHER_AGENT)).toBe('not-agent');

      expect(calls).toEqual([]);
      expect((await store.get(ticket.number))?.agentId).toBe(AGENT);
    });

    it('reports unknown Tickets', async () => {
      expect(await helpdesk.escalate('IT-9999', AGENT, OTHER_AGENT)).toBe('not-found');
    });

    it('refuses a second Escalation as stale, changing nothing but refreshing the card', async () => {
      const ticket = await helpdesk.open(draft);
      await helpdesk.escalate(ticket.number, AGENT, OTHER_AGENT);
      const before = await store.get(ticket.number);
      calls.length = 0;

      expect(await helpdesk.escalate(ticket.number, OTHER_AGENT, AGENT)).toBe('stale');

      expect(await store.get(ticket.number)).toEqual(before);
      expect(calls).toEqual([{ method: 'update', args: expect.objectContaining(before!.card) }]);
    });

    it('refuses a Resolved Ticket as stale', async () => {
      const ticket = await helpdesk.open(draft);
      await helpdesk.resolve(ticket.number, AGENT, FIXED);
      calls.length = 0;

      expect(await helpdesk.escalate(ticket.number, AGENT, OTHER_AGENT)).toBe('stale');

      expect((await store.get(ticket.number))?.agentId).toBe(AGENT);
      expect(calls.map((c) => c.method)).toEqual(['update']);
    });

    it('refuses a double submit as stale, removing the extra Ticket card it sent', async () => {
      const ticket = await helpdesk.open(draft);
      calls.length = 0;

      const outcomes = await Promise.all([
        helpdesk.escalate(ticket.number, AGENT, OTHER_AGENT),
        helpdesk.escalate(ticket.number, AGENT, OTHER_AGENT),
      ]);

      expect(outcomes.sort()).toEqual(['done', 'stale']);
      const sent = calls.filter(
        (c) => c.method === 'postMessage' && c.args.channel === OTHER_AGENT,
      );
      expect(sent).toHaveLength(2);
      const kept = await newCardOf(ticket);
      const deleted = calls.filter((c) => c.method === 'delete');
      expect(deleted).toHaveLength(1);
      expect(deleted[0]!.args).toMatchObject({ channel: `D${OTHER_AGENT}` });
      expect(deleted[0]!.args.ts).not.toBe(kept.ts);
      expect(calls.filter((c) => c.args.channel === ticket.confirmation.channel)).toHaveLength(1);
    });

    it('changes nothing if the new Agent cannot be messaged', async () => {
      const ticket = await helpdesk.open(draft);
      const failing = withChat(failingChat('channel_not_found'));

      await expect(failing.escalate(ticket.number, AGENT, OTHER_AGENT)).rejects.toThrow(
        'channel_not_found',
      );
      expect(await store.get(ticket.number)).toEqual(ticket);
    });
  });

  describe('escalate an announced Ticket', () => {
    const announcementEdits = () => generalCalls('update');

    it('edits the Announcement so it is handled by the new Agent', async () => {
      const ticket = await announced();

      await helpdesk.escalate(ticket.number, AGENT, OTHER_AGENT);

      const [edit] = announcementEdits();
      expect(edit!.args.ts).toBe('100.3');
      expect(edit!.args.text).toContain(`handled by <@${OTHER_AGENT}>`);
      expect(JSON.stringify(edit!.args.blocks)).toContain(`handled by <@${OTHER_AGENT}>`);
      expect(JSON.stringify(edit!.args)).not.toContain('Resolved');
    });

    it('still shows the Resolved line, naming the new Agent, once they Resolve it', async () => {
      const ticket = await announced();
      await helpdesk.escalate(ticket.number, AGENT, OTHER_AGENT);
      calls.length = 0;

      await helpdesk.resolve(ticket.number, OTHER_AGENT, FIXED);

      const [edit] = announcementEdits();
      expect(edit!.args.text).toContain(`handled by <@${OTHER_AGENT}>`);
      expect(JSON.stringify(edit!.args.blocks)).toContain('*Resolved* · Fixed');
    });

    it('only warns if the edit fails, leaving the Ticket Escalated and everyone else updated', async () => {
      const ticket = await announced();
      const fake = fakeChat();
      const update = fake.chat.update;
      fake.chat.update = (async (args: { channel: string }) => {
        if (args.channel === 'D#general') throw new Error('message_not_found');
        return update(args as never);
      }) as Chat['update'];
      const flaky = withChat(fake.chat);

      expect(await flaky.escalate(ticket.number, AGENT, OTHER_AGENT)).toBe('done');

      expect((await store.get(ticket.number))?.agentId).toBe(OTHER_AGENT);
      expect(fake.calls.map((c) => [c.method, c.args.channel])).toEqual([
        ['postMessage', OTHER_AGENT],
        ['update', ticket.card.channel],
        ['postMessage', ticket.confirmation.channel],
      ]);
      expect(warnings).toHaveLength(1);
      expect(String(warnings[0]![0])).toContain(ticket.number);
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

      expect((await helpdesk.ticketForAgent(number, AGENT))?.agentId).toBe(AGENT);
      expect(await helpdesk.take(number, OTHER_AGENT)).toBe('not-agent');
      expect(await helpdesk.take(number, AGENT)).toBe('done');
      expect(calls[1]!.args.text).toContain(`<@${AGENT}> has taken`);
      expect(await helpdesk.resolve(number, AGENT, FIXED)).toBe('done');
      expect(calls[3]!.args.text).toContain(`resolved by <@${AGENT}>`);
    });

    it('can be Escalated by the legacy Agent, then belongs to the new Agent', async () => {
      const number = await legacyTicket();

      expect(await helpdesk.escalate(number, OTHER_AGENT, AGENT)).toBe('not-agent');
      expect(await helpdesk.escalate(number, AGENT, OTHER_AGENT)).toBe('done');

      expect(await store.get(number)).toMatchObject({ agentId: OTHER_AGENT, escalatedFrom: AGENT });
      expect(await helpdesk.take(number, AGENT)).toBe('not-agent');
      expect(await helpdesk.take(number, OTHER_AGENT)).toBe('done');
    });
  });
});

/** A chat on which every post fails with `error`. */
function failingChat(error: string): Chat {
  return {
    postMessage: async () => {
      throw new Error(error);
    },
  } as unknown as Chat;
}

function buttonsOf(call: Call): string[] {
  const blocks = call.args.blocks as { type: string; elements?: { action_id: string }[] }[];
  return blocks
    .filter((b) => b.type === 'actions')
    .flatMap((b) => b.elements!.map((e) => e.action_id));
}
