import type { ModalView } from '@slack/types';
import { describe, expect, it } from 'vitest';
import { openTicketModal, type ModalClient } from './listeners.js';

interface FakeUser {
  display_name?: string;
  real_name?: string;
  deleted?: boolean;
}

/** Records Slack calls in order. Users missing from `users` fail to look up, as with a Slack error. */
function fakeClient(users: Record<string, FakeUser>) {
  const calls: string[] = [];
  const views: ModalView[] = [];
  const updates: Record<string, unknown>[] = [];
  const client = {
    views: {
      open: async ({ view }: { view: ModalView }) => {
        calls.push('views.open');
        views.push(view);
        return { ok: true, view: { id: 'V1', hash: 'h1' } };
      },
      update: async (args: { view: ModalView }) => {
        calls.push('views.update');
        views.push(args.view);
        updates.push(args);
        return { ok: true };
      },
    },
    users: {
      info: async ({ user }: { user: string }) => {
        calls.push(`users.info ${user}`);
        const found = users[user];
        if (!found) throw new Error('user_not_found');
        const { display_name, real_name, deleted } = found;
        return { ok: true, user: { id: user, real_name, deleted, profile: { display_name } } };
      },
    },
  };
  return { client: client as unknown as ModalClient, calls, views, updates };
}

/** The Agent dropdown's options as label → member ID. */
function agentOptions(view: ModalView): Record<string, string> {
  const block = view.blocks.find((b) => b.block_id === 'agent') as unknown as {
    element: { options: { text: { text: string }; value: string }[] };
  };
  return Object.fromEntries(block.element.options.map((o) => [o.text.text, o.value]));
}

const noLogs = { warn: () => {} };

describe('openTicketModal', () => {
  it('opens the modal right away, then shows each Agent by their current Slack name', async () => {
    const { client, calls, views, updates } = fakeClient({
      UANA: { display_name: 'ana', real_name: 'Ana Silva' },
      UBEN: { display_name: '', real_name: 'Ben Okafor' },
    });

    await openTicketModal(client, noLogs, {
      triggerId: 'T1',
      agentIds: ['UANA', 'UBEN'],
      prefill: { title: 'VPN' },
    });

    expect(calls[0]).toBe('views.open');
    expect(agentOptions(views[0]!)).toEqual({ UANA: 'UANA', UBEN: 'UBEN' });
    expect(calls.at(-1)).toBe('views.update');
    expect(updates[0]).toMatchObject({ view_id: 'V1', hash: 'h1' });
    expect(agentOptions(views[1]!)).toEqual({ ana: 'UANA', 'Ben Okafor': 'UBEN' });
    expect(JSON.stringify(views[1])).toContain('VPN');
  });

  it('shows the member ID for an Agent who cannot be looked up or is deactivated', async () => {
    const { client, views } = fakeClient({
      UANA: { display_name: 'ana' },
      UGONE: { display_name: 'gone', deleted: true },
    });

    await openTicketModal(client, noLogs, {
      triggerId: 'T1',
      agentIds: ['UANA', 'UMISSING', 'UGONE'],
    });

    expect(agentOptions(views.at(-1)!)).toEqual({
      ana: 'UANA',
      UMISSING: 'UMISSING',
      UGONE: 'UGONE',
    });
  });

  it('leaves the modal as opened when the names take too long, so Slack still gets its reply in time', async () => {
    const { client, calls } = fakeClient({ UANA: { display_name: 'ana' } });
    client.users.info = () => new Promise(() => {});

    await openTicketModal(client, noLogs, {
      triggerId: 'T1',
      agentIds: ['UANA'],
      lookupBudgetMs: 5,
    });

    expect(calls).toEqual(['views.open']);
  });

  it('leaves the modal as opened when no Agent name is found', async () => {
    const { client, calls } = fakeClient({});

    await openTicketModal(client, noLogs, { triggerId: 'T1', agentIds: ['UANA'] });

    expect(calls).toEqual(['views.open', 'users.info UANA']);
  });
});
