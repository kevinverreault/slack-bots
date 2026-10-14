import type { ViewOutput } from '@slack/bolt';
import { describe, expect, it } from 'vitest';
import { formatTicketNumber } from './ticket.js';
import {
  messagePermalink,
  parseResolveSubmission,
  parseTicketSubmission,
  ticketModal,
} from './views.js';

function submission(
  fields: { title?: string; description?: string; category?: string; urgency?: string },
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
      },
    },
  } as unknown as ViewOutput;
}

describe('parseTicketSubmission', () => {
  it('builds a draft from a complete form, keeping the source permalink', () => {
    const view = submission(
      { title: '  Laptop  ', description: 'Screen flickers', category: 'Hardware', urgency: 'Low' },
      JSON.stringify({ sourcePermalink: 'https://x.slack.com/archives/C1/p1' }),
    );
    expect(parseTicketSubmission(view, 'U1')).toEqual({
      ok: true,
      value: {
        title: 'Laptop',
        description: 'Screen flickers',
        category: 'Hardware',
        urgency: 'Low',
        requesterId: 'U1',
        sourcePermalink: 'https://x.slack.com/archives/C1/p1',
      },
    });
  });

  it('reports blank fields and unknown options against their blocks', () => {
    const view = submission({ title: '   ', description: 'x', category: 'Plumbing' });
    const result = parseTicketSubmission(view, 'U1');
    expect(result.ok).toBe(false);
    expect(Object.keys(!result.ok ? result.errors : {})).toEqual(['title', 'category', 'urgency']);
  });
});

describe('ticketModal', () => {
  it('pre-fills from a message and defaults Urgency to Normal', () => {
    const modal = ticketModal({ description: 'printer on fire', sourcePermalink: 'https://p' });
    const json = JSON.stringify(modal);
    expect(json).toContain('printer on fire');
    expect(JSON.parse(modal.private_metadata!)).toEqual({ sourcePermalink: 'https://p' });
    expect(json).toContain('"initial_option":{"text":{"type":"plain_text","text":"Normal"}');
  });
});

describe('parseResolveSubmission', () => {
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

  it('builds message permalinks', () => {
    expect(messagePermalink('acme', 'C123', '1700000000.123456')).toBe(
      'https://acme.slack.com/archives/C123/p1700000000123456',
    );
  });
});
