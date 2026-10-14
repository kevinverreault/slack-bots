import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';
import { MemoryTicketStore } from './memory-ticket-store.js';
import type { Ticket } from './ticket.js';
import { DynamoTicketStore } from './ticket-store.js';

const ticket: Ticket = {
  number: 'IT-0001',
  title: 'VPN is down',
  description: "Can't connect",
  category: 'Network',
  urgency: 'High',
  requesterId: 'UREQ',
  agentId: 'UAGENT',
  postToGeneral: true,
  status: 'Open',
  createdAt: '2026-10-14T12:00:00Z',
  confirmation: { channel: 'DREQ', ts: '100.2' },
  card: { channel: 'DAGENT', ts: '100.1' },
};
const announcement = { channel: 'CGENERAL', ts: '100.3' };

describe('MemoryTicketStore', () => {
  it('records the Announcement whatever the Status', async () => {
    const store = new MemoryTicketStore();
    await store.create(ticket);
    await store.update(ticket.number, ['Open'], { status: 'In progress' });

    await store.recordAnnouncement(ticket.number, announcement);

    expect(await store.get(ticket.number)).toMatchObject({ status: 'In progress', announcement });
  });

  it('refuses to record an Announcement for an unknown Ticket', async () => {
    await expect(
      new MemoryTicketStore().recordAnnouncement('IT-9999', announcement),
    ).rejects.toThrow('IT-9999');
  });
});

/** A DynamoDB client that answers every command with `output` and records each command sent. */
function fakeDynamo(output: Record<string, unknown> = {}) {
  const sent: { input: Record<string, unknown> }[] = [];
  const client = new DynamoDBClient({
    region: 'us-east-1',
    credentials: { accessKeyId: 'x', secretAccessKey: 'x' },
  });
  client.middlewareStack.add(
    () => async (args) => {
      sent.push({ input: args.input as Record<string, unknown> });
      return { output: { $metadata: {}, ...output }, response: {} };
    },
    { step: 'build', priority: 'high' },
  );
  return { client, sent };
}

describe('DynamoTicketStore', () => {
  it('records the Announcement whatever the Status, only on an existing Ticket', async () => {
    const { client, sent } = fakeDynamo();

    await new DynamoTicketStore('tickets', client).recordAnnouncement(ticket.number, announcement);

    expect(sent).toHaveLength(1);
    const input = sent[0]!.input;
    expect(input).toMatchObject({
      TableName: 'tickets',
      Key: { pk: { S: 'TICKET#IT-0001' } },
      ConditionExpression: 'attribute_exists(pk)',
    });
    expect(input.UpdateExpression).toBe('SET #announcement = :announcement');
    expect(input.ExpressionAttributeNames).toEqual({ '#announcement': 'announcement' });
    expect(input.ExpressionAttributeValues).toEqual({
      ':announcement': { M: { channel: { S: 'CGENERAL' }, ts: { S: '100.3' } } },
    });
  });
});
