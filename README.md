# DateVault Creator Market

Separate application for `market.elysiandate.site`.

## Current status

The `main` branch is a static landing page. The `feat/secure-market-sso-foundation` branch adds server-side SSO redemption and a separate Market session foundation. It is not active until the matching DateVault authorization-code issuer is implemented, the environment variables below are configured, and the preview is tested.

## Netlify configuration

- Build command: leave blank
- Publish directory: `.` (a single dot)
- Functions directory: `netlify/functions`
- Node.js: 20

## Required environment variables (new Creator Market Netlify project only)

Set these for the deploy contexts you intend to test:

- `FIREBASE_SERVICE_ACCOUNT`: the JSON service-account credential for the existing DateVault Firebase project. Store the full JSON as a secret environment variable; never commit it or put it in browser code.
- `MARKET_SESSION_SECRET`: a newly generated random secret of at least 32 characters. Do not reuse a Firebase key, API key, password, or DateVault session secret.
- `MARKET_ORIGIN`: `https://market.elysiandate.site` for the custom-domain deployment. Use the exact preview origin separately when testing a Netlify deploy preview.

Do not copy all DateVault environment variables. Do not add payment, SMS, email, or other secrets until a specific Market feature needs them.

## SSO protocol contract

DateVault must issue a cryptographically random, single-use code after verifying the caller's Firebase ID token and account status. It stores only the SHA-256 hash in Firestore:

Collection: `creatorMarketSsoCodes`

Document ID: lowercase hex SHA-256 of the random code.

Fields:
- `uid`: authenticated DateVault Firebase UID
- `audience`: exactly `market.elysiandate.site`
- `expiresAt`: Firestore Timestamp, no more than 2 minutes after issue
- `consumedAt`: absent until Market redeems the code

The browser receives the raw code only for the one-time redirect to the Market callback. Market posts it to `/.netlify/functions/market-sso-redeem` (or `/api/market-sso-redeem`), which atomically marks the code consumed, checks account standing, and sets an HttpOnly, Secure, SameSite=Lax Market-only cookie. The code must never be a Firebase ID token or refresh token.

The Market session is a signed 12-hour cookie. `GET /api/market-session` checks the signature and current account standing. `POST /api/market-logout` clears it. The cookie is host-only; it is not shared with the DateVault app.

## Security notes

- This branch does not add a login UI or the DateVault code issuer yet.
- No Market session is usable until the matching issuer writes the specified Firestore document.
- The Firebase service account is server-side only. Never expose it in client environment variables.
- The Market session secret is separate and must be kept private.
- Direct visits, account switching, logout, bans, replay, expiry, and preview-origin behavior must be tested before enabling navigation from DateVault.
- Do not merge or deploy to production without explicit owner approval.
