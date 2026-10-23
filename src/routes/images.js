'use strict';
const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/img/:id/:size.webp', async (req, res) => {
  const id = Number(req.params.id);
  const size = req.params.size;
  if (!Number.isInteger(id) || id <= 0 || !['full', 'thumb'].includes(size)) return res.status(404).end();
  const row = await db.one(`SELECT ${size === 'full' ? 'data' : 'thumb'} AS bytes, etag FROM images WHERE id = $1`, [id]);
  if (!row || !row.bytes) return res.status(404).end();
  const etag = `"${row.etag}-${size}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
  // Stripe Checkout and ad platforms load product images from other origins.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.get('if-none-match') === etag) return res.status(304).end();
  res.type('image/webp').send(row.bytes);
});

module.exports = router;
