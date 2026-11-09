# DateVault Creator Market

Separate web application for the Creator Market at `market.elysiandate.site`.

## Current status

This repository starts with a deployable static landing page only. It is a foundation for the separate Netlify project, **not a completed marketplace**.

Not implemented yet:
- Secure sign-in / single-use SSO handoff from DateVault
- Creator applications, identity checks and admin approval
- Creator profiles and username search
- Private media storage, previews and access enforcement
- Timed viewing, rentals and permanent purchases
- Checkout, creator earnings ledger and withdrawals
- Age verification and adult-content access controls
- Moderation, reporting and audit history

Do not collect payment details, identity documents or private uploads on the static starter page.

## Netlify

- Build command: leave blank
- Publish directory: `.`
- No environment variables are required for this static starter.

Connect this repository to a **new** Netlify site. Keep the existing DateVault Netlify site unchanged.

## Domain

The intended custom domain is `market.elysiandate.site`. Add it to the new Netlify site first, then create only the DNS record Netlify instructs you to add in Cloudflare. Do not change the apex domain or existing DateVault records.
