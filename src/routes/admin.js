'use strict';
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const auth = require('../auth');
const A = require('../views/admin');
const settings = require('../services/settings');
const analytics = require('../services/analytics');
const ordersSvc = require('../services/orders');
const images = require('../services/images');
const stripeSvc = require('../services/stripe');
const { limiters } = require('../security');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: images.MAX_BYTES, files: 10 } });

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

function page(res, opts) {
  const flash = res.locals.flash || null;
  res.type('html').send(String(A.layout({ ...opts, nonce: res.locals.nonce, admin: res.locals.admin, csrf: res.locals.csrf, flash })));
}

// Flash messages via a short-lived, signed-free cookie containing only a fixed key.
const FLASH = {
  saved: ['Saved.', 'ok'], created: ['Created.', 'ok'], deleted: ['Deleted.', 'ok'], uploaded: ['Images uploaded.', 'ok'], imported: ['Image imported.', 'ok'],
  pw: ['Password updated. Other sessions were signed out.', 'ok'], totp_on: ['Two-factor authentication is on.', 'ok'], totp_off: ['Two-factor authentication turned off.', 'ok'],
  revoked: ['Other sessions signed out.', 'ok'], stripe: ['Payment settings saved.', 'ok'], stripe_off: ['Stripe disconnected.', 'ok'], synced: ['Checked with Stripe.', 'ok'],
};
router.use((req, res, next) => {
  const k = req.query && typeof req.query.m === 'string' ? req.query.m : null;
  if (k && FLASH[k]) res.locals.flash = { msg: FLASH[k][0], type: FLASH[k][1] };
  if (req.query && typeof req.query.e === 'string') res.locals.flash = { msg: String(req.query.e).slice(0, 200), type: 'err' };
  next();
});
const back = (res, url, m) => res.redirect(303, url + (url.includes('?') ? '&' : '?') + 'm=' + m);
const backErr = (res, url, e) => res.redirect(303, url + (url.includes('?') ? '&' : '?') + 'e=' + encodeURIComponent(e));

const cents = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = String(v).trim().replace(/^\$/, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
};
const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);

// ---------------- setup & login (public) ----------------
router.get('/setup', async (req, res) => {
  const token = String(req.query.token || '');
  if (!auth.checkSetupToken(token)) return res.status(404).send('Not found');
  page(res, { title: 'Setup', body: A.setup({ token }) });
});

router.post('/setup', limiters.login, async (req, res) => {
  const { token, email, password, password2 } = req.body || {};
  if (!auth.checkSetupToken(String(token || ''))) return res.status(404).send('Not found');
  const em = String(email || '').trim().toLowerCase();
  const fail = (error) => page(res.status(400), { title: 'Setup', body: A.setup({ token, error, email: em }) });
  if (!z.string().email().max(200).safeParse(em).success) return fail('Enter a valid email address.');
  const problems = auth.passwordProblems(password, em);
  if (problems.length) return fail('Password needs ' + problems.join(', ') + '.');
  if (password !== password2) return fail('Passwords do not match.');
  const created = await db.tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(4242003)');
    const n = (await c.query('SELECT count(*)::int AS n FROM admins')).rows[0].n;
    if (n > 0) return null;
    const hash = await auth.hashPassword(password);
    return (await c.query('INSERT INTO admins(email, password_hash) VALUES ($1,$2) RETURNING id', [em, hash])).rows[0];
  });
  auth.clearSetupToken();
  if (!created) return res.redirect(303, '/admin/login');
  const tokenStr = await auth.createSession(created.id, req);
  auth.setSessionCookie(res, tokenStr);
  await db.query('INSERT INTO audit_log(admin_id, action, ip) VALUES ($1,$2,$3)', [created.id, 'owner account created', req.ip]);
  res.redirect(303, '/admin/security?m=created');
});

router.get('/login', async (req, res) => {
  if (await auth.loadSession(req)) return res.redirect(303, '/admin');
  page(res, { title: 'Sign in', body: A.login({ next: typeof req.query.next === 'string' ? req.query.next : '' }) });
});

