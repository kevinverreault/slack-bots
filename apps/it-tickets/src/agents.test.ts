import { describe, expect, it } from 'vitest';
import { parseAgentIds } from './agents.js';

describe('parseAgentIds', () => {
  it('reads a comma-separated list of member IDs, ignoring spaces, blanks and repeats', () => {
    expect(parseAgentIds(' UANA, UBEN,,UANA ')).toEqual(['UANA', 'UBEN']);
  });

  it('accepts a single Agent', () => {
    expect(parseAgentIds('UANA')).toEqual(['UANA']);
  });

  it('refuses a list with no Agent in it', () => {
    expect(() => parseAgentIds(' , ')).toThrow('at least one Agent');
  });
});
