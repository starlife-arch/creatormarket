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
- `CLOUDINARY_URL`: dedicated Creator Market Cloudinary account URL (server-only).
- `MARKET_CLOUDINARY_UPLOAD_PRESET`: name of the signed, authenticated-delivery upload preset.\n- `DIDIT_API_KEY`: server-only Didit API key for the same Sandbox or Live application selected below.\n- `DIDIT_WORKFLOW_ID`: published Didit age-verification workflow ID.\n- `DIDIT_WEBHOOK_SECRET`: signing secret for the dedicated Didit webhook destination (not an API key).\n- `DIDIT_ENVIRONMENT`: exactly `sandbox` or `live`; webhook events from the other environment are rejected.\n- `DIDIT_APPLICATION_ID`: optional Didit application UUID to pin webhook events to one application.

Never put service credentials or session secrets in browser code.

## Implemented in this branch
- DateVault one-time SSO issuer and Market one-time redemption / separate HttpOnly Market session.
- Session validation and logout.
- Searchable approved creator directory and creator profile route.
- Creator application form, one application per DateVault UID, server-side username validation and admin approval.
- Unique case-insensitive username reservation on approval.
- Creator listing drafts with hourly timed viewing, day/week/month rental, and permanent access offers.
- Signed Cloudinary private-media upload, upload metadata validation, and entitlement-checked 60-second viewing URLs.
- Member-facing Didit hosted age-verification sessions plus manual 18+ evidence submission as a fallback. Didit webhooks use full-payload `X-Signature-V2` HMAC verification, a five-minute timestamp window, workflow/environment/application matching, session-to-member binding, event idempotency and out-of-order event protection. Manual evidence continues to use private Cloudinary uploads, administrator review, audit records, and scheduled cleanup.
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
- `marketAgeVerificationRequests/{uid}`: age-review status and private evidence references (evidence expires after seven days).
- `marketAgeVerificationUploads/{uploadId}`: short-lived signed upload intents for private age evidence.
- `users/{uid}`: shared account standing and server-managed verification flags.

## Age and creator identity verification
Market APIs deliberately fail closed unless the shared user document has:
- `marketAgeVerified: true` — trusted 18+ verification completed.
- `marketCreatorIdentityVerified: true` — creator identity verification completed.

These values must only be set by a trusted verification provider result or authorized server-side admin review. Never let a browser client set either field. A self-entered birth date is not sufficient. Members can use the Didit hosted verification flow or submit a government identity document image and recent selfie through `/verify-age.html` for manual fallback. Configure a Didit webhook destination with webhook version `v3`, subscribe to `status.updated`, and set its public HTTPS URL to `https://market.elysiandate.site/api/market-didit-webhook` only after the corresponding deployment is approved. The webhook signing secret must be stored as `DIDIT_WEBHOOK_SECRET`; it is different from the API key. Use the same Sandbox or Live application for the API key, workflow and webhook destination. Sandbox deliveries must use `DIDIT_ENVIRONMENT=sandbox`; Live deliveries require `DIDIT_ENVIRONMENT=live`. Didit sessions are bound to the authenticated Market UID through `vendor_data` and a server-side session mapping. Only the exact `Approved` status grants age access; later non-approved status changes revoke it. Didit sends only decision metadata to Market; identity documents remain in Didit's hosted flow. Manual fallback files use private Cloudinary uploads, administrator review, audit records, and scheduled cleanup. Manual review does not provide automated document authenticity or liveness checks and must not be represented as a universal legal-compliance guarantee. Creator identity approval remains a separate admin-reviewed process.

## Private media
Creator media uses a dedicated Cloudinary account with authenticated delivery. Upload authorization is signed by the Market backend; media access checks the Market session, 18+ verification, creator/listing state, purchase or rental entitlement, expiry, and download permission before issuing a short-lived private URL. Configure the dedicated signed upload preset before enabling creator uploads.

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
