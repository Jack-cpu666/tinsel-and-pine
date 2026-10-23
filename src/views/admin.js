'use strict';
const { html, raw, money } = require('./html');

const STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'expired'];
const img = (id, size = 'thumb') => (id ? `/img/${id}/${size}.webp` : '/static/img/placeholder.svg');
const dt = (d) => (d ? new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }) : '—');
const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;

function layout({ title, body, nonce, admin, csrf, flash, active }) {
  const nav = [['/admin', 'Dashboard', 'dash'], ['/admin/orders', 'Orders', 'orders'], ['/admin/products', 'Products', 'products'],
    ['/admin/messages', 'Messages', 'messages'], ['/admin/subscribers', 'Subscribers', 'subs'], ['/admin/settings', 'Settings', 'settings'], ['/admin/security', 'Security', 'security']];
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${title} · Admin</title>
<link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/css/admin.css?v=${raw(ASSET_V)}"></head>
<body class="${admin ? 'in' : 'out'}" data-csrf="${csrf || ''}">
${admin ? html`<aside class="side"><a class="logo" href="/admin">Store admin</a>
  <nav>${nav.map(([href, label, key]) => html`<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`)}</nav>
  <div class="side-foot"><a href="/" target="_blank" rel="noopener">View store ↗</a><span class="who">${admin.email}</span>
  <form method="post" action="/admin/logout">${csrfField(csrf)}<button class="link" type="submit">Log out</button></form></div></aside>` : ''}
<main class="main">${flash ? html`<div class="flash ${flash.type || ''}" role="status">${flash.msg}</div>` : ''}${body}</main>
<script nonce="${nonce}" src="/static/js/admin.js?v=${raw(ASSET_V)}" defer></script></body></html>`;
}
let ASSET_V = '1';
function setAssetVersion(v) { ASSET_V = v; }

function authCard(title, inner) {
  return html`<div class="auth"><div class="auth-card"><h1>${title}</h1>${inner}</div></div>`;
}

function login({ error, email, next, needTotp }) {
  return authCard('Sign in', html`${error ? html`<p class="err" role="alert">${error}</p>` : ''}
  <form method="post" action="/admin/login" class="stack">
    <input type="hidden" name="next" value="${next || ''}">
    <label>Email<input name="email" type="email" required autocomplete="username" value="${email || ''}" maxlength="200"></label>
    <label>Password<input name="password" type="password" required autocomplete="current-password" maxlength="200"></label>
    <label>Authenticator code <small>(if enabled)</small><input name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" ${needTotp ? raw('autofocus') : ''}></label>
    <button class="btn" type="submit">Sign in</button>
  </form>`);
}

function setup({ token, error, email }) {
  return authCard('Create the owner account', html`<p class="muted">This one-time page creates the store owner's admin login. Use a strong password (12+ characters with letters and numbers).</p>
  ${error ? html`<p class="err" role="alert">${error}</p>` : ''}
  <form method="post" action="/admin/setup" class="stack">
    <input type="hidden" name="token" value="${token}">
    <label>Email<input name="email" type="email" required autocomplete="username" value="${email || ''}" maxlength="200"></label>
    <label>Password<input name="password" type="password" required minlength="12" autocomplete="new-password" maxlength="200"></label>
    <label>Confirm password<input name="password2" type="password" required minlength="12" autocomplete="new-password" maxlength="200"></label>
    <button class="btn" type="submit">Create account</button>
  </form>`);
}

function statusPill(s) { return html`<span class="pill st-${s}">${s}</span>`; }

function bars(daily, key, fmt = (v) => v) {
  const max = Math.max(1, ...daily.map((d) => d[key]));
  const n = daily.length;
  const w = 100 / n;
  return html`<svg class="bars" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="${key} per day">${daily.map((d, i) => {
    const h = (d[key] / max) * 38;
    return html`<rect x="${(i * w + w * 0.12).toFixed(3)}" y="${(40 - h).toFixed(3)}" width="${(w * 0.76).toFixed(3)}" height="${Math.max(h, 0.4).toFixed(3)}" rx="0.4"><title>${d.day}: ${fmt(d[key])}</title></rect>`;
  })}</svg><div class="bars-axis"><span>${daily[0] ? daily[0].day : ''}</span><span>${daily.length ? daily[daily.length - 1].day : ''}</span></div>`;
}

function dashboard({ a, recent, alerts, unread }) {
  const visitors = a.totals.visitors;
  const conv = visitors ? ((a.sales.orders / visitors) * 100).toFixed(1) : '0.0';
  const profit = a.sales.revenue - a.sales.cost;
  return html`<h1>Dashboard <small class="muted">last ${a.days} days</small></h1>
  <form class="range" method="get">${[1, 7, 30, 90].map((d) => html`<button name="days" value="${d}" class="${a.days === d ? 'on' : ''}">${d === 1 ? 'Today' : d + ' days'}</button>`)}</form>
  ${alerts.map((al) => html`<div class="flash ${al.type}">${al.msg} ${al.href ? html`<a href="${al.href}">${al.cta}</a>` : ''}</div>`)}
  <div class="kpis">
    <div class="kpi"><span>Visitors</span><strong>${visitors}</strong><small>${a.totals.views} page views</small></div>
    <div class="kpi"><span>Orders</span><strong>${a.sales.orders}</strong><small>${conv}% conversion</small></div>
    <div class="kpi"><span>Revenue</span><strong>${money(a.sales.revenue)}</strong><small>Est. profit ${money(profit)} before ads/fees</small></div>
    <div class="kpi"><span>Add to cart</span><strong>${a.funnel.add_to_cart || 0}</strong><small>${a.funnel.begin_checkout || 0} started checkout</small></div>
  </div>
  <div class="panels">
    <section class="panel wide"><h2>Visitors per day</h2>${bars(a.daily, 'visitors')}</section>
    <section class="panel wide"><h2>Revenue per day</h2>${bars(a.daily, 'revenue', money)}</section>
    <section class="panel"><h2>Traffic sources</h2>${table(['Source', 'Visitors'], a.refs.map((r) => [r.source, r.visitors]))}</section>
    <section class="panel"><h2>Top pages</h2>${table(['Page', 'Views'], a.pages.map((r) => [r.path, r.views]))}</section>
    <section class="panel"><h2>Devices</h2>${table(['Device', 'Visitors'], a.devices.map((r) => [r.device, r.visitors]))}</section>
    <section class="panel"><h2>Ad campaigns <small>(utm_campaign)</small></h2>${a.campaigns.length ? table(['Campaign', 'Visitors'], a.campaigns.map((r) => [r.campaign, r.visitors])) : html`<p class="muted">Add <code>?utm_source=facebook&amp;utm_campaign=name</code> to ad links to see them here.</p>`}</section>
  </div>
  <section class="panel"><h2>Recent orders ${unread ? html`<a class="pill st-paid" href="/admin/messages">${unread} unread message${unread > 1 ? 's' : ''}</a>` : ''}</h2>${ordersTable(recent)}</section>`;
}

function table(head, rows) {
  if (!rows.length) return html`<p class="muted">No data yet.</p>`;
  return html`<table class="tbl"><thead><tr>${head.map((h) => html`<th>${h}</th>`)}</tr></thead><tbody>${rows.map((r) => html`<tr>${r.map((c) => html`<td>${c}</td>`)}</tr>`)}</tbody></table>`;
}

function ordersTable(rows) {
  if (!rows.length) return html`<p class="muted">No orders yet.</p>`;
  return html`<table class="tbl"><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Status</th><th>Items</th><th class="r">Total</th></tr></thead><tbody>
  ${rows.map((o) => html`<tr><td><a href="/admin/orders/${o.id}">${o.number}</a></td><td>${dt(o.created_at)}</td><td>${o.customer_name || '—'}<br><small class="muted">${o.email || ''}</small></td><td>${statusPill(o.status)}</td><td>${o.item_count}</td><td class="r">${money(o.total_cents)}</td></tr>`)}
  </tbody></table>`;
}

function orders({ rows, status, q, counts }) {
  return html`<h1>Orders</h1>
  <form class="filters" method="get"><select name="status"><option value="">All (except abandoned)</option>${STATUSES.map((s) => html`<option value="${s}" ${status === s ? raw('selected') : ''}>${s} (${counts[s] || 0})</option>`)}</select>
  <input name="q" value="${q || ''}" placeholder="Order #, email or name" maxlength="100"><button class="btn sm">Filter</button>
  <a class="btn sm ghost" href="/admin/orders.csv">Export CSV</a></form>
  ${ordersTable(rows)}`;
}

function orderDetail({ o, items, events, csrf }) {
  const a = o.shipping_address;
  const cost = items.reduce((s, i) => s + (i.cost_cents || 0) * i.quantity, 0);
  return html`<p><a href="/admin/orders">← Orders</a></p>
  <h1>${o.number} ${statusPill(o.status)}</h1>
  <div class="panels">
    <section class="panel wide"><h2>Items to fulfil</h2>
      <table class="tbl"><thead><tr><th></th><th>Product</th><th>Qty</th><th class="r">Price</th><th class="r">Cost</th><th>Supplier</th></tr></thead><tbody>
      ${items.map((i) => html`<tr><td><img src="${img(i.image_id)}" width="48" height="48" alt=""></td><td><strong>${i.product_name}</strong><br><small>${i.variant_name || ''}</small></td><td>${i.quantity}</td><td class="r">${money(i.unit_cents * i.quantity)}</td><td class="r">${i.cost_cents ? money(i.cost_cents * i.quantity) : '—'}</td>
        <td>${i.supplier_url ? html`<a href="${i.supplier_url}" target="_blank" rel="noopener noreferrer">Open supplier ↗</a>` : '—'}</td></tr>`)}
      </tbody></table>
      <p class="muted">Total ${money(o.total_cents)} · supplier cost ≈ ${money(cost)} · gross margin ≈ ${money(o.total_cents - cost)} (before Stripe fees)</p>
    </section>
    <section class="panel"><h2>Customer</h2>
      <p>${o.customer_name || '—'}<br>${o.email ? html`<a href="mailto:${o.email}">${o.email}</a>` : ''}<br>${o.phone || ''}</p>
      ${a ? html`<h3>Ship to</h3><p class="addr" data-copy>${a.name}<br>${a.line1}${a.line2 ? html`<br>${a.line2}` : ''}<br>${a.city}, ${a.state} ${a.postal_code}<br>${a.country}</p><button class="btn sm ghost" type="button" data-copy-btn>Copy address</button>` : ''}
      <h3>Payment</h3><p>${o.paid_at ? html`Paid ${dt(o.paid_at)}` : 'Not paid'}${o.stripe_payment_intent ? html`<br><a href="https://dashboard.stripe.com/payments/${o.stripe_payment_intent}" target="_blank" rel="noopener noreferrer">View in Stripe ↗</a>` : ''}</p>
      <p><a href="/order/${o.public_token}" target="_blank" rel="noopener">Customer order page ↗</a></p>
    </section>
    <section class="panel"><h2>Fulfilment</h2>
      <form method="post" action="/admin/orders/${o.id}" class="stack">${csrfField(csrf)}
        <label>Status<select name="status">${STATUSES.map((s) => html`<option ${o.status === s ? raw('selected') : ''}>${s}</option>`)}</select></label>
        <label>Supplier order # <input name="supplier_order_ref" value="${o.supplier_order_ref || ''}" maxlength="100"></label>
        <label>Carrier<input name="carrier" value="${o.carrier || ''}" maxlength="60" placeholder="USPS, YunExpress…"></label>
        <label>Tracking number<input name="tracking_number" value="${o.tracking_number || ''}" maxlength="100"></label>
        <label>Tracking URL<input name="tracking_url" type="url" value="${o.tracking_url || ''}" maxlength="500" placeholder="https://"></label>
        <label>Internal notes<textarea name="notes" rows="3" maxlength="4000">${o.notes || ''}</textarea></label>
        <button class="btn">Save</button>
      </form>
      ${o.status === 'pending' && o.stripe_session_id ? html`<form method="post" action="/admin/orders/${o.id}/sync">${csrfField(csrf)}<button class="btn sm ghost">Re-check payment with Stripe</button></form>` : ''}
    </section>
    <section class="panel"><h2>History</h2><ul class="events">${events.map((e) => html`<li><small>${dt(e.created_at)}</small> ${e.message}</li>`)}</ul></section>
  </div>`;
}

function products({ rows, csrf }) {
  return html`<h1>Products <a class="btn sm" href="/admin/products/new">+ New product</a></h1>
  <table class="tbl"><thead><tr><th></th><th>Name</th><th>Status</th><th>Variants</th><th class="r">Price</th><th class="r">Stock</th><th class="r">Sold</th></tr></thead><tbody>
  ${rows.map((p) => html`<tr><td><img src="${img(p.image_id)}" width="44" height="44" alt=""></td><td><a href="/admin/products/${p.id}">${p.name}</a>${p.featured ? html` <span class="pill">featured</span>` : ''}${p.queued ? html`<br><small class="muted">${p.queued} image(s) downloading…</small>` : ''}</td>
    <td>${statusPill(p.status)}</td><td>${p.variants}</td><td class="r">${p.min_price === p.max_price ? money(p.min_price) : html`${money(p.min_price)}–${money(p.max_price)}`}</td><td class="r">${p.stock}</td><td class="r">${p.sold}</td></tr>`)}
  </tbody></table>`;
}

function productEdit({ p, variants, images, categories, csrf, queue }) {
  const isNew = !p.id;
  return html`<p><a href="/admin/products">← Products</a></p>
  <h1>${isNew ? 'New product' : p.name} ${!isNew ? html`<a class="btn sm ghost" href="/products/${p.slug}" target="_blank" rel="noopener">View ↗</a>` : ''}</h1>
  <form method="post" action="${isNew ? '/admin/products/new' : `/admin/products/${p.id}`}" class="panel stack">${csrfField(csrf)}
    <div class="grid2">
      <label>Name<input name="name" required maxlength="140" value="${p.name || ''}"></label>
      <label>URL slug<input name="slug" required maxlength="120" pattern="[a-z0-9-]+" value="${p.slug || ''}"></label>
    </div>
    <label>Tagline<input name="tagline" maxlength="200" value="${p.tagline || ''}"></label>
    <label>Description<textarea name="description" rows="5" maxlength="6000">${p.description || ''}</textarea></label>
    <label>Bullet points (one per line)<textarea name="bullets" rows="5" maxlength="3000">${(p.bullets || []).join('\n')}</textarea></label>
    <div class="grid3">
      <label>Category<select name="category_id"><option value="">—</option>${categories.map((c) => html`<option value="${c.id}" ${p.category_id === c.id ? raw('selected') : ''}>${c.name}</option>`)}</select></label>
      <label>Status<select name="status">${['active', 'draft', 'archived'].map((s) => html`<option ${p.status === s ? raw('selected') : ''}>${s}</option>`)}</select></label>
      <label>Sort order<input name="sort_order" type="number" value="${p.sort_order || 0}"></label>
    </div>
    <div class="grid3">
      <label>Option 1 name<input name="option_name" maxlength="40" value="${p.option_name || ''}" placeholder="e.g. Color"></label>
      <label>Option 2 name<input name="option2_name" maxlength="40" value="${p.option2_name || ''}" placeholder="e.g. Size"></label>
      <label>Delivery estimate<input name="ship_estimate" maxlength="60" value="${p.ship_estimate || '7-14 business days'}"></label>
    </div>
    <label>Supplier URL (private)<input name="supplier_url" type="url" maxlength="500" value="${p.supplier_url || ''}"></label>
    <label class="check"><input type="checkbox" name="featured" value="1" ${p.featured ? raw('checked') : ''}> Featured / bestseller</label>
    ${isNew ? html`<div class="grid3"><label>Price (USD)<input name="price" required inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" placeholder="19.99"></label><label>Supplier cost (USD)<input name="cost" inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?"></label><label>Inventory<input name="inventory" type="number" min="0" value="500"></label></div>` : ''}
    <button class="btn">${isNew ? 'Create product' : 'Save product'}</button>
  </form>
  ${isNew ? '' : html`
  <section class="panel"><h2>Variants &amp; pricing</h2>
    <form method="post" action="/admin/products/${p.id}/variants">${csrfField(csrf)}
    <div class="scroll"><table class="tbl variants"><thead><tr><th>${p.option_name || 'Option 1'}</th>${p.option2_name ? html`<th>${p.option2_name}</th>` : ''}<th>Price</th><th>Compare at</th><th>Cost</th><th>Margin</th><th>Stock</th><th>Image</th><th>Active</th><th>Delete</th></tr></thead><tbody>
    ${variants.map((v) => html`<tr>
      <td><input name="v[k${v.id}][option1]" value="${v.option1}" maxlength="80" required></td>
      ${p.option2_name ? html`<td><input name="v[k${v.id}][option2]" value="${v.option2 || ''}" maxlength="80"></td>` : ''}
      <td><input class="num" name="v[k${v.id}][price]" value="${(v.price_cents / 100).toFixed(2)}" inputmode="decimal" required></td>
      <td><input class="num" name="v[k${v.id}][compare]" value="${v.compare_at_cents ? (v.compare_at_cents / 100).toFixed(2) : ''}" inputmode="decimal"></td>
      <td><input class="num" name="v[k${v.id}][cost]" value="${v.cost_cents != null ? (v.cost_cents / 100).toFixed(2) : ''}" inputmode="decimal"></td>
      <td class="muted">${v.cost_cents ? Math.round(((v.price_cents - v.cost_cents) / v.price_cents) * 100) + '%' : '—'}</td>
      <td><input class="num" name="v[k${v.id}][inventory]" type="number" min="0" value="${v.inventory}"></td>
      <td><select name="v[k${v.id}][image_id]"><option value="">—</option>${images.map((im, i) => html`<option value="${im.id}" ${v.image_id === im.id ? raw('selected') : ''}>#${i + 1}</option>`)}</select></td>
      <td><input type="checkbox" name="v[k${v.id}][active]" value="1" ${v.active ? raw('checked') : ''}></td>
      <td><input type="checkbox" name="v[k${v.id}][delete]" value="1" aria-label="Delete variant"></td></tr>`)}
    <tr class="new"><td><input name="new[option1]" placeholder="New variant" maxlength="80"></td>${p.option2_name ? html`<td><input name="new[option2]" maxlength="80"></td>` : ''}<td><input class="num" name="new[price]" placeholder="0.00" inputmode="decimal"></td><td><input class="num" name="new[compare]" inputmode="decimal"></td><td><input class="num" name="new[cost]" inputmode="decimal"></td><td></td><td><input class="num" name="new[inventory]" type="number" min="0" value="500"></td><td></td><td></td><td></td></tr>
    </tbody></table></div>
    <div class="row"><button class="btn">Save variants</button>
      <span class="muted">Quick reprice: </span><input class="num" name="multiplier" placeholder="2.0" inputmode="decimal" aria-label="Price multiplier"><span class="muted">× cost (rounded up to .99)</span></div>
    </form>
  </section>
  <section class="panel"><h2>Images</h2>
    ${queue ? html`<p class="flash">${queue} supplier image(s) are still downloading in the background.</p>` : ''}
    <div class="img-grid">${images.map((im, i) => html`<figure><img src="${img(im.id)}" alt="" width="140" height="140"><figcaption>#${i + 1}
      <form method="post" action="/admin/images/${im.id}/move" class="inline">${csrfField(csrf)}<button name="dir" value="up" class="link" title="Move earlier">◀</button><button name="dir" value="down" class="link" title="Move later">▶</button></form>
      <form method="post" action="/admin/images/${im.id}/delete" class="inline" data-confirm="Delete this image?">${csrfField(csrf)}<button class="link danger">Delete</button></form></figcaption></figure>`)}</div>
    <div class="grid2">
      <form class="stack" data-upload="/admin/products/${p.id}/images"><label>Upload images (JPG, PNG, WebP — max 10 MB each)<input type="file" name="files" accept="image/jpeg,image/png,image/webp" multiple required></label><button class="btn sm">Upload</button><p class="muted" data-upload-msg></p></form>
      <form method="post" action="/admin/products/${p.id}/images/import" class="stack">${csrfField(csrf)}<label>Import from AliExpress / Alibaba image URL<input name="url" type="url" required maxlength="500" placeholder="https://ae-pic-a1.aliexpress-media.com/kf/....jpg"></label><button class="btn sm">Import</button></form>
    </div>
  </section>
  <form method="post" action="/admin/products/${p.id}/delete" class="danger-zone" data-confirm="Delete this product permanently? Past orders keep their records.">${csrfField(csrf)}<button class="btn sm danger">Delete product</button></form>`}`;
}

function messages({ rows, csrf }) {
  return html`<h1>Messages</h1>${rows.length ? rows.map((m) => html`<article class="panel msg ${m.is_read ? '' : 'unread'}">
    <header><strong>${m.name}</strong> &lt;<a href="mailto:${m.email}?subject=${encodeURIComponent('Re: your message')}">${m.email}</a>&gt; ${m.order_number ? html`· order ${m.order_number}` : ''}<small class="muted">${dt(m.created_at)}</small></header>
    <p class="pre">${m.body}</p>
    <div class="row"><a class="btn sm" href="mailto:${m.email}">Reply by email</a>
    ${m.is_read ? '' : html`<form method="post" action="/admin/messages/${m.id}/read" class="inline">${csrfField(csrf)}<button class="btn sm ghost">Mark read</button></form>`}
    <form method="post" action="/admin/messages/${m.id}/delete" class="inline" data-confirm="Delete message?">${csrfField(csrf)}<button class="btn sm ghost danger">Delete</button></form></div></article>`) : html`<p class="muted">No messages yet.</p>`}`;
}

function subscribers({ rows }) {
  return html`<h1>Subscribers <a class="btn sm ghost" href="/admin/subscribers.csv">Export CSV</a></h1>${table(['Email', 'Joined'], rows.map((r) => [r.email, dt(r.created_at)]))}`;
}

function settingsPage({ s, stripe, webhookSet, csrf, baseUrl, envKey }) {
  return html`<h1>Settings</h1>
  <section class="panel"><h2>Payments (Stripe)</h2>
    <p>Status: ${stripe.mode === 'missing' ? html`<span class="pill st-cancelled">not connected</span> — checkout is disabled until a key is added.` : html`<span class="pill st-paid">${stripe.mode} mode</span> key ending <code>…${stripe.last4}</code>${envKey ? ' (from environment variable)' : ''}`}</p>
    ${envKey ? '' : html`<form method="post" action="/admin/settings/stripe" class="stack" autocomplete="off">${csrfField(csrf)}
      <label>Stripe secret key or restricted key<input name="stripe_secret_key" type="password" maxlength="200" placeholder="sk_live_… or rk_live_…" autocomplete="off" spellcheck="false"></label>
      <p class="muted small">Find it in Stripe → Developers → API keys. A <strong>restricted key</strong> with write access to <em>Checkout Sessions</em> and read access to <em>Payment Intents</em> is safest. Keys are encrypted at rest and never shown again.</p>
      <label>Webhook signing secret (optional)<input name="stripe_webhook_secret" type="password" maxlength="200" placeholder="whsec_… (${webhookSet ? 'set' : 'not set'})" autocomplete="off"></label>
      <p class="muted small">Optional. Endpoint URL: <code>${baseUrl}/stripe/webhook</code> — events: checkout.session.completed, checkout.session.expired, charge.refunded. Without it, orders are still confirmed automatically every minute.</p>
      <div class="row"><button class="btn">Save payment settings</button><button class="btn ghost" name="remove" value="1" data-confirm="Disconnect Stripe? Checkout will stop working.">Disconnect</button></div>
    </form>`}
  </section>
  <section class="panel"><h2>Store</h2>
    <form method="post" action="/admin/settings" class="stack">${csrfField(csrf)}
      <label>Store name<input name="store_name" maxlength="60" value="${s.store_name}" required></label>
      <label>Announcement bar<input name="announcement" maxlength="160" value="${s.announcement}"></label>
      <label>Homepage headline<input name="hero_title" maxlength="80" value="${s.hero_title}"></label>
      <label>Homepage subtitle<input name="hero_subtitle" maxlength="200" value="${s.hero_subtitle}"></label>
      <label>Christmas order cutoff (shown to customers)<input name="christmas_cutoff" maxlength="40" value="${s.christmas_cutoff}"></label>
      <label>Support email (shown on contact page, optional)<input name="support_email" type="email" maxlength="200" value="${s.support_email}"></label>
      <label>Meta (Facebook) Pixel ID (optional)<input name="meta_pixel_id" inputmode="numeric" pattern="[0-9]{6,20}" maxlength="20" value="${s.meta_pixel_id}"></label>
      <label class="check"><input type="checkbox" name="checkout_enabled" value="true" ${s.checkout_enabled !== 'false' ? raw('checked') : ''}> Checkout enabled</label>
      <button class="btn">Save store settings</button>
    </form>
  </section>`;
}

function security({ admin, sessions, audit, csrf, totpSetup }) {
  return html`<h1>Security</h1>
  <section class="panel"><h2>Change password</h2>
    <form method="post" action="/admin/security/password" class="stack narrow">${csrfField(csrf)}
      <label>Current password<input name="current" type="password" required autocomplete="current-password" maxlength="200"></label>
      <label>New password<input name="password" type="password" required minlength="12" autocomplete="new-password" maxlength="200"></label>
      <label>Confirm new password<input name="password2" type="password" required minlength="12" autocomplete="new-password" maxlength="200"></label>
      <button class="btn">Update password</button><p class="muted small">Changing your password signs out all other sessions.</p>
    </form>
  </section>
  <section class="panel"><h2>Two-factor authentication</h2>
    ${admin.totpEnabled ? html`<p><span class="pill st-paid">enabled</span> An authenticator code is required at sign-in.</p>
      <form method="post" action="/admin/security/totp/disable" class="stack narrow">${csrfField(csrf)}<label>Current password<input name="current" type="password" required maxlength="200" autocomplete="current-password"></label><button class="btn ghost danger">Disable 2FA</button></form>`
    : totpSetup ? html`<p>Add this key to Google Authenticator, 1Password, Authy or similar (choose “enter a setup key”, time-based):</p>
      <p><code class="secret">${totpSetup.secret.replace(/(.{4})/g, '$1 ').trim()}</code></p><p class="muted small">Or use this otpauth link on a phone: <code class="wrapcode">${totpSetup.uri}</code></p>
      <form method="post" action="/admin/security/totp/enable" class="stack narrow">${csrfField(csrf)}<input type="hidden" name="secret" value="${totpSetup.secret}"><label>6-digit code from the app<input name="code" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"></label><button class="btn">Turn on 2FA</button></form>`
    : html`<p class="muted">Protect the admin with a second factor from an authenticator app.</p><form method="post" action="/admin/security/totp/setup">${csrfField(csrf)}<button class="btn">Set up 2FA</button></form>`}
  </section>
  <section class="panel"><h2>Active sessions</h2>${table(['Signed in', 'Last active', 'IP', 'Device'], sessions.map((s) => [dt(s.created_at), dt(s.last_seen), s.ip || '', (s.user_agent || '').slice(0, 60)]))}
    <form method="post" action="/admin/security/sessions/revoke">${csrfField(csrf)}<button class="btn sm ghost">Sign out all other sessions</button></form></section>
  <section class="panel"><h2>Audit log</h2>${table(['When', 'Action', 'Detail', 'IP'], audit.map((a) => [dt(a.created_at), a.action, a.detail || '', a.ip || '']))}</section>`;
}

module.exports = { layout, login, setup, dashboard, orders, orderDetail, products, productEdit, messages, subscribers, settingsPage, security, STATUSES, setAssetVersion };
