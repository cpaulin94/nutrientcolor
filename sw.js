var CACHE = "macrocolore-v3";
var SHELL = [
  "./",
  "./index.html",
  "./ocr.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  var nostro = url.origin === location.origin;

  // I file dell'app si servono dalla cache, ma intanto si va a vedere se ne
  // esiste una versione nuova e si aggiorna la copia per la volta dopo.
  // Con la sola cache, modificare un file senza cambiare CACHE lasciava il
  // telefono sulla versione vecchia per sempre: è già successo.
  if (nostro) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(req).then(function (hit) {
          var rete = fetch(req).then(function (res) {
            if (res && res.ok) c.put(req, res.clone());
            return res;
          }).catch(function () {
            return hit || (req.mode === "navigate" ? c.match("./index.html") : null) ||
                   new Response("", { status: 504 });
          });
          return hit || rete;
        });
      })
    );
    return;
  }

  // Il modello dell'OCR è grosso e non cambia mai: cache e basta.
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copia = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copia); });
        }
        return res;
      }).catch(function () {
        return new Response("", { status: 504 });
      });
    })
  );
});
