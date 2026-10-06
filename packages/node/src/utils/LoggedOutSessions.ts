// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {BackchannelLogoutConstants} from '@thunderid/javascript';

/**
 * Where an SDK that keeps its session in a cookie records the sessions a back-channel logout
 * ended. Two operations, so a shared store such as Redis fits directly (`SET key value EX ttl`
 * and `GET key`). The default keeps records in the memory of one process.
 */
export interface LogoutRecordStore {
  get(key: string): Promise<string | null | undefined>;
  /**
   * @param ttlSeconds - How long the record is needed. A store may drop it after that.
   */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/**
 * The session a request presents, as far as a logout record can match it.
 */
export interface PresentedSession {
  /** The server session the local session joined, from the `sid` of its ID token. */
  sid?: string;
  /** When the local session began, in seconds since the epoch. */
  startedAt?: number;
  sub?: string;
}

interface LogoutRecord {
  // The logout token's `iat`, in seconds. Only kept for a record by subject.
  endedAt?: number;
  // In milliseconds. Checked on read, since a store is not required to expire records itself.
  expiresAt: number;
}

/**
 * Keeps logout records in the memory of this process, dropping expired ones as new ones arrive.
 */
export class InMemoryLogoutRecordStore implements LogoutRecordStore {
  private records: Map<string, {expiresAt: number; value: string}> = new Map<
    string,
    {expiresAt: number; value: string}
  >();

  public get(key: string): Promise<string | undefined> {
    const record: {expiresAt: number; value: string} | undefined = this.records.get(key);

    if (record && record.expiresAt <= Date.now()) {
      this.records.delete(key);

      return Promise.resolve(undefined);
    }

    return Promise.resolve(record?.value);
  }

  public set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const now: number = Date.now();

    this.records.forEach((record: {expiresAt: number; value: string}, recordKey: string): void => {
      if (record.expiresAt <= now) {
        this.records.delete(recordKey);
      }
    });
    this.records.set(key, {expiresAt: now + ttlSeconds * 1000, value});

    return Promise.resolve();
  }
}

/**
 * The sessions that back-channel logout has ended, for an SDK whose session lives in a cookie the
 * server cannot delete. The logout handler records each ended session here, and every later read
 * of a session cookie asks whether it matches one.
 *
 * A record by `sid` ends exactly that server session. A record by `sub`, written only when the
 * logout token carried no `sid`, ends that subject's sessions that began before the token was
 * issued, so signing in again afterwards works.
 */
class LoggedOutSessions {
  private store: LogoutRecordStore;

  public constructor(store: LogoutRecordStore = new InMemoryLogoutRecordStore()) {
    this.store = store;
  }

  /**
   * Records a logout.
   *
   * @param logout - The `sid`, `sub` and `iat` of the validated logout token, and the clock
   * tolerance its validation used. A logout by `sub` ends the sessions that began up to that
   * long after `iat`: the clocks may differ by that much, and ending a session that began just
   * after the logout is the safer mistake.
   * @param ttlSeconds - The longest a matching session cookie could still be presented.
   */
  public async record(
    logout: {clockTolerance?: number; issuedAt: number; sid?: string; sub?: string},
    ttlSeconds: number,
  ): Promise<void> {
    const expiresAt: number = Date.now() + ttlSeconds * 1000;

    if (logout.sid) {
      await this.store.set(LoggedOutSessions.sidKey(logout.sid), JSON.stringify({expiresAt}), ttlSeconds);

      return;
    }
    if (logout.sub) {
      // A later logout must not be replaced by an earlier one that arrives out of order.
      const existing: LogoutRecord | undefined = await this.read(LoggedOutSessions.subKey(logout.sub));
      const endedAt: number = Math.max(
        logout.issuedAt + (logout.clockTolerance ?? BackchannelLogoutConstants.DEFAULT_CLOCK_TOLERANCE_SECONDS),
        existing?.endedAt ?? 0,
      );

      await this.store.set(LoggedOutSessions.subKey(logout.sub), JSON.stringify({endedAt, expiresAt}), ttlSeconds);
    }
  }

  /**
   * Reports whether the presented session was ended by a recorded logout.
   */
  public async isLoggedOut(session: PresentedSession): Promise<boolean> {
    if (session.sid && (await this.read(LoggedOutSessions.sidKey(session.sid)))) {
      return true;
    }
    if (!session.sub) {
      return false;
    }

    const bySubject: LogoutRecord | undefined = await this.read(LoggedOutSessions.subKey(session.sub));

    if (bySubject?.endedAt === undefined) {
      return false;
    }

    // The token's time is in whole seconds, so a session that began in that second counts as earlier.
    return session.startedAt === undefined || session.startedAt <= bySubject.endedAt;
  }

  private async read(key: string): Promise<LogoutRecord | undefined> {
    const value: string | null | undefined = await this.store.get(key);

    if (!value) {
      return undefined;
    }

    try {
      const record: LogoutRecord = JSON.parse(value) as LogoutRecord;

      return record.expiresAt > Date.now() ? record : undefined;
    } catch {
      return undefined;
    }
  }

  // Identifiers are encoded so one with a separator in it cannot land on another record's key.
  private static sidKey(sid: string): string {
    return `thunderid:logout:sid:${encodeURIComponent(sid)}`;
  }

  private static subKey(sub: string): string {
    return `thunderid:logout:sub:${encodeURIComponent(sub)}`;
  }
}

export default LoggedOutSessions;
