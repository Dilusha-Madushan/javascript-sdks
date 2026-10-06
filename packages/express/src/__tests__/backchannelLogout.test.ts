// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import http from 'node:http';
import {AddressInfo} from 'node:net';
import {InvalidLogoutTokenError} from '@thunderid/node';
import express from 'express';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import handleBackchannelLogout from '../middleware/backchannelLogout';
import ThunderIDExpressClient from '../ThunderIDExpressClient';

interface Reply {
  headers: http.IncomingHttpHeaders;
  status: number;
}

describe('handleBackchannelLogout', () => {
  let server: http.Server;
  let client: {expressConfig: Record<string, unknown>; handleBackchannelLogout: ReturnType<typeof vi.fn>};
  let mountClient: boolean;

  // Loopback only: the handler is exercised through a real Express app, with the client stubbed.
  const send = (method: string, contentType: string, body: string): Promise<Reply> =>
    new Promise<Reply>((resolve: (reply: Reply) => void, reject: (error: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          headers: {'Content-Length': Buffer.byteLength(body), 'Content-Type': contentType},
          host: '127.0.0.1',
          method,
          path: '/backchannel-logout',
          port: (server.address() as AddressInfo).port,
        },
        (response: http.IncomingMessage) => {
          response.resume();
          response.on('end', () => resolve({headers: response.headers, status: response.statusCode ?? 0}));
        },
      );

      request.on('error', reject);
      request.end(body);
    });

  const post = (body: string, contentType = 'application/x-www-form-urlencoded'): Promise<Reply> =>
    send('POST', contentType, body);

  beforeEach(async () => {
    mountClient = true;
    client = {
      expressConfig: {},
      handleBackchannelLogout: vi.fn().mockResolvedValue({sessionsEnded: 1, sid: 'sid-1', sub: 'user-1'}),
    };

    const app: express.Express = express();

    app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
      if (mountClient) {
        (req as express.Request & {thunderIDAuth?: ThunderIDExpressClient}).thunderIDAuth =
          client as unknown as ThunderIDExpressClient;
      }
      next();
    });
    app.all('/backchannel-logout', handleBackchannelLogout());

    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve: () => void) => {
      server.once('listening', resolve);
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => resolve());
    });
  });

  it('answers 200 and hands the token to the client', async () => {
    const reply: Reply = await post('logout_token=header.payload.signature');

    expect(reply.status).toBe(200);
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(client.handleBackchannelLogout).toHaveBeenCalledWith('header.payload.signature');
  });

  it('calls onBackchannelLogout with the outcome', async () => {
    const onBackchannelLogout = vi.fn();

    client.expressConfig = {onBackchannelLogout};
    await post('logout_token=header.payload.signature');

    expect(onBackchannelLogout).toHaveBeenCalledWith({sessionsEnded: 1, sid: 'sid-1', sub: 'user-1'});
  });

  it('answers 400 for a token the client refuses', async () => {
    client.handleBackchannelLogout.mockRejectedValue(new InvalidLogoutTokenError('CODE', 'not valid'));

    const reply: Reply = await post('logout_token=header.payload.signature');

    expect(reply.status).toBe(400);
    expect(reply.headers['cache-control']).toBe('no-store');
  });

  it('answers 500 for any other failure, so the server tries again', async () => {
    client.handleBackchannelLogout.mockRejectedValue(new Error('store unavailable'));

    expect((await post('logout_token=header.payload.signature')).status).toBe(500);
  });

  it('still answers 200 when the application hook fails, since the sessions are already ended', async () => {
    client.expressConfig = {onBackchannelLogout: vi.fn().mockRejectedValue(new Error('hook failed'))};

    expect((await post('logout_token=header.payload.signature')).status).toBe(200);
  });

  it.each([
    ['no logout_token parameter', 'other=value'],
    ['an empty logout_token', 'logout_token='],
    ['an empty body', ''],
  ])('answers 400 for %s', async (_name: string, body: string) => {
    expect((await post(body)).status).toBe(400);
    expect(client.handleBackchannelLogout).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not form encoded', async () => {
    const reply: Reply = await post(JSON.stringify({logout_token: 'header.payload.signature'}), 'application/json');

    expect(reply.status).toBe(400);
    expect(client.handleBackchannelLogout).not.toHaveBeenCalled();
  });

  it('answers 400 for a body over the size limit, without reading the token', async () => {
    const reply: Reply = await post(`logout_token=${'a'.repeat(20 * 1024)}`);

    expect(reply.status).toBe(400);
    expect(client.handleBackchannelLogout).not.toHaveBeenCalled();
  });

  it('answers 405 for any method but POST', async () => {
    const reply: Reply = await send('GET', 'application/x-www-form-urlencoded', '');

    expect(reply.status).toBe(405);
    expect(reply.headers.allow).toBe('POST');
  });

  it('answers 500 when thunderID() was not mounted first', async () => {
    mountClient = false;

    expect((await post('logout_token=header.payload.signature')).status).toBe(500);
  });
});
