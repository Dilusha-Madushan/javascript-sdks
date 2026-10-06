// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {BackchannelLogoutConstants, InvalidLogoutTokenError, type BackchannelLogoutResult} from '@thunderid/node';
import {defineEventHandler, getRequestHeader, readRawBody, sendNoContent, setResponseHeader} from 'h3';
import type {H3Event} from 'h3';
import type {ThunderIDNuxtConfig} from '../../../../types';
import {createLogger} from '../../../../utils/log';
import ThunderIDNuxtClient from '../../../ThunderIDNuxtClient';
import {getLoggedOutSessions} from '../../../utils/loggedOutSessions';
import {getSessionCookieOptions} from '../../../utils/session';

const log: ReturnType<typeof createLogger> = createLogger('backchannel-logout');

// A logout token is a kilobyte or two. The endpoint is unauthenticated, so nothing larger is read.
const BODY_LIMIT_BYTES = 16 * 1024;

function respond(event: H3Event, status: number): void {
  setResponseHeader(event, 'Cache-Control', 'no-store');
  sendNoContent(event, status);
}

/**
 * Reads the `logout_token` form parameter. The declared length is required and checked first, so
 * an oversized body is refused without being read.
 */
async function readLogoutToken(event: H3Event): Promise<string | null> {
  const contentType: string = getRequestHeader(event, 'content-type')?.toLowerCase() ?? '';
  const contentLength = Number(getRequestHeader(event, 'content-length'));

  if (
    !contentType.startsWith('application/x-www-form-urlencoded') ||
    !Number.isInteger(contentLength) ||
    contentLength <= 0 ||
    contentLength > BODY_LIMIT_BYTES
  ) {
    return null;
  }

  const body: string | undefined = await readRawBody(event, 'utf8');

  return body ? new URLSearchParams(body).get(BackchannelLogoutConstants.TOKEN_PARAM) : null;
}

/**
 * POST /api/auth/backchannel-logout
 *
 * OpenID Connect back-channel logout. ThunderID posts a `logout_token` here when a session this
 * application took part in ends. The session lives in a cookie the server cannot delete, so the
 * handler records the logout, and every later request that presents a matching session cookie is
 * treated as signed out.
 *
 * Answers `200` for a valid token, including one that names no session held here, `400` for a
 * request or token that is not valid, and `500` when the logout could not be recorded, which
 * makes the server try again. It needs no session cookie: the token's signature is the
 * authentication.
 */
export default defineEventHandler(async (event: H3Event): Promise<void> => {
  const logoutToken: string | null = await readLogoutToken(event);

  if (!logoutToken) {
    respond(event, 400);

    return;
  }

  try {
    const client: ThunderIDNuxtClient = ThunderIDNuxtClient.getInstance();

    if (!client.isInitialized) {
      throw new Error('The ThunderID client is not initialized.');
    }

    const result: BackchannelLogoutResult = await client.handleBackchannelLogout(logoutToken);
    // Typed as synchronous, but it resolves from storage.
    const config: ThunderIDNuxtConfig = await (client.getConfiguration() as unknown as Promise<ThunderIDNuxtConfig>);

    // A session cookie cannot outlive this, so neither does the record that ends it.
    await getLoggedOutSessions().record(
      {...result, clockTolerance: config?.tokenValidation?.idToken?.clockTolerance},
      getSessionCookieOptions().maxAge,
    );

    respond(event, 200);
  } catch (error: unknown) {
    if (error instanceof InvalidLogoutTokenError) {
      // The code says which check failed. The token itself is never logged.
      log.warn(`Rejected a logout token (${error.code}).`);
      respond(event, 400);

      return;
    }

    log.error('Could not complete a back-channel logout.');
    respond(event, 500);
  }
});
