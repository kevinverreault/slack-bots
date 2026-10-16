import type { KnownBlock } from '@slack/types';
import { canResolve, canTake, type Ticket } from './ticket.js';

export const TAKE_ACTION = 'ticket_take';
export const RESOLVE_ACTION = 'ticket_resolve';

/** A Ticket before it has been posted anywhere. */
export type TicketDetails = Omit<Ticket, 'confirmation' | 'card'>;

export interface Message {
  text: string;
  blocks: KnownBlock[];
}

const STATUS_EMOJI = { Open: '🆕', 'In progress': '🛠️', Resolved: '✅' } as const;
const URGENCY_EMOJI = { Low: '🟢', Normal: '🟡', High: '🔴' } as const;

/** The Agent's view of a Ticket, kept up to date as its Status changes. */
export function ticketCard(ticket: TicketDetails): Message {
  const blocks: KnownBlock[] = [
    header(`🎫 ${ticket.number}: ${ticket.title}`),
    context(
      ticket.status === 'Open'
        ? `New ticket for you from <@${ticket.requesterId}>`
        : `Ticket from <@${ticket.requesterId}>`,
    ),
    detailFields(ticket),
    { type: 'section', text: { type: 'mrkdwn', text: quote(ticket.description) } },
  ];
  if (ticket.sourcePermalink) {
    blocks.push(context(`Raised from <${ticket.sourcePermalink}|this message>`));
  }
  if (ticket.resolutionNote) {
    blocks.push(section(`*Resolution note*\n${quote(ticket.resolutionNote)}`));
  }

  const buttons = [];
  if (canTake(ticket.status)) {
    buttons.push({
      type: 'button' as const,
      action_id: TAKE_ACTION,
      text: { type: 'plain_text' as const, text: 'Take' },
      style: 'primary' as const,
      value: ticket.number,
    });
  }
  if (canResolve(ticket.status)) {
    buttons.push({
      type: 'button' as const,
      action_id: RESOLVE_ACTION,
      text: { type: 'plain_text' as const, text: 'Resolve' },
      value: ticket.number,
    });
  }
  if (buttons.length > 0) blocks.push({ type: 'actions', elements: buttons });

  return {
    text: `🎫 ${ticket.number} (${ticket.status}): ${ticket.title}`,
    blocks,
  };
}

/** What the Requester receives when their Ticket is opened; later updates thread under it. */
export function confirmation(ticket: TicketDetails): Message {
  return {
    text: `Your ticket ${ticket.number} has been opened, <@${ticket.agentId}> will be in touch: ${ticket.title}`,
    blocks: [
      section(
        `✅ Your ticket *${ticket.number}* has been opened. <@${ticket.agentId}> will be in touch.`,
      ),
      section(`*${escape(ticket.title)}*\n${quote(ticket.description)}`),
      detailFields(ticket, { includeStatus: false }),
      context('Updates on this ticket will appear in this thread.'),
    ],
  };
}

/** The public post in #general for a Ticket whose Requester asked for one. */
export function announcement(ticket: TicketDetails): Message {
  return {
    text: `📣 <@${ticket.requesterId}> opened IT ticket ${ticket.number}, handled by <@${ticket.agentId}>: ${ticket.title}`,
    blocks: [
      section(
        `📣 <@${ticket.requesterId}> opened IT ticket *${ticket.number}* · handled by <@${ticket.agentId}>`,
      ),
      section(`*${escape(ticket.title)}*\n${quote(ticket.description)}`),
      detailFields(ticket, { includeStatus: false }),
    ],
  };
}

export function takenUpdate(ticket: TicketDetails): Message {
  const text = `🛠️ <@${ticket.agentId}> has taken *${ticket.number}* and is working on it.`;
  return { text, blocks: [section(text)] };
}

export function resolvedUpdate(ticket: TicketDetails): Message {
  const text = `✅ *${ticket.number}* has been resolved by <@${ticket.agentId}>.`;
  const blocks = [section(text)];
  if (ticket.resolutionNote) blocks.push(section(quote(ticket.resolutionNote)));
  return { text, blocks };
}

/** Posted in a Ticket's Announcement thread when its Agent Resolves it and asks for one. */
export function announcementFollowUp(ticket: TicketDetails): Message {
  const text = `✅ <@${ticket.agentId}> resolved <@${ticket.requesterId}>'s IT ticket *${ticket.number}*.`;
  const blocks = [section(text)];
  if (ticket.resolutionNote) blocks.push(section(quote(ticket.resolutionNote)));
  return { text, blocks };
}

export function openFailed(): Message {
  const text =
    '⚠️ Sorry, something went wrong and your ticket could not be opened. Please try again in a moment.';
  return { text, blocks: [section(text)] };
}

function detailFields(ticket: TicketDetails, { includeStatus = true } = {}): KnownBlock {
  const opened = Math.floor(Date.parse(ticket.createdAt) / 1000);
  const fields = [
    `*Category*\n${ticket.category}`,
    `*Urgency*\n${URGENCY_EMOJI[ticket.urgency]} ${ticket.urgency}`,
    `*Opened*\n<!date^${opened}^{date_short_pretty} {time}|${ticket.createdAt}>`,
  ];
  if (includeStatus) fields.unshift(`*Status*\n${STATUS_EMOJI[ticket.status]} ${ticket.status}`);
  return { type: 'section', fields: fields.map((text) => ({ type: 'mrkdwn', text })) };
}

function header(text: string): KnownBlock {
  return { type: 'header', text: { type: 'plain_text', text: truncate(text, 150) } };
}

function section(text: string): KnownBlock {
  return { type: 'section', text: { type: 'mrkdwn', text: truncate(text, 3000) } };
}

function context(text: string): KnownBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

function quote(text: string): string {
  return truncate(
    escape(text)
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n'),
    3000,
  );
}

/** Escapes the characters Slack treats as control sequences in mrkdwn. */
function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
