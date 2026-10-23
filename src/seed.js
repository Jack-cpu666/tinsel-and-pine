'use strict';
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

async function insertProduct(c, p, catIds) {
  const pr = await c.query(
    `INSERT INTO products(slug, name, tagline, description, bullets, category_id, status, featured, sort_order,
                          option_name, option2_name, supplier_url, ship_estimate)
     VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11,$12) RETURNING id`,
    [p.slug, p.name, p.tagline, p.description, JSON.stringify(p.bullets), catIds[p.category] || null, p.featured,
     p.sort_order, p.option_name, p.option2_name, p.supplier_url, p.ship_estimate]
  );
  const productId = pr.rows[0].id;
  let i = 0;
  for (const [idx, url] of p.images.entries()) {
    await c.query('INSERT INTO image_queue(product_id, url, sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [productId, url, idx]);
  }
  const variantImg = {};
  for (const v of p.variants) {
    const vr = await c.query(
      `INSERT INTO variants(product_id, option1, option2, price_cents, compare_at_cents, cost_cents, inventory, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [productId, v.option1, v.option2, v.price_cents, v.compare_at_cents, Math.round(v.cost * 100), 500, i++]
    );
    if (v.image) (variantImg[v.image] ||= []).push(vr.rows[0].id);
  }
  let k = 100;
  for (const [url, ids] of Object.entries(variantImg)) {
    await c.query(
      `INSERT INTO image_queue(product_id, url, sort_order, variant_ids) VALUES ($1,$2,$3,$4)
       ON CONFLICT (product_id, url) DO UPDATE SET variant_ids = EXCLUDED.variant_ids`,
      [productId, url, k++, ids]
    );
  }
}

async function upsertCategories(c, categories) {
  const catIds = {};
  for (const cat of categories || []) {
    const r = await c.query(
      `INSERT INTO categories(slug, name, sort_order) VALUES ($1,$2,$3)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [cat.slug, cat.name, cat.sort_order]
    );
    catIds[cat.name] = r.rows[0].id;
  }
  const all = await c.query('SELECT id, name FROM categories');
  for (const r of all.rows) catIds[r.name] ||= r.id;
  return catIds;
}

async function seedIfEmpty() {
  const n = await db.one('SELECT count(*)::int AS n FROM products');
  if (n.n > 0) return false;
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'products.json'), 'utf8'));
  await db.tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(4242002)');
    const again = await c.query('SELECT count(*)::int AS n FROM products');
    if (again.rows[0].n > 0) return;
    const catIds = await upsertCategories(c, data.categories);
    for (const p of data.products) await insertProduct(c, p, catIds);
  });
  console.log('[seed] catalog created');
  return true;
}

// Extra catalog batches (seed/batches/*.json) are applied once each, on any database.
// Products whose slug already exists are skipped, and a batch never re-adds a product
// the admin later deleted, because the batch is recorded as applied.
async function applyBatches() {
  const dir = path.join(__dirname, '..', 'seed', 'batches');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { return 0; }
  let added = 0;
  for (const file of files) {
    const done = await db.one('SELECT 1 FROM seed_batches WHERE name = $1', [file]);
    if (done) continue;
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    await db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(4242002)');
      const again = await c.query('SELECT 1 FROM seed_batches WHERE name = $1', [file]);
      if (again.rowCount) return;
      const catIds = await upsertCategories(c, data.categories);
      for (const p of data.products) {
        const exists = await c.query('SELECT 1 FROM products WHERE slug = $1', [p.slug]);
        if (exists.rowCount) continue;
        await insertProduct(c, p, catIds);
        added++;
      }
      await c.query('INSERT INTO seed_batches(name) VALUES ($1)', [file]);
    });
    console.log(`[seed] applied batch ${file}`);
  }
  return added;
}

module.exports = { seedIfEmpty, applyBatches };
