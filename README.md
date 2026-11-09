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

## Implemented in this branch
- DateVault one-time SSO issuer and Market one-time redemption / separate HttpOnly Market session.
- Session validation and logout.
- Searchable approved creator directory and creator profile route.
- Creator application form, one application per DateVault UID, server-side username validation.
- Admin application queue and approve/reject action. Approval transactionally reserves a case-insensitive handle and creates the public creator record.
- Market APIs fail closed unless the shared DateVault user document has `marketAgeVerified: true` and the account is in good standing.
- Admin review page requires a Market session and shared user role `role: "admin"` or `isAdmin: true`.

## Firestore collections
- `creatorMarketSsoCodes/{sha256}`: one-time SSO code hashes.
- `marketCreatorApplications/{uid}`: creator application and review status.
- `marketCreators/{uid}`: approved public creator profile.
- `marketCreatorHandles/{usernameLower}`: unique username reservation.
- `users/{uid}`: shared account status and server-managed `marketAgeVerified` flag.

## Age verification gate
The code deliberately does not treat a self-entered date of birth or an uploaded ID as verified. A trusted 18+ verification process must set `users/{uid}.marketAgeVerified = true` server-side after review/provider confirmation. Until then, creator search, profile and application APIs return an age-verification requirement. Never set this field from browser code.

## Not yet enabled
Private media uploads/streaming, creator catalogue management, timed viewing, day/week/month rentals, permanent purchases, payment/token deduction, 15%/85% settlement ledger, creator withdrawals, report/block tools, creator identity verification, and full moderation/audit history. These need a secure private-storage integration, confirmed payment/token interface, and admin review workflow. Do not accept real payments or private uploads until those controls are implemented and tested.

## Business rules
- Market access is independent of Trial/Standard/Elite/Vault and dating membership expiry.
- Adult content viewing requires independent 18+ verification.
- Creator publishing and payouts require a separate creator application and admin approval.
- Platform fee 15%; creator share 85%; minimum creator withdrawal 3,000 creator-earning tokens.
- Timed viewing and rentals are separate offer types with server-calculated expiry.
- Download permission defaults off; private originals are never public.
- Screenshots and screen recording cannot be fully prevented once content is displayed.
- No production DateVault changes, payment activation or deployment cutover without explicit approval.
