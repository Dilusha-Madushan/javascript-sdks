// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable @typescript-eslint/typedef, sort-keys, @typescript-eslint/explicit-function-return-type */

import {describe, it, expect, vi} from 'vitest';
import {getLoggedOutSessions} from '../../src/runtime/server/utils/loggedOutSessions';
import {useStorage} from 'nitropack/runtime';

const kept = vi.hoisted(() => new Map<string, unknown>());

vi.mock('#imports', () => ({
  useRuntimeConfig: vi.fn(() => ({thunderid: {backchannelLogout: {enabled: true, store: 'redis'}}})),
}));

vi.mock('nitropack/runtime', () => ({
  useStorage: vi.fn(() => ({
    // Like a real driver, hands a JSON record back already parsed.
    getItem: vi.fn(async (key: string) => (kept.has(key) ? JSON.parse(kept.get(key) as string) : null)),
    setItem: vi.fn(async (key: string, value: string, options: {ttl: number}) => {
      kept.set(key, value);
      kept.set(`${key}#ttl`, options.ttl);
    }),
  })),
}));

describe('logged-out list in a Nitro storage mount point', () => {
  it('records in the configured mount point and reads the record back', async () => {
    const sessions = getLoggedOutSessions();

    expect(useStorage).toHaveBeenCalledWith('redis');
    expect(await sessions.isLoggedOut({sid: 'sid-1'})).toBe(false);

    await sessions.record({issuedAt: Math.floor(Date.now() / 1000), sid: 'sid-1'}, 3600);

    expect(kept.get('thunderid:logout:sid:sid-1#ttl')).toBe(3600);
    expect(await sessions.isLoggedOut({sid: 'sid-1'})).toBe(true);
    expect(await sessions.isLoggedOut({sid: 'sid-2'})).toBe(false);
  });
});
