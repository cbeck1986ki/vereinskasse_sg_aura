// Vereinskasse: App-Dateien offline verfügbar machen (Daten-Sync übernimmt Firebase selbst)
const CACHE = "vereinskasse-gh-v1";
const FILES = ["./", "index.html", "app.js", "firebase-config.js", "firebase.bundle.js", "jspdf.umd.min.js", "manifest.webmanifest",
  "icon-192.png", "icon-512.png", "icon-maskable.png", "apple-touch-icon.png",
  "fonts/barlow-condensed-latin-700-normal.woff2", "fonts/barlow-condensed-latin-800-normal.woff2",
  "fonts/barlow-latin-400-normal.woff2", "fonts/barlow-latin-600-normal.woff2", "fonts/barlow-latin-700-normal.woff2"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return; // Firebase-Verkehr nie anfassen
  e.respondWith(
    fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match("index.html")))
  );
});
