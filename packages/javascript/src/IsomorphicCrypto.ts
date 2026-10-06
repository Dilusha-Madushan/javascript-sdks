// Copyright 2022 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import TokenConstants from './constants/TokenConstants';
import {InvalidLogoutTokenError, ThunderIDAuthException} from './errors/exception';
import {Crypto, JWKInterface} from './models/crypto';

export class IsomorphicCrypto<T = any> {
  private cryptoUtils: Crypto<T>;

  public constructor(cryptoUtils: Crypto<T>) {
    this.cryptoUtils = cryptoUtils;
  }

  /**
   * Generate code verifier.
   *
   * @returns code verifier.
   */
  public getCodeVerifier(): string {
    return this.cryptoUtils.base64URLEncode(this.cryptoUtils.generateRandomBytes(32));
  }

  /**
   * Derive code challenge from the code verifier.
   *
   * @param verifier - Code verifier.
   *
   * @returns - code challenge.
   */
  public async getCodeChallenge(verifier: string): Promise<string> {
    const hashed: T = await this.cryptoUtils.hashSha256(verifier);
    return this.cryptoUtils.base64URLEncode(hashed);
  }

  /**
   * Get JWK used for the id_token
   *
   * @param jwtHeader - header of the id_token.
   * @param keys - jwks response.
   *
   * @returns public key.
   *
   * @throws
   */
  /* eslint-disable @typescript-eslint/no-explicit-any */
  public getJWKForTheIdToken(jwtHeader: string, keys: JWKInterface[]): JWKInterface {
    const headerJSON: Record<string, string> = JSON.parse(this.cryptoUtils.base64URLDecode(jwtHeader));

    const matchingKey: JWKInterface | undefined = keys.find(
      (key: JWKInterface): boolean => headerJSON['kid'] === key.kid,
    );

    if (matchingKey) {
      return matchingKey;
    }

    throw new ThunderIDAuthException(
      'JS-CRYPTO_UTIL-GJFTIT-IV01',
      'kid not found.',
      `Failed to find the 'kid' specified in the id_token. 'kid' found in the header : ${
        headerJSON['kid']
      }, Expected values: ${keys.map((key: JWKInterface) => key.kid).join(', ')}`,
    );
  }

  /**
   * Verify id token.
   *
   * @param idToken - id_token received from the IdP.
   * @param jwk - public key used for signing.
   * @param clientId - app identification.
   * @param issuer - id_token issuer.
   * @param username - Username.
   * @param clockTolerance - Allowed leeway for id_tokens (in seconds).
   *
   * @returns whether the id_token is valid.
   *
   * @throws
   */
  public isValidIdToken(
    idToken: string,
    jwk: JWKInterface,
    clientId: string,
    issuer: string,
    username: string,
    clockTolerance: number | undefined,
    validateJwtIssuer: boolean | undefined,
  ): Promise<boolean> {
    return this.cryptoUtils
      .verifyJwt(
        idToken,
        jwk,
        TokenConstants.SignatureValidation.SUPPORTED_ALGORITHMS as unknown as string[],
        clientId,
        issuer,
        username,
        clockTolerance,
        validateJwtIssuer,
      )
      .then((response: boolean) => {
        if (response) {
          return Promise.resolve(true);
        }

        return Promise.reject(
          new ThunderIDAuthException(
            'JS-CRYPTO_HELPER-IVIT-IV01',
            'Invalid ID token.',
            'ID token validation returned false',
          ),
        );
      })
      .catch((error: ThunderIDAuthException) => Promise.reject(error));
  }

  /**
   * Verifies the signature of a back-channel logout token, along with its audience, issuer,
   * lifetime and, when the token has one, subject.
   *
   * @param logoutToken - The logout token received from the server.
   * @param jwk - The server key the token names.
   * @param clientId - The client the token must be addressed to.
   * @param issuer - The expected issuer.
   * @param subject - The token's subject, when it has one.
   * @param clockTolerance - Allowed clock difference in seconds.
   *
   * @throws {InvalidLogoutTokenError} When verification fails. The message never includes the token.
   */
  public async verifyLogoutTokenSignature(
    logoutToken: string,
    jwk: JWKInterface,
    clientId: string,
    issuer: string,
    subject: string | undefined,
    clockTolerance: number,
  ): Promise<void> {
    let verified = false;

    try {
      verified = await this.cryptoUtils.verifyJwt(
        logoutToken,
        jwk,
        TokenConstants.SignatureValidation.SUPPORTED_ALGORITHMS as unknown as string[],
        clientId,
        issuer,
        // A logout token may name only a session, and an empty subject would be required to match.
        subject!,
        clockTolerance,
        true,
      );
    } catch {
      verified = false;
    }

    if (!verified) {
      throw new InvalidLogoutTokenError(
        'JS-CRYPTO_HELPER-VLTS-IV01',
        'The logout token signature could not be verified.',
      );
    }
  }

  /**
   * Decodes the JOSE header of a JWT without verifying its signature.
   */
  public decodeJwtHeader<R = Record<string, unknown>>(token: string): R {
    try {
      return JSON.parse(this.cryptoUtils.base64URLDecode(token?.split('.')[0])) as R;
    } catch {
      throw new ThunderIDAuthException(
        'JS-CRYPTO_UTIL-DJH-IV01',
        'Decoding token failed.',
        'The token header could not be decoded.',
      );
    }
  }

  public decodeJwtToken<R = Record<string, unknown>>(token: string): R {
    try {
      const utf8String: string = this.cryptoUtils.base64URLDecode(token?.split('.')[1]);
      const payload: R = JSON.parse(utf8String);

      return payload;
    } catch (error: any) {
      throw new ThunderIDAuthException('JS-CRYPTO_UTIL-DIT-IV02', 'Decoding token failed.', error);
    }
  }
}