router.post('/login', limiters.login, async (req, res) => {
  const { email, password, totp } = req.body || {};
  let next = String((req.body && req.body.next) || '');
  if (!/^\/admin(\/|$|\?)/.test(next) || next.startsWith('//')) next = '/admin';
  const r = await auth.attemptLogin(email, password, totp, req);
  if (!r.ok) return page(res.status(401), { title: 'Sign in', body: A.login({ error: r.error, email: String(email || '').slice(0, 200), next, needTotp: r.needTotp }) });
  const token = await auth.createSession(r.admin.id, req);
  auth.setSessionCookie(res, token);
  await db.query('INSERT INTO audit_log(admin_id, action, ip) VALUES ($1,$2,$3)', [r.admin.id, 'signed in', req.ip]);
  res.redirect(303, next);
});

// ---------------- everything below requires a session ----------------
router.use(auth.requireAdmin());

router.post('/logout', async (req, res) => {
  await auth.destroySession(req);
  auth.clearSessionCookie(res);
  res.redirect(303, '/admin/login');
});

router.get('/', async (req, res) => {
  const days = [1, 7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const [a, recent, key, queue, unread] = await Promise.all([
    analytics.summary(days),
    db.many(`SELECT o.*, (SELECT sum(quantity)::int FROM order_items i WHERE i.order_id = o.id) AS item_count FROM orders o
              WHERE status NOT IN ('pending','expired') ORDER BY created_at DESC LIMIT 10`),
    stripeSvc.secretKey(),
    db.one('SELECT count(*)::int AS n FROM image_queue WHERE attempts < 5'),
    db.one('SELECT count(*)::int AS n FROM messages WHERE NOT is_read'),
  ]);
  const alerts = [];
  if (!key) alerts.push({ type: 'err', msg: 'Checkout is OFF: no Stripe key is connected yet.', href: '/admin/settings', cta: 'Connect Stripe →' });
  else if (stripeSvc.keyMode(key) === 'test') alerts.push({ type: 'warn', msg: 'Stripe is in TEST mode — real cards will not be charged.', href: '/admin/settings', cta: 'Switch to live →' });
  if (queue.n) alerts.push({ type: 'warn', msg: `${queue.n} product image(s) are still downloading.` });
  const toShip = await db.one(`SELECT count(*)::int AS n FROM orders WHERE status IN ('paid','processing')`);
  if (toShip.n) alerts.push({ type: 'ok', msg: `${toShip.n} order(s) waiting to be fulfilled.`, href: '/admin/orders?status=paid', cta: 'View →' });
  page(res, { title: 'Dashboard', active: 'dash', body: A.dashboard({ a, recent, alerts, unread: unread.n }) });
});

// ---------------- orders ----------------
router.get('/orders', async (req, res) => {
  const status = A.STATUSES.includes(req.query.status) ? req.query.status : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const params = [];
  const where = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); } else where.push(`status NOT IN ('pending','expired')`);
  if (q) { params.push('%' + q.replace(/[%_\\]/g, (m) => '\\' + m) + '%'); where.push(`(number ILIKE $${params.length} OR email ILIKE $${params.length} OR customer_name ILIKE $${params.length})`); }
  const [rows, counts] = await Promise.all([
    db.many(`SELECT o.*, (SELECT sum(quantity)::int FROM order_items i WHERE i.order_id = o.id) AS item_count FROM orders o WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 300`, params),
    db.many('SELECT status, count(*)::int AS n FROM orders GROUP BY status'),
  ]);
  page(res, { title: 'Orders', active: 'orders', body: A.orders({ rows, status, q, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) }) });
});

const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

router.get('/orders.csv', async (req, res) => {
  const rows = await db.many(`SELECT o.number, o.status, o.created_at, o.paid_at, o.email, o.customer_name, o.phone, o.shipping_address, o.total_cents, o.tracking_number,
    (SELECT string_agg(i.quantity || ' x ' || i.product_name || COALESCE(' (' || i.variant_name || ')', ''), '; ') FROM order_items i WHERE i.order_id = o.id) AS items
    FROM orders o WHERE status NOT IN ('pending','expired') ORDER BY created_at DESC`);
  const head = ['number', 'status', 'created_at', 'paid_at', 'email', 'name', 'phone', 'address', 'total', 'tracking', 'items'];
  const lines = [head.join(',')].concat(rows.map((r) => {
    const a = r.shipping_address;
    const addr = a ? [a.line1, a.line2, a.city, a.state, a.postal_code, a.country].filter(Boolean).join(', ') : '';
    return [r.number, r.status, r.created_at && r.created_at.toISOString(), r.paid_at && r.paid_at.toISOString(), r.email, r.customer_name, r.phone, addr, (r.total_cents / 100).toFixed(2), r.tracking_number, r.items].map(csvCell).join(',');
  }));
  await auth.audit(req, 'exported orders CSV');
  res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
  res.type('text/csv').send(lines.join('\n'));
});

