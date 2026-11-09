# DateVault Creator Market

Independent application for `https://market.elysiandate.site`. Keep it separate from DateVault's dating routes and membership guards.

## Deployment
- Netlify project: separate from DateVault
- Build command: none
- Publish directory: `.`
- Functions directory: `netlify/functions`
- Node: 20

## Server-only environment
- `FIREBASE_SERVICE_ACCOUNT`: Firebase Admin service account JSON for the shared DateVault Firebase project.
- `MARKET_SESSION_SECRET`: unique random secret, minimum 32 characters.
- `MARKET_ORIGIN`: exact Market origin, normally `https://market.elysiandate.site`.

Never put service credentials or session secrets in browser code.

## Implemented foundation
- DateVault one-time SSO issuer and Market one-time redemption / separate HttpOnly Market session.
- Session validation and logout.
- Creator discovery API reads only approved documents from `marketCreators`.
- Creator application API writes one application per DateVault UID to `marketCreatorApplications`.
- Creator Studio application form and searchable creator directory.
- Market APIs fail closed unless the shared DateVault user document has `marketAgeVerified: true` and the account is in good standing.
- Username format: 3–30 lowercase letters, numbers and underscores; reserved system handles are rejected at application time. Public handles are not reserved until approval.

## Firestore collections
- `creatorMarketSsoCodes/{sha256}`: one-time SSO code hashes.
- `marketCreatorApplications/{uid}`: creator application and review status.
- `marketCreators/{uid}`: public approved creator profile; username uniqueness must be enforced by the approval workflow before publishing.
- `users/{uid}`: shared account status and the server-managed `marketAgeVerified` flag.

## Important security boundary
The current code deliberately does not claim that an uploaded ID or a self-entered date of birth is verified. A trusted 18+ verification process must set `users/{uid}.marketAgeVerified = true` server-side after review/provider confirmation. Until then, creator search and application APIs return an age-verification requirement. Do not set this field from a browser client.

## Not yet enabled
Private media uploads/streaming, creator catalogue management, timed viewing, day/week/month rentals, permanent purchases, payment/token deduction, 15%/85% settlement ledger, creator withdrawals, report/block tools and admin moderation. These need a secure private-storage integration, confirmed payment/token interface, and admin review workflow. Do not accept real payments or private uploads until those controls are implemented and tested.

## Business rules to preserve
- Market access is independent of Trial/Standard/Elite/Vault and dating membership expiry.
- Adult content viewing requires independent 18+ verification.
- Creator publishing and payouts require a separate creator application and admin approval.
- Platform fee 15%; creator share 85%; minimum creator withdrawal 3,000 creator-earning tokens.
- Timed viewing and rentals are separate offer types with server-calculated expiry.
- Download permission defaults off; private originals are never public.
- Screenshots and screen recording cannot be fully prevented once content is displayed.
- No production DateVault changes, payment activation or deployment cutover without explicit approval.
