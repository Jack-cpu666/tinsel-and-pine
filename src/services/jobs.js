'use strict';
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const images = require('./images');
const orders = require('./orders');

let running = false;

// Index of photos bundled in seed/images (any sub-folder), keyed by file name.
let localIndex = null;
function localImages() {
  if (localIndex) return localIndex;
  localIndex = new Map();
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(jpe?g|png|webp)$/i.test(e.name)) localIndex.set(e.name, full);
    }
  };
  walk(path.join(__dirname, '..', '..', 'seed', 'images'));
  return localIndex;
}

// Downloads queued supplier images, re-encodes them and stores them in the DB.
async function processImageQueue(limit = 6) {
  const items = await db.many(
    `SELECT q.*, p.name AS product_name FROM image_queue q JOIN products p ON p.id = q.product_id
      WHERE q.attempts < 5 ORDER BY q.product_id, q.sort_order LIMIT $1`, [limit]);
  let done = 0;
  for (const it of items) {
    try {
      // A variant image that already exists in the gallery is reused instead of stored twice.
      let imageId = null;
      const existing = await db.one('SELECT id FROM images WHERE product_id = $1 AND source_url = $2', [it.product_id, it.url]);
      // Photos bundled in the repo (seed/images, filled by DOWNLOAD-IMAGES.bat) are used first;
      // anything missing is downloaded from the supplier CDN.
      const local = localImages().get(path.basename(new URL(it.url).pathname));
      if (existing) imageId = existing.id;
      else if (local) imageId = await images.store({ productId: it.product_id, buf: fs.readFileSync(local), alt: it.product_name, sourceUrl: it.url, sortOrder: it.sort_order });
      else imageId = await images.importFromUrl({ productId: it.product_id, url: it.url, alt: it.product_name, sortOrder: it.sort_order });
      if (it.variant_ids && it.variant_ids.length) {
        await db.query('UPDATE variants SET image_id = $1 WHERE id = ANY($2::int[])', [imageId, it.variant_ids]);
      }
      await db.query('DELETE FROM image_queue WHERE id = $1', [it.id]);
      done++;
    } catch (e) {
      await db.query('UPDATE image_queue SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [it.id, String(e.message).slice(0, 300)]);
      console.warn(`[images] ${it.url}: ${e.message}`);
    }
  }
  return done;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await processImageQueue();
    await orders.reconcilePending();
    await db.query(`DELETE FROM admin_sessions WHERE expires_at < now()`);
    await db.query(`DELETE FROM login_attempts WHERE created_at < now() - interval '30 days'`);
  } catch (e) {
    console.error('[jobs]', e.message);
  } finally {
    running = false;
  }
}

function start() {
  setTimeout(tick, 2_000).unref();
  setInterval(tick, 60_000).unref();
  // Drain the image queue quickly right after first deploy.
  const fast = setInterval(async () => {
    const left = await db.one('SELECT count(*)::int AS n FROM image_queue WHERE attempts < 5').catch(() => ({ n: 0 }));
    if (!left.n) return clearInterval(fast);
    if (!running) { running = true; try { await processImageQueue(8); } finally { running = false; } }
  }, 5_000);
  fast.unref();
}

module.exports = { start, tick, processImageQueue };
