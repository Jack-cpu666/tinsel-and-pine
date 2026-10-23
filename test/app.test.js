'use strict';
// Integration tests. Requires a Postgres database at TEST_DATABASE_URL.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:pw@localhost:5433/shop_test';
process.env.NODE_ENV = 'test';
process.env.APP_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BASE_URL = 'http://localhost';

const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const { createApp } = require('../src/server');
const { seedIfEmpty } = require('../src/seed');
const auth = require('../src/auth');
const orders = require('../src/services/orders');
const settings = require('../src/services/settings');
const { html, raw } = require('../src/views/html');

let server, base;
const jar = {};

async function req(path, { method = 'GET', body, form, headers = {}, cookie = true } = {}) {
  const h = { ...headers };
  if (cookie && jar.c) h.cookie = jar.c;
  let payload;
  if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
  if (body) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (method !== 'GET') h.origin = h.origin || base;
  const r = await fetch(base + path, { method, headers: h, body: payload, redirect: 'manual' });
  const set = r.headers.get('set-cookie');
  if (set && cookie) jar.c = set.split(';')[0];
  const text = await r.text();
  return { status: r.status, text, headers: r.headers, json: () => JSON.parse(text) };
}

test.before(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  await seedIfEmpty();
  await auth.ensureSetupToken();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await db.pool.end();
});

