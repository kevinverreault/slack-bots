import type { ViewOutput } from '@slack/bolt';
import type { ModalView } from '@slack/types';
import type { AgentChoice } from './agents.js';
import { CATEGORIES, URGENCIES, type Category, type TicketDraft, type Urgency } from './ticket.js';

export const OPEN_TICKET_VIEW = 'open_ticket';
export const RESOLVE_TICKET_VIEW = 'resolve_ticket';

const TITLE_MAX = 150;
const DESCRIPTION_MAX = 2900;
const NOTE_MAX = 2900;
const POST_TO_GENERAL = 'general';

export interface TicketModalPrefill {
  title?: string;
  description?: string;
  sourcePermalink?: string;
}

interface TicketModalMetadata {
  sourcePermalink?: string;
}

/** The form a Requester fills in to open a Ticket, choosing one of `agents` to send it to. */
export function ticketModal(agents: AgentChoice[], prefill: TicketModalPrefill = {}): ModalView {
  const metadata: TicketModalMetadata = { sourcePermalink: prefill.sourcePermalink };
  return {
    type: 'modal',
    callback_id: OPEN_TICKET_VIEW,
    private_metadata: JSON.stringify(metadata),
    title: { type: 'plain_text', text: 'New IT ticket' },
    submit: { type: 'plain_text', text: 'Open ticket' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'title',
        label: { type: 'plain_text', text: 'Title' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          max_length: TITLE_MAX,
          placeholder: { type: 'plain_text', text: "e.g. Can't connect to the VPN" },
          ...(prefill.title ? { initial_value: prefill.title.slice(0, TITLE_MAX) } : {}),
        },
      },
      {
        type: 'input',
        block_id: 'description',
        label: { type: 'plain_text', text: 'Description' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          max_length: DESCRIPTION_MAX,
          placeholder: {
            type: 'plain_text',
            text: 'What happened, what you expected, and anything you already tried',
          },
          ...(prefill.description
            ? { initial_value: prefill.description.slice(0, DESCRIPTION_MAX) }
            : {}),
        },
      },
      {
        type: 'input',
        block_id: 'category',
        label: { type: 'plain_text', text: 'Category' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Pick a category' },
          options: CATEGORIES.map(option),
        },
      },
      {
        type: 'input',
        block_id: 'urgency',
        label: { type: 'plain_text', text: 'Urgency' },
        element: {
          type: 'static_select',
          action_id: 'value',
          options: URGENCIES.map(option),
          initial_option: option('Normal'),
        },
      },
      {
        type: 'input',
        block_id: 'agent',
        label: { type: 'plain_text', text: 'Agent' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Pick the Agent to send it to' },
          options: agents.map(({ id, name }) => ({
            text: { type: 'plain_text', text: name },
            value: id,
          })),
        },
      },
      {
        type: 'input',
        block_id: 'share',
        optional: true,
        label: { type: 'plain_text', text: 'Visibility' },
        element: {
          type: 'checkboxes',
          action_id: 'value',
          options: [
            {
              text: { type: 'plain_text', text: 'Also post this ticket in #general' },
              value: POST_TO_GENERAL,
            },
          ],
        },
      },
    ],
  };
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

/** Reads a submitted ticket modal. The chosen Agent must be one of `agentIds`. */
export function parseTicketSubmission(
  view: ViewOutput,
  requesterId: string,
  agentIds: readonly string[],
): ParseResult<TicketDraft> {
  const values = view.state.values;
  const title = values.title?.value?.value?.trim() ?? '';
  const description = values.description?.value?.value?.trim() ?? '';
  const category = values.category?.value?.selected_option?.value as Category | undefined;
  const urgency = values.urgency?.value?.selected_option?.value as Urgency | undefined;
  const agentId = values.agent?.value?.selected_option?.value;
  const postToGeneral = !!values.share?.value?.selected_options?.some(
    (o) => o.value === POST_TO_GENERAL,
  );

  const errors: Record<string, string> = {};
  if (!title) errors.title = 'Please give your ticket a title.';
  if (!description) errors.description = 'Please describe the problem.';
  if (!category || !CATEGORIES.includes(category)) errors.category = 'Please pick a category.';
  if (!urgency || !URGENCIES.includes(urgency)) errors.urgency = 'Please pick an urgency.';
  if (!agentId || !agentIds.includes(agentId)) errors.agent = 'Please pick an Agent from the list.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const metadata = parseMetadata(view.private_metadata);
  return {
    ok: true,
    value: {
      title,
      description,
      category: category!,
      urgency: urgency!,
      requesterId,
      agentId: agentId!,
      ...(metadata.sourcePermalink ? { sourcePermalink: metadata.sourcePermalink } : {}),
      ...(postToGeneral ? { postToGeneral } : {}),
    },
  };
}

/** The form the Agent fills in to Resolve a Ticket. */
export function resolveModal(ticketNumber: string): ModalView {
  return {
    type: 'modal',
    callback_id: RESOLVE_TICKET_VIEW,
    private_metadata: ticketNumber,
    title: { type: 'plain_text', text: `Resolve ${ticketNumber}` },
    submit: { type: 'plain_text', text: 'Resolve' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'note',
        optional: true,
        label: { type: 'plain_text', text: 'Resolution note' },
        hint: { type: 'plain_text', text: 'Sent to the requester.' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          max_length: NOTE_MAX,
          placeholder: { type: 'plain_text', text: 'e.g. Reset your password, please try again.' },
        },
      },
    ],
  };
}

export function parseResolveSubmission(view: ViewOutput): {
  ticketNumber: string;
  note?: string;
} {
  const note = view.state.values.note?.value?.value?.trim();
  return { ticketNumber: view.private_metadata, ...(note ? { note } : {}) };
}

/** Builds a permalink without an API call, so the modal opens within the trigger's 3s window. */
export function messagePermalink(teamDomain: string, channelId: string, ts: string): string {
  return `https://${teamDomain}.slack.com/archives/${channelId}/p${ts.replace('.', '')}`;
}

function option(value: string) {
  return { text: { type: 'plain_text' as const, text: value }, value };
}

function parseMetadata(raw: string): TicketModalMetadata {
  try {
    return JSON.parse(raw) as TicketModalMetadata;
  } catch {
    return {};
  }
}
