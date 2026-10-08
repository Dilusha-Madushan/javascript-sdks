// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import LoggedOutSessions, {InMemoryLogoutRecordStore, LogoutRecordStore} from '../utils/LoggedOutSessions';

const HOUR = 3600;
const NOW = 1_800_000_000;

describe('LoggedOutSessions', () => {
  let sessions: LoggedOutSessions;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
    sessions = new LoggedOutSessions();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports nothing as logged out before any logout is recorded', async () => {
    expect(await sessions.isLoggedOut({sid: 'sid-1', startedAt: NOW - 60, sub: 'user-1'})).toBe(false);
  });

  it('ends exactly the server session a logout by sid names', async () => {
    await sessions.record({issuedAt: NOW, sid: 'sid-1', sub: 'user-1'}, HOUR);

    expect(await sessions.isLoggedOut({sid: 'sid-1', startedAt: NOW - 60, sub: 'user-1'})).toBe(true);
    expect(await sessions.isLoggedOut({sid: 'sid-2', startedAt: NOW - 60, sub: 'user-1'})).toBe(false);
  });

  it('with only a sub, ends that subject`s sessions that began before the logout', async () => {
    await sessions.record({issuedAt: NOW, sub: 'user-1'}, HOUR);

    expect(await sessions.isLoggedOut({sid: 'sid-1', startedAt: NOW - 60, sub: 'user-1'})).toBe(true);
    expect(await sessions.isLoggedOut({sid: 'sid-1', startedAt: NOW, sub: 'user-1'})).toBe(true);
    // Within the clock tolerance counts as before: the clocks may differ by that much.
    expect(await sessions.isLoggedOut({sid: 'sid-2', startedAt: NOW + 60, sub: 'user-1'})).toBe(true);
    expect(await sessions.isLoggedOut({sid: 'sid-2', startedAt: NOW + 61, sub: 'user-1'})).toBe(false);
    expect(await sessions.isLoggedOut({sid: 'sid-3', startedAt: NOW - 60, sub: 'user-2'})).toBe(false);
  });

  it('uses the clock tolerance the token was validated with', async () => {
    await sessions.record({clockTolerance: 5, issuedAt: NOW, sub: 'user-1'}, HOUR);

    expect(await sessions.isLoggedOut({startedAt: NOW + 5, sub: 'user-1'})).toBe(true);
    expect(await sessions.isLoggedOut({startedAt: NOW + 6, sub: 'user-1'})).toBe(false);
  });

  it('treats a session with no recorded start as begun before a logout by sub', async () => {
    await sessions.record({issuedAt: NOW, sub: 'user-1'}, HOUR);

    expect(await sessions.isLoggedOut({sub: 'user-1'})).toBe(true);
  });

  it('keeps the later logout when an earlier one for the same subject arrives afterwards', async () => {
    await sessions.record({issuedAt: NOW, sub: 'user-1'}, HOUR);
    await sessions.record({issuedAt: NOW - 600, sub: 'user-1'}, HOUR);

    expect(await sessions.isLoggedOut({startedAt: NOW - 30, sub: 'user-1'})).toBe(true);
  });

  it('forgets a logout once a matching session could no longer be presented', async () => {
    await sessions.record({issuedAt: NOW, sid: 'sid-1'}, HOUR);
    vi.advanceTimersByTime(HOUR * 1000);

    expect(await sessions.isLoggedOut({sid: 'sid-1'})).toBe(false);
  });

  it('checks the expiry itself, for a store that keeps records past their lifetime', async () => {
    const kept: Map<string, string> = new Map<string, string>();
    const store: LogoutRecordStore = {
      get: (key: string) => Promise.resolve(kept.get(key)),
      set: (key: string, value: string) => {
        kept.set(key, value);

        return Promise.resolve();
      },
    };

    sessions = new LoggedOutSessions(store);
    await sessions.record({issuedAt: NOW, sid: 'sid-1'}, HOUR);
    expect(await sessions.isLoggedOut({sid: 'sid-1'})).toBe(true);
    vi.advanceTimersByTime(HOUR * 1000);

    expect(await sessions.isLoggedOut({sid: 'sid-1'})).toBe(false);
  });

  it('passes the lifetime to the store, so a shared store can expire the record', async () => {
    const set = vi.fn().mockResolvedValue(undefined);

    sessions = new LoggedOutSessions({get: vi.fn().mockResolvedValue(undefined), set});
    await sessions.record({issuedAt: NOW, sid: 'sid-1'}, HOUR);

    expect(set).toHaveBeenCalledWith('thunderid:logout:sid:sid-1', expect.any(String), HOUR);
  });

  it('encodes the identifier, so one with a separator in it gets a key of its own', async () => {
    const set = vi.fn().mockResolvedValue(undefined);

    sessions = new LoggedOutSessions({get: vi.fn().mockResolvedValue(undefined), set});
    await sessions.record({issuedAt: NOW, sub: 'tenant:a/user?1'}, HOUR);

    expect(set).toHaveBeenCalledWith('thunderid:logout:sub:tenant%3Aa%2Fuser%3F1', expect.any(String), HOUR);
  });

  it('ignores a record it cannot read', async () => {
    sessions = new LoggedOutSessions({get: () => Promise.resolve('not json'), set: () => Promise.resolve()});

    expect(await sessions.isLoggedOut({sid: 'sid-1', sub: 'user-1'})).toBe(false);
  });
});

describe('InMemoryLogoutRecordStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops expired records when a new one arrives, so it does not grow without bound', async () => {
    const store: InMemoryLogoutRecordStore = new InMemoryLogoutRecordStore();

    await store.set('a', '1', 10);
    vi.advanceTimersByTime(11_000);
    await store.set('b', '2', 10);

    // eslint-disable-next-line @typescript-eslint/dot-notation
    expect([...store['records'].keys()]).toEqual(['b']);
    expect(await store.get('a')).toBeUndefined();
    expect(await store.get('b')).toBe('2');
  });
});