test('html template escapes interpolations', () => {
  assert.strictEqual(String(html`<p>${'<script>alert(1)</script>'}</p>`), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.strictEqual(String(html`<p>${raw('<b>ok</b>')}</p>`), '<p><b>ok</b></p>');
  assert.strictEqual(String(html`<a title="${'" onmouseover="x'}">`), '<a title="&quot; onmouseover=&quot;x">');
});

test('seed created 15 products priced at 2x supplier cost', async () => {
  const n = await db.one(`SELECT count(*)::int AS n FROM products WHERE status = 'active'`);
  assert.strictEqual(n.n, 15);
  const bad = await db.many('SELECT * FROM variants WHERE cost_cents IS NULL OR price_cents < cost_cents * 2');
  assert.deepStrictEqual(bad, []);
});

test('storefront pages render with security headers', async () => {
  for (const p of ['/', '/shop', '/shop/lights', '/products/snow-globe-lantern-music-box', '/cart', '/faq', '/privacy']) {
    const r = await req(p, { cookie: false });
    assert.strictEqual(r.status, 200, p);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self' 'nonce-/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(!r.headers.get('x-powered-by'));
  }
  const r = await req('/shop?q=%3Cscript%3E', { cookie: false });
  assert.ok(!r.text.includes('<script>alert'), 'search query is escaped');
  assert.ok(r.text.includes('&lt;script&gt;'));
});

test('unknown pages 404', async () => {
  assert.strictEqual((await req('/products/does-not-exist', { cookie: false })).status, 404);
  assert.strictEqual((await req('/shop/nope', { cookie: false })).status, 404);
});

test('cart API prices from the database, not the client', async () => {
  const v = await db.one('SELECT id, price_cents FROM variants ORDER BY id LIMIT 1');
  const r = await req('/api/cart', { method: 'POST', body: { lines: [{ variantId: v.id, qty: 2, price: 1 }] }, cookie: false });
  const j = r.json();
  assert.strictEqual(j.subtotal, v.price_cents * 2);
});

test('checkout without Stripe key fails gracefully', async () => {
  const v = await db.one('SELECT id FROM variants ORDER BY id LIMIT 1');
  const r = await req('/api/checkout', { method: 'POST', body: { lines: [{ variantId: v.id, qty: 1 }] }, cookie: false });
  assert.strictEqual(r.status, 503);
  assert.match(r.json().error, /set up/);
});

test('priceCart rejects bad input and enforces stock', async () => {
  await assert.rejects(orders.priceCart([]), /empty/);
  await assert.rejects(orders.priceCart([{ variantId: -1, qty: 1 }]), /Invalid/);
  await assert.rejects(orders.priceCart([{ variantId: 999999, qty: 1 }]), /no longer available/);
  const v = await db.one('SELECT id FROM variants ORDER BY id LIMIT 1');
  await db.query('UPDATE variants SET inventory = 1 WHERE id = $1', [v.id]);
  await assert.rejects(orders.priceCart([{ variantId: v.id, qty: 2 }]), /Only 1 left/);
  await db.query('UPDATE variants SET inventory = 500 WHERE id = $1', [v.id]);
  const ok = await orders.priceCart([{ variantId: v.id, qty: 1 }, { variantId: v.id, qty: 2 }]);
  assert.strictEqual(ok.lines.length, 1);
  assert.strictEqual(ok.lines[0].qty, 3);
});

test('applySession marks paid once, decrements inventory once', async () => {
  const v = await db.one('SELECT id, price_cents, inventory FROM variants ORDER BY id LIMIT 1');
  const o = await db.one(`INSERT INTO orders(number, public_token, status, subtotal_cents, total_cents, stripe_session_id)
     VALUES ('TP-TEST01', 'tok_aaaaaaaaaaaaaaaaaaaaaaaa', 'pending', $1, $1, 'cs_test_1') RETURNING id`, [v.price_cents * 2]);
  await db.query(`INSERT INTO order_items(order_id, variant_id, product_name, unit_cents, quantity) VALUES ($1,$2,'X',$3,2)`, [o.id, v.id, v.price_cents]);
  const session = {
    id: 'cs_test_1', status: 'complete', payment_status: 'paid', amount_total: v.price_cents * 2, payment_intent: 'pi_1',
    metadata: { order_id: String(o.id) }, customer_details: { email: 'a@b.co', name: 'Ann' },
    collected_information: { shipping_details: { name: 'Ann Lee', address: { line1: '1 Main', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' } } },
  };
  await orders.applySession(session);
  await orders.applySession(session);
  const after = await db.one('SELECT status, email, inventory_applied, shipping_address FROM orders WHERE id = $1', [o.id]);
  assert.strictEqual(after.status, 'paid');
  assert.strictEqual(after.email, 'a@b.co');
  assert.strictEqual(after.shipping_address.city, 'Austin');
  const inv = await db.one('SELECT inventory FROM variants WHERE id = $1', [v.id]);
  assert.strictEqual(inv.inventory, v.inventory - 2);
  // public order page shows the items, order tracking works with email
  const page = await req('/order/tok_aaaaaaaaaaaaaaaaaaaaaaaa', { cookie: false });
  assert.strictEqual(page.status, 200);
  assert.match(page.text, /TP-TEST01/);
  const tr = await req('/track', { method: 'POST', form: { number: 'tp-test01', email: 'A@B.co' }, cookie: false });
  assert.strictEqual(tr.status, 303);
  const bad = await req('/track', { method: 'POST', form: { number: 'TP-TEST01', email: 'x@y.co' }, cookie: false });
  assert.strictEqual(bad.status, 404);
});

test('expired session marks pending order expired', async () => {
  const o = await db.one(`INSERT INTO orders(number, public_token, status, subtotal_cents, total_cents, stripe_session_id)
     VALUES ('TP-TEST02', 'tok_bbbbbbbbbbbbbbbbbbbbbbbb', 'pending', 100, 100, 'cs_test_2') RETURNING id`);
  await orders.applySession({ id: 'cs_test_2', status: 'expired', payment_status: 'unpaid', metadata: { order_id: String(o.id) } });
  assert.strictEqual((await db.one('SELECT status FROM orders WHERE id = $1', [o.id])).status, 'expired');
});

test('admin is protected and setup requires the one-time token', async () => {
  assert.strictEqual((await req('/admin', { cookie: false })).status, 302);
  assert.strictEqual((await req('/admin/setup?token=wrong', { cookie: false })).status, 404);
  const r = await req('/admin/setup', { method: 'POST', form: { token: 'nope', email: 'x@y.co', password: 'abcdefgh1234', password2: 'abcdefgh1234' }, cookie: false });
  assert.strictEqual(r.status, 404);
});

test('admin setup, CSRF, login lockout and session flow', async () => {
  const token = await auth.ensureSetupToken();
  const weak = await req('/admin/setup', { method: 'POST', form: { token, email: 'owner@shop.co', password: 'short', password2: 'short' } });
  assert.strictEqual(weak.status, 400);
  const ok = await req('/admin/setup', { method: 'POST', form: { token, email: 'owner@shop.co', password: 'Very-strong-pass-42', password2: 'Very-strong-pass-42' } });
  assert.strictEqual(ok.status, 303);
  assert.match(jar.c, /tp_admin=/);
  // token is single use
  assert.strictEqual((await req(`/admin/setup?token=${token}`, { cookie: false })).status, 404);

  const dash = await req('/admin');
  assert.strictEqual(dash.status, 200);
  assert.match(dash.text, /Checkout is OFF/);
  const csrf = dash.text.match(/data-csrf="([^"]+)"/)[1];

  // POST without CSRF token is rejected
  const noCsrf = await req('/admin/settings', { method: 'POST', form: { store_name: 'Hacked', hero_title: 'x', hero_subtitle: 'x', christmas_cutoff: 'x' } });
  assert.strictEqual(noCsrf.status, 403);
  // cross-origin POST rejected even with token
  const xo = await req('/admin/settings', { method: 'POST', headers: { origin: 'https://evil.example' }, form: { _csrf: csrf, store_name: 'Hacked', hero_title: 'x', hero_subtitle: 'x', christmas_cutoff: 'x' } });
  assert.strictEqual(xo.status, 403);
  const good = await req('/admin/settings', { method: 'POST', form: { _csrf: csrf, store_name: 'Tinsel & Pine', announcement: 'Hi', hero_title: 'Glow', hero_subtitle: 'Sub', christmas_cutoff: 'December 5', checkout_enabled: 'true' } });
  assert.strictEqual(good.status, 303);
  assert.strictEqual((await settings.all()).hero_title, 'Glow');

  // product + variant editing
  const prod = await db.one('SELECT id FROM products ORDER BY id LIMIT 1');
  const pv = await db.one('SELECT id, cost_cents FROM variants WHERE product_id = $1 ORDER BY id LIMIT 1', [prod.id]);
  const vf = { _csrf: csrf, multiplier: '3' };
  vf[`v[k${pv.id}][option1]`] = 'Style A'; vf[`v[k${pv.id}][price]`] = '1.00'; vf[`v[k${pv.id}][cost]`] = (pv.cost_cents / 100).toFixed(2);
  vf[`v[k${pv.id}][inventory]`] = '7'; vf[`v[k${pv.id}][active]`] = '1';
  const vr = await req(`/admin/products/${prod.id}/variants`, { method: 'POST', form: vf });
  assert.strictEqual(vr.status, 303);
  const pv2 = await db.one('SELECT price_cents, inventory FROM variants WHERE id = $1', [pv.id]);
  assert.strictEqual(pv2.inventory, 7);
  assert.strictEqual(pv2.price_cents % 100, 99);
  assert.ok(pv2.price_cents >= pv.cost_cents * 3);

  // order fulfilment update + XSS-safe rendering
  const o = await db.one(`SELECT id FROM orders WHERE number = 'TP-TEST01'`);
  const up = await req(`/admin/orders/${o.id}`, { method: 'POST', form: { _csrf: csrf, status: 'shipped', carrier: 'USPS', tracking_number: '<img src=x>', tracking_url: 'javascript:alert(1)', notes: '' } });
  assert.strictEqual(up.status, 303);
  assert.match(up.headers.get('location'), /e=/, 'javascript: URL rejected');
  await req(`/admin/orders/${o.id}`, { method: 'POST', form: { _csrf: csrf, status: 'shipped', carrier: 'USPS', tracking_number: '<img src=x>', tracking_url: 'https://tools.usps.com/x', notes: '' } });
  const detail = await req(`/admin/orders/${o.id}`);
  assert.ok(!detail.text.includes('<img src=x>'));
  const csv = await req('/admin/orders.csv');
  assert.match(csv.text, /TP-TEST01/);

  // logout invalidates the session server-side
  const saved = jar.c;
  await req('/admin/logout', { method: 'POST', form: { _csrf: csrf } });
  jar.c = saved;
  assert.strictEqual((await req('/admin')).status, 302);

  // lockout after 5 bad passwords
  for (let i = 0; i < 5; i++) await req('/admin/login', { method: 'POST', form: { email: 'owner@shop.co', password: 'wrong-password-1' }, cookie: false });
  const locked = await req('/admin/login', { method: 'POST', form: { email: 'owner@shop.co', password: 'Very-strong-pass-42' }, cookie: false });
  assert.strictEqual(locked.status, 401);
  assert.match(locked.text, /locked/);
  await db.query('UPDATE admins SET locked_until = NULL');
  const login = await req('/admin/login', { method: 'POST', form: { email: 'owner@shop.co', password: 'Very-strong-pass-42', next: '//evil.com' } });
  assert.strictEqual(login.status, 303);
  assert.strictEqual(login.headers.get('location'), '/admin', 'open redirect blocked');
});

test('TOTP verification', () => {
  const secret = auth.newTotpSecret();
  const code = auth.totpAt(secret, Math.floor(Date.now() / 30000));
  assert.ok(auth.verifyTotp(secret, code));
  assert.ok(!auth.verifyTotp(secret, '000000') || code === '000000');
  assert.ok(!auth.verifyTotp(secret, 'abc'));
});

test('settings secrets are encrypted at rest', async () => {
  await settings.setSecret('stripe_secret_key', 'sk_test_abcdefghijklmnop');
  const row = await db.one(`SELECT value FROM settings WHERE key = 'stripe_secret_key'`);
  assert.ok(!row.value.includes('sk_test'));
  assert.strictEqual(await settings.getSecret('stripe_secret_key'), 'sk_test_abcdefghijklmnop');
  await settings.setSecret('stripe_secret_key', '');
});

test('image import refuses non-allowlisted hosts (SSRF guard)', () => {
  const images = require('../src/services/images');
  assert.ok(images.hostAllowed('https://ae-pic-a1.aliexpress-media.com/kf/x.jpg'));
  assert.ok(!images.hostAllowed('http://ae-pic-a1.aliexpress-media.com/kf/x.jpg'));
  assert.ok(!images.hostAllowed('https://169.254.169.254/latest'));
  assert.ok(!images.hostAllowed('https://evil.com/aliexpress-media.com.jpg'));
  assert.ok(!images.hostAllowed('https://aliexpress-media.com.evil.com/x.jpg'));
});

test('contact form stores message, honeypot drops bots', async () => {
  const r = await req('/contact', { method: 'POST', form: { name: 'Bo', email: 'bo@x.co', body: 'Where is my order?' }, cookie: false });
  assert.strictEqual(r.status, 303);
  const bot = await req('/contact', { method: 'POST', form: { name: 'Bot', email: 'bot@x.co', body: 'spam spam', website: 'http://spam' }, cookie: false });
  assert.strictEqual(bot.status, 303);
  const n = await db.one('SELECT count(*)::int AS n FROM messages');
  assert.strictEqual(n.n, 1);
});
