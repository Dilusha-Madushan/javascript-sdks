// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import BackchannelLogoutConstants from '../constants/BackchannelLogoutConstants';
import {InvalidLogoutTokenError} from '../errors/exception';
import {IsomorphicCrypto} from '../IsomorphicCrypto';
import type {Crypto} from '../models/crypto';
import type {Storage} from '../models/store';
import StorageManager from '../StorageManager';
import AuthenticationHelper from '../utils/AuthenticationHelper';

class MemoryStore implements Storage {
  private store = new Map<string, string>();

  getData(key: string): Promise<string> {
    return Promise.resolve(this.store.get(key) ?? null!);
  }

  setData(key: string, value: string): Promise<void> {
    this.store.set(key, value);

    return Promise.resolve();
  }

  removeData(key: string): Promise<void> {
    this.store.delete(key);

    return Promise.resolve();
  }
}

const ISSUER = 'https://localhost:8090';
const CLIENT_ID = 'test-client';
const JWKS_URI = `${ISSUER}/oauth2/jwks`;

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const logoutToken = (kid: string, change: Record<string, unknown> = {}): string => {
  const now: number = Math.floor(Date.now() / 1000);

  return [
    encode({alg: 'RS256', kid, typ: 'logout+jwt'}),
    encode({
      aud: CLIENT_ID,
      events: {[BackchannelLogoutConstants.EVENT]: {}},
      exp: now + 120,
      iat: now,
      iss: ISSUER,
      jti: `jti-${Math.random().toString(36).slice(2)}`,
      sid: 'session-1',
      sub: 'user-1',
      ...change,
    }),
    'signature',
  ].join('.');
};

