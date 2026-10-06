// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {StorageManager} from '@thunderid/javascript';

const SID_INDEX = 'backchannel_logout_sid';
const SUB_INDEX = 'backchannel_logout_sub';

/**
 * Local session identifiers mapped to the time each session began, in milliseconds.
 */
export type IndexedSessions = Record<string, number>;

/**
 * What ties a local session to the server: the server session it joined and its subject.
 */
export interface SessionBinding {
  sid?: string;
  sub?: string;
}

/**
 * Finds local sessions by the server session identifier (`sid`) or the subject (`sub`) of their ID
 * token. The storage adapter cannot list sessions, so a back-channel logout needs this to find the
 * ones a logout token names. It lives in the same store as the sessions themselves.
 */
class SessionIndex<T = unknown> {
  private storageManager: StorageManager<T>;

  public constructor(storageManager: StorageManager<T>) {
    this.storageManager = storageManager;
  }

  /**
   * Records a session that just began.
   */
  public async add(sessionId: string, binding: SessionBinding, startedAt: number): Promise<void> {
    // An entry would otherwise grow with every sign-in, so sessions that are gone are dropped.
    if (binding.sid) {
      const live: IndexedSessions = await this.dropEndedSessions(await this.read(SID_INDEX, binding.sid));

      await this.write(SID_INDEX, binding.sid, {...live, [sessionId]: startedAt});
    }
    if (binding.sub) {
      const live: IndexedSessions = await this.dropEndedSessions(await this.read(SUB_INDEX, binding.sub));

      await this.write(SUB_INDEX, binding.sub, {...live, [sessionId]: startedAt});
    }
  }

  public findBySid(sid: string): Promise<IndexedSessions> {
    return this.read(SID_INDEX, sid);
  }

  public findBySub(sub: string): Promise<IndexedSessions> {
    return this.read(SUB_INDEX, sub);
  }

  /**
   * Forgets a session that has ended.
   */
  public async remove(sessionId: string, binding: SessionBinding): Promise<void> {
    if (binding.sid) {
      await this.removeEntry(SID_INDEX, binding.sid, sessionId);
    }
    if (binding.sub) {
      await this.removeEntry(SUB_INDEX, binding.sub, sessionId);
    }
  }

  private async read(index: string, key: string): Promise<IndexedSessions> {
    try {
      return (await this.storageManager.getCustomData<IndexedSessions>(index, key)) ?? {};
    } catch {
      // A store may throw for a key it does not hold.
      return {};
    }
  }

  private async write(index: string, key: string, sessions: IndexedSessions): Promise<void> {
    // setCustomData merges into what is stored, so replacing an entry means removing it first.
    await this.storageManager.removeCustomData(index, key);

    if (Object.keys(sessions).length > 0) {
      await this.storageManager.setCustomData<IndexedSessions>(index, sessions, key);
    }
  }

  private async removeEntry(index: string, key: string, sessionId: string): Promise<void> {
    const sessions: IndexedSessions = await this.read(index, key);

    if (!(sessionId in sessions)) {
      return;
    }

    delete sessions[sessionId];
    await this.write(index, key, sessions);
  }

  private async dropEndedSessions(sessions: IndexedSessions): Promise<IndexedSessions> {
    const checked: ([string, number] | undefined)[] = await Promise.all(
      Object.entries(sessions).map(async ([sessionId, startedAt]: [string, number]) => {
        try {
          return (await this.storageManager.getSessionData(sessionId))?.access_token
            ? ([sessionId, startedAt] as [string, number])
            : undefined;
        } catch {
          return undefined;
        }
      }),
    );

    return Object.fromEntries(checked.filter((entry: [string, number] | undefined) => entry !== undefined));
  }
}

export default SessionIndex;
