// Copyright 2025 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

// Add Ponyfills for Fetch API
import fetch, {Headers, Request, Response} from 'cross-fetch';

if (!globalThis.fetch) {
  globalThis.fetch = fetch;
  globalThis.Headers = Headers;
  globalThis.Request = Request;
  globalThis.Response = Response;
}

/**
 * Entry point for all public APIs of the @thunderid/node SDK.
 */

// Client
export {default as ThunderIDNodeClient} from './ThunderIDNodeClient';

// Constants
export {default as CookieConfig} from './constants/CookieConfig';

// Models
export type {ThunderIDNodeConfig, SessionCookieConfig} from './models/config';
export type {default as AuthURLCallback} from './models/AuthURLCallback';

// Stores
export {default as MemoryCacheStore} from './stores/MemoryCacheStore';

// Utils
export {default as CookieChunking} from './utils/CookieChunking';
export {default as NodeCryptoUtils} from './utils/NodeCryptoUtils';
export {default as SessionUtils} from './utils/SessionUtils';
export {default as SessionIndex} from './utils/SessionIndex';
export type {IndexedSessions, SessionBinding} from './utils/SessionIndex';
export {default as generateSessionId} from './utils/generateSessionId';
export {default as getSessionCookieOptions} from './utils/getSessionCookieOptions';

// Re-export everything from the JavaScript SDK
export * from '@thunderid/javascript';
