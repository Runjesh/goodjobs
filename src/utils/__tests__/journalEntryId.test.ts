import { describe, it, expect } from 'vitest';
import {
  resolvePersistedJournalEntryId,
  isLocalJournalEntryId,
} from '../journalEntryId';

const stableOpts = { now: () => 1_700_000_000_000, rand: () => 0.5 };

describe('resolvePersistedJournalEntryId', () => {
  it('uses backend id when payload.id is a non-empty string', () => {
    expect(resolvePersistedJournalEntryId({ id: 'JE-42' })).toEqual({
      source: 'backend', id: 'JE-42',
    });
  });

  it('coerces numeric ids to strings', () => {
    expect(resolvePersistedJournalEntryId({ id: 42 })).toEqual({
      source: 'backend', id: '42',
    });
  });

  it('falls back to entry_id and journal_entry_id', () => {
    expect(resolvePersistedJournalEntryId({ entry_id: 'JE-9' })).toEqual({
      source: 'backend', id: 'JE-9',
    });
    expect(resolvePersistedJournalEntryId({ journal_entry_id: 'JE-10' })).toEqual({
      source: 'backend', id: 'JE-10',
    });
  });

  it('reads one level of nesting (entry.id, data.id, journal_entry.id)', () => {
    expect(resolvePersistedJournalEntryId({ entry: { id: 'JE-X' } }).id).toBe('JE-X');
    expect(resolvePersistedJournalEntryId({ data: { id: 'JE-Y' } }).id).toBe('JE-Y');
    expect(resolvePersistedJournalEntryId({ journal_entry: { entry_id: 'JE-Z' } }).id).toBe('JE-Z');
  });

  it('ignores empty / whitespace ids and falls back to local', () => {
    const r = resolvePersistedJournalEntryId({ id: '   ' }, stableOpts);
    expect(r.source).toBe('local');
    expect(r.id.startsWith('local-JE-')).toBe(true);
  });

  it('generates a clearly-local id when payload is null/undefined/not-an-object', () => {
    for (const p of [null, undefined, 'not-json', 7, true]) {
      const r = resolvePersistedJournalEntryId(p as unknown, stableOpts);
      expect(r.source).toBe('local');
      expect(r.id.startsWith('local-JE-')).toBe(true);
    }
  });

  it('produces deterministic local ids when now+rand are provided', () => {
    const a = resolvePersistedJournalEntryId(null, stableOpts);
    const b = resolvePersistedJournalEntryId({}, stableOpts);
    expect(a.id).toBe(b.id);
  });

  it('local ids are distinguishable from real backend ids via the helper', () => {
    expect(isLocalJournalEntryId('local-JE-1700000000000-abcd')).toBe(true);
    expect(isLocalJournalEntryId('JE-3001')).toBe(false);
    expect(isLocalJournalEntryId('42')).toBe(false);
  });

  it('does not mistake an empty object for a backend id', () => {
    expect(resolvePersistedJournalEntryId({}, stableOpts).source).toBe('local');
  });
});
