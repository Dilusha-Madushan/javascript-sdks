// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {
  BackchannelLogoutConstants,
  BackchannelLogoutResult,
  InvalidLogoutTokenError,
  LogoutRecordStore,
} from '@thunderid/node';
import getClient from './getClient';
import {ThunderIDNextConfig} from '../models/config';
import ThunderIDNextClient from '../ThunderIDNextClient';
import {getLoggedOutSessions, setLogoutRecordStore} from '../utils/loggedOutSessions';
import logger from '../utils/logger';
import SessionManager from '../utils/SessionManager';

// A logout token is a kilobyte or two. The endpoint is unauthenticated, so nothing larger is read.
const BODY_LIMIT_BYTES = 16 * 1024;

export interface BackchannelLogoutOptions {
  /**
   * Called after a logout was recorded, so the application can clear what it holds for the ended
   * sessions. Best effort: a failure is logged and the handler still answers 200, since the logout
   * is already recorded and a retry would find nothing new.
   */
  onLogout?: (result: BackchannelLogoutResult) => void | Promise<void>;
  /**
   * Where ended sessions are recorded. Give the same store to `thunderIDProxy()`. Needed when more
   * than one instance of the application runs, or when the proxy runs on the Edge runtime, which
   * shares no memory with this handler. Defaults to the memory of this process.
   */
  store?: LogoutRecordStore;
}

const respond = (status: number): Response => new Response(null, {headers: {'Cache-Control': 'no-store'}, status});

/**
 * Reads the request body as text, giving up once it passes the limit.
 */
const readBody = async (request: Request): Promise<string | undefined> => {
  if (Number(request.headers.get('content-length') ?? 0) > BODY_LIMIT_BYTES || !request.body) {
    return undefined;
  }

  const reader: ReadableStreamDefaultReader<Uint8Array> = request.body.getReader();
  const decoder: TextDecoder = new TextDecoder();
  let body = '';
  let size = 0;

  for (;;) {
    const {done, value} = await reader.read();

    if (done) {
      return body + decoder.decode();
    }

    size += value.byteLength;

    if (size > BODY_LIMIT_BYTES) {
      await reader.cancel();

      return undefined;
    }

    body += decoder.decode(value, {stream: true});
  }
};

/**
 * Creates the route handler for OpenID Connect back-channel logout. ThunderID posts a
 * `logout_token` to it when a session this application took part in ends. The session lives in a
 * cookie the server cannot delete, so the handler records the logout, and every later request
 * that presents a matching session cookie is treated as signed out.
 *
 * Mount it at the path registered as the application's back-channel logout URI:
 *
 * ```ts
 * // app/api/auth/backchannel-logout/route.ts
 * import {backchannelLogout} from '@thunderid/nextjs/server';
 *
 * export const {POST} = backchannelLogout();
 * ```
 *
 * It answers `200` for a valid token, including one that names no session held here, `400` for a
 * request or token that is not valid, and `500` when the logout could not be recorded, which
 * makes the server try again. It needs no session cookie: the token's signature is the
 * authentication.
 */
const backchannelLogout = (options: BackchannelLogoutOptions = {}): {POST: (request: Request) => Promise<Response>} => {
  setLogoutRecordStore(options.store);

  const POST = async (request: Request): Promise<Response> => {
    const contentType: string = request.headers.get('content-type')?.toLowerCase() ?? '';

    if (!contentType.startsWith('application/x-www-form-urlencoded')) {
      return respond(400);
    }

    const body: string | undefined = await readBody(request);
    const logoutToken: string | null =
      body === undefined ? null : new URLSearchParams(body).get(BackchannelLogoutConstants.TOKEN_PARAM);

    if (!logoutToken) {
      return respond(400);
    }

    try {
      const client: ThunderIDNextClient = getClient();

      // A logout request can be the first thing a server process handles.
      if (!client.isInitialized) {
        await client.initialize({} as ThunderIDNextConfig);
      }

      const result: BackchannelLogoutResult = await client.handleBackchannelLogout(logoutToken);
      // Typed as synchronous, but it resolves from storage.
      const config: ThunderIDNextConfig = await (client.getConfiguration() as unknown as Promise<ThunderIDNextConfig>);

      // A session cookie cannot outlive this, so neither does the record that ends it.
      await getLoggedOutSessions().record(
        {...result, clockTolerance: config?.tokenValidation?.idToken?.clockTolerance},
        SessionManager.resolveSessionCookieExpiry(config?.sessionCookie?.expiryTime),
      );
      try {
        await options.onLogout?.(result);
      } catch {
        logger.error('[backchannelLogout] The onLogout hook failed.');
      }

      return respond(200);
    } catch (error: unknown) {
      if (error instanceof InvalidLogoutTokenError) {
        // The code says which check failed. The token itself is never logged.
        logger.warn(`[backchannelLogout] Rejected a logout token (${error.code}).`);

        return respond(400);
      }

      logger.error('[backchannelLogout] Could not complete a back-channel logout.');

      return respond(500);
    }
  };

  return {POST};
};

export default backchannelLogout;
