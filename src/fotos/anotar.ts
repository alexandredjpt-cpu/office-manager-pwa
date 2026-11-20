/** Formas desenhadas por cima de uma fotografia, em coordenadas da própria imagem (píxeis). */
export type Ferramenta = 'circulo' | 'seta' | 'livre';
export interface Forma { tipo: Ferramenta; cor: string; pontos: [number, number][] }

/** Espessura proporcional à imagem, para o traço ter o mesmo aspeto em fotos grandes ou pequenas. */
export const espessura = (larguraImagem: number) => Math.max(3, Math.round(larguraImagem / 160));

/** Pontas da seta (dois segmentos a ±25° da direção, com 4× a espessura). */
export function pontasSeta(de: [number, number], ate: [number, number], larg: number): [[number, number], [number, number]] {
  const ang = Math.atan2(ate[1] - de[1], ate[0] - de[0]);
  const l = Math.max(12, larg * 4);
  const p = (d: number): [number, number] => [ate[0] - l * Math.cos(ang - d), ate[1] - l * Math.sin(ang - d)];
  return [p(Math.PI / 7), p(-Math.PI / 7)];
}

type Ctx = Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'ellipse' | 'save' | 'restore'> & {
  strokeStyle: string | CanvasGradient | CanvasPattern; lineWidth: number; lineCap: CanvasLineCap; lineJoin: CanvasLineJoin; shadowColor: string; shadowBlur: number;
};

export function desenharFormas(ctx: Ctx, formas: Forma[], larguraImagem: number): void {
  const w = espessura(larguraImagem);
  for (const f of formas) {
    const [a, b] = [f.pontos[0], f.pontos[f.pontos.length - 1]];
    ctx.save();
    ctx.strokeStyle = f.cor; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = w; // lê-se em fundos claros e escuros
    ctx.beginPath();
    if (f.tipo === 'circulo') {
      const rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2;
      ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.max(rx, w), Math.max(ry, w), 0, 0, Math.PI * 2);
    } else if (f.tipo === 'seta') {
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      const [p1, p2] = pontasSeta(a, b, w);
      ctx.moveTo(p1[0], p1[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(p2[0], p2[1]);
    } else {
      ctx.moveTo(a[0], a[1]);
      for (const p of f.pontos.slice(1)) ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
    ctx.restore();
  }
}
