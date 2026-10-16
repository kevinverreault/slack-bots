import type { ViewOutput } from '@slack/bolt';
import { describe, expect, it } from 'vitest';
import { formatLeadTime, formatTicketNumber } from './ticket.js';
import {
  messagePermalink,
  parseResolveSubmission,
  parseTicketSubmission,
  resolveModal,
  ticketModal,
} from './views.js';

function submission(
  fields: {
    title?: string;
    description?: string;
    category?: string;
    urgency?: string;
    agent?: string;
    share?: string[];
  },
  privateMetadata = '{}',
): ViewOutput {
  const text = (value?: string) => ({ value: { type: 'plain_text_input', value } });
  const select = (value?: string) => ({
    value: { type: 'static_select', selected_option: value ? { value } : null },
  });
  return {
    private_metadata: privateMetadata,
    state: {
      values: {
        title: text(fields.title),
        description: text(fields.description),
        category: select(fields.category),
        urgency: select(fields.urgency),
        agent: select(fields.agent),
        share: {
          value: {
            type: 'checkboxes',
            selected_options: (fields.share ?? []).map((value) => ({ value })),
          },
        },
      },
    },
  } as unknown as ViewOutput;
}

const AGENTS = [
  { id: 'UANA', name: 'Ana' },
  { id: 'UBEN', name: 'UBEN' },
];

const AGENT_IDS = AGENTS.map((a) => a.id);
const complete = {
  title: 'T',
  description: 'D',
  category: 'Other',
  urgency: 'Low',
  agent: 'UANA',
};

describe('parseTicketSubmission', () => {
  it('builds a draft from a complete form, keeping the source permalink', () => {
    const view = submission(
      {
        title: '  Laptop  ',
        description: 'Screen flickers',
        category: 'Hardware',
        urgency: 'Low',
        agent: 'UBEN',
      },
      JSON.stringify({ sourcePermalink: 'https://x.slack.com/archives/C1/p1' }),
    );
    expect(parseTicketSubmission(view, 'U1', AGENT_IDS)).toEqual({
      ok: true,
      value: {
        title: 'Laptop',
        description: 'Screen flickers',
        category: 'Hardware',
        urgency: 'Low',
        requesterId: 'U1',
        agentId: 'UBEN',
        sourcePermalink: 'https://x.slack.com/archives/C1/p1',
      },
    });
  });

  it('flags the Ticket for #general only when the box is ticked', () => {
    const ticked = parseTicketSubmission(
      submission({ ...complete, share: ['general'] }),
      'U1',
      AGENT_IDS,
    );
    const unticked = parseTicketSubmission(submission(complete), 'U1', AGENT_IDS);
    expect(ticked.ok && ticked.value.postToGeneral).toBe(true);
    expect(unticked.ok && 'postToGeneral' in unticked.value).toBe(false);
  });

  it('reports blank fields and unknown options against their blocks', () => {
    const view = submission({ title: '   ', description: 'x', category: 'Plumbing' });
    const result = parseTicketSubmission(view, 'U1', AGENT_IDS);
    expect(result.ok).toBe(false);
    expect(Object.keys(!result.ok ? result.errors : {})).toEqual([
      'title',
      'category',
      'urgency',
      'agent',
    ]);
  });

  it('rejects an Agent who is not on the configured list', () => {
    const result = parseTicketSubmission(
      submission({ ...complete, agent: 'UMALLORY' }),
      'U1',
      AGENT_IDS,
    );
    expect(result).toEqual({ ok: false, errors: { agent: 'Please pick an Agent from the list.' } });
  });

  it('asks for an Agent when none is picked', () => {
    const result = parseTicketSubmission(
      submission({ ...complete, agent: undefined }),
      'U1',
      AGENT_IDS,
    );
    expect(result).toEqual({ ok: false, errors: { agent: 'Please pick an Agent from the list.' } });
  });
});

