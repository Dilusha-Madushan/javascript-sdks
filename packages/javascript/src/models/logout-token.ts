// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * The claims of a validated back-channel logout token.
 */
export interface LogoutTokenClaims {
  /**
   * Other claims the server included.
   */
  [claim: string]: unknown;
  aud: string | string[];
  events: Record<string, unknown>;
  exp: number;
  iat: number;
  iss: string;
  jti: string;
  /**
   * The server session that ended. Present on every ThunderID logout token.
   */
  sid?: string;
  /**
   * The subject whose session ended.
   */
  sub?: string;
}

/**
 * What a logout token's claims are checked against.
 */
export interface LogoutTokenValidationOptions {
  clientId: string;
  /**
   * Allowed clock difference in seconds.
   */
  clockTolerance?: number;
  issuer: string;
  /**
   * The current time in seconds since the epoch. Defaults to the system clock.
   */
  now?: number;
  /**
   * The signature algorithms the SDK accepts.
   */
  supportedAlgorithms: readonly string[];
}

/**
 * The outcome of handling a back-channel logout request.
 */
export interface BackchannelLogoutResult {
  /**
   * How many local sessions were ended. Zero when the token named no session held here.
   */
  sessionsEnded: number;
  sid?: string;
  sub?: string;
}
