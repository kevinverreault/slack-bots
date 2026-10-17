import { describe, expect, it } from 'vitest';
import {
  announcement,
  announcementFollowUp,
  escalatedAwayCard,
  escalatedUpdate,
  resolvedUpdate,
  ticketCard,
  type Message,
  type TicketDetails,
} from './messages.js';

const resolved: TicketDetails = {
  number: 'IT-0007',
  title: 'VPN is down',
  description: "Can't connect since this morning",
  category: 'Network',
  urgency: 'High',
  requesterId: 'UREQ',
  agentId: 'UAGENT',
  status: 'Resolved',
  createdAt: '2026-10-14T12:00:00Z',
  resolvedAt: '2026-10-14T15:20:00Z',
  resolution: 'Unable to reproduce',
  resolutionNote: 'Works for me now',
};

/** A Ticket Resolved before Resolutions existed. */
const { resolution: _resolution, ...legacy } = resolved;

/** `resolved`, Escalated from UAGENT to UOTHER while still In progress. */
const escalated: TicketDetails = {
  ...resolved,
  status: 'In progress',
  agentId: 'UOTHER',
  escalatedFrom: 'UAGENT',
  escalatedAt: '2026-10-14T13:00:00Z',
  resolvedAt: undefined,
  resolution: undefined,
  resolutionNote: undefined,
};

const json = (message: Message) => JSON.stringify(message);
/** The action IDs of the message's buttons, in order. */
const buttons = (message: Message) =>
  message.blocks.flatMap((b) => (b.type === 'actions' ? b.elements.map((e) => e.action_id) : []));
/** The mrkdwn of each context block, in order. */
const contexts = (message: Message) =>
  message.blocks.flatMap((b) =>
    b.type === 'context' ? b.elements.flatMap((e) => ('text' in e ? [e.text] : [])) : [],
  );
/** The mrkdwn of each section, in order. */
const sections = (message: Message) =>
  message.blocks.flatMap((b) => (b.type === 'section' && b.text ? [b.text.text] : []));

describe('ticketCard', () => {
  it('offers Escalate until the Ticket is Escalated or Resolved', () => {
    const open = { ...escalated, status: 'Open', escalatedFrom: undefined } as const;
    expect(buttons(ticketCard(open))).toEqual(['ticket_take', 'ticket_resolve', 'ticket_escalate']);
    expect(buttons(ticketCard({ ...open, status: 'In progress' }))).toEqual([
      'ticket_resolve',
      'ticket_escalate',
    ]);
    expect(buttons(ticketCard({ ...escalated, status: 'Open' }))).toEqual([
      'ticket_take',
      'ticket_resolve',
    ]);
    expect(buttons(ticketCard(escalated))).toEqual(['ticket_resolve']);
    expect(buttons(ticketCard(resolved))).toEqual([]);
  });

  it('tells the new Agent who Escalated the Ticket to them', () => {
    expect(contexts(ticketCard(escalated))[0]).toBe(
      'Ticket from <@UREQ>, escalated to you by <@UAGENT>',
    );
    expect(contexts(ticketCard({ ...escalated, status: 'Open' }))[0]).toBe(
      'Ticket from <@UREQ>, escalated to you by <@UAGENT>',
    );
  });

  it('shows the Resolution of a Resolved Ticket', () => {
    expect(json(ticketCard(resolved))).toContain('*Resolution*\\nUnable to reproduce');
  });

  it('shows no Resolution for a Ticket Resolved without one', () => {
    const card = json(ticketCard(legacy));
    expect(card).not.toContain('*Resolution*\\n');
    expect(card).not.toContain('undefined');
    expect(card).toContain('*Resolution note*');
  });
});

