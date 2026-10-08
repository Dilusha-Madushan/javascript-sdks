// Copyright 2025 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import type {H3Event} from 'h3';
import {createError} from 'h3';
import {isSessionLoggedOut} from './loggedOutSessions';
import {verifySessionToken, getSessionCookieName} from './session';
import {getChunkedCookie} from './chunkedCookie';
import type {ThunderIDSessionPayload} from '../../types';
import ThunderIDNuxtClient from '../ThunderIDNuxtClient';
import {useRuntimeConfig} from '#imports';

/**
 * Get the current session from the request cookie.
 * Returns the session payload if valid, or null if no session exists.
 *
 * Use this in custom server API routes to access session data.
 *
 * @example
 * ```ts
 * // server/api/me.get.ts
 * export default defineEventHandler(async (event) => {
 *   const session = await useServerSession(event);
 *   if (!session) {
 *     throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
 *   }
 *   return { sessionId: session.sessionId, sub: session.sub };
 * });
 * ```
 */
export async function useServerSession(event: H3Event): Promise<ThunderIDSessionPayload | null> {
  const config: ReturnType<typeof useRuntimeConfig> = useRuntimeConfig();
  const sessionSecret: string | undefined = config.thunderid?.sessionSecret;

  const sessionCookie: string | undefined = getChunkedCookie(event, getSessionCookieName());
  if (!sessionCookie) {
    return null;
  }

  try {
    const session: ThunderIDSessionPayload = await verifySessionToken(sessionCookie, sessionSecret);

    return (await isSessionLoggedOut(session)) ? null : session;
  } catch {
    return null;
  }
}

/**
 * Get the current session or throw a 401 error.
 * Use this when the route must be authenticated.
 *
 * @example
 * ```ts
 * // server/api/protected-data.get.ts
 * export default defineEventHandler(async (event) => {
 *   const session = await requireServerSession(event);
 *   // session is guaranteed to be non-null here
 *   return { userId: session.sub };
 * });
 * ```
 */
export async function requireServerSession(event: H3Event): Promise<ThunderIDSessionPayload> {
  const session: ThunderIDSessionPayload | null = await useServerSession(event);
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: Authentication required.',
    });
  }
  return session;
}

/**
 * Verify the session cookie and rehydrate the legacy in-memory token store
 * from its payload. Used internally by the SDK's SSR plugin and /api/auth/*
 * routes so that subsequent calls which look up tokens by `sessionId`
 * (`getAccessToken`, `getUser`, `getDecodedIdToken`, `signOut`) still succeed
 * after a server restart, when the in-memory store is empty but the signed
 * session cookie is still valid.
 *
 * Returns `null` for missing or invalid cookies — callers decide whether to
 * 401 or silently treat the user as unauthenticated.
 */
export async function verifyAndRehydrateSession(
  event: H3Event,
  sessionSecret?: string,
): Promise<ThunderIDSessionPayload | null> {
  const sessionCookie: string | undefined = getChunkedCookie(event, getSessionCookieName());
  if (!sessionCookie) {
    return null;
  }

  let session: ThunderIDSessionPayload;
  try {
    session = await verifySessionToken(sessionCookie, sessionSecret);

    if (await isSessionLoggedOut(session)) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    await ThunderIDNuxtClient.getInstance().rehydrateSessionFromPayload(session);
  } catch {
    // Rehydration is best-effort: the cookie payload itself is still usable
    // by callers that read tokens directly from `session`.
  }

  return session;
}
