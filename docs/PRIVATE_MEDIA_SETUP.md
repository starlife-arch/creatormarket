# Private Creator Market media (Cloudinary)

Creator Market uses the existing DateVault Cloudinary product environment, but all Market assets are stored under the separate `creator-market/` public-ID prefix and uploaded with the `authenticated` delivery type. DateVault's existing media and upload flows are not changed.

## Required Creator Market Netlify environment variables

Set these as server-side variables in the separate Creator Market Netlify project (Production and the appropriate Deploy Preview context):

- `CLOUDINARY_URL`: the Cloudinary API environment URL copied from the Cloudinary Console. It contains the cloud name, API key and API secret. Treat it as a secret; never add it to browser variables, source code, commits or chat.
- `MARKET_CLOUDINARY_UPLOAD_PRESET`: the name of the dedicated **signed** Creator Market upload preset described below.

Do not configure `MARKET_STORAGE_BUCKET`; Google Cloud Storage is not used by this implementation.

## Create a dedicated signed upload preset

In Cloudinary Console, open Settings → Upload → Upload presets and create a new preset for Creator Market. Configure it as follows (labels may vary by console version):

- Preset name: a unique name such as `creator_market_private`.
- Signing mode: **Signed** (not unsigned).
- Delivery type: **Authenticated**.
- Allowed formats: `jpg,jpeg,png,webp,mp4,webm`.
- Maximum file size: `524288000` bytes (500 MB). If the account's plan imposes a lower limit, use the lower limit and align the application limits.
- Disallow overwriting existing assets.
- Do not enable public delivery or create an unsigned upload preset for this workflow.

The server signs the preset name, unique public ID, timestamp and authenticated delivery type. Cloudinary returns the API key and signature to the browser; the API secret remains server-side. Image uploads are limited by the application to 30 MB and videos to 500 MB, and the server checks the actual uploaded resource metadata before publishing it.

## Private media access

- The server checks the Market session, creator approval, listing status, and buyer entitlement (including rental expiry) before generating a time-limited URL.
- Assets use Cloudinary's `authenticated` delivery type, protecting both originals and derived versions from unsigned public delivery.
- Access URLs are signed and expire after 60 seconds. The download option is only enabled when both the listing and the buyer's entitlement permit downloads.
- Cloudinary's `private_download_url` delivers through its authenticated download API and is not CDN-cached; this is an intentional security/performance trade-off for paid content.
- A URL already issued remains usable until its 60-second expiry. No browser-based system can fully prevent screenshots or screen recording after content is displayed.

## Operational notes

- Use the same Cloudinary product environment as DateVault, but do not change DateVault's existing upload presets or media configuration.
- The Creator Market folder prefix is `creator-market/{creatorUid}/{listingId}/{uploadId}`.
- Monitor Cloudinary storage and bandwidth usage. Cloudinary upload signatures have provider-defined validity; the Market's own upload intent expires after five minutes and can only be completed once. Expired or abandoned uploads should be included in periodic cleanup.
- Never make authenticated media public to solve a delivery issue. Check the asset type, signature, preset, and Cloudinary response instead.