router.get('/orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).send('Not found');
  const o = await db.one('SELECT * FROM orders WHERE id = $1', [id]);
  if (!o) return res.status(404).send('Not found');
  const [items, events] = await Promise.all([ordersSvc.items(id), db.many('SELECT * FROM order_events WHERE order_id = $1 ORDER BY created_at DESC', [id])]);
  page(res, { title: o.number, active: 'orders', body: A.orderDetail({ o, items, events, csrf: res.locals.csrf }) });
});

const orderUpdate = z.object({
  status: z.enum(A.STATUSES),
  supplier_order_ref: z.string().trim().max(100).optional().default(''),
  carrier: z.string().trim().max(60).optional().default(''),
  tracking_number: z.string().trim().max(100).optional().default(''),
  tracking_url: z.union([z.literal(''), z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'http(s) only')]).optional().default(''),
  notes: z.string().max(4000).optional().default(''),
});
router.post('/orders/:id', async (req, res) => {
  const id = Number(req.params.id);
  const parsed = orderUpdate.safeParse(req.body || {});
  if (!parsed.success) return backErr(res, `/admin/orders/${id}`, 'Please check the fields (tracking URL must start with https://).');
  const d = parsed.data;
  const o = await db.one('SELECT * FROM orders WHERE id = $1', [id]);
  if (!o) return res.status(404).send('Not found');
  await db.query(
    `UPDATE orders SET status = $2, supplier_order_ref = NULLIF($3,''), carrier = NULLIF($4,''), tracking_number = NULLIF($5,''), tracking_url = NULLIF($6,''), notes = NULLIF($7,''),
       shipped_at = CASE WHEN $2 = 'shipped' AND shipped_at IS NULL THEN now() ELSE shipped_at END, updated_at = now() WHERE id = $1`,
    [id, d.status, d.supplier_order_ref, d.carrier, d.tracking_number, d.tracking_url, d.notes]);
  if (o.status !== d.status) await ordersSvc.addEvent(id, 'status', `Status changed from ${o.status} to ${d.status} by ${req.admin.email}`);
  if ((o.tracking_number || '') !== d.tracking_number && d.tracking_number) await ordersSvc.addEvent(id, 'tracking', `Tracking added: ${d.carrier ? d.carrier + ' ' : ''}${d.tracking_number}`);
  await auth.audit(req, 'updated order', o.number);
  back(res, `/admin/orders/${id}`, 'saved');
});

router.post('/orders/:id/sync', async (req, res) => {
  const id = Number(req.params.id);
  const o = await db.one('SELECT * FROM orders WHERE id = $1', [id]);
  if (!o) return res.status(404).send('Not found');
  try { await ordersSvc.syncOrderFromStripe(o); } catch (e) { return backErr(res, `/admin/orders/${id}`, 'Stripe check failed: ' + e.message); }
  back(res, `/admin/orders/${id}`, 'synced');
});

// ---------------- products ----------------
router.get('/products', async (req, res) => {
  const rows = await db.many(`SELECT p.id, p.name, p.status, p.featured,
      (SELECT count(*)::int FROM variants v WHERE v.product_id = p.id) AS variants,
      (SELECT min(price_cents) FROM variants v WHERE v.product_id = p.id) AS min_price,
      (SELECT max(price_cents) FROM variants v WHERE v.product_id = p.id) AS max_price,
      (SELECT COALESCE(sum(inventory),0)::int FROM variants v WHERE v.product_id = p.id AND v.active) AS stock,
      (SELECT COALESCE(sum(i.quantity),0)::int FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.product_id = p.id AND o.status IN ('paid','processing','shipped','delivered')) AS sold,
      (SELECT id FROM images i WHERE i.product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image_id,
      (SELECT count(*)::int FROM image_queue q WHERE q.product_id = p.id AND q.attempts < 5) AS queued
    FROM products p ORDER BY p.status, p.sort_order, p.id`);
  page(res, { title: 'Products', active: 'products', body: A.products({ rows, csrf: res.locals.csrf }) });
});

