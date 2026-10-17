import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { formatTicketNumber, type MessageRef, type Status, type Ticket } from './ticket.js';

/** A Ticket as read back from storage. Tickets opened before Agents were recorded have no `agentId`. */
export type StoredTicket = Omit<Ticket, 'agentId'> & Partial<Pick<Ticket, 'agentId'>>;

export type TicketChanges = Partial<
  Pick<Ticket, 'status' | 'takenAt' | 'resolvedAt' | 'resolution' | 'resolutionNote'>
>;

export interface TicketStore {
  /** Reserves the next Ticket number. Numbers are never reused. */
  nextNumber(): Promise<string>;
  create(ticket: Ticket): Promise<void>;
  get(number: string): Promise<StoredTicket | undefined>;
  /**
   * Applies `changes` only if the Ticket is currently in one of the `from` statuses.
   * Returns the updated Ticket, or undefined if it does not exist or its status didn't match.
   */
  update(number: string, from: Status[], changes: TicketChanges): Promise<StoredTicket | undefined>;
  /** Records where the Ticket's Announcement was posted, whatever its Status. Throws if it does not exist. */
  recordAnnouncement(number: string, announcement: MessageRef): Promise<void>;
}

const COUNTER_KEY = 'COUNTER#ticket';
const ticketKey = (number: string) => `TICKET#${number}`;

export class DynamoTicketStore implements TicketStore {
  private readonly db: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    client = new DynamoDBClient({}),
  ) {
    this.db = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async nextNumber(): Promise<string> {
    const { Attributes } = await this.db.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: COUNTER_KEY },
        UpdateExpression: 'ADD #seq :one',
        ExpressionAttributeNames: { '#seq': 'seq' },
        ExpressionAttributeValues: { ':one': 1 },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return formatTicketNumber(Attributes?.seq as number);
  }

  async create(ticket: Ticket): Promise<void> {
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { pk: ticketKey(ticket.number), ...ticket },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  }

  async get(number: string): Promise<StoredTicket | undefined> {
    const { Item } = await this.db.send(
      new GetCommand({ TableName: this.tableName, Key: { pk: ticketKey(number) } }),
    );
    return Item ? toTicket(Item) : undefined;
  }

  async update(
    number: string,
    from: Status[],
    changes: TicketChanges,
  ): Promise<StoredTicket | undefined> {
    const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
    const names: Record<string, string> = { '#status': 'status' };
    const values: Record<string, unknown> = {};
    from.forEach((status, i) => (values[`:from${i}`] = status));
    const sets = entries.map(([key, value], i) => {
      names[`#k${i}`] = key;
      values[`:v${i}`] = value;
      return `#k${i} = :v${i}`;
    });

    try {
      const { Attributes } = await this.db.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: ticketKey(number) },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: `attribute_exists(pk) AND #status IN (${from.map((_, i) => `:from${i}`).join(', ')})`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW',
        }),
      );
      return Attributes ? toTicket(Attributes) : undefined;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return undefined;
      throw err;
    }
  }

  async recordAnnouncement(number: string, announcement: MessageRef): Promise<void> {
    await this.db.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: ticketKey(number) },
        UpdateExpression: 'SET #announcement = :announcement',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeNames: { '#announcement': 'announcement' },
        ExpressionAttributeValues: { ':announcement': announcement },
      }),
    );
  }
}

function toTicket(item: Record<string, unknown>): StoredTicket {
  const { pk: _pk, ...ticket } = item;
  return ticket as unknown as StoredTicket;
}
