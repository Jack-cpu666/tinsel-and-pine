'use strict';
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const stripeSvc = require('./stripe');

class CheckoutError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; this.expose = true; }
}

function orderNumber() {
  // e.g. TP-7K3F9Q — unambiguous characters only.
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return 'TP-' + s;
}

function variantLabel(v, product) {
  const parts = [];
  if (v.option1 && v.option1 !== 'Default') parts.push(v.option1);
  if (v.option2) parts.push(v.option2);
  return parts.join(' / ') || null;
}

// Validates a client cart against the database. Client prices are never trusted.
async function priceCart(rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw new CheckoutError('Your cart is empty.');
  if (rawLines.length > config.maxCartLines) throw new CheckoutError('Too many items in cart.');
  const merged = new Map();
  for (const l of rawLines) {
    const id = Number(l && l.variantId);
    const qty = Number(l && l.qty);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(qty) || qty <= 0) throw new CheckoutError('Invalid cart item.');
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  const ids = [...merged.keys()];
  const rows = await db.many(
    `SELECT v.id, v.option1, v.option2, v.price_cents, v.cost_cents, v.inventory, v.active,
            v.image_id AS v_image, p.id AS product_id, p.name, p.slug, p.status, p.supplier_url,
            (SELECT i.id FROM images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS p_image
       FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($1::int[])`, [ids]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const lines = [];
  for (const [id, qty] of merged) {
    const v = byId.get(id);
    if (!v || !v.active || v.status !== 'active') throw new CheckoutError('An item in your cart is no longer available. Please remove it and try again.');
    if (qty > config.maxQtyPerLine) throw new CheckoutError(`Maximum ${config.maxQtyPerLine} of one item per order.`);
    if (qty > v.inventory) throw new CheckoutError(`Only ${v.inventory} left of ${v.name}${variantLabel(v) ? ' (' + variantLabel(v) + ')' : ''}.`);
    lines.push({
      variantId: v.id, productId: v.product_id, name: v.name, slug: v.slug, variantName: variantLabel(v),
      unitCents: v.price_cents, costCents: v.cost_cents, qty, imageId: v.v_image || v.p_image, supplierUrl: v.supplier_url,
    });
  }
  const subtotal = lines.reduce((s, l) => s + l.unitCents * l.qty, 0);
  return { lines, subtotal, shipping: 0, total: subtotal };
}

async function addEvent(orderId, kind, message, client = db) {
  await client.query('INSERT INTO order_events(order_id, kind, message) VALUES ($1,$2,$3)', [orderId, kind, message]);
}

async function createCheckout(rawLines, { ip, email } = {}) {
  const stripe = await stripeSvc.client();
  if (!stripe) throw new CheckoutError('Checkout is being set up — please check back shortly.', 503);
  const cart = await priceCart(rawLines);
  const number = orderNumber();
  const token = crypto.randomBytes(24).toString('base64url');

  const order = await db.tx(async (c) => {
    const o = await c.query(
      `INSERT INTO orders(number, public_token, status, subtotal_cents, shipping_cents, total_cents, client_ip)
       VALUES ($1,$2,'pending',$3,$4,$5,$6) RETURNING id`,
      [number, token, cart.subtotal, cart.shipping, cart.total, ip || null]
    );
    const orderId = o.rows[0].id;
    for (const l of cart.lines) {
      await c.query(
        `INSERT INTO order_items(order_id, product_id, variant_id, product_name, variant_name, supplier_url, image_id, unit_cents, cost_cents, quantity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [orderId, l.productId, l.variantId, l.name, l.variantName, l.supplierUrl, l.imageId, l.unitCents, l.costCents, l.qty]
      );
    }
    await addEvent(orderId, 'created', 'Checkout started', c);
    return { id: orderId };
  });

  const base = config.baseUrl;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: cart.lines.map((l) => ({
      quantity: l.qty,
      price_data: {
        currency: config.currency,
        unit_amount: l.unitCents,
        product_data: {
          name: l.variantName ? `${l.name} — ${l.variantName}` : l.name,
          ...(l.imageId && base.startsWith('https://') ? { images: [`${base}/img/${l.imageId}/thumb.webp`] } : {}),
          metadata: { variant_id: String(l.variantId) },
        },
      },
    })),
    shipping_address_collection: { allowed_countries: ['US'] },
    shipping_options: [{
      shipping_rate_data: {
        type: 'fixed_amount',
        display_name: 'Free 5-day shipping',
        fixed_amount: { amount: 0, currency: config.currency },
        delivery_estimate: { minimum: { unit: 'business_day', value: 3 }, maximum: { unit: 'business_day', value: 5 } },
      },
    }],
    phone_number_collection: { enabled: true },
    billing_address_collection: 'auto',
    ...(email ? { customer_email: email } : {}),
    customer_creation: 'if_required',
    client_reference_id: number,
    metadata: { order_id: String(order.id), order_number: number },
    payment_intent_data: { metadata: { order_id: String(order.id), order_number: number }, description: `Order ${number}` },
    success_url: `${base}/order/${token}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/cart?cancelled=1`,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
  }, { idempotencyKey: 'checkout-' + number });

  await db.query('UPDATE orders SET stripe_session_id = $2, updated_at = now() WHERE id = $1', [order.id, session.id]);
  return { url: session.url, number };
}

// Applies a Stripe Checkout Session to its order. Safe to call repeatedly (idempotent).
async function applySession(session) {
  const orderId = Number(session.metadata && session.metadata.order_id);
  let order = orderId ? await db.one('SELECT * FROM orders WHERE id = $1', [orderId]) : null;
  if (!order) order = await db.one('SELECT * FROM orders WHERE stripe_session_id = $1', [session.id]);
  if (!order) return null;
  if (order.stripe_session_id && order.stripe_session_id !== session.id) return order;

  if (session.status === 'expired' && order.status === 'pending') {
    await db.query(`UPDATE orders SET status = 'expired', updated_at = now() WHERE id = $1 AND status = 'pending'`, [order.id]);
    await addEvent(order.id, 'expired', 'Checkout session expired without payment');
    return db.one('SELECT * FROM orders WHERE id = $1', [order.id]);
  }
  if (session.payment_status !== 'paid') return order;

  await db.tx(async (c) => {
    const cur = (await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0];
    const details = session.customer_details || {};
    const ship = (session.collected_information && session.collected_information.shipping_details) || session.shipping_details || null;
    const amountTotal = Number(session.amount_total || 0);
    if (['pending', 'expired', 'cancelled'].includes(cur.status)) {
      await c.query(
        `UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, now()), email = $2, customer_name = $3, phone = $4,
                shipping_address = $5, stripe_payment_intent = $6, total_cents = $7, updated_at = now() WHERE id = $1`,
        [cur.id, details.email || cur.email, (ship && ship.name) || details.name || null, details.phone || null,
         ship ? JSON.stringify({ name: ship.name, ...ship.address }) : null,
         typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || null,
         amountTotal || cur.total_cents]
      );
      await addEvent(cur.id, 'paid', `Payment received: $${(amountTotal / 100).toFixed(2)}`, c);
      if (amountTotal && amountTotal !== cur.total_cents) {
        await addEvent(cur.id, 'warning', `Amount paid ($${(amountTotal / 100).toFixed(2)}) differs from order total ($${(cur.total_cents / 100).toFixed(2)})`, c);
      }
    }
    if (!cur.inventory_applied) {
      const items = (await c.query('SELECT variant_id, quantity FROM order_items WHERE order_id = $1', [cur.id])).rows;
      for (const it of items) {
        if (it.variant_id) await c.query('UPDATE variants SET inventory = GREATEST(inventory - $2, 0) WHERE id = $1', [it.variant_id, it.quantity]);
      }
      await c.query('UPDATE orders SET inventory_applied = true WHERE id = $1', [cur.id]);
    }
  });
  return db.one('SELECT * FROM orders WHERE id = $1', [order.id]);
}

async function syncOrderFromStripe(order) {
  if (!order || !order.stripe_session_id) return order;
  const stripe = await stripeSvc.client();
  if (!stripe) return order;
  const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
  return (await applySession(session)) || order;
}

async function reconcilePending() {
  const stripe = await stripeSvc.client();
  if (!stripe) return;
  const pending = await db.many(
    `SELECT * FROM orders WHERE status = 'pending' AND stripe_session_id IS NOT NULL
       AND created_at < now() - interval '2 minutes' AND created_at > now() - interval '3 days'
     ORDER BY created_at LIMIT 25`);
  for (const o of pending) {
    try { await syncOrderFromStripe(o); } catch (e) { console.warn('[reconcile]', o.number, e.message); }
  }
}

async function handleRefund(paymentIntentId, fully) {
  const o = await db.one('SELECT * FROM orders WHERE stripe_payment_intent = $1', [paymentIntentId]);
  if (!o) return;
  if (fully) await db.query(`UPDATE orders SET status = 'refunded', updated_at = now() WHERE id = $1`, [o.id]);
  await addEvent(o.id, 'refund', fully ? 'Order fully refunded in Stripe' : 'Partial refund issued in Stripe');
}

async function getByToken(token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) return null;
  return db.one('SELECT * FROM orders WHERE public_token = $1', [token]);
}

async function items(orderId) {
  return db.many('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
}

module.exports = { CheckoutError, priceCart, createCheckout, applySession, syncOrderFromStripe, reconcilePending, handleRefund, getByToken, items, addEvent, orderNumber };
