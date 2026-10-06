// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import BackchannelLogoutConstants from '../constants/BackchannelLogoutConstants';
import {InvalidLogoutTokenError} from '../errors/exception';
import {LogoutTokenClaims, LogoutTokenValidationOptions} from '../models/logout-token';

const fail = (code: string, message: string): never => {
  throw new InvalidLogoutTokenError(code, message);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * Checks the header and claims of a back-channel logout token, per OpenID Connect Back-Channel
 * Logout 1.0 section 2.6. It does not verify the signature: the caller does that with the server's
 * keys. Messages never include the token or its claim values.
 *
 * @param header - The decoded JOSE header.
 * @param payload - The decoded claims.
 * @param options - The issuer, client and clock the claims are checked against.
 * @returns The claims, typed.
 * @throws {InvalidLogoutTokenError} When any check fails.
 */
const validateLogoutTokenClaims = (
  header: unknown,
  payload: unknown,
  options: LogoutTokenValidationOptions,
): LogoutTokenClaims => {
  if (!isRecord(header) || !isRecord(payload)) {
    return fail('JS-LOGOUT_TOKEN-VLTC-IV01', 'The logout token is not a well-formed JWT.');
  }

  // The type, the event and the missing nonce are what tell a logout token from an ID token.
  const type: string = typeof header['typ'] === 'string' ? header['typ'].toLowerCase() : '';

  if (
    type !== BackchannelLogoutConstants.TOKEN_TYPE &&
    type !== `application/${BackchannelLogoutConstants.TOKEN_TYPE}`
  ) {
    return fail('JS-LOGOUT_TOKEN-VLTC-IV02', 'The token type is not logout+jwt.');
  }
  if (typeof header['alg'] !== 'string' || !options.supportedAlgorithms.includes(header['alg'])) {
    return fail('JS-LOGOUT_TOKEN-VLTC-IV03', 'The signature algorithm is not supported.');
  }
  if ('nonce' in payload) {
    return fail('JS-LOGOUT_TOKEN-VLTC-IV04', 'A logout token must not carry a nonce.');
  }

  const {events} = payload;

  if (!isRecord(events) || !isRecord(events[BackchannelLogoutConstants.EVENT])) {
    return fail('JS-LOGOUT_TOKEN-VLTC-IV05', 'The back-channel logout event is missing.');
  }
  if (payload['iss'] !== options.issuer) {
    return fail('JS-LOGOUT_TOKEN-VLTC-IV06', 'The issuer does not match.');
  }

  const audiences: unknown[] = Array.isArray(payload['aud']) ? payload['aud'] : [payload['aud']];

  if (!isNonEmptyString(options.clientId) || !audiences.includes(options.clientId)) {
    return fail('JS-LOGOUT_TOKEN-VLTC-IV07', 'The audience does not include this client.');
  }

  const now: number = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance: number = options.clockTolerance ?? BackchannelLogoutConstants.DEFAULT_CLOCK_TOLERANCE_SECONDS;

  if (typeof payload['iat'] !== 'number' || payload['iat'] > now + tolerance) {
    return fail('JS-LOGOUT_TOKEN-VLTC-IV08', 'The issued-at time is missing or in the future.');
  }
  if (typeof payload['exp'] !== 'number' || payload['exp'] <= now - tolerance) {
    return fail('JS-LOGOUT_TOKEN-VLTC-IV09', 'The token has expired.');
  }
  if ('sid' in payload && !isNonEmptyString(payload['sid'])) {
    return fail('JS-LOGOUT_TOKEN-VLTC-IV10', 'The session identifier is not valid.');
  }
  if ('sub' in payload && !isNonEmptyString(payload['sub'])) {
    return fail('JS-LOGOUT_TOKEN-VLTC-IV10', 'The subject is not valid.');
  }
  if (!('sid' in payload) && !('sub' in payload)) {
    return fail('JS-LOGOUT_TOKEN-VLTC-IV11', 'The token names neither a session nor a subject.');
  }
  // Required by the protocol, and what the replay check keys on.
  if (!isNonEmptyString(payload['jti'])) {
    return fail('JS-LOGOUT_TOKEN-VLTC-IV12', 'The token identifier is missing.');
  }

  return payload as LogoutTokenClaims;
};

export default validateLogoutTokenClaims;
