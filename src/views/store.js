'use strict';
const { html, raw, jsonScript, money } = require('./html');

const img = (id, size = 'full') => (id ? `/img/${id}/${size}.webp` : '/static/img/placeholder.svg');

function priceRange(p) {
  if (p.min_price === p.max_price) return money(p.min_price);
  return `From ${money(p.min_price)}`;
}

function layout({ title, description, body, s, nonce, canonical, ogImage, cartCount = true, bodyClass = '', jsonLd = null, noindex = false }) {
  const storeName = s.store_name;
  const fullTitle = title ? `${title} | ${storeName}` : `${storeName} — Christmas lights, decor & gifts`;
  const pixel = /^\d{6,20}$/.test(s.meta_pixel_id || '') ? s.meta_pixel_id : '';
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${description || s.hero_subtitle}">
${noindex ? raw('<meta name="robots" content="noindex">') : ''}
${canonical ? html`<link rel="canonical" href="${canonical}">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${storeName}">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${description || s.hero_subtitle}">
${ogImage ? html`<meta property="og:image" content="${ogImage}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0f3d2e">
<link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/static/css/store.css?v=${raw(ASSET_V)}">
${jsonLd ? html`<script type="application/ld+json" nonce="${nonce}">${jsonScript(jsonLd)}</script>` : ''}
${pixel ? html`<script nonce="${nonce}" data-pixel="${pixel}" src="/static/js/pixel.js?v=${raw(ASSET_V)}" defer></script>` : ''}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
${s.announcement ? html`<div class="announce">${s.announcement}</div>` : ''}
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="/" aria-label="${storeName} home">
      <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2l3 6h-2l4 7h-2.5l5 8H7.5l5-8H10l4-7h-2z" fill="currentColor"/><rect x="14" y="23" width="4" height="6" rx="1" fill="currentColor"/></svg>
      <span>${storeName}</span>
    </a>
    <nav class="main-nav" aria-label="Main">
      <a href="/shop">Shop all</a>
      <a href="/shop/lights">Lights</a>
      <a href="/shop/decor">Decor</a>
      <a href="/shop/gifts">Gifts</a>
      <a href="/shop/apparel">Apparel</a>
    </nav>
    <div class="header-actions">
      <a class="icon-btn" href="/track" aria-label="Track order" title="Track order">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="7" cy="17.5" r="1.8" fill="currentColor"/><circle cx="17.5" cy="17.5" r="1.8" fill="currentColor"/></svg>
      </a>
      ${cartCount ? html`<button class="icon-btn cart-btn" type="button" data-open-cart aria-label="Open cart">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 9V6a3 3 0 0 1 6 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
        <span class="cart-count" data-cart-count hidden>0</span>
      </button>` : ''}
    </div>
  </div>
</header>
<main id="main">${body}</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <div class="brand footer-brand"><span>${storeName}</span></div>
      <p class="muted">Festive lights, cozy decor and thoughtful gifts — shipped free to anywhere in the US.</p>
      <form class="newsletter" method="post" action="/subscribe" data-newsletter>
        <label for="nl-email">Get early access to deals</label>
        <div class="nl-row"><input id="nl-email" name="email" type="email" required maxlength="200" placeholder="you@email.com" autocomplete="email"><button class="btn btn-sm" type="submit">Join</button></div>
        <p class="nl-msg" data-nl-msg role="status"></p>
      </form>
    </div>
    <div>
      <h4>Shop</h4>
      <a href="/shop">All products</a><a href="/shop/lights">Christmas lights</a><a href="/shop/decor">Decor</a><a href="/shop/gifts">Gifts</a><a href="/shop/apparel">Apparel</a><a href="/shop/pets">Pets</a>
    </div>
    <div>
      <h4>Help</h4>
      <a href="/track">Track your order</a><a href="/shipping">Shipping</a><a href="/returns">Returns &amp; refunds</a><a href="/faq">FAQ</a><a href="/contact">Contact us</a>
    </div>
    <div>
      <h4>Legal</h4>
      <a href="/privacy">Privacy policy</a><a href="/terms">Terms of service</a>
      <p class="pay-note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10V8a6 6 0 0 1 12 0v2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="4" y="10" width="16" height="11" rx="2" fill="currentColor"/></svg> Secure checkout by Stripe</p>
    </div>
  </div>
  <div class="wrap footer-base">© ${new Date().getFullYear()} ${storeName}. All rights reserved.</div>
</footer>
<div class="drawer-backdrop" data-cart-backdrop hidden></div>
<aside class="cart-drawer" data-cart-drawer aria-label="Shopping cart" aria-hidden="true" tabindex="-1">
  <div class="drawer-head"><h2>Your cart</h2><button class="icon-btn" type="button" data-close-cart aria-label="Close cart">✕</button></div>
  <div class="drawer-body" data-cart-lines></div>
  <div class="drawer-foot" data-cart-foot></div>
</aside>
<div class="toast" data-toast role="status" aria-live="polite" hidden></div>
<script nonce="${nonce}" src="/static/js/store.js?v=${raw(ASSET_V)}" defer></script>
</body>
</html>`;
}

let ASSET_V = '1';
function setAssetVersion(v) { ASSET_V = v; }

function productCard(p) {
  const sale = p.compare_at && p.compare_at > p.min_price;
  return html`<article class="card">
  <a class="card-link" href="/products/${p.slug}">
    <div class="card-media">
      <img src="${img(p.image_id, 'thumb')}" alt="${p.name}" loading="lazy" width="480" height="480">
      ${p.image2_id ? html`<img class="alt" src="${img(p.image2_id, 'thumb')}" alt="" loading="lazy" width="480" height="480">` : ''}
      ${p.featured ? html`<span class="badge">Bestseller</span>` : ''}
      ${p.stock <= 0 ? html`<span class="badge soldout">Sold out</span>` : ''}
    </div>
    <div class="card-body">
      <h3>${p.name}</h3>
      <p class="card-tag">${p.tagline}</p>
      <div class="card-foot"><p class="price">${priceRange(p)} ${sale ? html`<s>${money(p.compare_at)}</s>` : ''}</p><span class="ship-tag">Free shipping</span></div>
    </div>
  </a>
</article>`;
}

function trustBar() {
  const icon = (d) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
  return html`<section class="trust wrap" aria-label="Why shop with us">
  <div>${icon('M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z')}<p><strong>Free US shipping</strong><span>On every order, no minimum</span></p></div>
  <div>${icon('M6 10V8a6 6 0 0 1 12 0v2M5 10h14v10H5zM12 14v2')}<p><strong>Secure checkout</strong><span>Card, Apple Pay &amp; Google Pay</span></p></div>
  <div>${icon('M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4')}<p><strong>30-day returns</strong><span>Not right? We'll make it right</span></p></div>
  <div>${icon('M4 6h16v10H8l-4 4zM8 10h8M8 13h5')}<p><strong>Real people</strong><span>Message us any time</span></p></div>
</section>`;
}

function daysUntilChristmas() {
  const now = new Date();
  let xmas = new Date(Date.UTC(now.getUTCFullYear(), 11, 25));
  if (now > xmas) xmas = new Date(Date.UTC(now.getUTCFullYear() + 1, 11, 25));
  return Math.ceil((xmas - now) / 86400000);
}

function home({ s, products, categories }) {
  const featured = products.filter((p) => p.featured);
  const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));
  const heroP = bySlug['snow-globe-lantern-music-box'] || featured[0] || products[0];
  const pj = bySlug['family-christmas-pajamas'];
  const glow = bySlug['led-birch-tree-light'] || bySlug['star-curtain-fairy-lights'];
  const catCover = (c) => (products.find((p) => p.category_slug === c.slug) || {}).image_id;
  const under = (cents) => products.filter((p) => p.min_price <= cents).length;
  const days = daysUntilChristmas();
  return html`
<section class="hero">
  ${heroP ? html`<img class="hero-bg" src="${img(heroP.image_id)}" alt="" width="1200" height="1200" fetchpriority="high">` : ''}
  <div class="hero-shade" aria-hidden="true"></div>
  <div class="snow" aria-hidden="true"></div>
  <div class="wrap hero-inner">
    <p class="eyebrow"><span class="dot"></span> ${days} days until Christmas</p>
    <h1>${s.hero_title}</h1>
    <p class="lede">${s.hero_subtitle}</p>
    <div class="hero-cta">
      <a class="btn btn-gold" href="/shop">Shop the collection</a>
      <a class="btn btn-ghost-light" href="#bestsellers">See bestsellers</a>
    </div>
    <p class="cutoff">Order by <strong>${s.christmas_cutoff}</strong> for the best chance of delivery before Christmas.</p>
  </div>
</section>
${trustBar()}
<section class="wrap section" id="bestsellers">
  <div class="section-head"><div><p class="kicker">Most loved</p><h2>Bestsellers this season</h2></div><a class="link-arrow" href="/shop">Shop all →</a></div>
  <div class="grid">${featured.slice(0, 8).map(productCard)}</div>
</section>
${pj ? html`<section class="wrap section">
  <div class="feature">
    <a class="feature-media" href="/products/${pj.slug}"><img src="${img(pj.image_id)}" alt="${pj.name}" loading="lazy" width="1200" height="1200"></a>
    <div class="feature-copy">
      <p class="kicker">The Christmas-morning photo</p>
      <h2>Matching pajamas for the whole family</h2>
      <p>Soft, festive and made for the photo you'll keep forever. Women's and men's sizes from S to 3XL — free shipping on every set.</p>
      <a class="btn" href="/products/${pj.slug}">Shop pajamas · ${priceRange(pj)}</a>
    </div>
  </div>
</section>` : ''}
<section class="wrap section">
  <div class="section-head"><div><p class="kicker">Find it fast</p><h2>Shop by category</h2></div></div>
  <div class="cats">${categories.filter((c) => c.n > 0).map((c) => html`<a class="cat" href="/shop/${c.slug}">
    ${catCover(c) ? html`<img src="${img(catCover(c), 'thumb')}" alt="" loading="lazy" width="480" height="480">` : ''}
    <span class="cat-label"><strong>${c.name}</strong><small>${c.n} item${c.n === 1 ? '' : 's'}</small></span></a>`)}</div>
</section>
<section class="wrap section">
  <div class="gift-strip">
    <a href="/shop?max=1500"><strong>Stocking stuffers</strong><span>${under(1500)} gifts under $15</span></a>
    <a href="/shop?max=3000"><strong>Under $30</strong><span>${under(3000)} easy gifts</span></a>
    <a href="/shop/lights"><strong>Make it glow</strong><span>Lights &amp; lamps</span></a>
    <a href="/shop/pets"><strong>For the dog</strong><span>Because they're family</span></a>
  </div>
</section>
<section class="wrap section">
  <div class="section-head"><div><p class="kicker">The full collection</p><h2>Everything in the shop</h2></div></div>
  <div class="grid">${products.filter((p) => !p.featured).map(productCard)}</div>
</section>
${glow ? html`<section class="wrap section">
  <div class="feature reverse dark">
    <a class="feature-media" href="/products/${glow.slug}"><img src="${img(glow.image_id)}" alt="${glow.name}" loading="lazy" width="1200" height="1200"></a>
    <div class="feature-copy">
      <p class="kicker">Cozy season</p>
      <h2>A warm glow for every corner</h2>
      <p>Twinkling stars for the window, a glowing birch tree for the mantel, a Santa projector for the kids' room. Little lights, big Christmas feeling.</p>
      <a class="btn btn-gold" href="/shop/lights">Shop Christmas lights</a>
    </div>
  </div>
</section>` : ''}
<section class="band">
  <div class="wrap band-grid">
    <div><p class="kicker">Simple &amp; free</p><h2>How it works</h2><p>Every item is in stock and ships free from our US warehouse, straight to your door. You'll get an order confirmation right away and tracking as soon as your package is on its way.</p></div>
    <ol class="steps"><li><strong>Pick your favourites</strong><span>Mix and match anything in the shop.</span></li><li><strong>Check out securely</strong><span>Card, Apple Pay and Google Pay via Stripe.</span></li><li><strong>Track your parcel</strong><span>Delivered in 3–5 business days.</span></li></ol>
  </div>
</section>`;
}

function collection({ title, intro, products, categories, active, q }) {
  return html`<section class="wrap section page-top">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span>/</span> <span>${title}</span></nav>
  <div class="collection-head">
    <div><h1>${title}</h1>${intro ? html`<p class="muted">${intro}</p>` : ''}</div>
    <form class="search" action="/shop" method="get" role="search"><input type="search" name="q" value="${q || ''}" placeholder="Search products" maxlength="80" aria-label="Search products"><button class="btn btn-sm" type="submit">Search</button></form>
  </div>
  <div class="chips"><a class="chip ${!active ? 'on' : ''}" href="/shop">All</a>${categories.filter((c) => c.n > 0).map((c) => html`<a class="chip ${active === c.slug ? 'on' : ''}" href="/shop/${c.slug}">${c.name}</a>`)}</div>
  ${products.length ? html`<div class="grid">${products.map(productCard)}</div>` : html`<p class="empty">No products found. <a href="/shop">Browse everything</a>.</p>`}
</section>`;
}

function product({ p, related, s }) {
  const minPrice = Math.min(...p.variants.map((v) => v.price_cents));
  const data = {
    id: p.id, slug: p.slug, name: p.name, option1: p.option_name, option2: p.option2_name,
    variants: p.variants.map((v) => ({ id: v.id, o1: v.option1, o2: v.option2, price: v.price_cents, compare: v.compare_at_cents, stock: v.inventory, img: v.image_id })),
    images: p.images.map((i) => i.id),
  };
  const opts1 = [...new Set(p.variants.map((v) => v.option1))];
  const opts2 = p.option2_name ? [...new Set(p.variants.map((v) => v.option2))] : [];
  const first = p.variants.find((v) => v.inventory > 0) || p.variants[0];
  const mainImg = p.images[0];
  const swatchFor = (o) => { const v = p.variants.find((x) => x.option1 === o && x.image_id); return v ? v.image_id : null; };
  return html`<section class="wrap section page-top">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span>/</span> ${p.category_slug ? html`<a href="/shop/${p.category_slug}">${p.category_name}</a> <span>/</span>` : ''} <span>${p.name}</span></nav>
  <div class="pdp">
    <div class="gallery" data-gallery>
      <div class="gallery-main"><img data-main-img src="${img(mainImg && mainImg.id)}" alt="${p.name}" width="1200" height="1200"></div>
      ${p.images.length > 1 ? html`<div class="thumbs" role="list">${p.images.map((im, i) => html`<button type="button" role="listitem" class="thumb ${i === 0 ? 'on' : ''}" data-thumb="${im.id}" aria-label="Show image ${i + 1}"><img src="${img(im.id, 'thumb')}" alt="" loading="lazy" width="120" height="120"></button>`)}</div>` : ''}
    </div>
    <div class="buybox">
      <h1>${p.name}</h1>
      <p class="tagline">${p.tagline}</p>
      <p class="pdp-price"><span data-price>${money(first.price_cents)}</span> <s data-compare ${first.compare_at_cents > first.price_cents ? '' : raw('hidden')}>${first.compare_at_cents ? money(first.compare_at_cents) : ''}</s></p>
      <p class="ship-line"><strong>Free shipping</strong> · Arrives in ${p.ship_estimate}</p>
      <form class="buy-form" data-buy-form novalidate>
        ${p.option_name ? html`<fieldset class="opt"><legend>${p.option_name}: <span data-o1-label>${first.option1}</span></legend>
          <div class="opt-values">${opts1.map((o) => { const sw = swatchFor(o); return html`<label class="opt-val ${sw ? 'has-swatch' : ''}"><input type="radio" name="o1" value="${o}" ${o === first.option1 ? raw('checked') : ''}>${sw ? html`<img src="${img(sw, 'thumb')}" alt="" width="44" height="44" loading="lazy">` : ''}<span>${o}</span></label>`; })}</div></fieldset>` : ''}
        ${p.option2_name ? html`<fieldset class="opt"><legend>${p.option2_name}: <span data-o2-label>${first.option2}</span></legend>
          <div class="opt-values">${opts2.map((o) => html`<label class="opt-val"><input type="radio" name="o2" value="${o}" ${o === first.option2 ? raw('checked') : ''}><span>${o}</span></label>`)}</div></fieldset>` : ''}
        <div class="qty-row">
          <div class="qty" data-qty><button type="button" data-qty-minus aria-label="Decrease quantity">−</button><input type="number" name="qty" value="1" min="1" max="50" inputmode="numeric" aria-label="Quantity"><button type="button" data-qty-plus aria-label="Increase quantity">+</button></div>
          <button class="btn btn-block" type="submit" data-add>Add to cart</button>
        </div>
        <button class="btn btn-dark btn-block" type="button" data-buy-now>Buy it now</button>
        <p class="stock-msg" data-stock-msg role="status"></p>
      </form>
      <ul class="assure">
        <li>Free shipping to all 50 states</li>
        <li>Secure checkout — card, Apple Pay, Google Pay</li>
        <li>30-day returns on unused items</li>
      </ul>
      <div class="desc">
        <p>${p.description}</p>
        ${p.bullets && p.bullets.length ? html`<ul>${p.bullets.map((b) => html`<li>${b}</li>`)}</ul>` : ''}
      </div>
      <details class="acc"><summary>Shipping &amp; delivery</summary><p>Free shipping on every order. Every item is in stock in the US — orders ship within 1 business day and arrive in ${p.ship_estimate}. You'll receive tracking as soon as your parcel ships. Order by ${s.christmas_cutoff} for Christmas delivery.</p></details>
      <details class="acc"><summary>Returns</summary><p>Changed your mind? Return unused items within 30 days of delivery. Arrived damaged or not as described? Contact us with a photo and we'll replace or refund it. <a href="/returns">Full returns policy</a>.</p></details>
    </div>
  </div>
  <script type="application/json" id="product-data">${jsonScript(data)}</script>
</section>
${related.length ? html`<section class="wrap section"><div class="section-head"><h2>You may also like</h2></div><div class="grid">${related.map(productCard)}</div></section>` : ''}
<div class="sticky-buy" data-sticky-buy hidden><div class="wrap"><span>${p.name}</span><strong data-sticky-price>${money(minPrice)}</strong><button class="btn btn-sm" type="button" data-sticky-add>Add to cart</button></div></div>`;
}

function cartPage({ cancelled }) {
  return html`<section class="wrap section page-top narrow">
  <h1>Your cart</h1>
  ${cancelled ? html`<p class="notice">Checkout was cancelled — your cart is saved below.</p>` : ''}
  <div class="cart-page" data-cart-page><p class="muted">Loading your cart…</p></div>
</section>`;
}

function orderPage({ order, items, justPaid }) {
  const paid = !['pending', 'expired', 'cancelled'].includes(order.status);
  const addr = order.shipping_address || null;
  const statusText = {
    pending: 'Waiting for payment confirmation', paid: 'Order confirmed', processing: 'Preparing your order', shipped: 'On its way',
    delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded', expired: 'Checkout not completed',
  }[order.status];
  return html`<section class="wrap section page-top narrow">
  ${paid ? html`<div class="thanks">
    <div class="thanks-icon" aria-hidden="true">✓</div>
    <h1>${justPaid ? 'Thank you for your order!' : statusText}</h1>
    <p>Order <strong>${order.number}</strong>${order.email ? html` · A receipt has been sent to <strong>${order.email}</strong>` : ''}</p>
  </div>` : html`<div class="thanks pending"><h1>${statusText}</h1><p>Order <strong>${order.number}</strong>${order.status === 'pending' ? ' — if you just paid, this page will update in a moment.' : ''}</p>
    ${order.status === 'pending' ? html`<p class="muted small" data-order-pending>Checking payment status…</p>` : html`<p><a class="btn" href="/cart">Return to cart</a></p>`}</div>`}
  <div class="order-box">
    <h2>What you ordered</h2>
    <ul class="order-items">${items.map((it) => html`<li>
      <img src="${img(it.image_id, 'thumb')}" alt="" width="72" height="72" loading="lazy">
      <div><strong>${it.product_name}</strong>${it.variant_name ? html`<span class="muted">${it.variant_name}</span>` : ''}<span class="muted">Qty ${it.quantity} × ${money(it.unit_cents)}</span></div>
      <span class="line-total">${money(it.unit_cents * it.quantity)}</span></li>`)}</ul>
    <dl class="totals"><div><dt>Subtotal</dt><dd>${money(order.subtotal_cents)}</dd></div><div><dt>Shipping</dt><dd>Free</dd></div><div class="grand"><dt>Total</dt><dd>${money(order.total_cents)}</dd></div></dl>
  </div>
  ${paid ? html`<div class="order-cols">
    ${addr ? html`<div class="order-box"><h2>Shipping to</h2><p>${addr.name}<br>${addr.line1}${addr.line2 ? html`<br>${addr.line2}` : ''}<br>${addr.city}, ${addr.state} ${addr.postal_code}</p></div>` : ''}
    <div class="order-box"><h2>What happens next</h2>
      <ol class="timeline">
        <li class="${['paid', 'processing', 'shipped', 'delivered'].includes(order.status) ? 'done' : ''}">Order confirmed</li>
        <li class="${['processing', 'shipped', 'delivered'].includes(order.status) ? 'done' : ''}">Preparing your order (ships within 1 business day)</li>
        <li class="${['shipped', 'delivered'].includes(order.status) ? 'done' : ''}">Shipped${order.tracking_number ? html` — tracking <strong>${order.tracking_number}</strong>${order.tracking_url ? html` · <a href="${order.tracking_url}" rel="noopener noreferrer" target="_blank">Track parcel</a>` : ''}` : ''}</li>
        <li class="${order.status === 'delivered' ? 'done' : ''}">Delivered</li>
      </ol>
      <p class="muted small">Bookmark this page to check your order status any time, or use <a href="/track">order tracking</a> with your order number and email.</p>
    </div></div>` : ''}
  <p class="center"><a class="btn btn-ghost" href="/shop">Continue shopping</a></p>
</section>`;
}

function trackPage({ error, values = {} }) {
  return html`<section class="wrap section page-top narrow">
  <h1>Track your order</h1>
  <p class="muted">Enter your order number (it starts with TP-) and the email you used at checkout.</p>
  ${error ? html`<p class="notice error" role="alert">${error}</p>` : ''}
  <form class="form" method="post" action="/track">
    <label>Order number<input name="number" required maxlength="20" value="${values.number || ''}" placeholder="TP-XXXXXX" autocomplete="off"></label>
    <label>Email<input name="email" type="email" required maxlength="200" value="${values.email || ''}" autocomplete="email"></label>
    <button class="btn" type="submit">Find my order</button>
  </form>
</section>`;
}

function contactPage({ sent, error, values = {}, s }) {
  return html`<section class="wrap section page-top narrow">
  <h1>Contact us</h1>
  <p class="muted">Questions about an order, sizing or delivery? Send us a message and we'll reply by email${s.support_email ? html` — or write to <a href="mailto:${s.support_email}">${s.support_email}</a>` : ''}.</p>
  ${sent ? html`<p class="notice" role="status">Thanks! Your message was sent — we'll get back to you soon.</p>` : ''}
  ${error ? html`<p class="notice error" role="alert">${error}</p>` : ''}
  ${sent ? '' : html`<form class="form" method="post" action="/contact">
    <label>Your name<input name="name" required maxlength="100" value="${values.name || ''}" autocomplete="name"></label>
    <label>Email<input name="email" type="email" required maxlength="200" value="${values.email || ''}" autocomplete="email"></label>
    <label>Order number (optional)<input name="order_number" maxlength="20" value="${values.order_number || ''}"></label>
    <label>Message<textarea name="body" required maxlength="4000" rows="6">${values.body || ''}</textarea></label>
    <label class="hp" aria-hidden="true">Leave empty<input name="website" tabindex="-1" autocomplete="off"></label>
    <button class="btn" type="submit">Send message</button>
  </form>`}
</section>`;
}

function textPage({ title, sections }) {
  return html`<section class="wrap section page-top narrow prose">
  <h1>${title}</h1>
  ${sections.map(([h, ps]) => html`${h ? html`<h2>${h}</h2>` : ''}${ps.map((p) => html`<p>${p}</p>`)}`)}
</section>`;
}

function notFound() {
  return html`<section class="wrap section page-top narrow center"><h1>Page not found</h1><p class="muted">That page may have moved. Let's get you back to the good stuff.</p><p><a class="btn" href="/shop">Shop all products</a></p></section>`;
}

function errorPage() {
  return html`<section class="wrap section page-top narrow center"><h1>Something went wrong</h1><p class="muted">Please try again in a moment.</p><p><a class="btn" href="/">Back to home</a></p></section>`;
}

module.exports = { layout, home, collection, product, cartPage, orderPage, trackPage, contactPage, textPage, notFound, errorPage, productCard, setAssetVersion, img };
