// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {BackchannelLogoutConstants, InvalidLogoutTokenError} from '@thunderid/javascript';
import * as jose from 'jose';
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import MemoryCacheStore from '../stores/MemoryCacheStore';
import ThunderIDNodeClient from '../ThunderIDNodeClient';
import SessionIndex from '../utils/SessionIndex';

const ISSUER = 'https://auth.example.com';
const CLIENT_ID = 'test-client';
const KID = 'key-1';

interface Keys {
  privateKey: jose.CryptoKey;
  publicJwk: jose.JWK;
}

const newKeys = async (kid: string): Promise<Keys> => {
  const {privateKey, publicKey} = await jose.generateKeyPair('RS256');

  return {privateKey, publicJwk: {...(await jose.exportJWK(publicKey)), alg: 'RS256', kid, use: 'sig'}};
};

// A store of its own per test, since the default one is shared by the whole process.
class IsolatedStore extends MemoryCacheStore {
  private data: Map<string, string> = new Map<string, string>();

  public override setData(key: string, value: string): Promise<void> {
    this.data.set(key, value);

    return Promise.resolve();
  }

  public override getData(key: string): Promise<string> {
    return Promise.resolve(this.data.get(key) ?? '{}');
  }

  public override removeData(key: string): Promise<void> {
    this.data.delete(key);

    return Promise.resolve();
  }
}