describe('AuthenticationHelper.validateLogoutToken()', (): void => {
  let helper: AuthenticationHelper<unknown>;
  let verifyJwt: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let publishedKids: string[];

  beforeEach(async (): Promise<void> => {
    vi.useFakeTimers();
    publishedKids = ['key-1'];
    verifyJwt = vi.fn().mockResolvedValue(true);
    fetchMock = vi.fn(
      (): Promise<Response> =>
        Promise.resolve(
          new Response(JSON.stringify({keys: publishedKids.map((kid: string) => ({alg: 'RS256', kid, kty: 'RSA'}))}), {
            status: 200,
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const cryptoUtils: Crypto = {
      base64URLDecode: (value: string): string => Buffer.from(value, 'base64url').toString('utf8'),
      verifyJwt,
    } as unknown as Crypto;
    const storageManager = new StorageManager<unknown>('test-instance', new MemoryStore());

    await storageManager.setConfigData({baseUrl: ISSUER, clientId: CLIENT_ID});
    await storageManager.setOIDCProviderMetaData({issuer: ISSUER, jwks_uri: JWKS_URI});
    helper = new AuthenticationHelper<unknown>(storageManager, new IsomorphicCrypto(cryptoUtils));
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns the claims of a token whose signature verifies', async (): Promise<void> => {
    const claims = await helper.validateLogoutToken(logoutToken('key-1'));

    expect(claims.sid).toBe('session-1');
    expect(verifyJwt).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({kid: 'key-1'}),
      expect.any(Array),
      CLIENT_ID,
      ISSUER,
      'user-1',
      BackchannelLogoutConstants.DEFAULT_CLOCK_TOLERANCE_SECONDS,
      true,
    );
  });

  it('rejects a token whose signature does not verify, without leaking why', async (): Promise<void> => {
    verifyJwt.mockRejectedValue(new Error('signature verification failed for eyJ...'));

    await expect(helper.validateLogoutToken(logoutToken('key-1'))).rejects.toMatchObject({
      code: 'JS-CRYPTO_HELPER-VLTS-IV01',
      message: 'The logout token signature could not be verified.',
    });
  });

  it('rejects an ID token before fetching keys or checking a signature', async (): Promise<void> => {
    const idToken: string = [encode({alg: 'RS256', kid: 'key-1', typ: 'JWT'}), encode({}), 'signature'].join('.');

    await expect(helper.validateLogoutToken(idToken)).rejects.toMatchObject({code: 'JS-LOGOUT_TOKEN-VLTC-IV02'});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(verifyJwt).not.toHaveBeenCalled();
  });

  it('rejects anything that is not a three-part JWT', async (): Promise<void> => {
    await expect(helper.validateLogoutToken('not-a-jwt')).rejects.toMatchObject({code: 'JS-AUTH_HELPER-VLT-IV01'});
  });

  it('fetches the key set once and reuses it', async (): Promise<void> => {
    await helper.validateLogoutToken(logoutToken('key-1'));
    await helper.validateLogoutToken(logoutToken('key-1'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not re-fetch for an unknown key more often than the minimum interval', async (): Promise<void> => {
    await helper.validateLogoutToken(logoutToken('key-1'));

    const attempts: unknown[] = await Promise.allSettled(
      Array.from({length: 5}, () => helper.validateLogoutToken(logoutToken('unknown'))),
    );

    expect(attempts).toEqual(
      Array.from({length: 5}, () => ({
        reason: expect.objectContaining({code: 'JS-AUTH_HELPER-GCJ-NF01'}) as unknown,
        status: 'rejected',
      })),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches the key set once for a burst against a cold cache', async (): Promise<void> => {
    const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([
      ...Array.from({length: 5}, () => helper.validateLogoutToken(logoutToken('key-1'))),
      ...Array.from({length: 5}, () => helper.validateLogoutToken(logoutToken('unknown'))),
    ]);

    expect(results.slice(0, 5).map((result: PromiseSettledResult<unknown>) => result.status)).toEqual(
      Array.from({length: 5}, () => 'fulfilled'),
    );
    expect(results.slice(5)).toEqual(
      Array.from({length: 5}, () => ({
        reason: expect.objectContaining({code: 'JS-AUTH_HELPER-GCJ-NF01'}) as unknown,
        status: 'rejected',
      })),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not re-fetch more often than the minimum interval while the key endpoint is failing', async (): Promise<void> => {
    const failing = vi.fn(
      (): Promise<Response> => Promise.resolve(new Response(JSON.stringify({error: 'down'}), {status: 503})),
    );

    vi.stubGlobal('fetch', failing);

    const attempts: PromiseSettledResult<unknown>[] = await Promise.allSettled(
      Array.from({length: 5}, () => helper.validateLogoutToken(logoutToken('key-1'))),
    );

    // Each is refused in a way the server retries, with one request to the key endpoint between them.
    expect(attempts.map((attempt: PromiseSettledResult<unknown>) => attempt.status)).toEqual(
      Array.from({length: 5}, () => 'rejected'),
    );
    attempts.forEach((attempt: PromiseSettledResult<unknown>): void => {
      expect((attempt as PromiseRejectedResult).reason).not.toBeInstanceOf(InvalidLogoutTokenError);
    });
    expect(failing).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(BackchannelLogoutConstants.JWKS_MIN_REFETCH_INTERVAL_MS);
    await expect(helper.validateLogoutToken(logoutToken('key-1'))).rejects.toBeTruthy();
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('follows a key rotation once the minimum interval has passed', async (): Promise<void> => {
    await helper.validateLogoutToken(logoutToken('key-1'));
    publishedKids = ['key-2'];
    vi.advanceTimersByTime(BackchannelLogoutConstants.JWKS_MIN_REFETCH_INTERVAL_MS);

    await expect(helper.validateLogoutToken(logoutToken('key-2'))).resolves.toMatchObject({sid: 'session-1'});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('passes no subject to verification when the token has none', async (): Promise<void> => {
    await helper.validateLogoutToken(logoutToken('key-1', {sub: undefined}));

    expect(verifyJwt.mock.calls[0][5]).toBeUndefined();
  });
});
