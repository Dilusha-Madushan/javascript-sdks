// Copyright 2025 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable @typescript-eslint/typedef, sort-keys, @typescript-eslint/explicit-function-return-type */

/**
 * Unit tests for getValidAccessToken (token-refresh.ts).
 *
 * getValidAccessToken depends on:
 *  - requireServerSession(event) — reads the session from the JWT cookie
 *  - useRuntimeConfig(event)     — reads Nuxt runtime config
 *  - fetch                        — calls the OIDC token endpoint
 *  - setChunkedCookie             — re-issues the session cookie on refresh
 *
 * All four are mocked so no HTTP calls or real Nuxt context is needed.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {requireServerSession} from '../../src/runtime/server/utils/serverSession';
import {verifySessionToken, getSessionCookieName} from '../../src/runtime/server/utils/session';
import {setChunkedCookie} from '../../src/runtime/server/utils/chunkedCookie';

import {getValidAccessToken} from '../../src/runtime/server/utils/token-refresh';
import {useRuntimeConfig} from '#imports';

const TEST_SECRET = 'test-secret-at-least-32-characters-long!!';

// ─── Mock #imports (useRuntimeConfig) ─────────────────────────────────────
vi.mock('#imports', () => ({
  useRuntimeConfig: vi.fn(),
}));

// ─── Mock chunkedCookie (setChunkedCookie) ────────────────────────────────
vi.mock('../../src/runtime/server/utils/chunkedCookie', () => ({
  setChunkedCookie: vi.fn(),
}));

// ─── Mock serverSession (requireServerSession) ────────────────────────────
vi.mock('../../src/runtime/server/utils/serverSession', () => ({
  requireServerSession: vi.fn(),
}));

// Fake H3 event (only needs to satisfy the function signatures)
const fakeEvent = {} as Parameters<typeof getValidAccessToken>[0];

// Shared runtime config mock
const mockConfig = {
  public: {
    thunderid: {
      baseUrl: 'https://localhost:8090',
      clientId: 'test-client-id',
    },
  },
  thunderid: {
    clientSecret: '',
    sessionSecret: TEST_SECRET,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useRuntimeConfig).mockReturnValue(mockConfig as ReturnType<typeof useRuntimeConfig>);
});

// Helper to build a mock session payload with Phase 2 fields.
function buildSession(
  overrides: Partial<{
    accessToken: string;
    accessTokenExpiresAt: number | undefined;
    idToken: string | undefined;
    refreshToken: string | undefined;
  }> = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'user-123',
    sessionId: 'sess-abc',
    accessToken: 'at_original',
    scopes: 'openid profile',
    organizationId: undefined,
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
}

describe('getValidAccessToken — token still fresh', () => {
  it('returns the stored token when no accessTokenExpiresAt (pre-Phase-2 session)', async () => {
    vi.mocked(requireServerSession).mockResolvedValue(buildSession({accessTokenExpiresAt: undefined}) as any);

    const token = await getValidAccessToken(fakeEvent);

    expect(token).toBe('at_original');
    expect(setChunkedCookie).not.toHaveBeenCalled();
  });

  it('returns the stored token when well before expiry', async () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 7200; // 2 h in the future
    vi.mocked(requireServerSession).mockResolvedValue(buildSession({accessTokenExpiresAt: futureExpiry}) as any);

    const token = await getValidAccessToken(fakeEvent);

    expect(token).toBe('at_original');
    expect(setChunkedCookie).not.toHaveBeenCalled();
  });

  it('returns the stored token when exactly at the 60 s skew boundary', async () => {
    // expiresAt is exactly 61 seconds from now — still fresh (> 60 s skew).
    const boundary = Math.floor(Date.now() / 1000) + 61;
    vi.mocked(requireServerSession).mockResolvedValue(buildSession({accessTokenExpiresAt: boundary}) as any);

    const token = await getValidAccessToken(fakeEvent);

    expect(token).toBe('at_original');
  });
});

describe('getValidAccessToken — expired, no refresh token', () => {
  it('throws 401 when token is expired and no refresh token is stored', async () => {
    const pastExpiry = Math.floor(Date.now() / 1000) - 10; // already expired
    vi.mocked(requireServerSession).mockResolvedValue(
      buildSession({accessTokenExpiresAt: pastExpiry, refreshToken: undefined}) as any,
    );

    await expect(getValidAccessToken(fakeEvent)).rejects.toMatchObject({statusCode: 401});
  });

  it('throws 401 when within skew window and no refresh token', async () => {
    const withinSkew = Math.floor(Date.now() / 1000) + 30; // < 60 s remaining
    vi.mocked(requireServerSession).mockResolvedValue(
      buildSession({accessTokenExpiresAt: withinSkew, refreshToken: undefined}) as any,
    );

    await expect(getValidAccessToken(fakeEvent)).rejects.toMatchObject({statusCode: 401});
  });
});

describe('getValidAccessToken — successful refresh', () => {
  it('calls the OIDC token endpoint with correct parameters', async () => {
    const withinSkew = Math.floor(Date.now() / 1000) + 30;
    vi.mocked(requireServerSession).mockResolvedValue(
      buildSession({accessTokenExpiresAt: withinSkew, refreshToken: 'rt_original'}) as any,
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'at_refreshed',
        expires_in: 3600,
        refresh_token: 'rt_new',
        id_token: 'idt_new',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await getValidAccessToken(fakeEvent);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://localhost:8090/oauth2/token');
    expect(init.method).toBe('POST');

    const bodyParams = new URLSearchParams(init.body as string);
    expect(bodyParams.get('grant_type')).toBe('refresh_token');
    expect(bodyParams.get('refresh_token')).toBe('rt_original');
    expect(bodyParams.get('client_id')).toBe('test-client-id');

    vi.unstubAllGlobals();
  });

  it('returns the new access token', async () => {
    const withinSkew = Math.floor(Date.now() / 1000) + 30;
    vi.mocked(requireServerSession).mockResolvedValue(
      buildSession({accessTokenExpiresAt: withinSkew, refreshToken: 'rt_original'}) as any,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({access_token: 'at_new', expires_in: 3600}),
      }),
    );

    const result = await getValidAccessToken(fakeEvent);
    expect(result).toBe('at_new');

    vi.unstubAllGlobals();
  });

  it('re-issues the session cookie after a successful refresh', async () => {
    const withinSkew = Math.floor(Date.now() / 1000) + 30;
    vi.mocked(requireServerSession).mockResolvedValue(
      buildSession({accessTokenExpiresAt: withinSkew, refreshToken: 'rt_original'}) as any,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({access_token: 'at_new', expires_in: 3600, refresh_token: 'rt_rotated'}),
      }),
    );

    await getValidAccessToken(fakeEvent);

    expect(setChunkedCookie).toHaveBeenCalledOnce();
    // First arg is the event, second is the cookie name
    expect(vi.mocked(setChunkedCookie).mock.calls[0][1]).toBe(getSessionCookieName());

    vi.unstubAllGlobals();
  });

  it('preserves the original refreshToken when the server does not rotate it', async () => {
    const withinSkew = Math.floor(Date.now() / 1000) + 30;
    vi.mocked(requireServerSession).mockResolvedValue(
      buildSession({accessTokenExpiresAt: withinSkew, refreshToken: 'rt_kept'}) as any,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        // No refresh_token in response — server chose not to rotate
        json: async () => ({access_token: 'at_new', expires_in: 3600}),
      }),
    );

    await getValidAccessToken(fakeEvent);

    // Verify the new session cookie contains the original refresh token by
    // decoding the JWT written to the cookie.
    const cookieCall = vi.mocked(setChunkedCookie).mock.calls[0];
    const cookieValue = cookieCall[2] as string;
    const payload = await verifySessionToken(cookieValue, TEST_SECRET);
    expect(payload.refreshToken).toBe('rt_kept');

    vi.unstubAllGlobals();
  });
});

describe('getValidAccessToken — session binding', () => {
  it('keeps the sid and the sign-in time when the cookie is re-issued', async () => {
    const now = Math.floor(Date.now() / 1000);
    vi.mocked(requireServerSession).mockResolvedValue({
      ...buildSession({accessTokenExpiresAt: now + 30, refreshToken: 'rt_kept'}),
      sid: 'sid-1',
      signedInAt: now - 600,
    } as any);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ok: true, json: async () => ({access_token: 'at_new', expires_in: 3600})}),
    );

    await getValidAccessToken(fakeEvent);

    const payload = await verifySessionToken(vi.mocked(setChunkedCookie).mock.calls[0][2] as string, TEST_SECRET);
    expect(payload.sid).toBe('sid-1');
    expect(payload.signedInAt).toBe(now - 600);

    vi.unstubAllGlobals();
  });

  it('takes the sign-in time from the issue time of a cookie written before it was recorded', async () => {
    const now = Math.floor(Date.now() / 1000);
    vi.mocked(requireServerSession).mockResolvedValue({
      ...buildSession({accessTokenExpiresAt: now + 30, refreshToken: 'rt_kept'}),
      iat: now - 900,
    } as any);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ok: true, json: async () => ({access_token: 'at_new', expires_in: 3600})}),
    );

    await getValidAccessToken(fakeEvent);

    const payload = await verifySessionToken(vi.mocked(setChunkedCookie).mock.calls[0][2] as string, TEST_SECRET);
    expect(payload.signedInAt).toBe(now - 900);

    vi.unstubAllGlobals();
  });
});

describe('getValidAccessToken — failed refresh', () => {
  it('throws 401 when the token endpoint returns a non-ok status', async () => {
    const withinSkew = Math.floor(Date.now() / 1000) + 30;
    vi.mocked(requireServerSession).mockResolvedValue(
      buildSession({accessTokenExpiresAt: withinSkew, refreshToken: 'rt_bad'}) as any,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      }),
    );

    await expect(getValidAccessToken(fakeEvent)).rejects.toMatchObject({statusCode: 401});

    vi.unstubAllGlobals();
  });

  it('throws 401 when fetch itself rejects (network error)', async () => {
    const withinSkew = Math.floor(Date.now() / 1000) + 30;
    vi.mocked(requireServerSession).mockResolvedValue(
      buildSession({accessTokenExpiresAt: withinSkew, refreshToken: 'rt_net'}) as any,
    );

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    await expect(getValidAccessToken(fakeEvent)).rejects.toMatchObject({statusCode: 401});

    vi.unstubAllGlobals();
  });
});
