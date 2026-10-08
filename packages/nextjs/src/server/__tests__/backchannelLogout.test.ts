// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {InvalidLogoutTokenError} from '@thunderid/node';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import SessionManager from '../../utils/SessionManager';
import backchannelLogout from '../backchannelLogout';

const {client} = vi.hoisted(() => ({
  client: {
    getConfiguration: vi.fn(),
    handleBackchannelLogout: vi.fn(),
    initialize: vi.fn(),
    isInitialized: true,
  },
}));

vi.mock('../getClient', () => ({default: () => client}));

const HOUR = 3600;
const URL = 'https://app.example.com/api/auth/backchannel-logout';

const resetLoggedOutSessions = (): void => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('thunderid.nextjs.loggedOutSessions')];
};

const post = (body: string, contentType = 'application/x-www-form-urlencoded'): Request =>
  new Request(URL, {body, headers: {'Content-Type': contentType}, method: 'POST'});

describe('backchannelLogout route handler', () => {
  beforeEach(() => {
    process.env['THUNDERID_SECRET'] = 'test-secret-for-session-cookies';
    resetLoggedOutSessions();
    client.isInitialized = true;
    client.initialize.mockReset().mockResolvedValue(true);
    client.getConfiguration.mockReset().mockResolvedValue({});
    client.handleBackchannelLogout.mockReset().mockResolvedValue({
      issuedAt: Math.floor(Date.now() / 1000),
      sessionsEnded: 0,
      sid: 'sid-1',
      sub: 'user-1',
    });
  });

  afterEach(() => {
    resetLoggedOutSessions();
  });

  it('answers 200 and from then on the matching session cookie is refused', async () => {
    const cookie: string = await SessionManager.createSessionToken(
      'access-token',
      'user-1',
      'local-1',
      'openid',
      HOUR,
      'refresh-token',
      undefined,
      {sid: 'sid-1'},
    );

    await expect(SessionManager.verifySessionToken(cookie)).resolves.toBeDefined();

    const response: Response = await backchannelLogout().POST(post('logout_token=header.payload.signature'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(client.handleBackchannelLogout).toHaveBeenCalledWith('header.payload.signature');
    await expect(SessionManager.verifySessionToken(cookie)).rejects.toThrow();
  });

  it('initializes the client when the logout is the first request the process handles', async () => {
    client.isInitialized = false;

    expect((await backchannelLogout().POST(post('logout_token=header.payload.signature'))).status).toBe(200);
    expect(client.initialize).toHaveBeenCalledTimes(1);
  });

  it('calls onLogout with the outcome', async () => {
    const onLogout = vi.fn();

    await backchannelLogout({onLogout}).POST(post('logout_token=header.payload.signature'));

    expect(onLogout).toHaveBeenCalledWith(expect.objectContaining({sid: 'sid-1', sub: 'user-1'}));
  });

  it('records the logout in the given store', async () => {
    const store = {get: vi.fn().mockResolvedValue(undefined), set: vi.fn().mockResolvedValue(undefined)};

    await backchannelLogout({store}).POST(post('logout_token=header.payload.signature'));

    expect(store.set).toHaveBeenCalledWith('thunderid:logout:sid:sid-1', expect.any(String), 86400);
  });

  it('answers 400 for a token the client refuses, and records nothing', async () => {
    const store = {get: vi.fn().mockResolvedValue(undefined), set: vi.fn().mockResolvedValue(undefined)};

    client.handleBackchannelLogout.mockRejectedValue(new InvalidLogoutTokenError('CODE', 'not valid'));

    const response: Response = await backchannelLogout({store}).POST(post('logout_token=header.payload.signature'));

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(store.set).not.toHaveBeenCalled();
  });

  it('answers 500 for any other failure, so the server tries again', async () => {
    client.handleBackchannelLogout.mockRejectedValue(new Error('keys unreachable'));

    expect((await backchannelLogout().POST(post('logout_token=header.payload.signature'))).status).toBe(500);
  });

  it('still answers 200 when the application hook fails, since the logout is already recorded', async () => {
    const onLogout = vi.fn().mockRejectedValue(new Error('hook failed'));

    expect((await backchannelLogout({onLogout}).POST(post('logout_token=header.payload.signature'))).status).toBe(200);
  });

  it.each([
    ['no logout_token parameter', 'other=value'],
    ['an empty logout_token', 'logout_token='],
  ])('answers 400 for %s', async (_name: string, body: string) => {
    expect((await backchannelLogout().POST(post(body))).status).toBe(400);
    expect(client.handleBackchannelLogout).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not form encoded', async () => {
    const request: Request = post(JSON.stringify({logout_token: 'header.payload.signature'}), 'application/json');

    expect((await backchannelLogout().POST(request)).status).toBe(400);
    expect(client.handleBackchannelLogout).not.toHaveBeenCalled();
  });

  it('answers 400 for a body over the size limit, without reading the token', async () => {
    expect((await backchannelLogout().POST(post(`logout_token=${'a'.repeat(20 * 1024)}`))).status).toBe(400);
    expect(client.handleBackchannelLogout).not.toHaveBeenCalled();
  });
});
