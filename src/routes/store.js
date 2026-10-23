'use strict';
const express = require('express');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const catalog = require('../services/catalog');
const settings = require('../services/settings');
const orders = require('../services/orders');
const analytics = require('../services/analytics');
const V = require('../views/store');
const pages = require('../views/pages');
const { limiters } = require('../security');

const router = express.Router();

async function send(req, res, opts, status = 200) {
  const s = await settings.all();
  res.status(status).type('html').send(String(V.layout({ ...opts, s, nonce: res.locals.nonce })));
}

// Analytics for storefront page views (bots and prefetches are ignored).
router.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) res.on('finish', () => { if (res.statusCode === 200) analytics.recordView(req); });
  next();
});

router.get('/', async (req, res) => {
  const [products, categories, s] = await Promise.all([catalog.listProducts(), catalog.categories(), settings.all()]);
  const hero = products.find((p) => p.featured && p.image_id);
  await send(req, res, {
    body: V.home({ s, products, categories }),
    canonical: config.baseUrl + '/',
    ogImage: hero ? `${config.baseUrl}/img/${hero.image_id}/full.webp` : null,
    jsonLd: { '@context': 'https://schema.org', '@type': 'Organization', name: s.store_name, url: config.baseUrl },
  });
});

router.get(['/shop', '/shop/:category'], async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const categories = await catalog.categories();
  let cat = null;
  if (req.params.category) {
    cat = categories.find((c) => c.slug === req.params.category);
    if (!cat) return send(req, res, { title: 'Not found', body: V.notFound(), noindex: true }, 404);
  }
  const max = [1500, 3000, 5000].includes(Number(req.query.max)) ? Number(req.query.max) : null;
  const products = await catalog.listProducts({ category: cat && cat.slug, q: q || null, maxPrice: max });
  await send(req, res, {
    title: q ? `Search: ${q}` : cat ? cat.name : max ? `Gifts under $${max / 100}` : 'Shop all',
    description: cat ? `Shop ${cat.name.toLowerCase()} for Christmas — free US shipping.` : 'Shop every Christmas light, decoration and gift in the store — free US shipping.',
    body: V.collection({ title: q ? `Results for “${q}”` : cat ? cat.name : max ? `Gifts under $${max / 100}` : 'Shop all', products, categories, active: cat && cat.slug, q }),
    canonical: config.baseUrl + (cat ? `/shop/${cat.slug}` : '/shop'),
    noindex: Boolean(q),
  });
});

router.get('/products/:slug', async (req, res) => {
  const p = await catalog.getProduct(String(req.params.slug).slice(0, 120));
  if (!p) return send(req, res, { title: 'Not found', body: V.notFound(), noindex: true }, 404);
  const [related, s] = await Promise.all([catalog.related(p.id, p.category_slug), settings.all()]);
  const prices = p.variants.map((v) => v.price_cents);
  const image = p.images[0] ? `${config.baseUrl}/img/${p.images[0].id}/full.webp` : null;
  await send(req, res, {
    title: p.name,
    description: `${p.tagline} Free US shipping.`,
    body: V.product({ p, related, s }),
    canonical: `${config.baseUrl}/products/${p.slug}`,
    ogImage: image,
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.description,
      image: p.images.slice(0, 5).map((i) => `${config.baseUrl}/img/${i.id}/full.webp`),
      offers: {
        '@type': 'AggregateOffer', priceCurrency: 'USD', lowPrice: (Math.min(...prices) / 100).toFixed(2), highPrice: (Math.max(...prices) / 100).toFixed(2),
        availability: p.variants.some((v) => v.inventory > 0) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: `${config.baseUrl}/products/${p.slug}`,
      },
    },
  });
});

router.get('/cart', async (req, res) => {
  await send(req, res, { title: 'Cart', body: V.cartPage({ cancelled: req.query.cancelled === '1' }), noindex: true });
});

router.get('/order/:token', async (req, res) => {
  let order = await orders.getByToken(req.params.token);
  if (!order) return send(req, res, { title: 'Order not found', body: V.notFound(), noindex: true }, 404);
  const sid = typeof req.query.session_id === 'string' ? req.query.session_id : '';
  const justPaid = Boolean(sid);
  if (order.status === 'pending' && order.stripe_session_id && (!sid || sid === order.stripe_session_id)) {
    try { order = await orders.syncOrderFromStripe(order); } catch (e) { console.warn('[order] sync failed', e.message); }
  }
  const items = await orders.items(order.id);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  await send(req, res, { title: `Order ${order.number}`, body: V.orderPage({ order, items, justPaid }), noindex: true, bodyClass: justPaid && order.status !== 'pending' ? 'order-complete' : '' });
});

