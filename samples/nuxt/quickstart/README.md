# ThunderID Nuxt Quickstart

<a href="https://stackblitz.com/fork/github/thunder-id/javascript-sdks/tree/main/samples/nuxt/quickstart?file=.env" target="_blank"><img src="https://developer.stackblitz.com/img/open_in_stackblitz.svg" alt="Open in StackBlitz" /></a>

A minimal Nuxt 3 application demonstrating ThunderID authentication with OAuth 2.0, PKCE, and JWT out of the box.

## Prerequisites

- Node.js 18+
- pnpm
- A ThunderID application

## Getting started

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Fill in your ThunderID credentials in `.env`. By default the file is set up for the native flow:

   ```dotenv
   NUXT_PUBLIC_THUNDERID_BASE_URL=https://localhost:8090
   NUXT_PUBLIC_THUNDERID_APPLICATION_ID=<your-application-id>
   NUXT_PUBLIC_THUNDERID_SIGN_IN_URL=/signin
   NUXT_PUBLIC_THUNDERID_SIGN_UP_URL=/signup
   THUNDERID_FLOW_SECRET=<your-flow-secret>
   THUNDERID_SESSION_SECRET=<run: openssl rand -base64 32>
   ```

3. Start the development server:

   ```bash
   pnpm dev
   ```

   The app is now running at [http://localhost:3000](http://localhost:3000).

<details>
<summary><h2>Redirect-based flow</h2></summary>

By default this quickstart uses the native (embedded) flow, where sign-in/sign-up render inline on this
app's own `/signin` and `/signup` routes with no redirect to ThunderID's hosted pages.

To send the user to ThunderID's hosted sign-in page instead, switch to the redirect-based flow:

1. Register a redirect URI for your application (see the app's config notice in the console for the
   exact value to use).
2. Regenerate `.env` for the redirect flow:

   ```bash
   npm run prepare-dev:redirect
   ```

   This comments out the native-flow vars (`NUXT_PUBLIC_THUNDERID_APPLICATION_ID`,
   `NUXT_PUBLIC_THUNDERID_SIGN_IN_URL`, `NUXT_PUBLIC_THUNDERID_SIGN_UP_URL`) and adds:

   ```dotenv
   NUXT_PUBLIC_THUNDERID_CLIENT_ID=<your-client-id>
   THUNDERID_CLIENT_SECRET=<your-client-secret>
   ```

   Both values come from the application's Credentials tab in the console. The redirect-based flow
   doesn't use `THUNDERID_FLOW_SECRET` (that's only sent when the native flow starts), so it can stay
   set in `.env` from step 2 above, unused. To switch back to the native flow, run
   `node scripts/prepare-dev.cjs --flow=native` (or manually re-enable the native-flow vars and comment
   out the two above).
3. Fill in `NUXT_PUBLIC_THUNDERID_CLIENT_ID` and `THUNDERID_CLIENT_SECRET` in `.env`, then restart the
   dev server.

</details>

## Back-channel logout

ThunderID can end this app's session itself. When the user's ThunderID session ends somewhere else,
for example by signing out of another application, ThunderID posts a logout token to this app. The
module serves the route once it is turned on in `nuxt.config.ts`:

```ts
thunderid: {
  backchannelLogout: { enabled: true },
},
```

The session lives in a cookie that only the browser can delete, so the SDK records the logout and
treats every later request with that session as signed out.

To try it, use the redirect-based flow above, since the logout token is addressed to the client ID:

1. In the ThunderID Console, open this application, go to **Advanced Settings → OAuth2
   Configuration**, and set **Back-Channel Logout URI** to
   `http://localhost:3000/api/auth/backchannel-logout`.
2. ThunderID refuses localhost and private network addresses by default. For local testing only,
   turn that off in the server's `deployment.yaml` and restart it:
   ```yaml
   oauth:
     logout:
       backchannel:
         reject_private_addresses: false
   ```
3. Sign in at [http://localhost:3000](http://localhost:3000), then sign in to a second application
   in the same browser, so both share one ThunderID session.
4. Sign out of the second application, then reload this app: you are signed out here too.

Things to know before production:

- The SDK records ended sessions in memory by default. If you run more than one instance, name a
  [Nitro storage](https://nitro.build/guide/storage) mount point that all of them share, since
  ThunderID's request reaches only one instance:
  ```ts
  thunderid: {
    backchannelLogout: { enabled: true, store: 'redis' },
  },
  nitro: {
    storage: { redis: { driver: 'redis', url: process.env.REDIS_URL } },
  },
  ```
- An access token already handed to the browser or to another API stays valid until it expires.
