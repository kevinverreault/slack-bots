import { formatTicketNumber, type Status, type Ticket } from './ticket.js';
import type { StoredTicket, TicketChanges, TicketStore } from './ticket-store.js';

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
    from: Status[],
    changes: TicketChanges,
  ): Promise<StoredTicket | undefined> {
    const ticket = this.tickets.get(number);
    if (!ticket || !from.includes(ticket.status)) return undefined;
    Object.assign(ticket, changes);
    return structuredClone(ticket);
  }
}
