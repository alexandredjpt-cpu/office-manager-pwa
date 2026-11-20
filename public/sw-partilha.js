/*
 * Recebe fotografias partilhadas a partir de outras apps (Web Share Target, Android).
 * Carregado pelo service worker principal (importScripts). Guarda as imagens só neste
 * telemóvel (Cache Storage «om-partilha») e abre a app numa anomalia nova.
 * Nada sai do telemóvel.
 */
const CACHE_PARTILHA = 'om-partilha';
const MAX_FOTOS = 10;
const MAX_BYTES = 25 * 1024 * 1024;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || !url.pathname.endsWith('/partilhar')) return;
  event.respondWith((async () => {
    const destino = new URL('./#/anomalias/nova?partilha=1', self.registration.scope).href;
    try {
      const dados = await event.request.formData();
      const fotos = dados.getAll('fotos').filter((f) => f && typeof f === 'object' && String(f.type).startsWith('image/') && f.size <= MAX_BYTES).slice(0, MAX_FOTOS);
      const cache = await caches.open(CACHE_PARTILHA);
      for (const k of await cache.keys()) await cache.delete(k); // só a última partilha conta
      const agora = Date.now();
      await Promise.all(fotos.map((f, i) => cache.put(
        new Request(new URL(`./partilha/${agora}-${i}`, self.registration.scope).href),
        new Response(f, { headers: { 'Content-Type': f.type } })
      )));
      const texto = [dados.get('titulo'), dados.get('texto')].filter((x) => typeof x === 'string' && x.trim()).join(' ').slice(0, 200);
      return Response.redirect(texto ? `${destino}&titulo=${encodeURIComponent(texto)}` : destino, 303);
    } catch (e) {
      return Response.redirect(destino, 303);
    }
  })());
});