describe('ticketModal', () => {
  it('pre-fills from a message and defaults Urgency to Normal', () => {
    const modal = ticketModal(AGENTS, {
      description: 'printer on fire',
      sourcePermalink: 'https://p',
    });
    const json = JSON.stringify(modal);
    expect(json).toContain('printer on fire');
    expect(JSON.parse(modal.private_metadata!)).toEqual({ sourcePermalink: 'https://p' });
    expect(json).toContain('"initial_option":{"text":{"type":"plain_text","text":"Normal"}');
  });

  it('asks for an Agent from every configured Agent, with none picked', () => {
    const agentBlock = ticketModal(AGENTS).blocks.find((b) => b.block_id === 'agent');
    expect(agentBlock).toMatchObject({ type: 'input', label: { text: 'Agent' } });
    expect(agentBlock).not.toHaveProperty('optional', true);
    const select = (agentBlock as unknown as { element: Record<string, unknown> }).element;
    expect(select.options).toEqual([
      { text: { type: 'plain_text', text: 'Ana' }, value: 'UANA' },
      { text: { type: 'plain_text', text: 'UBEN' }, value: 'UBEN' },
    ]);
    expect(select).not.toHaveProperty('initial_option');
  });

  it('shows the Agent dropdown even with a single Agent', () => {
    const modal = ticketModal([{ id: 'UANA', name: 'UANA' }]);
    expect(modal.blocks.some((b) => b.block_id === 'agent')).toBe(true);
  });
});

describe('resolveModal', () => {
  const blockIds = (announced: boolean) =>
    resolveModal('IT-0003', { announced }).blocks.map((b) => b.block_id);
  const noteHint = (announced: boolean) =>
    JSON.stringify(
      resolveModal('IT-0003', { announced }).blocks.find((b) => b.block_id === 'note'),
    );

  it('offers to post the resolution in #general, unticked, only for an announced Ticket', () => {
    expect(blockIds(false)).toEqual(['note']);
    expect(blockIds(true)).toEqual(['note', 'share']);
    const share = resolveModal('IT-0003', { announced: true }).blocks[1]!;
    expect(share).toMatchObject({ type: 'input', optional: true });
    expect(JSON.stringify(share)).toContain('Also post the resolution in #general');
    expect(share).not.toHaveProperty('element.initial_options');
  });

  it("warns in the note's hint that it will also show in #general if ticked", () => {
    expect(noteHint(false)).not.toContain('#general');
    expect(noteHint(true)).toContain('#general');
  });
});

describe('parseResolveSubmission', () => {
  const resolveSubmission = (share?: string[]) =>
    ({
      private_metadata: 'IT-0003',
      state: {
        values: {
          note: { value: { type: 'plain_text_input', value: 'Fixed' } },
          ...(share && {
            share: {
              value: { type: 'checkboxes', selected_options: share.map((value) => ({ value })) },
            },
          }),
        },
      },
    }) as unknown as ViewOutput;

  it('asks for an Announcement follow-up only when the box is ticked', () => {
    expect(parseResolveSubmission(resolveSubmission(['general']))).toEqual({
      ticketNumber: 'IT-0003',
      note: 'Fixed',
      postFollowUp: true,
    });
    expect(parseResolveSubmission(resolveSubmission([]))).toEqual({
      ticketNumber: 'IT-0003',
      note: 'Fixed',
    });
    expect(parseResolveSubmission(resolveSubmission())).toEqual({
      ticketNumber: 'IT-0003',
      note: 'Fixed',
    });
  });

  it('drops a blank Resolution note', () => {
    const view = {
      private_metadata: 'IT-0003',
      state: { values: { note: { value: { type: 'plain_text_input', value: '  ' } } } },
    } as unknown as ViewOutput;
    expect(parseResolveSubmission(view)).toEqual({ ticketNumber: 'IT-0003' });
  });
});

describe('helpers', () => {
  it('formats Ticket numbers', () => {
    expect(formatTicketNumber(42)).toBe('IT-0042');
    expect(formatTicketNumber(12345)).toBe('IT-12345');
  });

  it('formats a lead time under an hour in minutes', () => {
    expect(formatLeadTime('2026-10-14T12:00:00Z', '2026-10-14T12:45:30Z')).toBe('45m');
  });

  it('formats a lead time under a minute as such', () => {
    expect(formatLeadTime('2026-10-14T12:00:00Z', '2026-10-14T12:00:40Z')).toBe('under 1m');
  });

  it('formats a longer lead time in its two largest units, dropping a zero one', () => {
    expect(formatLeadTime('2026-10-14T12:00:00Z', '2026-10-14T15:20:00Z')).toBe('3h 20m');
    expect(formatLeadTime('2026-10-14T12:00:00Z', '2026-10-14T14:00:59Z')).toBe('2h');
    expect(formatLeadTime('2026-10-12T09:00:00Z', '2026-10-14T12:45:00Z')).toBe('2d 3h');
    expect(formatLeadTime('2026-10-09T12:00:00Z', '2026-10-14T12:30:00Z')).toBe('5d');
  });

  it('builds message permalinks', () => {
    expect(messagePermalink('acme', 'C123', '1700000000.123456')).toBe(
      'https://acme.slack.com/archives/C123/p1700000000123456',
    );
  });
});