router.get('/track', async (req, res) => send(req, res, { title: 'Track your order', body: V.trackPage({}), noindex: false }));

const trackSchema = z.object({ number: z.string().trim().toUpperCase().regex(/^TP-[A-Z0-9]{6}$/), email: z.string().trim().toLowerCase().email().max(200) });
router.post('/track', limiters.forms, async (req, res) => {
  const parsed = trackSchema.safeParse(req.body || {});
  const values = { number: String((req.body && req.body.number) || '').slice(0, 20), email: String((req.body && req.body.email) || '').slice(0, 200) };
  if (!parsed.success) return send(req, res, { title: 'Track your order', body: V.trackPage({ error: 'Please enter a valid order number (TP-XXXXXX) and email.', values }) }, 400);
  const o = await db.one(`SELECT public_token FROM orders WHERE number = $1 AND lower(email) = $2 AND status <> 'pending'`, [parsed.data.number, parsed.data.email]);
  if (!o) return send(req, res, { title: 'Track your order', body: V.trackPage({ error: 'We could not find an order with that number and email.', values }) }, 404);
  res.redirect(303, `/order/${o.public_token}`);
});

router.get('/contact', async (req, res) => {
  const s = await settings.all();
  await send(req, res, { title: 'Contact us', body: V.contactPage({ s, sent: req.query.sent === '1' }) });
});

const contactSchema = z.object({
  name: z.string().trim().min(1).max(100), email: z.string().trim().email().max(200),
  order_number: z.string().trim().max(20).optional().default(''), body: z.string().trim().min(5).max(4000),
  website: z.string().max(0).optional().default(''),
});
router.post('/contact', limiters.forms, async (req, res) => {
  const s = await settings.all();
  const parsed = contactSchema.safeParse(req.body || {});
  if (!parsed.success) {
    if (req.body && req.body.website) return res.redirect(303, '/contact?sent=1'); // honeypot: pretend success
    return send(req, res, { title: 'Contact us', body: V.contactPage({ s, error: 'Please fill in your name, a valid email and a message.', values: req.body || {} }) }, 400);
  }
  const d = parsed.data;
  await db.query('INSERT INTO messages(name, email, order_number, body, ip) VALUES ($1,$2,$3,$4,$5)', [d.name, d.email, d.order_number || null, d.body, req.ip]);
  res.redirect(303, '/contact?sent=1');
});

router.post('/subscribe', limiters.forms, async (req, res) => {
  const parsed = z.string().trim().toLowerCase().email().max(200).safeParse(req.body && req.body.email);
  const wantsJson = (req.get('accept') || '').includes('application/json');
  if (!parsed.success) return wantsJson ? res.status(400).json({ error: 'Please enter a valid email.' }) : res.redirect(303, '/');
  await db.query('INSERT INTO subscribers(email) VALUES ($1) ON CONFLICT DO NOTHING', [parsed.data]);
  analytics.recordEvent(req, 'newsletter');
  return wantsJson ? res.json({ ok: true }) : res.redirect(303, '/');
});

for (const key of ['shipping', 'returns', 'privacy', 'terms', 'faq']) {
  router.get('/' + key, async (req, res) => {
    const s = await settings.all();
    const pg = pages(s)[key];
    await send(req, res, { title: pg.title, description: pg.description, body: V.textPage(pg), canonical: `${config.baseUrl}/${key}` });
  });
}

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /order/\nDisallow: /api/\nDisallow: /cart\nSitemap: ${config.baseUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', async (req, res) => {
  const [products, cats] = await Promise.all([catalog.listProducts({ limit: 500 }), catalog.categories()]);
  const urls = ['/', '/shop', ...cats.map((c) => `/shop/${c.slug}`), ...products.map((p) => `/products/${p.slug}`), '/shipping', '/returns', '/faq', '/contact', '/privacy', '/terms'];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${config.baseUrl}${u}</loc></url>`).join('\n')}\n</urlset>`);
});

module.exports = { router, send };
