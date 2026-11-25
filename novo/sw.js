// Service worker: permite abrir o sistema sem internet (os dados já ficam no IndexedDB).
// Arquivos do próprio site: rede primeiro (sempre a versão mais nova), cache como reserva.
// Bibliotecas de CDN (URLs com versão fixa): cache primeiro.
// Nunca intercepta login (login.microsoftonline.com) nem a API do Graph.
const VERSAO = 'crono-v2-2026-11-25-operacao';
const CDN = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSAO).then(c => c.addAll(['./', './index.html', './assets/css/app.css', './config.js', './assets/js/main.js']).catch(() => null)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(chaves => Promise.all(chaves.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const mesmoSite = url.origin === self.location.origin;
  if (!mesmoSite && !CDN.includes(url.hostname)) return;

  if (mesmoSite) {
    e.respondWith(
      fetch(req)
        .then(resp => {
          if (resp.ok) {
            const copia = resp.clone();
            caches.open(VERSAO).then(c => c.put(req, copia));
          }
          return resp;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html'))),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      r =>
        r ||
        fetch(req).then(resp => {
          if (resp.ok || resp.type === 'opaque') {
            const copia = resp.clone();
            caches.open(VERSAO).then(c => c.put(req, copia));
          }
          return resp;
        }),
    ),
  );
});
