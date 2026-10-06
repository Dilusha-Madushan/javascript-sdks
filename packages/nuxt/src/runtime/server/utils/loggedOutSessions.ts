// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {LoggedOutSessions, type LogoutRecordStore} from '@thunderid/node';
import {useStorage} from 'nitropack/runtime';
import type {ThunderIDNuxtConfig, ThunderIDSessionPayload} from '../../types';
import {useRuntimeConfig} from '#imports';

type BackchannelLogoutConfig = ThunderIDNuxtConfig['backchannelLogout'];

let sessions: LoggedOutSessions | undefined;

function getConfig(): BackchannelLogoutConfig {
  return useRuntimeConfig().thunderid?.backchannelLogout;
}

/**
 * Records in a Nitro storage mount point, so the application's own storage driver decides where
 * they live and which instances share them.
 */
function fromNitroStorage(mount: string): LogoutRecordStore {
  const storage: ReturnType<typeof useStorage> = useStorage(mount);

  return {
    get: async (key: string): Promise<string | undefined> => {
      // A driver may hand the record back already parsed.
      const value: unknown = await storage.getItem(key);

      if (value === null || value === undefined) {
        return undefined;
      }

      return typeof value === 'string' ? value : JSON.stringify(value);
    },
    set: (key: string, value: string, ttlSeconds: number): Promise<void> =>
      storage.setItem(key, value, {ttl: ttlSeconds}),
  };
}

/**
 * Returns the list of sessions that back-channel logout has ended.
 */
export function getLoggedOutSessions(): LoggedOutSessions {
  if (!sessions) {
    const mount: string | undefined = getConfig()?.store;

    sessions = new LoggedOutSessions(mount ? fromNitroStorage(mount) : undefined);
  }

  return sessions;
}

/**
 * Reports whether back-channel logout has ended the session this cookie payload describes.
 */
export async function isSessionLoggedOut(session: ThunderIDSessionPayload): Promise<boolean> {
  if (!getConfig()?.enabled) {
    return false;
  }

  return getLoggedOutSessions().isLoggedOut({
    sid: session.sid,
    startedAt: session.signedInAt ?? session.iat,
    sub: session.sub,
  });
}
