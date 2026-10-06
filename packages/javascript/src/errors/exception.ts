// Copyright 2020 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * @deprecated Use `ThunderIDRuntimeError` for runtime errors and `ThunderIDAPIError` for API errors.
 */
export class ThunderIDAuthException extends Error {
  public code: string | undefined;

  public constructor(code: string, name: string, message: string) {
    super(message);
    this.name = name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Raised when a back-channel logout token is not valid. A logout handler answers 400 for this and a
 * 5xx for any other failure, which tells the server whether a retry can help.
 */
export class InvalidLogoutTokenError extends ThunderIDAuthException {
  public constructor(code: string, message: string) {
    super(code, 'Invalid logout token.', message);
  }
}