describe('escalatedAwayCard', () => {
  it('shows the previous Agent the Ticket, where it went, and no buttons', () => {
    const card = escalatedAwayCard(escalated);
    expect(contexts(card)[0]).toBe('Ticket from <@UREQ> · ⏫ Escalated to <@UOTHER>');
    expect(card.text).toBe('🎫 IT-0007 (⏫ Escalated to <@UOTHER>): VPN is down');
    expect(json(card)).toContain("Can't connect since this morning");
    expect(buttons(card)).toEqual([]);
  });
});

describe('escalatedUpdate', () => {
  it('tells the Requester from whom and to whom their Ticket was Escalated', () => {
    const update = escalatedUpdate(escalated);
    expect(sections(update)).toEqual([
      '⏫ *IT-0007* has been escalated from <@UAGENT> to <@UOTHER>.',
    ]);
    expect(update.text).toBe('⏫ *IT-0007* has been escalated from <@UAGENT> to <@UOTHER>.');
  });
});

describe('resolvedUpdate', () => {
  it('shows the Resolution, then the Resolution note', () => {
    const update = resolvedUpdate(resolved);
    expect(sections(update)).toEqual([
      '✅ *IT-0007* has been resolved by <@UAGENT>.',
      '*Resolution:* Unable to reproduce',
      '> Works for me now',
    ]);
    expect(update.text).toContain('Unable to reproduce');
  });

  it('shows the Resolution alone when there is no Resolution note', () => {
    const { resolutionNote: _note, ...withoutNote } = resolved;
    expect(sections(resolvedUpdate(withoutNote))).toEqual([
      '✅ *IT-0007* has been resolved by <@UAGENT>.',
      '*Resolution:* Unable to reproduce',
    ]);
  });

  it('reads as before for a Ticket Resolved without a Resolution', () => {
    const update = resolvedUpdate(legacy);
    expect(sections(update)).toEqual([
      '✅ *IT-0007* has been resolved by <@UAGENT>.',
      '> Works for me now',
    ]);
    expect(update.text).toBe('✅ *IT-0007* has been resolved by <@UAGENT>.');
  });
});

describe('announcementFollowUp', () => {
  const headline = "✅ <@UAGENT> resolved <@UREQ>'s IT ticket *IT-0007*.";

  it('shows the Resolution, then the Resolution note', () => {
    const followUp = announcementFollowUp(resolved);
    expect(sections(followUp)).toEqual([
      headline,
      '*Resolution:* Unable to reproduce',
      '> Works for me now',
    ]);
    expect(followUp.text).toContain('Unable to reproduce');
  });

  it('reads as before for a Ticket Resolved without a Resolution', () => {
    const { resolutionNote: _note, ...bare } = legacy;
    expect(announcementFollowUp(bare)).toEqual({ text: headline, blocks: [expect.anything()] });
    expect(sections(announcementFollowUp(legacy))).toEqual([headline, '> Works for me now']);
  });
});

describe('announcement', () => {
  it('names the new Agent once Escalated, with no Resolved line', () => {
    const post = announcement(escalated);
    expect(sections(post)[0]).toBe('📣 <@UREQ> opened IT ticket *IT-0007* · handled by <@UOTHER>');
    expect(contexts(post)).toEqual([]);
  });

  const resolvedAt = '<!date^1791991200^{date_short_pretty} {time}|2026-10-14T15:20:00Z>';

  it('shows the Resolution on its Resolved line, with when and the Lead time, but never the note', () => {
    const post = announcement(resolved);
    expect(contexts(post)).toEqual([
      `✅ *Resolved* · Unable to reproduce · ${resolvedAt} · open for 3h 20m`,
    ]);
    expect(post.text).toContain('(✅ Resolved · Unable to reproduce, open for 3h 20m)');
    expect(json(post)).not.toContain('Works for me now');
  });

  it('reads as before for a Ticket Resolved without a Resolution', () => {
    const post = announcement(legacy);
    expect(contexts(post)).toEqual([`✅ *Resolved* ${resolvedAt} · open for 3h 20m`]);
    expect(post.text).toContain('(✅ Resolved, open for 3h 20m)');
    expect(json(post)).not.toContain('undefined');
  });
});
