export const CATEGORIES = ['Hardware', 'Software', 'Access', 'Network', 'Other'] as const;
export type Category = (typeof CATEGORIES)[number];

export const URGENCIES = ['Low', 'Normal', 'High'] as const;
export type Urgency = (typeof URGENCIES)[number];

export type Status = 'Open' | 'In progress' | 'Resolved';

export const RESOLUTIONS = ['Fixed', 'Unable to reproduce', 'As designed', "Won't fix"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

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
  /** The Agent the Requester chose: the only one who may Take or Resolve the Ticket. */
  agentId: string;
  /** Link to the Slack message the Ticket was raised from, if any. */
  sourcePermalink?: string;
  /** The Requester asked for an Announcement in #general. */
  postToGeneral?: boolean;
}

export interface Ticket extends TicketDraft {
  number: string;
  status: Status;
  createdAt: string;
  takenAt?: string;
  resolvedAt?: string;
  /** How the Agent classified the Ticket's end. Tickets Resolved before Resolutions existed have none. */
  resolution?: Resolution;
  resolutionNote?: string;
  confirmation: MessageRef;
  card: MessageRef;
  /** Where the Ticket was posted in #general, once its Announcement is recorded. */
  announcement?: MessageRef;
}

export function formatTicketNumber(sequence: number): string {
  return `IT-${String(sequence).padStart(4, '0')}`;
}

/** How long a Ticket was open, in its two largest units, such as `2d 3h`, `3h 20m` or `45m`. */
export function formatLeadTime(openedAt: string, resolvedAt: string): string {
  const totalMinutes = Math.floor((Date.parse(resolvedAt) - Date.parse(openedAt)) / 60_000);
  const parts: [number, string][] = [
    [Math.floor(totalMinutes / 1440), 'd'],
    [Math.floor(totalMinutes / 60) % 24, 'h'],
    [totalMinutes % 60, 'm'],
  ];
  const largest = parts.findIndex(([amount]) => amount > 0);
  if (largest === -1) return 'under 1m';
  return parts
    .slice(largest, largest + 2)
    .filter(([amount]) => amount > 0)
    .map(([amount, unit]) => `${amount}${unit}`)
    .join(' ');
}

export function canTake(status: Status): boolean {
  return status === 'Open';
}

export function canResolve(status: Status): boolean {
  return status === 'Open' || status === 'In progress';
}
