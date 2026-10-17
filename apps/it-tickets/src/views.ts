import type { ViewOutput } from '@slack/bolt';
import type { ModalView } from '@slack/types';
import type { AgentChoice } from './agents.js';
import type { ResolveDetails } from './helpdesk.js';
import {
  CATEGORIES,
  RESOLUTIONS,
  URGENCIES,
  type Category,
  type Resolution,
  type TicketDraft,
  type Urgency,
} from './ticket.js';

export const OPEN_TICKET_VIEW = 'open_ticket';
export const RESOLVE_TICKET_VIEW = 'resolve_ticket';
export const ESCALATE_TICKET_VIEW = 'escalate_ticket';

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
      agentSelect(agents, 'Pick the Agent to send it to'),
      generalCheckbox('Also post this ticket in #general'),
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
  const agentId = chosenAgent(values, agentIds);
  const postToGeneral = generalTicked(values);

  const errors: Record<string, string> = {};
  if (!title) errors.title = 'Please give your ticket a title.';
  if (!description) errors.description = 'Please describe the problem.';
  if (!category || !CATEGORIES.includes(category)) errors.category = 'Please pick a category.';
  if (!urgency || !URGENCIES.includes(urgency)) errors.urgency = 'Please pick an urgency.';
  if (!agentId) errors.agent = PICK_AN_AGENT;
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

/**
 * The form the Agent fills in to Resolve a Ticket. For an `announced` Ticket, the Agent can also
 * ask for an Announcement follow-up.
 */
export function resolveModal(ticketNumber: string, { announced = false } = {}): ModalView {
  const blocks: ModalView['blocks'] = [
    {
      type: 'input',
      block_id: 'resolution',
      label: { type: 'plain_text', text: 'Resolution' },
      element: {
        type: 'static_select',
        action_id: 'value',
        placeholder: { type: 'plain_text', text: 'How did this ticket end?' },
        options: RESOLUTIONS.map(option),
      },
    },
    {
      type: 'input',
      block_id: 'note',
      optional: true,
      label: { type: 'plain_text', text: 'Resolution note' },
      hint: {
        type: 'plain_text',
        text: announced
          ? 'Sent to the requester. Also shown in #general if you tick the box below.'
          : 'Sent to the requester.',
      },
      element: {
        type: 'plain_text_input',
        action_id: 'value',
        multiline: true,
        max_length: NOTE_MAX,
        placeholder: { type: 'plain_text', text: 'e.g. Reset your password, please try again.' },
      },
    },
  ];
  if (announced) blocks.push(generalCheckbox('Also post the resolution in #general'));
  return {
    type: 'modal',
    callback_id: RESOLVE_TICKET_VIEW,
    private_metadata: ticketNumber,
    title: { type: 'plain_text', text: `Resolve ${ticketNumber}` },
    submit: { type: 'plain_text', text: 'Resolve' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks,
  };
}

export type ResolveSubmission = { ticketNumber: string } & ResolveDetails;

export function parseResolveSubmission(view: ViewOutput): ParseResult<ResolveSubmission> {
  const values = view.state.values;
  const resolution = values.resolution?.value?.selected_option?.value as Resolution | undefined;
  const note = values.note?.value?.value?.trim();
  const postFollowUp = generalTicked(values);
  if (!resolution || !RESOLUTIONS.includes(resolution)) {
    return { ok: false, errors: { resolution: 'Please pick a resolution.' } };
  }
  return {
    ok: true,
    value: {
      ticketNumber: view.private_metadata,
      resolution,
      ...(note ? { note } : {}),
      ...(postFollowUp ? { postFollowUp } : {}),
    },
  };
}

/**
 * The form the Agent fills in to Escalate a Ticket to one of `agents`, which leaves out the Agent
 * themselves. With no one to escalate to, it only says so.
 */
export function escalateModal(ticketNumber: string, agents: AgentChoice[]): ModalView {
  const modal: ModalView = {
    type: 'modal',
    callback_id: ESCALATE_TICKET_VIEW,
    private_metadata: ticketNumber,
    title: { type: 'plain_text', text: `Escalate ${ticketNumber}` },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [agentSelect(agents, 'Pick the Agent to escalate to')],
  };
  if (agents.length > 0) return { ...modal, submit: { type: 'plain_text', text: 'Escalate' } };
  return {
    ...modal,
    close: { type: 'plain_text', text: 'OK' },
    blocks: [
      {
        type: 'section',
        text: { type: 'plain_text', text: 'There is no other Agent to escalate this ticket to.' },
      },
    ],
  };
}

export interface EscalateSubmission {
  ticketNumber: string;
  /** The Agent to Escalate to. */
  agentId: string;
}

/** Reads a submitted Escalate modal. The chosen Agent must be one of `agentIds`, other than `actorId`. */
export function parseEscalateSubmission(
  view: ViewOutput,
  agentIds: readonly string[],
  actorId: string,
): ParseResult<EscalateSubmission> {
  const agentId = chosenAgent(
    view.state.values,
    agentIds.filter((id) => id !== actorId),
  );
  if (!agentId) return { ok: false, errors: { agent: PICK_AN_AGENT } };
  return { ok: true, value: { ticketNumber: view.private_metadata, agentId } };
}

/** Builds a permalink without an API call, so the modal opens within the trigger's 3s window. */
export function messagePermalink(teamDomain: string, channelId: string, ts: string): string {
  return `https://${teamDomain}.slack.com/archives/${channelId}/p${ts.replace('.', '')}`;
}

const PICK_AN_AGENT = 'Please pick an Agent from the list.';

/** A required dropdown of `agents`, with none picked. */
function agentSelect(agents: AgentChoice[], placeholder: string): ModalView['blocks'][number] {
  return {
    type: 'input',
    block_id: 'agent',
    label: { type: 'plain_text', text: 'Agent' },
    element: {
      type: 'static_select',
      action_id: 'value',
      placeholder: { type: 'plain_text', text: placeholder },
      options: agents.map(({ id, name }) => ({
        text: { type: 'plain_text', text: name },
        value: id,
      })),
    },
  };
}

/** The Agent picked in the `agent` dropdown, if it is one of `allowed`. */
function chosenAgent(
  values: ViewOutput['state']['values'],
  allowed: readonly string[],
): string | undefined {
  const agentId = values.agent?.value?.selected_option?.value;
  return agentId && allowed.includes(agentId) ? agentId : undefined;
}

/** An optional, unticked box asking to also post something in #general. */
function generalCheckbox(text: string): ModalView['blocks'][number] {
  return {
    type: 'input',
    block_id: 'share',
    optional: true,
    label: { type: 'plain_text', text: 'Visibility' },
    element: {
      type: 'checkboxes',
      action_id: 'value',
      options: [{ text: { type: 'plain_text', text }, value: POST_TO_GENERAL }],
    },
  };
}

function generalTicked(values: ViewOutput['state']['values']): boolean {
  return !!values.share?.value?.selected_options?.some((o) => o.value === POST_TO_GENERAL);
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
