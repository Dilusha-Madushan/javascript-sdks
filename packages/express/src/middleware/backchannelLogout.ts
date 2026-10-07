// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {
  BackchannelLogoutConstants,
  BackchannelLogoutResult,
  InvalidLogoutTokenError,
  logger as Logger,
} from '@thunderid/node';
import express from 'express';
import ThunderIDExpressClient from '../ThunderIDExpressClient';

// A logout token is a kilobyte or two. The endpoint is unauthenticated, so nothing larger is read.
const BODY_LIMIT = '16kb';

type RequestWithClient = express.Request & {thunderIDAuth?: ThunderIDExpressClient};

/**
 * Returns an Express route handler for OpenID Connect back-channel logout. ThunderID posts a
 * `logout_token` to it when a session this application took part in ends, and the handler ends
 * the matching local sessions, so the next request that presents one is rejected by `protect()`.
 *
 * - Answers `200` for a valid token, including one that names no session held here.
 * - Answers `400` for a request or token that is not valid, and `500` when the logout could not be
 *   recorded, which makes the server try again.
 *
 * Must be used after `thunderID()` middleware so that `req.thunderIDAuth` is set. Mount it at the
 * path registered as the application's back-channel logout URI. It needs no body parser and no
 * session cookie: the token's signature is the authentication.
 *
 * ```ts
 * app.post('/backchannel-logout', handleBackchannelLogout());
 * ```
 */
const handleBackchannelLogout = (): express.RequestHandler => {
  const parseForm: express.RequestHandler = express.urlencoded({extended: false, limit: BODY_LIMIT});

  const handle = async (req: express.Request, res: express.Response): Promise<void> => {
    const client: ThunderIDExpressClient | undefined = (req as RequestWithClient).thunderIDAuth;

    if (!client) {
      Logger.error('thunderID() middleware must be mounted before handleBackchannelLogout()');
      res.status(500).end();
      return;
    }

    const logoutToken: unknown = (req.body as Record<string, unknown> | undefined)?.[
      BackchannelLogoutConstants.TOKEN_PARAM
    ];

    if (typeof logoutToken !== 'string' || logoutToken.length === 0) {
      res.status(400).end();
      return;
    }

    try {
      const result: BackchannelLogoutResult = await client.handleBackchannelLogout(logoutToken);

      try {
        await client.expressConfig?.onBackchannelLogout?.(result);
      } catch {
        // The sessions are already ended, and a retry would find nothing, so this is not a 500.
        Logger.error('The onBackchannelLogout hook failed.');
      }
      res.status(200).end();
    } catch (e: unknown) {
      if (e instanceof InvalidLogoutTokenError) {
        // The code says which check failed. The token itself is never logged.
        Logger.warn(`Rejected a back-channel logout token (${e.code}).`);
        res.status(400).end();
        return;
      }

      Logger.error('Could not complete a back-channel logout.');
      res.status(500).end();
    }
  };

  return (req: express.Request, res: express.Response): void => {
    res.set('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      res.set('Allow', 'POST').status(405).end();
      return;
    }
    if (!req.is('application/x-www-form-urlencoded')) {
      res.status(400).end();
      return;
    }

    parseForm(req, res, (parseError?: unknown): void => {
      if (parseError) {
        res.status(400).end();
        return;
      }

      handle(req, res).catch((): void => {
        res.status(500).end();
      });
    });
  };
};

export default handleBackchannelLogout;
