import { formatTicketNumber, type MessageRef, type Ticket } from './ticket.js';
import {
  passesGuard,
  type StoredTicket,
  type TicketChanges,
  type TicketGuard,
  type TicketStore,
} from './ticket-store.js';

/** In-memory TicketStore for tests. */
export class MemoryTicketStore implements TicketStore {
  private seq = 0;
  readonly tickets = new Map<string, StoredTicket>();

  async nextNumber(): Promise<string> {
    return formatTicketNumber(++this.seq);
  }

  async create(ticket: Ticket): Promise<void> {
    if (this.tickets.has(ticket.number)) throw new Error(`${ticket.number} already exists`);
    this.tickets.set(ticket.number, structuredClone(ticket));
  }

  async get(number: string): Promise<StoredTicket | undefined> {
    const ticket = this.tickets.get(number);
    return ticket && structuredClone(ticket);
  }

  async update(
    number: string,
    guard: TicketGuard,
    changes: TicketChanges,
  ): Promise<StoredTicket | undefined> {
    const ticket = this.tickets.get(number);
    if (!ticket || !passesGuard(ticket, guard)) return undefined;
    Object.assign(ticket, changes);
    return structuredClone(ticket);
  }

  async recordAnnouncement(number: string, announcement: MessageRef): Promise<void> {
    const ticket = this.tickets.get(number);
    if (!ticket) throw new Error(`${number} does not exist`);
    ticket.announcement = structuredClone(announcement);
  }
}
