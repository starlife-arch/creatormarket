# Private creator media setup

## Required Netlify variable
Add this server-side environment variable to the Creator Market Netlify project:

`MARKET_STORAGE_BUCKET=date-ce760.firebasestorage.app`

This is the Storage bucket configured by the existing DateVault Firebase client configuration. The Market functions use the Firebase Admin service account to create short-lived signed upload and read URLs. Do not expose this value as a browser variable; it is server configuration.

If you later create a dedicated bucket for Market, replace the value with that bucket's exact name and ensure the service account has object create/read/delete permissions on it.

## Bucket security
- Keep the bucket private; do not grant `allUsers` or `allAuthenticatedUsers` object access.
- Enable uniform bucket-level access and public access prevention.
- Do not create public download tokens or store public Firebase download URLs in listing documents.
- The application stores object names under `creator-market/{creatorUid}/{listingId}/{randomId}`.
- Upload URLs are write-only, content-type-bound and valid for five minutes. Upload completion checks the actual object metadata and expected size before publishing.
- Viewing URLs are read-only, entitlement-checked and valid for 60 seconds. The response is inline unless the creator enabled downloads for that listing and the entitlement was created with downloads enabled.

## CORS
The browser uploads directly to the signed Google Cloud Storage URL. Configure the bucket CORS to allow only the Market origin and the required PUT request headers. Example CORS policy:

```json
[
  {
    "origin": ["https://market.elysiandate.site"],
    "method": ["PUT", "GET", "HEAD"],
    "responseHeader": ["Content-Type", "ETag"],
    "maxAgeSeconds": 1800
  }
]
```

Apply this policy to the exact bucket from the Netlify environment variable using the Google Cloud Storage bucket CORS configuration workflow. Do not make the bucket public.

## Delivery limitations
A signed read URL is a temporary bearer URL: it is checked against the user's Market session and entitlement when issued, but it can be reused until it expires. Inline delivery and hiding download controls are deterrents, not absolute download prevention. Once content is displayed, screenshots, screen recording and external capture cannot be fully prevented. A strict per-range-request authorization proxy would be a separate delivery service and is not included in this Netlify function implementation.
