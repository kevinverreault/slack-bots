import type { WebClient } from '@slack/web-api';

/** An Agent as offered in the ticket modal: the member ID, and the label to show for it. */
export interface AgentChoice {
  id: string;
  name: string;
}

/** Reads the configured Agents from a comma-separated list of Slack member IDs, in order. */
export function parseAgentIds(raw: string): string[] {
  const ids = [
    ...new Set(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) throw new Error('Configure at least one Agent member ID');
  return ids;
}

type Users = Pick<WebClient['users'], 'info'>;

/**
 * Looks up how Slack currently names each Agent: display name, then real name. An Agent who can't
 * be looked up (missing scope, Slack error) or is deactivated is shown by member ID.
 */
export async function lookUpAgents(
  users: Users,
  agentIds: string[],
  logger: { warn(...msg: unknown[]): void },
): Promise<AgentChoice[]> {
  const results = await Promise.allSettled(agentIds.map((user) => users.info({ user })));
  return results.map((result, i) => {
    const id = agentIds[i]!;
    if (result.status === 'rejected') {
      logger.warn(`Could not look up Agent ${id}`, result.reason);
      return { id, name: id };
    }
    const user = result.value.user;
    const name = user?.deleted ? undefined : user?.profile?.display_name || user?.real_name;
    return { id, name: name || id };
  });
}
