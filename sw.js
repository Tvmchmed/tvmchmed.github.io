/* TVMCHMED - Copyright (c) 2026 Dr. S. Rajkumar. All rights reserved. Proprietary: copying, cloning or AI-assisted recreation without written permission is prohibited. See LICENSE.txt. */
// Keeps the website's own files on the device so it opens without internet. Records live in IndexedDB, never here.
const CACHE = 'tvmchmed-web-10.5';
const FILES = ["./", "index.html", "style.css", "manifest.webmanifest", "quiz.html", "sql-wasm.wasm", "dept_logo.png", "icd11.txt", "uq_seed.txt", "dama_form.pdf", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "logo.png", "home_banner.webp", "home_banner_wide.webp", "album_frame.webp", "cert_template.webp", "home_poster.webp", "doubt_heart.webp", "sql-wasm.js", "fflate.js", "config.js", "tvmchmed.js"];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f.indexOf('.js') > 0 && f.indexOf('?') < 0 ? f + '?v=10.5' : f).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== SHARE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 10.3: something shared to the installed website (WhatsApp message, photos, PDF) is kept here until the page reads it
const SHARE = 'tvmchmed-share';
async function keepShare(req) {
  const fd = await req.formData();
  const c = await caches.open(SHARE);
  for (const k of await c.keys()) await c.delete(k);
  const meta = { text: [fd.get('title'), fd.get('text'), fd.get('url')].filter(x => typeof x === 'string' && x.trim()).join('\n'), files: [] };
  let n = 0;
  for (const f of fd.getAll('files')) {
    if (!f || typeof f === 'string' || n >= 10) continue;
    const key = 'share/file/' + n++;
    meta.files.push({ key: key, name: f.name || 'file', type: f.type || '' });
    await c.put(key, new Response(f));
  }
  await c.put('share/meta', new Response(JSON.stringify(meta)));
  return Response.redirect('./?shared=' + Date.now(), 303);
}
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.origin === self.location.origin && u.searchParams.has('share-target')) {
    e.respondWith(keepShare(e.request).catch(() => Response.redirect('./', 303)));
    return;
  }
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
