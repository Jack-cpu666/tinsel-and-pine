'use strict';
const express = require('express');
const db = require('../db');
const orders = require('../services/orders');
const analytics = require('../services/analytics');
const settings = require('../services/settings');
const stripeSvc = require('../services/stripe');
const { limiters } = require('../security');

const router = express.Router();
router.use(limiters.api);
router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// Returns authoritative cart contents. Unknown/unavailable lines are reported, not silently priced.
router.post('/cart', async (req, res) => {
  const lines = Array.isArray(req.body && req.body.lines) ? req.body.lines.slice(0, 40) : [];
  const ids = lines.map((l) => Number(l && l.variantId)).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return res.json({ lines: [], subtotal: 0 });
  const rows = await db.many(
    `SELECT v.id, v.option1, v.option2, v.price_cents, v.compare_at_cents, v.inventory, v.active, v.image_id,
            p.name, p.slug, p.status,
            (SELECT i.id FROM images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS p_image
       FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($1::int[])`, [ids]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = [];
  for (const l of lines) {
    const v = byId.get(Number(l && l.variantId));
    const qty = Math.max(1, Math.min(50, Math.floor(Number(l && l.qty) || 1)));
    if (!v || !v.active || v.status !== 'active') { out.push({ variantId: Number(l && l.variantId) || 0, unavailable: true }); continue; }
    const label = [v.option1 !== 'Default' ? v.option1 : null, v.option2].filter(Boolean).join(' / ');
    out.push({
      variantId: v.id, qty: Math.min(qty, Math.max(v.inventory, 0)) || qty, name: v.name, slug: v.slug, variant: label || null,
      price: v.price_cents, compare: v.compare_at_cents, stock: v.inventory, image: v.image_id || v.p_image,
      unavailable: v.inventory <= 0,
    });
  }
  const subtotal = out.filter((l) => !l.unavailable).reduce((s, l) => s + l.price * l.qty, 0);
  res.json({ lines: out, subtotal });
});

router.post('/checkout', limiters.checkout, async (req, res) => {
  try {
    const s = await settings.all();
    if (s.checkout_enabled === 'false') return res.status(503).json({ error: 'Checkout is paused for a moment. Please try again soon.' });
    const lines = Array.isArray(req.body && req.body.lines) ? req.body.lines : [];
    const { url } = await orders.createCheckout(lines, { ip: req.ip });
    analytics.recordEvent(req, 'begin_checkout', { lines: lines.length });
    res.json({ url });
  } catch (e) {
    if (e.expose) return res.status(e.status || 400).json({ error: e.message });
    console.error('[checkout]', e.type || '', e.message);
    res.status(502).json({ error: 'We could not start checkout. Please try again in a moment.' });
  }
});

router.post('/t', limiters.track, (req, res) => {
  const name = String((req.body && req.body.e) || '').slice(0, 40);
  analytics.recordEvent(req, name, req.body && typeof req.body.d === 'object' ? req.body.d : null);
  res.status(204).end();
});

router.get('/health', async (req, res) => {
  await db.one('SELECT 1');
  res.json({ ok: true, checkout: Boolean(await stripeSvc.secretKey()) });
});

module.exports = router;
