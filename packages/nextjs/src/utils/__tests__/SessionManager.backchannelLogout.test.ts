// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import handleRefreshToken from '../handleRefreshToken';
import {getLoggedOutSessions} from '../loggedOutSessions';
import SessionManager, {SessionTokenPayload} from '../SessionManager';

const HOUR = 3600;

const resetLoggedOutSessions = (): void => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('thunderid.nextjs.loggedOutSessions')];
};

const sessionCookie = (sid: string | undefined, signedInAt?: number, sub = 'user-1'): Promise<string> =>
  SessionManager.createSessionToken('access-token', sub, 'local-1', 'openid', HOUR, 'refresh-token', undefined, {
    sid,
    signedInAt,
  });

describe('SessionManager and back-channel logout', () => {
  beforeEach(() => {
    process.env['THUNDERID_SECRET'] = 'test-secret-for-session-cookies';
    resetLoggedOutSessions();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetLoggedOutSessions();
  });

  it('puts the server session and the sign-in time in the session cookie', async () => {
    const payload: SessionTokenPayload = await SessionManager.verifySessionToken(await sessionCookie('sid-1', 1000));

    expect(payload.sid).toBe('sid-1');
    expect(payload.signedInAt).toBe(1000);
  });

  it('records the present as the sign-in time when none is given', async () => {
    const payload: SessionTokenPayload = await SessionManager.verifySessionToken(await sessionCookie('sid-1'));

    expect(Math.abs(payload.signedInAt! - Date.now() / 1000)).toBeLessThan(5);
  });

  it('refuses a correctly signed cookie once its server session was logged out', async () => {
    const cookie: string = await sessionCookie('sid-1');
    const other: string = await sessionCookie('sid-2');

    await getLoggedOutSessions().record({issuedAt: Math.floor(Date.now() / 1000), sid: 'sid-1', sub: 'user-1'}, HOUR);

    await expect(SessionManager.verifySessionToken(cookie)).rejects.toMatchObject({code: 'invalid-session-token'});
    await expect(SessionManager.verifySessionToken(other)).resolves.toMatchObject({sid: 'sid-2'});
  });

  it('refuses it on the refresh path too, so a logged-out session cannot be renewed', async () => {
    const cookie: string = await sessionCookie('sid-1');

    await getLoggedOutSessions().record({issuedAt: Math.floor(Date.now() / 1000), sid: 'sid-1'}, HOUR);

    await expect(SessionManager.verifySessionTokenForRefresh(cookie)).rejects.toMatchObject({
      code: 'invalid-session-token-for-refresh',
    });
  });

  it('with a logout by subject, refuses sessions signed in before it and keeps later ones', async () => {
    const now: number = Math.floor(Date.now() / 1000);
    const before: string = await sessionCookie(undefined, now - 600);
    // Beyond the clock tolerance; a session begun within it counts as before the logout.
    const after: string = await sessionCookie(undefined, now + 61);
    const someoneElse: string = await sessionCookie(undefined, now - 600, 'user-2');

    await getLoggedOutSessions().record({issuedAt: now, sub: 'user-1'}, HOUR);

    await expect(SessionManager.verifySessionToken(before)).rejects.toThrow();
    await expect(SessionManager.verifySessionToken(after)).resolves.toBeDefined();
    await expect(SessionManager.verifySessionToken(someoneElse)).resolves.toBeDefined();
  });

  it('keeps the server session and the sign-in time when the tokens are refreshed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({access_token: 'new-access', expires_in: HOUR, refresh_token: 'new-refresh'}), {
            status: 200,
          }),
        ),
      ),
    );

    const original: SessionTokenPayload = await SessionManager.verifySessionToken(await sessionCookie('sid-1', 1000));
    const {newSessionToken} = await handleRefreshToken(original, {
      baseUrl: 'https://auth.example.com',
      clientId: 'client',
      clientSecret: 'secret',
    });
    const refreshed: SessionTokenPayload = await SessionManager.verifySessionToken(newSessionToken);

    expect(refreshed.accessToken).toBe('new-access');
    expect(refreshed.sid).toBe('sid-1');
    expect(refreshed.signedInAt).toBe(1000);
  });
});
