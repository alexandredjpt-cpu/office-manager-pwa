/** Alvo de tamanho por fotografia, em bytes (~200 KB). */
export const ALVO_BYTES = 200_000;

export function dimensoesAlvo(w: number, h: number, ladoMax: number): { w: number; h: number } {
  const maior = Math.max(w, h);
  if (maior <= ladoMax) return { w, h };
  const f = ladoMax / maior;
  return { w: Math.max(1, Math.round(w * f)), h: Math.max(1, Math.round(h * f)) };
}

const paraBlob = (c: HTMLCanvasElement, q: number) =>
  new Promise<Blob>((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('Não consegui comprimir a imagem.'))), 'image/jpeg', q));

/**
 * Redimensiona e comprime para JPEG. Tenta lado máximo 1280 → 1024 → 800 px e
 * qualidade 0.8 → 0.4 até caber em ~200 KB; se nada couber, devolve a menor.
 * Respeita a orientação EXIF (fotografias tiradas na vertical).
 */
export async function comprimirImagem(ficheiro: Blob, alvo = ALVO_BYTES): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(ficheiro, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Formato de imagem não suportado. Usa JPEG ou PNG.');
  }
  try {
    let menor: Blob | null = null;
    for (const lado of [1280, 1024, 800]) {
      const { w, h } = dimensoesAlvo(bmp.width, bmp.height, lado);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff'; // PNG com transparência não fica preto em JPEG
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      for (const q of [0.8, 0.7, 0.6, 0.5, 0.4]) {
        const b = await paraBlob(canvas, q);
        if (b.size <= alvo) return b;
        if (!menor || b.size < menor.size) menor = b;
      }
    }
    return menor!;
  } finally {
    bmp.close();
  }
}
