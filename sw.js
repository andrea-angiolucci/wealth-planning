// Cambia VERSION ad ogni rilascio: il telefono scarica la nuova versione e ricarica da solo.
const VERSION = "20";
const CACHE = "wealth-shell-v" + VERSION;
const SHELL = ["./", "index.html", "supabase.js", "receipt-parse.js", "csv-import.js", "manifest.json", "icon-180.png", "icon-192.png", "icon-512.png", "cards/amex.jpg", "cards/revolut.jpg", "cards/buddy.jpg", "cards/intesa-visa.jpg", "cards/intesa-mc.jpg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Rete prima (max 4 s), poi copia salvata: online sempre aggiornato, offline funziona.
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (u.pathname.includes("/ocr/")) { // file pesanti e immutabili: prima la copia salvata
      const hit = await cache.match(r); if (hit) return hit;
      const res = await fetch(r); if (res.ok) cache.put(r, res.clone()); return res;
    }
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
      const res = await fetch(r, { signal: ctl.signal, cache: "no-cache" }); clearTimeout(t);
      if (res.ok) cache.put(r, res.clone());
      return res;
    } catch (err) {
      return (await cache.match(r, { ignoreSearch: true })) || (r.mode === "navigate" ? await cache.match("index.html") : Response.error());
    }
  })());
});
