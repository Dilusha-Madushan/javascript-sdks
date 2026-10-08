// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable @typescript-eslint/typedef, sort-keys, @typescript-eslint/explicit-function-return-type */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {getLoggedOutSessions} from '../../src/runtime/server/utils/loggedOutSessions';
import {useServerSession, verifyAndRehydrateSession} from '../../src/runtime/server/utils/serverSession';
import {createSessionToken} from '../../src/runtime/server/utils/session';

const TEST_SECRET = 'test-secret-at-least-32-characters-long!!';
const HOUR = 3600;

const state = vi.hoisted(() => ({
  backchannelLogout: {enabled: true} as {enabled?: boolean; store?: string},
  cookie: undefined as string | undefined,
}));

vi.mock('#imports', () => ({
  useRuntimeConfig: vi.fn(() => ({
    thunderid: {backchannelLogout: state.backchannelLogout, sessionSecret: 'test-secret-at-least-32-characters-long!!'},
    public: {thunderid: {}},
  })),
}));

vi.mock('../../src/runtime/server/utils/chunkedCookie', () => ({
  getChunkedCookie: vi.fn(() => state.cookie),
}));

vi.mock('nitropack/runtime', () => ({useStorage: vi.fn()}));

vi.mock('../../src/runtime/server/ThunderIDNuxtClient', () => ({
  default: {getInstance: () => ({rehydrateSessionFromPayload: vi.fn().mockResolvedValue(undefined)})},
}));

const fakeEvent = {} as Parameters<typeof useServerSession>[0];
const now = () => Math.floor(Date.now() / 1000);

async function signIn(binding: {sid?: string; signedInAt?: number; userId?: string}) {
  state.cookie = await createSessionToken(
    {
      accessToken: 'at_test',
      scopes: 'openid',
      sessionId: 'sess-abc',
      sid: binding.sid,
      signedInAt: binding.signedInAt,
      userId: binding.userId ?? 'user-123',
    },
    TEST_SECRET,
  );
}

describe('server session after a back-channel logout', () => {
  beforeEach(() => {
    state.backchannelLogout = {enabled: true};
    state.cookie = undefined;
  });

  it('returns the session while no logout names it', async () => {
    await signIn({sid: 'sid-live'});

    expect((await useServerSession(fakeEvent))?.sid).toBe('sid-live');
    expect((await verifyAndRehydrateSession(fakeEvent, TEST_SECRET))?.sid).toBe('sid-live');
  });

  it('treats a session as signed out once a logout names its sid', async () => {
    await signIn({sid: 'sid-ended'});
    await getLoggedOutSessions().record({issuedAt: now(), sid: 'sid-ended'}, HOUR);

    expect(await useServerSession(fakeEvent)).toBeNull();
    expect(await verifyAndRehydrateSession(fakeEvent, TEST_SECRET)).toBeNull();
  });

  it('leaves the same user’s other session alone when the logout names a sid', async () => {
    await signIn({sid: 'sid-other', userId: 'user-two-sessions'});
    await getLoggedOutSessions().record({issuedAt: now(), sid: 'sid-gone', sub: 'user-two-sessions'}, HOUR);

    expect(await useServerSession(fakeEvent)).not.toBeNull();
  });

  it('ends the sessions a subject began before a logout that carries no sid', async () => {
    await signIn({sid: 'sid-old', signedInAt: now() - 600, userId: 'user-by-sub'});
    await getLoggedOutSessions().record({issuedAt: now() - 120, sub: 'user-by-sub'}, HOUR);

    expect(await useServerSession(fakeEvent)).toBeNull();

    // Signing in again afterwards works.
    await signIn({sid: 'sid-new', signedInAt: now(), userId: 'user-by-sub'});

    expect(await useServerSession(fakeEvent)).not.toBeNull();
  });

  it('does not consult the list when back-channel logout is off', async () => {
    await signIn({sid: 'sid-off'});
    await getLoggedOutSessions().record({issuedAt: now(), sid: 'sid-off'}, HOUR);
    state.backchannelLogout = {};

    expect(await useServerSession(fakeEvent)).not.toBeNull();
  });
});
