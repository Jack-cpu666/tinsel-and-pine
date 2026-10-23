'use strict';
const express = require('express');
const stripeSvc = require('../services/stripe');
const orders = require('../services/orders');

const router = express.Router();

// Stripe webhook (optional — orders are also reconciled by polling).
router.post('/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const secret = await stripeSvc.webhookSecret();
  const stripe = await stripeSvc.client();
  if (!secret || !stripe) return res.status(503).send('Webhook not configured');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature') || '', secret);
  } catch (e) {
    return res.status(400).send('Bad signature');
  }
  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.expired':
        await orders.applySession(event.data.object);
        break;
      case 'charge.refunded': {
        const ch = event.data.object;
        if (ch.payment_intent) await orders.handleRefund(String(ch.payment_intent), ch.amount_refunded >= ch.amount);
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (e) {
    console.error('[webhook]', e.message);
    res.status(500).send('Handler error');
  }
});

module.exports = router;
