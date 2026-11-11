# api.video private playback gateway

This integration keeps api.video private video credentials out of the browser and checks the rental expiry at the delivery edge.

## Netlify environment variables

Set these in the **Creator Market Netlify project**:

- `API_VIDEO_API_KEY` — production api.video API key (server-side only).
- `MARKET_VIDEO_GATEWAY_URL` — `https://market.elysiandate.site`.
- `MARKET_VIDEO_GATEWAY_SECRET` — a new random secret of at least 32 characters. Use the exact same value as the Cloudflare Worker secret.

Never place the api.video API key or gateway secret in browser-visible variables.

## Cloudflare Worker

The Worker source is `cloudflare/market-video-gateway/src/index.js`.

1. Create a Worker and deploy this source.
2. Add the secret `MARKET_VIDEO_GATEWAY_SECRET` with the same value configured in Netlify.
3. Add Worker routes for `market.elysiandate.site/video-gateway*` and `market.elysiandate.site/video-upload*`.
4. Ensure the Market hostname is proxied through Cloudflare for the route to execute. If the DNS record remains DNS-only, the Worker route will not intercept requests.
5. Keep the Worker route fail-closed; do not bypass it to the api.video origin.

Also add the Worker secret `API_VIDEO_API_KEY` with the production api.video key. The Netlify function and Worker both need the production key, but it must remain server-side in each environment. The Worker accepts encrypted tickets issued by Netlify for both private uploads and playback. It only proxies paths for the video ID and private token inside that ticket, rewrites HLS playlist URIs back through the gateway, and rejects every new request after the ticket's exact millisecond expiry.

## Current integration boundary

The playback function is `netlify/functions/market-video-playback.js`. It supports listings whose Firestore fields include:

- `mediaProvider: "api_video"`
- `videoId: "<api.video video id>"`

It checks the signed-in, age-verified Market account, creator approval, and active purchase entitlement before issuing a playback ticket. For rental offers, ticket expiry is the entitlement's `expiresAt`. Permanent access is issued a renewable 23-hour provider session because api.video private sessions themselves last 24 hours.

The private video upload path now creates an api.video video object with `public: false`, then uploads through the Worker in 50 MiB chunks (small files use one request). The Studio upload UI calls the new upload and completion functions. The Worker upload proxy caps each request below Cloudflare's 100 MB Free/Pro request-body limit; the full file may be up to 500 MB because it is chunked. Until the Worker is deployed and the required secrets/routes are configured, this integration is **not production-active**. Existing image uploads continue through the existing Cloudinary path. Cloudinary is no longer accepted for new video uploads. Older Cloudinary video listings are hidden from buyer discovery and purchase until the creator re-uploads them through the new api.video flow; this avoids selling legacy video links that cannot enforce rental expiry on each HLS segment.

## Important playback limitation

The gateway rejects HLS manifest, playlist, key, and segment requests once the rental expires. The player must also stop at the expiry timestamp. Bytes already delivered to the browser or already buffered cannot be recalled, so no web video system can guarantee that an already-buffered frame disappears at the exact same instant. Short HLS segments and a client-side expiry stop minimize that unavoidable gap.

## Upload size note

Do not route large creator uploads through a Cloudflare Worker without checking the zone upload limit. Current Cloudflare request-body limits are 100 MB on Free/Pro, 200 MB on Business, and up to 5 GB on Enterprise. Large files need chunked/progressive uploads or a different direct-upload path.
