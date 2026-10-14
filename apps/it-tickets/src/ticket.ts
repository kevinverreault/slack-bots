export const CATEGORIES = ['Hardware', 'Software', 'Access', 'Network', 'Other'] as const;
export type Category = (typeof CATEGORIES)[number];

export const URGENCIES = ['Low', 'Normal', 'High'] as const;
export type Urgency = (typeof URGENCIES)[number];

export type Status = 'Open' | 'In progress' | 'Resolved';

/** A posted Slack message we may later update or reply to. */
export interface MessageRef {
  channel: string;
  ts: string;
}

export interface TicketDraft {
  title: string;
  description: string;
  category: Category;
  urgency: Urgency;
  requesterId: string;
  /** Link to the Slack message the Ticket was raised from, if any. */
  sourcePermalink?: string;
  /** The Requester asked for an Announcement in #general. */
  postToGeneral?: boolean;
}

export interface Ticket extends TicketDraft {
  number: string;
  /** The Agent the Ticket was opened for: the only one who may Take or Resolve it. */
  agentId: string;
  status: Status;
  createdAt: string;
  takenAt?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  confirmation: MessageRef;
  card: MessageRef;
}

export function formatTicketNumber(sequence: number): string {
  return `IT-${String(sequence).padStart(4, '0')}`;
}

export function canTake(status: Status): boolean {
  return status === 'Open';
}

export function canResolve(status: Status): boolean {
  return status === 'Open' || status === 'In progress';
}