router.get('/products/new', async (req, res) => {
  const categories = await db.many('SELECT * FROM categories ORDER BY sort_order');
  page(res, { title: 'New product', active: 'products', body: A.productEdit({ p: { status: 'draft', bullets: [] }, variants: [], images: [], categories, csrf: res.locals.csrf }) });
});

const productSchema = z.object({
  name: z.string().trim().min(1).max(140),
  slug: z.string().trim().max(120).optional().default(''),
  tagline: z.string().trim().max(200).optional().default(''),
  description: z.string().trim().max(6000).optional().default(''),
  bullets: z.string().max(3000).optional().default(''),
  category_id: z.string().optional().default(''),
  status: z.enum(['active', 'draft', 'archived']),
  sort_order: z.coerce.number().int().min(-1000).max(100000).optional().default(0),
  option_name: z.string().trim().max(40).optional().default(''),
  option2_name: z.string().trim().max(40).optional().default(''),
  ship_estimate: z.string().trim().max(60).optional().default('3-5 business days'),
  supplier_url: z.union([z.literal(''), z.string().trim().url().max(500)]).optional().default(''),
  featured: z.string().optional(),
});

function productValues(d) {
  return [d.name, slugify(d.slug || d.name), d.tagline, d.description,
    JSON.stringify(d.bullets.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 12)),
    d.category_id ? Number(d.category_id) || null : null, d.status, d.sort_order, d.option_name || null, d.option2_name || null,
    d.ship_estimate || '3-5 business days', d.supplier_url || null, d.featured === '1'];
}

