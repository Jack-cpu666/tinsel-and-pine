# Tinsel & Pine

A Christmas store with a catalogue of 15 products, a cart, Stripe Checkout, order tracking and a full admin panel. It runs on Node.js with PostgreSQL.

## Features

**Storefront**
- Home, collections, search, product pages with variants and galleries, a cart drawer and a cart page.
- Stripe Checkout with US-only addresses, free shipping, and Apple Pay or Google Pay.
- Order confirmation page, order tracking (order number plus email) and a contact form.
- Shipping, returns, FAQ, privacy and terms pages.
- SEO: canonical URLs, Open Graph tags, JSON-LD, `sitemap.xml` and `robots.txt`.
- Optional Meta Pixel, which sends the PageView, AddToCart, InitiateCheckout and Purchase events.

**Admin (`/admin`)**
- Dashboard with visitors, traffic sources, ad campaigns (UTM), the cart and checkout funnel, revenue and estimated profit.
- Orders: fulfilment status, supplier links, copyable ship-to address, tracking numbers and CSV export.
- Products: create and edit products, edit variants and prices, reprice in bulk with "× cost", and upload images or import them from an AliExpress URL.
- Messages, newsletter subscribers, store settings and Stripe connection.
- Security: password change, TOTP two-factor authentication, session management and an audit log.

**Security**
- Strict Content-Security-Policy with per-request nonces, plus HSTS, frame-ancestors none, nosniff and a Permissions-Policy.
- Admin passwords hashed with bcrypt (cost 12). The account locks after 5 failed logins, and login is rate-limited.
- Session tokens are stored only as SHA-256 hashes. Cookies are `__Host-`, HttpOnly, Secure and SameSite=Strict, and sessions expire after 12 hours.
- CSRF tokens on every admin form, plus an Origin/Sec-Fetch-Site check.
- All SQL is parameterised, input is validated with zod, and HTML output is auto-escaped.
- Prices are always recomputed on the server. Orders are confirmed by verifying the Stripe Checkout Session, either by webhook or by polling.
- The Stripe key is encrypted at rest with AES-256-GCM.
- Image imports only accept allowlisted hosts, which prevents SSRF. Uploads are re-encoded with sharp.
- The first admin can only be created with a one-time setup link printed in the server log.

## Running locally

```
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/shop npm run dev
npm test   # needs TEST_DATABASE_URL
```

## Deploying

`render.yaml` creates the web service and the Postgres database on Render. After the first deploy:
1. Open the setup link from the Render logs (`ADMIN SETUP: ...`) and create the owner login.
2. Go to Admin → Settings and paste a Stripe secret key or restricted key. Checkout turns on immediately.
3. Optionally, add the Stripe webhook (the URL is shown in Settings) and a Meta Pixel ID.

Supplier images are downloaded automatically in the background on first boot.
