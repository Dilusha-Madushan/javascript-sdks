// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {describe, expect, it} from 'vitest';
import BackchannelLogoutConstants from '../../constants/BackchannelLogoutConstants';
import {InvalidLogoutTokenError} from '../../errors/exception';
import {LogoutTokenValidationOptions} from '../../models/logout-token';
import validateLogoutTokenClaims from '../validateLogoutTokenClaims';

const NOW = 1_800_000_000;
const ISSUER = 'https://localhost:8090';
const CLIENT_ID = 'test-client';

const options: LogoutTokenValidationOptions = {
  clientId: CLIENT_ID,
  clockTolerance: 60,
  issuer: ISSUER,
  now: NOW,
  supportedAlgorithms: ['RS256'],
};

const validHeader = (): Record<string, unknown> => ({alg: 'RS256', kid: 'key-1', typ: 'logout+jwt'});

const validPayload = (): Record<string, unknown> => ({
  aud: CLIENT_ID,
  events: {[BackchannelLogoutConstants.EVENT]: {}},
  exp: NOW + 120,
  iat: NOW,
  iss: ISSUER,
  jti: 'jti-1',
  sid: 'session-1',
  sub: 'user-1',
});

const codeOf = (header: unknown, payload: unknown): string | undefined => {
  try {
    validateLogoutTokenClaims(header, payload, options);
  } catch (error) {
    if (error instanceof InvalidLogoutTokenError) {
      return error.code;
    }

    throw error;
  }

  return undefined;
};

describe('validateLogoutTokenClaims', (): void => {
  it('accepts a logout token as ThunderID issues it', (): void => {
    const claims = validateLogoutTokenClaims(validHeader(), validPayload(), options);

    expect(claims.sid).toBe('session-1');
    expect(claims.sub).toBe('user-1');
  });

  it.each([
    ['an array audience that includes the client', {aud: ['other', CLIENT_ID]}],
    ['a session with no subject', {sub: undefined}],
    ['a subject with no session', {sid: undefined}],
  ])('accepts %s', (_name: string, change: Record<string, unknown>): void => {
    const payload: Record<string, unknown> = {...validPayload(), ...change};

    Object.keys(change).forEach((key: string): void => {
      if (change[key] === undefined) delete payload[key];
    });

    expect(codeOf(validHeader(), payload)).toBeUndefined();
  });

  it('accepts the media-type form of the token type, in any case', (): void => {
    expect(codeOf({...validHeader(), typ: 'application/Logout+JWT'}, validPayload())).toBeUndefined();
  });

  it.each([
    ['a header that is not an object', 'JS-LOGOUT_TOKEN-VLTC-IV01', 'nope', validPayload()],
    ['an ID token type', 'JS-LOGOUT_TOKEN-VLTC-IV02', {...validHeader(), typ: 'JWT'}, validPayload()],
    ['no token type', 'JS-LOGOUT_TOKEN-VLTC-IV02', {alg: 'RS256'}, validPayload()],
    ['an unsupported algorithm', 'JS-LOGOUT_TOKEN-VLTC-IV03', {...validHeader(), alg: 'HS256'}, validPayload()],
    ['the none algorithm', 'JS-LOGOUT_TOKEN-VLTC-IV03', {...validHeader(), alg: 'none'}, validPayload()],
    ['a nonce', 'JS-LOGOUT_TOKEN-VLTC-IV04', validHeader(), {...validPayload(), nonce: 'n'}],
    ['no events claim', 'JS-LOGOUT_TOKEN-VLTC-IV05', validHeader(), {...validPayload(), events: undefined}],
    ['another event', 'JS-LOGOUT_TOKEN-VLTC-IV05', validHeader(), {...validPayload(), events: {other: {}}}],
    [
      'an event value that is not an object',
      'JS-LOGOUT_TOKEN-VLTC-IV05',
      validHeader(),
      {...validPayload(), events: {[BackchannelLogoutConstants.EVENT]: true}},
    ],
    ['another issuer', 'JS-LOGOUT_TOKEN-VLTC-IV06', validHeader(), {...validPayload(), iss: `${ISSUER}/`}],
    ['another client as audience', 'JS-LOGOUT_TOKEN-VLTC-IV07', validHeader(), {...validPayload(), aud: 'other'}],
    ['an issued-at time in the future', 'JS-LOGOUT_TOKEN-VLTC-IV08', validHeader(), {...validPayload(), iat: NOW + 61}],
    ['no issued-at time', 'JS-LOGOUT_TOKEN-VLTC-IV08', validHeader(), {...validPayload(), iat: undefined}],
    ['an expired token', 'JS-LOGOUT_TOKEN-VLTC-IV09', validHeader(), {...validPayload(), exp: NOW - 60}],
    ['an empty session identifier', 'JS-LOGOUT_TOKEN-VLTC-IV10', validHeader(), {...validPayload(), sid: ''}],
    ['a subject that is not a string', 'JS-LOGOUT_TOKEN-VLTC-IV10', validHeader(), {...validPayload(), sub: 7}],
    ['no token identifier', 'JS-LOGOUT_TOKEN-VLTC-IV12', validHeader(), {...validPayload(), jti: undefined}],
    ['an empty token identifier', 'JS-LOGOUT_TOKEN-VLTC-IV12', validHeader(), {...validPayload(), jti: ''}],
  ])('rejects %s', (_name: string, code: string, header: unknown, payload: unknown): void => {
    expect(codeOf(header, payload)).toBe(code);
  });

  it('rejects a token that names neither a session nor a subject', (): void => {
    const payload: Record<string, unknown> = validPayload();

    delete payload['sid'];
    delete payload['sub'];

    expect(codeOf(validHeader(), payload)).toBe('JS-LOGOUT_TOKEN-VLTC-IV11');
  });

  it('allows the clock to differ by the tolerance in either direction', (): void => {
    expect(codeOf(validHeader(), {...validPayload(), iat: NOW + 60})).toBeUndefined();
    expect(codeOf(validHeader(), {...validPayload(), exp: NOW - 59})).toBeUndefined();
  });

  it('never puts a claim value in the error message', (): void => {
    let message = '';

    try {
      validateLogoutTokenClaims(validHeader(), {...validPayload(), iss: 'https://secret.example'}, options);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe('The issuer does not match.');
  });
});
