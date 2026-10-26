/* TVMCHMED - Copyright (c) 2026 Dr. S. Rajkumar. All rights reserved. Proprietary: copying, cloning or AI-assisted recreation without written permission is prohibited. See LICENSE.txt. */
// Keeps the website's own files on the device so it opens without internet. Records live in IndexedDB, never here.
const CACHE = 'tvmchmed-web-7.0';
const FILES = ["./", "index.html", "style.css", "manifest.webmanifest", "quiz.html", "sql-wasm.wasm", "dept_logo.png", "icd11.txt", "uq_seed.txt", "dama_form.pdf", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "logo.png", "sql-wasm.js", "fflate.js", "config.js", "tvmchmed.js"];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f.indexOf('.js') > 0 && f.indexOf('?') < 0 ? f + '?v=7.0' : f).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
