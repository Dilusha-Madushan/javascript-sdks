// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Constants for OpenID Connect Back-Channel Logout 1.0, for an SDK that receives logout tokens.
 */
const BackchannelLogoutConstants: {
  readonly DEFAULT_CLOCK_TOLERANCE_SECONDS: number;
  readonly EVENT: string;
  readonly JWKS_CACHE_TTL_MS: number;
  readonly JWKS_MIN_REFETCH_INTERVAL_MS: number;
  readonly TOKEN_PARAM: string;
  readonly TOKEN_TYPE: string;
} = {
  // The server and the application rarely share a clock to the second, and a rejected token is not retried.
  DEFAULT_CLOCK_TOLERANCE_SECONDS: 60,
  EVENT: 'http://schemas.openid.net/event/backchannel-logout',
  JWKS_CACHE_TTL_MS: 600000,
  // Bounds the JWKS re-fetch an unknown key identifier triggers, since the endpoint is unauthenticated.
  JWKS_MIN_REFETCH_INTERVAL_MS: 30000,
  TOKEN_PARAM: 'logout_token',
  TOKEN_TYPE: 'logout+jwt',
};

export default BackchannelLogoutConstants;