router.post('/products/new', async (req, res) => {
  const parsed = productSchema.safeParse(req.body || {});
  const price = cents(req.body && req.body.price);
  const cost = cents(req.body && req.body.cost);
  if (!parsed.success || !price || Number.isNaN(price) || price < 50 || Number.isNaN(cost)) return backErr(res, '/admin/products/new', 'Please check the fields (name and a price of at least $0.50 are required).');
  try {
    const p = await db.tx(async (c) => {
      const r = await c.query(
        `INSERT INTO products(name, slug, tagline, description, bullets, category_id, status, sort_order, option_name, option2_name, ship_estimate, supplier_url, featured)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, productValues(parsed.data));
      const inv = Math.max(0, Math.min(1_000_000, Number(req.body.inventory) || 0));
      await c.query('INSERT INTO variants(product_id, option1, price_cents, cost_cents, inventory) VALUES ($1,$2,$3,$4,$5)', [r.rows[0].id, 'Default', price, cost, inv]);
      return r.rows[0];
    });
    await auth.audit(req, 'created product', parsed.data.name);
    back(res, `/admin/products/${p.id}`, 'created');
  } catch (e) {
    if (e.code === '23505') return backErr(res, '/admin/products/new', 'That URL slug is already used by another product.');
    throw e;
  }
});

router.get('/products/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).send('Not found');
  const p = await db.one('SELECT * FROM products WHERE id = $1', [id]);
  if (!p) return res.status(404).send('Not found');
  const [variants, imgs, categories, queue] = await Promise.all([
    db.many('SELECT * FROM variants WHERE product_id = $1 ORDER BY sort_order, id', [id]),
    db.many('SELECT id FROM images WHERE product_id = $1 ORDER BY sort_order, id', [id]),
    db.many('SELECT * FROM categories ORDER BY sort_order'),
    db.one('SELECT count(*)::int AS n FROM image_queue WHERE product_id = $1 AND attempts < 5', [id]),
  ]);
  page(res, { title: p.name, active: 'products', body: A.productEdit({ p, variants, images: imgs, categories, csrf: res.locals.csrf, queue: queue.n }) });
});

router.post('/products/:id', async (req, res) => {
  const id = Number(req.params.id);
  const parsed = productSchema.safeParse(req.body || {});
  if (!parsed.success) return backErr(res, `/admin/products/${id}`, 'Please check the fields.');
  try {
    const r = await db.query(
      `UPDATE products SET name=$1, slug=$2, tagline=$3, description=$4, bullets=$5, category_id=$6, status=$7, sort_order=$8, option_name=$9, option2_name=$10,
              ship_estimate=$11, supplier_url=$12, featured=$13, updated_at=now() WHERE id=$14`, [...productValues(parsed.data), id]);
    if (!r.rowCount) return res.status(404).send('Not found');
  } catch (e) {
    if (e.code === '23505') return backErr(res, `/admin/products/${id}`, 'That URL slug is already used by another product.');
    throw e;
  }
  await auth.audit(req, 'updated product', parsed.data.name);
  back(res, `/admin/products/${id}`, 'saved');
});

router.post('/products/:id/variants', async (req, res) => {
  const id = Number(req.params.id);
  const p = await db.one('SELECT id, name FROM products WHERE id = $1', [id]);
  if (!p) return res.status(404).send('Not found');
  const v = (req.body && req.body.v) || {};
  const mult = req.body && req.body.multiplier ? Number(req.body.multiplier) : null;
  if (mult !== null && (!Number.isFinite(mult) || mult < 1 || mult > 20)) return backErr(res, `/admin/products/${id}`, 'Multiplier must be between 1 and 20.');
  const imageIds = new Set((await db.many('SELECT id FROM images WHERE product_id = $1', [id])).map((r) => r.id));
  const errors = [];
  await db.tx(async (c) => {
    for (const [vid, f] of Object.entries(v)) {
      const variantId = Number(String(vid).replace(/^k/, ''));
      if (!/^k\d+$/.test(vid) || !Number.isInteger(variantId) || typeof f !== 'object') continue;
      if (f.delete === '1') {
        const used = await c.query('SELECT 1 FROM order_items WHERE variant_id = $1 LIMIT 1', [variantId]);
        if (used.rowCount) await c.query('UPDATE variants SET active = false WHERE id = $1 AND product_id = $2', [variantId, id]);
        else await c.query('DELETE FROM variants WHERE id = $1 AND product_id = $2', [variantId, id]);
        continue;
      }
      let price = cents(f.price);
      const compare = cents(f.compare);
      const cost = cents(f.cost);
      if (mult && cost) price = Math.ceil((cost * mult) / 100 + 0.0001) * 100 - 1;
      if (!price || Number.isNaN(price) || price < 50 || Number.isNaN(compare) || Number.isNaN(cost)) { errors.push(f.option1); continue; }
      const imageId = f.image_id && imageIds.has(Number(f.image_id)) ? Number(f.image_id) : null;
      await c.query(
        `UPDATE variants SET option1=$3, option2=$4, price_cents=$5, compare_at_cents=$6, cost_cents=$7, inventory=$8, image_id=$9, active=$10 WHERE id=$1 AND product_id=$2`,
        [variantId, id, String(f.option1 || 'Default').trim().slice(0, 80) || 'Default', f.option2 ? String(f.option2).trim().slice(0, 80) : null, price, compare, cost,
         Math.max(0, Math.min(1_000_000, Math.floor(Number(f.inventory) || 0))), imageId, f.active === '1']);
    }
    const n = (req.body && req.body.new) || {};
    if (n.option1 && String(n.option1).trim()) {
      const price = cents(n.price);
      if (!price || Number.isNaN(price) || price < 50) errors.push('new variant (needs a price of at least $0.50)');
      else {
        await c.query(`INSERT INTO variants(product_id, option1, option2, price_cents, compare_at_cents, cost_cents, inventory, sort_order)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(max(sort_order),0)+1 FROM variants WHERE product_id=$1))`,
          [id, String(n.option1).trim().slice(0, 80), n.option2 ? String(n.option2).trim().slice(0, 80) : null, price,
           Number.isNaN(cents(n.compare)) ? null : cents(n.compare), Number.isNaN(cents(n.cost)) ? null : cents(n.cost),
           Math.max(0, Math.min(1_000_000, Math.floor(Number(n.inventory) || 0)))]);
      }
    }
  });
  await auth.audit(req, 'updated variants', p.name);
  if (errors.length) return backErr(res, `/admin/products/${id}`, 'Some rows were not saved (invalid price): ' + errors.join(', '));
  back(res, `/admin/products/${id}`, 'saved');
});

router.post('/products/:id/delete', async (req, res) => {
  const id = Number(req.params.id);
  const p = await db.one('SELECT name FROM products WHERE id = $1', [id]);
  if (!p) return res.status(404).send('Not found');
  await db.query('DELETE FROM products WHERE id = $1', [id]);
  await auth.audit(req, 'deleted product', p.name);
  back(res, '/admin/products', 'deleted');
});

router.post('/products/:id/images', upload.array('files', 10), async (req, res) => {
  const id = Number(req.params.id);
  const p = await db.one('SELECT id, name FROM products WHERE id = $1', [id]);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files received.' });
  const maxSort = await db.one('SELECT COALESCE(max(sort_order), -1) AS m FROM images WHERE product_id = $1 AND sort_order < 100', [id]);
  let sort = maxSort.m + 1;
  const failed = [];
  for (const f of files) {
    if (!/^image\/(jpeg|png|webp)$/.test(f.mimetype)) { failed.push(f.originalname); continue; }
    try { await images.store({ productId: id, buf: f.buffer, alt: p.name, sortOrder: sort++ }); } catch { failed.push(f.originalname); }
  }
  await auth.audit(req, 'uploaded images', `${p.name} (${files.length - failed.length})`);
  if (failed.length) return res.status(400).json({ error: `Could not process: ${failed.join(', ')}` });
  res.json({ ok: true });
});

router.post('/products/:id/images/import', async (req, res) => {
  const id = Number(req.params.id);
  const url = String((req.body && req.body.url) || '').trim();
  if (!images.hostAllowed(url)) return backErr(res, `/admin/products/${id}`, 'Only https image links from AliExpress / Alibaba CDNs can be imported. Download other images and use Upload.');
  const p = await db.one('SELECT name FROM products WHERE id = $1', [id]);
  if (!p) return res.status(404).send('Not found');
  try {
    const maxSort = await db.one('SELECT COALESCE(max(sort_order), -1) AS m FROM images WHERE product_id = $1 AND sort_order < 100', [id]);
    await images.importFromUrl({ productId: id, url, alt: p.name, sortOrder: maxSort.m + 1 });
  } catch (e) {
    return backErr(res, `/admin/products/${id}`, 'Import failed: ' + e.message);
  }
  back(res, `/admin/products/${id}`, 'imported');
});

router.post('/images/:id/move', async (req, res) => {
  const id = Number(req.params.id);
  const im = await db.one('SELECT id, product_id FROM images WHERE id = $1', [id]);
  if (!im) return res.status(404).send('Not found');
  const list = await db.many('SELECT id FROM images WHERE product_id = $1 ORDER BY sort_order, id', [im.product_id]);
  const idx = list.findIndex((x) => x.id === id);
  const j = req.body && req.body.dir === 'up' ? idx - 1 : idx + 1;
  if (j >= 0 && j < list.length) [list[idx], list[j]] = [list[j], list[idx]];
  await db.tx(async (c) => { for (const [i, x] of list.entries()) await c.query('UPDATE images SET sort_order = $2 WHERE id = $1', [x.id, i]); });
  back(res, `/admin/products/${im.product_id}`, 'saved');
});

router.post('/images/:id/delete', async (req, res) => {
  const id = Number(req.params.id);
  const im = await db.one('SELECT product_id FROM images WHERE id = $1', [id]);
  if (!im) return res.status(404).send('Not found');
  await db.query('UPDATE variants SET image_id = NULL WHERE image_id = $1', [id]);
  await db.query('DELETE FROM images WHERE id = $1', [id]);
  await auth.audit(req, 'deleted image', String(id));
  back(res, `/admin/products/${im.product_id}`, 'deleted');
});

// ---------------- messages & subscribers ----------------
router.get('/messages', async (req, res) => {
  const rows = await db.many('SELECT * FROM messages ORDER BY is_read, created_at DESC LIMIT 300');
  page(res, { title: 'Messages', active: 'messages', body: A.messages({ rows, csrf: res.locals.csrf }) });
});
router.post('/messages/:id/read', async (req, res) => {
  await db.query('UPDATE messages SET is_read = true WHERE id = $1', [Number(req.params.id) || 0]);
  back(res, '/admin/messages', 'saved');
});
router.post('/messages/:id/delete', async (req, res) => {
  await db.query('DELETE FROM messages WHERE id = $1', [Number(req.params.id) || 0]);
  back(res, '/admin/messages', 'deleted');
});
router.get('/subscribers', async (req, res) => {
  const rows = await db.many('SELECT * FROM subscribers ORDER BY created_at DESC LIMIT 2000');
  page(res, { title: 'Subscribers', active: 'subs', body: A.subscribers({ rows }) });
});
router.get('/subscribers.csv', async (req, res) => {
  const rows = await db.many('SELECT email, created_at FROM subscribers ORDER BY created_at');
  await auth.audit(req, 'exported subscribers CSV');
  res.setHeader('Content-Disposition', 'attachment; filename="subscribers.csv"');
  res.type('text/csv').send(['email,created_at', ...rows.map((r) => [r.email, r.created_at.toISOString()].map(csvCell).join(','))].join('\n'));
});

// ---------------- settings ----------------
router.get('/settings', async (req, res) => {
  const [s, key, wh] = await Promise.all([settings.all(), stripeSvc.secretKey(), stripeSvc.webhookSecret()]);
  page(res, { title: 'Settings', active: 'settings', body: A.settingsPage({
    s, csrf: res.locals.csrf, baseUrl: config.baseUrl, webhookSet: Boolean(wh), envKey: Boolean(config.stripeSecretKey),
    stripe: { mode: stripeSvc.keyMode(key), last4: key ? key.slice(-4) : '' } }) });
});

const settingsSchema = z.object({
  store_name: z.string().trim().min(1).max(60), announcement: z.string().trim().max(160).optional().default(''),
  hero_title: z.string().trim().max(80), hero_subtitle: z.string().trim().max(200), christmas_cutoff: z.string().trim().max(40),
  support_email: z.union([z.literal(''), z.string().trim().email().max(200)]).optional().default(''),
  meta_pixel_id: z.union([z.literal(''), z.string().trim().regex(/^\d{6,20}$/)]).optional().default(''),
  checkout_enabled: z.string().optional(),
});
router.post('/settings', async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body || {});
  if (!parsed.success) return backErr(res, '/admin/settings', 'Please check the fields (email and Pixel ID must be valid).');
  const d = parsed.data;
  for (const k of ['store_name', 'announcement', 'hero_title', 'hero_subtitle', 'christmas_cutoff', 'support_email', 'meta_pixel_id']) await settings.set(k, d[k]);
  await settings.set('checkout_enabled', d.checkout_enabled === 'true' ? 'true' : 'false');
  await auth.audit(req, 'updated store settings');
  back(res, '/admin/settings', 'saved');
});

router.post('/settings/stripe', async (req, res) => {
  if (config.stripeSecretKey) return backErr(res, '/admin/settings', 'The Stripe key is set by an environment variable on the server.');
  if (req.body && req.body.remove === '1') {
    await settings.setSecret('stripe_secret_key', '');
    await settings.setSecret('stripe_webhook_secret', '');
    await auth.audit(req, 'disconnected Stripe');
    return back(res, '/admin/settings', 'stripe_off');
  }
  const key = String((req.body && req.body.stripe_secret_key) || '').trim();
  const wh = String((req.body && req.body.stripe_webhook_secret) || '').trim();
  if (key) {
    if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,190}$/.test(key)) return backErr(res, '/admin/settings', 'That does not look like a Stripe secret (sk_) or restricted (rk_) key.');
    // Verify the key works before saving it.
    try {
      const Stripe = require('stripe');
      await new Stripe(key, { timeout: 15_000 }).checkout.sessions.list({ limit: 1 });
    } catch (e) {
      return backErr(res, '/admin/settings', 'Stripe rejected that key: ' + String(e.message).slice(0, 140));
    }
    await settings.setSecret('stripe_secret_key', key);
    await auth.audit(req, 'connected Stripe', stripeSvc.keyMode(key) + ' key …' + key.slice(-4));
  }
  if (wh) {
    if (!/^whsec_[A-Za-z0-9]{10,200}$/.test(wh)) return backErr(res, '/admin/settings', 'Webhook secret should start with whsec_.');
    await settings.setSecret('stripe_webhook_secret', wh);
    await auth.audit(req, 'set Stripe webhook secret');
  }
  back(res, '/admin/settings', 'stripe');
});

// ---------------- security ----------------
const pendingTotp = new Map(); // adminId -> secret (in memory until confirmed)

async function securityPage(req, res, totpSetup = null) {
  const [sessions, audit, adm] = await Promise.all([
    db.many('SELECT created_at, last_seen, ip, user_agent FROM admin_sessions WHERE admin_id = $1 AND expires_at > now() ORDER BY last_seen DESC', [req.admin.id]),
    db.many('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50'),
    db.one('SELECT totp_enabled FROM admins WHERE id = $1', [req.admin.id]),
  ]);
  page(res, { title: 'Security', active: 'security', body: A.security({ admin: { ...req.admin, totpEnabled: adm.totp_enabled }, sessions, audit, csrf: res.locals.csrf, totpSetup }) });
}
router.get('/security', (req, res) => securityPage(req, res));

async function checkPassword(adminId, pw) {
  const a = await db.one('SELECT password_hash FROM admins WHERE id = $1', [adminId]);
  return a && require('bcryptjs').compare(String(pw || ''), a.password_hash);
}

router.post('/security/password', limiters.login, async (req, res) => {
  const { current, password, password2 } = req.body || {};
  if (!(await checkPassword(req.admin.id, current))) return backErr(res, '/admin/security', 'Current password is incorrect.');
  const problems = auth.passwordProblems(password, req.admin.email);
  if (problems.length) return backErr(res, '/admin/security', 'New password needs ' + problems.join(', ') + '.');
  if (password !== password2) return backErr(res, '/admin/security', 'New passwords do not match.');
  await db.query('UPDATE admins SET password_hash = $2 WHERE id = $1', [req.admin.id, await auth.hashPassword(password)]);
  const cur = auth.sha256(req.cookies[auth.COOKIE]);
  await db.query('DELETE FROM admin_sessions WHERE admin_id = $1 AND token_hash <> $2', [req.admin.id, cur]);
  await auth.audit(req, 'changed password');
  back(res, '/admin/security', 'pw');
});

router.post('/security/totp/setup', async (req, res) => {
  const secret = auth.newTotpSecret();
  pendingTotp.set(req.admin.id, secret);
  const s = await settings.all();
  const uri = `otpauth://totp/${encodeURIComponent(s.store_name)}:${encodeURIComponent(req.admin.email)}?secret=${secret}&issuer=${encodeURIComponent(s.store_name)}&period=30&digits=6`;
  await securityPage(req, res, { secret, uri });
});

router.post('/security/totp/enable', limiters.login, async (req, res) => {
  const secret = pendingTotp.get(req.admin.id);
  if (!secret || secret !== String((req.body && req.body.secret) || '')) return backErr(res, '/admin/security', 'Setup expired — start again.');
  if (!auth.verifyTotp(secret, String((req.body && req.body.code) || '').trim())) return backErr(res, '/admin/security', 'That code did not match. Check the time on your phone and try again.');
  await db.query('UPDATE admins SET totp_secret = $2, totp_enabled = true WHERE id = $1', [req.admin.id, secret]);
  pendingTotp.delete(req.admin.id);
  await auth.audit(req, 'enabled 2FA');
  back(res, '/admin/security', 'totp_on');
});

router.post('/security/totp/disable', limiters.login, async (req, res) => {
  if (!(await checkPassword(req.admin.id, req.body && req.body.current))) return backErr(res, '/admin/security', 'Current password is incorrect.');
  await db.query('UPDATE admins SET totp_secret = NULL, totp_enabled = false WHERE id = $1', [req.admin.id]);
  await auth.audit(req, 'disabled 2FA');
  back(res, '/admin/security', 'totp_off');
});

router.post('/security/sessions/revoke', async (req, res) => {
  const cur = auth.sha256(req.cookies[auth.COOKIE]);
  await db.query('DELETE FROM admin_sessions WHERE admin_id = $1 AND token_hash <> $2', [req.admin.id, cur]);
  await auth.audit(req, 'revoked other sessions');
  back(res, '/admin/security', 'revoked');
});

module.exports = router;
