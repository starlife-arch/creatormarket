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
- `MARKET_STORAGE_BUCKET`: private Firebase Storage / Google Cloud Storage bucket name. The existing DateVault config currently names `date-ce760.firebasestorage.app`; verify that bucket exists and is private before setting this value.

Never put service credentials or session secrets in browser code.

## Implemented in this branch
- DateVault one-time SSO issuer and Market one-time redemption / separate HttpOnly Market session.
- Session validation and logout.
- Searchable approved creator directory and creator profile route.
- Creator application form, one application per DateVault UID, server-side username validation and admin approval.
- Unique case-insensitive username reservation on approval.
- Creator listing drafts with hourly timed viewing, day/week/month rental, and permanent access offers.
- Signed private media upload, upload metadata validation, and entitlement-checked 60-second viewing URLs; see `docs/PRIVATE_MEDIA_SETUP.md` for bucket/CORS configuration.
- Idempotent token purchase service with server-calculated expiry, wallet debit, buyer entitlement, 15% platform / 85% creator ledger split.
- Creator balance, earnings history and withdrawal requests (minimum 3,000 creator-earning tokens).
- Admin review for creator applications and withdrawals.
- Member block list and creator/listing report submission.
- Admin report queue with listing takedown and creator suspension actions plus immutable audit entries.
- Firestore index definitions in `firestore.indexes.json`; merge these with existing DateVault indexes, do not replace them.

## Firestore collections
- `creatorMarketSsoCodes/{sha256}`: one-time SSO code hashes.
- `marketCreatorApplications/{uid}`: creator application and review status.
- `marketCreators/{uid}`: approved public creator profile.
- `marketCreatorHandles/{usernameLower}`: unique username reservation.
- `marketListings/{listingId}`: creator listing metadata and offers.
- `marketPurchases/{purchaseId}`: idempotent completed token purchases.
- `marketEntitlements/{purchaseId}`: buyer's timed/rental/permanent access.
- `marketCreatorBalances/{uid}`: separate creator earnings balance.
- `marketCreatorLedger/{uid}/entries/{entryId}`: creator earnings and withdrawal ledger.
- `marketPlatformLedger/{purchaseId}`: platform commission ledger.
- `marketCreatorWithdrawals/{withdrawalId}`: payout requests and admin status.
- `marketBlocks/{uid}/blocked/{targetUid}`: member-specific creator blocks.
- `marketReports/{reportId}`: reports awaiting moderation.
- `marketAdminAudit/{auditId}`: admin moderation and payout audit events.
- `users/{uid}`: shared account standing and server-managed verification flags.

## Age and creator identity verification
Market APIs deliberately fail closed unless the shared user document has:
- `marketAgeVerified: true` — trusted 18+ verification completed.
- `marketCreatorIdentityVerified: true` — creator identity verification completed.

These values must only be set by a trusted verification provider callback or authorized server-side verification workflow. Never let a browser client set either field. A self-entered birth date is not sufficient. A controlled manual admin verification screen is included in this branch; see `docs/MANUAL_VERIFICATION.md`. No external verification provider is connected.

## Private media is the remaining release blocker
Creator listings are currently saved as drafts. They cannot be published or purchased because no private media upload/streaming route is enabled yet. Do not expose public storage URLs or allow a listing to become purchasable without a private media object and entitlement-checked delivery. The next media phase needs a dedicated private object-storage bucket, signed upload, metadata validation, short-lived authenticated viewing, and owner-controlled downloads.

## Payment and withdrawal boundaries
Buyer purchases in this phase debit the existing DateVault `users/{uid}.walletBalance` inside a Firestore transaction. Creator earnings are recorded separately and never added to the buyer wallet. Withdrawals reserve creator earnings and require admin review; the admin must mark a withdrawal paid only after sending the payout. No automated payout provider is connected.

## Business rules
- Market access is independent of Trial/Standard/Elite/Vault and dating membership expiry.
- Adult content viewing requires independent 18+ verification.
- Creator publishing and payouts require separate creator identity verification and admin approval.
- Platform fee 15%; creator share 85%; minimum creator withdrawal 3,000 creator-earning tokens.
- Timed viewing and rentals are separate offer types with server-calculated expiry. Month rentals clamp to the final valid calendar day.
- Download permission defaults off.
- Screenshots and screen recording cannot be fully prevented once content is displayed.
- No production DateVault changes, payment activation or deployment cutover without explicit approval.
