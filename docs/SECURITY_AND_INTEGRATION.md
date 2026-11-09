# Market security and integration checklist

## Age and creator identity verification
Market server endpoints intentionally require the shared user document to contain server-managed booleans:
- `marketAgeVerified: true` — trusted 18+ verification has been completed.
- `marketCreatorIdentityVerified: true` — creator identity verification has been completed.

These values must only be set by a trusted verification provider callback or an authorized server-side admin workflow. Never let a browser client set either field. A self-entered birth date is not sufficient. Until an actual verification provider/workflow is connected, Market creator discovery and applications remain closed to unverified accounts, and creator approval fails closed.

## Firestore
The Market backend uses Firebase Admin SDK, so all writes bypass Firestore client rules. Do not expose these collections for direct client writes:
- `creatorMarketSsoCodes`
- `marketCreatorApplications`
- `marketCreators`
- `marketCreatorHandles`

Only server endpoints should read or write these collections. The separate index definitions are in `firestore.indexes.json`; merge them carefully into the shared Firebase project's existing index configuration rather than overwriting DateVault indexes.

## Creator approval
An administrator must verify the applicant's age and identity independently before approving. Approval transactionally reserves the lowercase username and creates the public creator profile. Creator verification badge remains false by default and must not be granted just because an application was approved.

## Not enabled
Do not accept content uploads, real payments, rentals, or creator withdrawals until private object storage, media entitlement checks, payment idempotency, ledger reconciliation, and admin audit workflows have been implemented and tested.