describe('ThunderIDNodeClient back-channel logout', () => {
  let serverKeys: Keys;
  let otherKeys: Keys;
  let client: ThunderIDNodeClient;
  let jtiCounter = 0;

  const sign = (claims: Record<string, unknown>, header: Record<string, unknown> = {}, keys: Keys = serverKeys) => {
    jtiCounter += 1;

    return new jose.SignJWT({
      events: {[BackchannelLogoutConstants.EVENT]: {}},
      jti: `jti-${jtiCounter}`,
      sid: 'server-session-1',
      sub: 'user-1',
      ...claims,
    })
      .setProtectedHeader({alg: 'RS256', kid: KID, typ: 'logout+jwt', ...header})
      .setIssuer((claims['iss'] as string) ?? ISSUER)
      .setAudience((claims['aud'] as string) ?? CLIENT_ID)
      .setIssuedAt((claims['iat'] as number) ?? undefined)
      .setExpirationTime((claims['exp'] as number) ?? '2m')
      .sign(keys.privateKey);
  };

  const idToken = (sid: string, sub: string): Promise<string> =>
    new jose.SignJWT({sid, sub})
      .setProtectedHeader({alg: 'RS256', kid: KID, typ: 'JWT'})
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(serverKeys.privateKey);

  // Stands in for a completed sign-in: stored tokens, plus the index entry sign-in writes. A start
  // time, when given, is written to the index directly, since sign-in always records the present.
  const startSession = async (sessionId: string, sid: string, sub: string, startedAt?: number): Promise<void> => {
    const sessionData = {
      access_token: `access-${sessionId}`,
      created_at: Date.now(),
      expires_in: '3600',
      id_token: await idToken(sid, sub),
    };

    await client.setSession(sessionData, sessionId);

    if (startedAt === undefined) {
      // eslint-disable-next-line @typescript-eslint/dot-notation
      await client['indexSession'](sessionId, sessionData as never);
    } else {
      // eslint-disable-next-line @typescript-eslint/dot-notation
      await new SessionIndex(client['getStorageManager']()).add(sessionId, {sid, sub}, startedAt);
    }
  };

  beforeAll(async () => {
    serverKeys = await newKeys(KID);
    otherKeys = await newKeys(KID);
  });

  beforeEach(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        const body: unknown = String(url).endsWith('/oauth2/jwks')
          ? {keys: [serverKeys.publicJwk]}
          : {
              end_session_endpoint: `${ISSUER}/oauth2/logout`,
              issuer: ISSUER,
              jwks_uri: `${ISSUER}/oauth2/jwks`,
              revocation_endpoint: `${ISSUER}/oauth2/revoke`,
              token_endpoint: `${ISSUER}/oauth2/token`,
            };

        return Promise.resolve(new Response(JSON.stringify(body), {status: 200}));
      }),
    );
    client = new ThunderIDNodeClient();
    await client.initialize(
      {afterSignOutUrl: 'https://app.example.com/', baseUrl: ISSUER, clientId: CLIENT_ID},
      new IsolatedStore(),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('ends the session bound to the sid and leaves other sessions alone', async () => {
    await startSession('local-1', 'server-session-1', 'user-1');
    await startSession('local-2', 'server-session-2', 'user-1');

    const result = await client.handleBackchannelLogout(await sign({}));

    expect(result).toEqual({sessionsEnded: 1, sid: 'server-session-1', sub: 'user-1'});
    expect(await client.isSignedIn('local-1')).toBe(false);
    expect(await client.isSignedIn('local-2')).toBe(true);
  });

  it('with only a sub, ends that subject`s sessions that began before the token was issued', async () => {
    const issuedAt: number = Math.floor(Date.now() / 1000);

    await startSession('before', 'server-session-1', 'user-1', (issuedAt - 30) * 1000);
    // Within the clock tolerance (the SDK's default is 300 s) counts as before: the clocks may differ
    // by that much.
    await startSession('just-after', 'server-session-2', 'user-1', (issuedAt + 5) * 1000);
    await startSession('after', 'server-session-3', 'user-1', (issuedAt + 301) * 1000);
    await startSession('someone-else', 'server-session-4', 'user-2', (issuedAt - 30) * 1000);

    const result = await client.handleBackchannelLogout(await sign({iat: issuedAt, sid: undefined}));

    expect(result.sessionsEnded).toBe(2);
    expect(await client.isSignedIn('before')).toBe(false);
    expect(await client.isSignedIn('just-after')).toBe(false);
    expect(await client.isSignedIn('after')).toBe(true);
    expect(await client.isSignedIn('someone-else')).toBe(true);
  });

  it('leaves a session alone when its id was reused for a sign-in to another server session', async () => {
    // Stale entry from an earlier sign-in with the same local session id.
    // eslint-disable-next-line @typescript-eslint/dot-notation
    await new SessionIndex(client['getStorageManager']()).add('local-1', {sid: 'server-session-1', sub: 'user-1'}, 1);
    await startSession('local-1', 'server-session-2', 'user-1');

    const result = await client.handleBackchannelLogout(await sign({}));

    expect(result.sessionsEnded).toBe(0);
    expect(await client.isSignedIn('local-1')).toBe(true);
    // eslint-disable-next-line @typescript-eslint/dot-notation
    expect(await new SessionIndex(client['getStorageManager']()).findBySid('server-session-1')).toEqual({});
  });

  it('succeeds with nothing ended when the token names no session held here', async () => {
    await startSession('local-1', 'server-session-9', 'user-9');

    const result = await client.handleBackchannelLogout(await sign({}));

    expect(result.sessionsEnded).toBe(0);
    expect(await client.isSignedIn('local-1')).toBe(true);
  });

  it('reads the server`s metadata and keys, and calls neither revocation nor end session', async () => {
    await startSession('local-1', 'server-session-1', 'user-1');
    await client.handleBackchannelLogout(await sign({}));

    const urls: string[] = (fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url));

    expect(urls.length).toBeGreaterThan(0);
    expect(
      urls.every((url: string) => url.endsWith('/oauth2/jwks') || url.endsWith('/.well-known/openid-configuration')),
    ).toBe(true);
  });

  it.each([
    ['a signature from another key', () => sign({}, {}, otherKeys)],
    ['another client as audience', () => sign({aud: 'other-client'})],
    ['another issuer', () => sign({iss: 'https://attacker.example'})],
    [
      'an expired token',
      () => sign({exp: Math.floor(Date.now() / 1000) - 600, iat: Math.floor(Date.now() / 1000) - 900}),
    ],
    ['an ID token', () => idToken('server-session-1', 'user-1')],
    ['a token without the logout type', () => sign({}, {typ: 'JWT'})],
    ['a token without the logout event', () => sign({events: {}})],
    ['a token with a nonce', () => sign({nonce: 'n-1'})],
    ['a token that is not a JWT', () => Promise.resolve('not-a-jwt')],
  ])('refuses %s and ends nothing', async (_name: string, makeToken: () => Promise<string>) => {
    await startSession('local-1', 'server-session-1', 'user-1');

    await expect(client.handleBackchannelLogout(await makeToken())).rejects.toBeInstanceOf(InvalidLogoutTokenError);
    expect(await client.isSignedIn('local-1')).toBe(true);
  });

  it('refuses a logout token it has already handled', async () => {
    const token: string = await sign({});

    await client.handleBackchannelLogout(token);

    await expect(client.handleBackchannelLogout(token)).rejects.toMatchObject({code: 'NODE-AUTH_CLIENT-HBL-IV01'});
  });

  it('accepts the same token again after a failure, so a retransmission is not lost', async () => {
    await startSession('local-1', 'server-session-1', 'user-1');
    const token: string = await sign({});
    const clear = vi
      .spyOn(client as unknown as {clearSessionAsync: () => Promise<void>}, 'clearSessionAsync')
      .mockRejectedValueOnce(new Error('store unavailable'));

    await expect(client.handleBackchannelLogout(token)).rejects.toThrow('store unavailable');
    clear.mockRestore();

    expect((await client.handleBackchannelLogout(token)).sessionsEnded).toBe(1);
  });

  it('removes the index entries when the stored session is cleared or its token revoked', async () => {
    await startSession('local-1', 'server-session-1', 'user-1');
    await startSession('local-2', 'server-session-2', 'user-1');
    // eslint-disable-next-line @typescript-eslint/dot-notation
    const index = new SessionIndex(client['getStorageManager']());

    // eslint-disable-next-line @typescript-eslint/dot-notation
    await client['clearSessionAsync']('local-1');
    expect(await index.findBySid('server-session-1')).toEqual({});

    await client.loadOpenIDProviderConfiguration(false);
    await client.revokeAccessToken('local-2');
    expect(await index.findBySid('server-session-2')).toEqual({});
    expect(await index.findBySub('user-1')).toEqual({});
    expect(await client.isSignedIn('local-2')).toBe(false);
  });

  it('still finds a session after sign-out, since sign-out leaves the stored session in place', async () => {
    await startSession('local-1', 'server-session-1', 'user-1');
    await client.loadOpenIDProviderConfiguration(false);
    await client.signOut('local-1');

    // ThunderID ends the server session and posts a logout token for it afterwards.
    expect((await client.handleBackchannelLogout(await sign({}))).sessionsEnded).toBe(1);
    expect(await client.isSignedIn('local-1')).toBe(false);
  });

  it('applies the configured clock tolerance to a logout by subject', async () => {
    client = new ThunderIDNodeClient();
    await client.initialize(
      {baseUrl: ISSUER, clientId: CLIENT_ID, tokenValidation: {idToken: {clockTolerance: 5}}} as never,
      new IsolatedStore(),
    );
    const issuedAt: number = Math.floor(Date.now() / 1000);

    await startSession('within', 'server-session-1', 'user-1', (issuedAt + 4) * 1000);
    await startSession('beyond', 'server-session-2', 'user-1', (issuedAt + 30) * 1000);

    await client.handleBackchannelLogout(await sign({iat: issuedAt, sid: undefined}));

    expect(await client.isSignedIn('within')).toBe(false);
    expect(await client.isSignedIn('beyond')).toBe(true);
  });

  it('indexes a session when sign-in completes, so a logout token can find it', async () => {
    const tokens = {
      access_token: 'access-local-1',
      created_at: Date.now(),
      expires_in: '3600',
      id_token: await idToken('server-session-1', 'user-1'),
    };

    // The code exchange itself is covered elsewhere; here it only has to leave a session behind.
    vi.spyOn(client as unknown as {requestAccessToken: () => Promise<void>}, 'requestAccessToken').mockImplementation(
      async (): Promise<void> => {
        await client.setSession(tokens, 'local-1');
      },
    );

    await client.signIn(() => undefined, 'local-1', 'code', undefined, 'state');
    const result = await client.handleBackchannelLogout(await sign({}));

    expect(result.sessionsEnded).toBe(1);
    expect(await client.isSignedIn('local-1')).toBe(false);
  });

  it('drops sessions that no longer exist when it indexes a new one for the same subject or sid', async () => {
    await startSession('local-1', 'server-session-1', 'user-1');
    // eslint-disable-next-line @typescript-eslint/dot-notation
    await client['getStorageManager']().removeSessionData('local-1');
    await startSession('local-2', 'server-session-1', 'user-1');

    // eslint-disable-next-line @typescript-eslint/dot-notation
    const index = new SessionIndex(client['getStorageManager']());

    expect(Object.keys(await index.findBySub('user-1'))).toEqual(['local-2']);
    expect(Object.keys(await index.findBySid('server-session-1'))).toEqual(['local-2']);
  });

  it('forgets ended sessions, so a later token for the same subject finds nothing', async () => {
    await startSession('local-1', 'server-session-1', 'user-1');
    await client.handleBackchannelLogout(await sign({}));

    const result = await client.handleBackchannelLogout(await sign({sid: undefined}));

    expect(result.sessionsEnded).toBe(0);
  });
});
