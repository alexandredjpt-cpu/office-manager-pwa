/** Fotografias recebidas por partilha (ver public/sw-partilha.js). Ficam só neste telemóvel até serem usadas. */
export const CACHE_PARTILHA = 'om-partilha';

export async function lerPartilha(): Promise<Blob[]> {
  if (typeof caches === 'undefined') return [];
  const cache = await caches.open(CACHE_PARTILHA);
  const pedidos = [...(await cache.keys())].sort((a, b) => a.url.localeCompare(b.url, undefined, { numeric: true }));
  const blobs: Blob[] = [];
  for (const p of pedidos) {
    const r = await cache.match(p);
    if (r) { const b = await r.blob(); if (b.type.startsWith('image/')) blobs.push(b); }
  }
  return blobs;
}

export async function limparPartilha(): Promise<void> {
  if (typeof caches === 'undefined') return;
  await caches.delete(CACHE_PARTILHA);
}
