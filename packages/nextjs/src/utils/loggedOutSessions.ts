// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {LoggedOutSessions, LogoutRecordStore} from '@thunderid/node';

// Next.js bundles the proxy, route handlers and server components separately, so a module-level
// variable would give each its own list. The global object is the one thing they share in a process.
const SHARED_KEY: unique symbol = Symbol.for('thunderid.nextjs.loggedOutSessions');

interface Shared {
  sessions: LoggedOutSessions;
  store?: LogoutRecordStore;
}

type GlobalWithShared = typeof globalThis & {[SHARED_KEY]?: Shared};

const shared = (): Shared => {
  const scope: GlobalWithShared = globalThis as GlobalWithShared;

  scope[SHARED_KEY] ??= {sessions: new LoggedOutSessions()};

  return scope[SHARED_KEY];
};

/**
 * Returns the list of sessions that back-channel logout has ended, shared by everything that runs
 * in this process.
 */
export const getLoggedOutSessions = (): LoggedOutSessions => shared().sessions;

/**
 * Makes the list use the given store, so several instances of an application can share it.
 * Without one, records stay in the memory of this process.
 */
export const setLogoutRecordStore = (store?: LogoutRecordStore): void => {
  const current: Shared = shared();

  if (store && current.store !== store) {
    current.store = store;
    current.sessions = new LoggedOutSessions(store);
  }
};
