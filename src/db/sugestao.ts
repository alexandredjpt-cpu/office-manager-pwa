import type { ContagemStock } from './schema';
import type { StockArtigo } from './stock';

/** Janela da sugestão: últimos 3 meses. */
export const DIAS_JANELA = 90;
/** Menos do que isto entre contagens não chega para estimar consumo. */
export const MIN_DIAS = 14;
const DIA = 86_400_000;

export type MotivoSemSugestao = 'sem_contagens' | 'poucos_dias';

export interface SugestaoArtigo {
  stock: StockArtigo;
  /** Consumo observado na janela (descidas entre contagens manuais). */
  consumo: number | null;
  /** Dias cobertos pelas contagens dentro da janela. */
  dias: number | null;
  /** Consumo estimado para os próximos 3 meses. */
  previsto: number | null;
  /** Quanto comprar para cobrir os próximos 3 meses e ficar no mínimo: max(0, previsto + mínimo − atual). */
  sugerida: number | null;
  /** Subidas entre contagens sem entrada registada (ignoradas no consumo). */
  subidasSemRegisto: number;
  motivo: MotivoSemSugestao | null;
}

const arred = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Estima o consumo a partir das contagens dos últimos 3 meses e sugere quanto comprar.
 * Regras: só conta como consumo a descida entre duas contagens em que a segunda é manual;
 * contagens geradas por movimentos (transferências, perdas, receções…) nunca são consumo;
 * subidas sem entrada registada são ignoradas. Um par de contagens que começa antes da janela
 * conta só a parte proporcional dentro dela. É só uma sugestão: nada é gravado.
 */
export function sugestaoTrimestral(stocks: StockArtigo[], contagens: ContagemStock[], hoje = new Date()): SugestaoArtigo[] {
  const fim = hoje.getTime();
  const inicio = fim - DIAS_JANELA * DIA;
  const porArtigo = new Map<string, ContagemStock[]>();
  for (const c of contagens) {
    if (c.deletedAt) continue;
    const l = porArtigo.get(c.artigoId) ?? [];
    l.push(c);
    porArtigo.set(c.artigoId, l);
  }
  return stocks.map((s) => {
    const todas = porArtigo.get(s.artigo.id) ?? [];
    const porLocal = new Map<string, ContagemStock[]>();
    for (const c of todas) {
      const l = porLocal.get(c.localizacaoId) ?? [];
      l.push(c);
      porLocal.set(c.localizacaoId, l);
    }
    let consumo = 0, pares = 0, subidas = 0, desde = Infinity, ate = -Infinity;
    for (const lista of porLocal.values()) {
      lista.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      for (let i = 1; i < lista.length; i++) {
        const a = lista[i - 1], b = lista[i];
        const ta = new Date(a.createdAt).getTime(), tb = new Date(b.createdAt).getTime();
        if (tb < inicio || tb > fim || tb <= ta) continue;
        if (b.movimentoId) continue; // mudança causada por um movimento: não é consumo
        const desc = a.quantidade - b.quantidade;
        const ini = Math.max(ta, inicio);
        const parte = (tb - ini) / (tb - ta);
        if (desc > 0) consumo += desc * parte;
        else if (desc < 0) subidas++;
        pares++;
        desde = Math.min(desde, ini);
        ate = Math.max(ate, tb);
      }
    }
    const minimo = s.artigo.stockMinimo ?? 0;
    if (pares === 0) return { stock: s, consumo: null, dias: null, previsto: null, sugerida: null, subidasSemRegisto: subidas, motivo: 'sem_contagens' };
    const dias = (ate - desde) / DIA;
    if (dias < MIN_DIAS) return { stock: s, consumo: arred(consumo), dias: arred(dias), previsto: null, sugerida: null, subidasSemRegisto: subidas, motivo: 'poucos_dias' };
    const previsto = arred((consumo / dias) * DIAS_JANELA);
    const sugerida = Math.max(0, Math.ceil(previsto + minimo - s.total - 1e-9));
    return { stock: s, consumo: arred(consumo), dias: Math.round(dias), previsto, sugerida, subidasSemRegisto: subidas, motivo: null };
  });
}
