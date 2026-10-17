import { describe, expect, it } from 'vitest';
import {
  announcement,
  announcementFollowUp,
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

const json = (message: Message) => JSON.stringify(message);
/** The mrkdwn of each context block, in order. */
const contexts = (message: Message) =>
  message.blocks.flatMap((b) =>
    b.type === 'context' ? b.elements.flatMap((e) => ('text' in e ? [e.text] : [])) : [],
  );
/** The mrkdwn of each section, in order. */
const sections = (message: Message) =>
  message.blocks.flatMap((b) => (b.type === 'section' && b.text ? [b.text.text] : []));

describe('ticketCard', () => {
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
