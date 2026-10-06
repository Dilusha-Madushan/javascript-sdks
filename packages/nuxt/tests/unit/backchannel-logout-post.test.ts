// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable @typescript-eslint/typedef, sort-keys, @typescript-eslint/explicit-function-return-type */

import {InvalidLogoutTokenError} from '@thunderid/node';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import handler from '../../src/runtime/server/routes/auth/session/backchannel-logout.post';
import {getLoggedOutSessions} from '../../src/runtime/server/utils/loggedOutSessions';

const state = vi.hoisted(() => ({
  body: '' as string | undefined,
  headers: {} as Record<string, string>,
  responseHeaders: {} as Record<string, string>,
  status: undefined as number | undefined,
}));

const mockClient = vi.hoisted(() => ({
  getConfiguration: vi.fn(() => Promise.resolve({})),
  handleBackchannelLogout: vi.fn(),
  isInitialized: true,
}));

vi.mock('h3', () => ({
  defineEventHandler: (fn: Function) => fn,
  getRequestHeader: vi.fn((_event: any, name: string) => state.headers[name]),
  readRawBody: vi.fn(async () => state.body),
  sendNoContent: vi.fn((_event: any, status: number) => {
    state.status = status;
  }),
  setResponseHeader: vi.fn((_event: any, name: string, value: string) => {
    state.responseHeaders[name] = value;
  }),
}));

vi.mock('#imports', () => ({
  useRuntimeConfig: vi.fn(() => ({thunderid: {backchannelLogout: {enabled: true}}})),
}));

vi.mock('nitropack/runtime', () => ({useStorage: vi.fn()}));

vi.mock('../../src/runtime/server/ThunderIDNuxtClient', () => ({
  default: {getInstance: () => mockClient},
}));

const NOW = Math.floor(Date.now() / 1000);

function post(body: string | undefined, headers: Record<string, string> = {}) {
  state.body = body;
  state.headers = {
    'content-length': String(body?.length ?? 0),
    'content-type': 'application/x-www-form-urlencoded',
    ...headers,
  };

  return (handler as any)({});
}

describe('POST /api/auth/backchannel-logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.status = undefined;
    state.responseHeaders = {};
    mockClient.isInitialized = true;
    mockClient.handleBackchannelLogout.mockResolvedValue({
      issuedAt: NOW,
      sessionsEnded: 0,
      sid: 'sid-1',
      sub: 'user-1',
    });
  });

  it('records the logout and answers 200 with no-store', async () => {
    await post('logout_token=the.logout.token');

    expect(mockClient.handleBackchannelLogout).toHaveBeenCalledWith('the.logout.token');
    expect(state.status).toBe(200);
    expect(state.responseHeaders['Cache-Control']).toBe('no-store');
    expect(await getLoggedOutSessions().isLoggedOut({sid: 'sid-1'})).toBe(true);
  });

  it('answers 400 and records nothing when the token is refused', async () => {
    mockClient.handleBackchannelLogout.mockRejectedValue(
      new InvalidLogoutTokenError('JS-LOGOUT_TOKEN-VLTC-IV01', 'The logout token is not valid.'),
    );

    await post('logout_token=an.id.token');

    expect(state.status).toBe(400);
    expect(await getLoggedOutSessions().isLoggedOut({sid: 'sid-refused'})).toBe(false);
  });

  it('never logs the token', async () => {
    mockClient.handleBackchannelLogout.mockRejectedValue(
      new InvalidLogoutTokenError('JS-LOGOUT_TOKEN-VLTC-IV01', 'The logout token is not valid.'),
    );

    await post('logout_token=secret.token.value');

    const logged = JSON.stringify([...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.error).mock.calls]);
    expect(logged).toContain('JS-LOGOUT_TOKEN-VLTC-IV01');
    expect(logged).not.toContain('secret.token.value');
  });

  it.each([
    ['a body that is not a form', 'logout_token=t', {'content-type': 'application/json'}],
    ['a form without the token', 'other=value', {}],
    ['an empty body', '', {}],
    ['a body over the limit', 'logout_token=t', {'content-length': String(16 * 1024 + 1)}],
    ['a body with no declared length', 'logout_token=t', {'content-length': undefined as unknown as string}],
  ])('answers 400 for %s without validating anything', async (_name, body, headers) => {
    await post(body, headers);

    expect(state.status).toBe(400);
    expect(mockClient.handleBackchannelLogout).not.toHaveBeenCalled();
  });

  it('answers 500 when the logout could not be completed, so the server tries again', async () => {
    mockClient.handleBackchannelLogout.mockRejectedValue(new Error('store unavailable'));

    await post('logout_token=the.logout.token');

    expect(state.status).toBe(500);
  });

  it('answers 500 while the client is not initialized', async () => {
    mockClient.isInitialized = false;

    await post('logout_token=the.logout.token');

    expect(state.status).toBe(500);
    expect(mockClient.handleBackchannelLogout).not.toHaveBeenCalled();
  });
});
