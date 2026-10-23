'use strict';
if (process.env.NODE_ENV === 'production') { console.error('dev only'); process.exit(1); }
// DEV ONLY: fills the image queue with generated placeholder images (no network needed).
const sharp = require('sharp');
const db = require('../src/db');
const images = require('../src/services/images');
(async () => {
  const q = await db.many('SELECT q.*, p.name FROM image_queue q JOIN products p ON p.id = q.product_id ORDER BY q.id');
  const colors = ['#0f3d2e', '#b3202a', '#c9a14a', '#15523d', '#7a1c22', '#2f6b55'];
  for (const [i, it] of q.entries()) {
    const c = colors[(it.product_id + it.sort_order) % colors.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="${c}"/><circle cx="450" cy="420" r="230" fill="#fff" opacity=".15"/><text x="450" y="460" font-size="46" text-anchor="middle" fill="#fff" font-family="sans-serif">${it.name.replace(/&/g,'&amp;').slice(0,28)}</text><text x="450" y="530" font-size="30" text-anchor="middle" fill="#fff" font-family="sans-serif">#${it.sort_order}</text></svg>`;
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    const id = await images.store({ productId: it.product_id, buf, alt: it.name, sourceUrl: it.url, sortOrder: it.sort_order });
    if (it.variant_ids.length) await db.query('UPDATE variants SET image_id = $1 WHERE id = ANY($2::int[])', [id, it.variant_ids]);
    await db.query('DELETE FROM image_queue WHERE id = $1', [it.id]);
  }
  console.log('filled', q.length);
  await db.pool.end();
})();
