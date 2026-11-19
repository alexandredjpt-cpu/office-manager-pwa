import type { Artigo, ContagemStock, EstadoCompra, OfficeDB } from './schema';
import { agora, novoId, proximoCodigo } from './repo';

const arred = (n: number) => Math.round(n * 1000) / 1000;

function numero(v: unknown, rotulo: string, { minimo = 0 }: { minimo?: number } = {}): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n)) throw new Error(`${rotulo}: indica um número.`);
  if (n < minimo) throw new Error(`${rotulo} não pode ser negativo.`);
  return arred(n);
}

/** '' / null → null (sem valor); caso contrário, número ≥ 0. */
export function numeroOpcional(v: unknown, rotulo: string): number | null {
  if (v === '' || v === null || v === undefined) return null;
  return numero(v, rotulo);
}

export interface DadosArtigo {
  nome: string;
  categoria?: string;
  unidade?: string;
  stockMinimo?: number | string | null;
  qtdSugerida?: number | string | null;
  fornecedor?: string;
  preco?: number | string | null;
  notas?: string;
}

function validar(d: DadosArtigo) {
  const nome = d.nome.trim();
  if (!nome) throw new Error('O nome é obrigatório.');
  return {
    nome,
    categoria: (d.categoria ?? '').trim(),
    unidade: (d.unidade ?? '').trim() || 'un',
    stockMinimo: numeroOpcional(d.stockMinimo, 'Stock mínimo'),
    qtdSugerida: numeroOpcional(d.qtdSugerida, 'Quantidade sugerida'),
    fornecedor: (d.fornecedor ?? '').trim(),
    preco: numeroOpcional(d.preco, 'Preço'),
    notas: d.notas ?? ''
  };
}

export async function criarArtigo(db: OfficeDB, dados: DadosArtigo): Promise<Artigo> {
  const v = validar(dados);
  return db.transaction('rw', db.artigos, db.contadores, async () => {
    const t = agora();
    const reg: Artigo = {
      id: novoId(), createdAt: t, updatedAt: t, deletedAt: null,
      codigo: await proximoCodigo(db, 'AR'), ...v, estadoCompra: 'por_comprar'
    };
    await db.artigos.add(reg);
    return reg;
  });
}

export async function atualizarArtigo(db: OfficeDB, id: string, dados: DadosArtigo): Promise<Artigo> {
  const v = validar(dados);
  return db.transaction('rw', db.artigos, async () => {
    const a = await db.artigos.get(id);
    if (!a || a.deletedAt) throw new Error('O artigo não existe.');
    const novo = { ...a, ...v, updatedAt: agora() };
    await db.artigos.put(novo);
    return novo;
  });
}

/** Arquivar (lógico): some das listas; as contagens ficam guardadas. */
export async function arquivarArtigo(db: OfficeDB, id: string): Promise<void> {
  const t = agora();
  const n = await db.artigos.update(id, { deletedAt: t, updatedAt: t });
  if (!n) throw new Error('O artigo não existe.');
}

export async function definirEstadoCompra(db: OfficeDB, id: string, estado: EstadoCompra): Promise<void> {
  const n = await db.artigos.update(id, { estadoCompra: estado, updatedAt: agora() });
  if (!n) throw new Error('O artigo não existe.');
}

/**
 * Regista uma contagem física. Guarda a quantidade anterior e a diferença
 * (só variação entre contagens). Nova contagem volta a pôr a compra em «por comprar».
 */
export async function registarContagem(
  db: OfficeDB,
  artigoId: string,
  localizacaoId: string,
  quantidade: number | string,
  observacoes = ''
): Promise<ContagemStock> {
  const q = numero(quantidade, 'Quantidade');
  return db.transaction('rw', db.artigos, db.localizacoes, db.contagensStock, () => gravarContagem(db, artigoId, localizacaoId, q, observacoes, null));
}

/** Grava uma contagem. Tem de correr dentro de uma transação que inclua artigos, localizações e contagens. */
export async function gravarContagem(
  db: OfficeDB, artigoId: string, localizacaoId: string, q: number, observacoes: string, movimentoId: string | null
): Promise<ContagemStock> {
  const a = await db.artigos.get(artigoId);
  if (!a || a.deletedAt) throw new Error('O artigo não existe.');
  const l = await db.localizacoes.get(localizacaoId);
  if (!l || l.deletedAt) throw new Error('Escolhe um local válido.');
  const anteriores = (await db.contagensStock.where('[artigoId+localizacaoId]').equals([artigoId, localizacaoId]).toArray()).filter((c) => !c.deletedAt);
  const ultima = anteriores.sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1)).at(-1) ?? null;
  let t = agora();
  // Ordem estritamente crescente por (artigo, local), mesmo no mesmo milissegundo.
  if (ultima && t <= ultima.createdAt) t = new Date(Date.parse(ultima.createdAt) + 1).toISOString();
  const reg: ContagemStock = {
    id: novoId(), createdAt: t, updatedAt: t, deletedAt: null,
    artigoId, localizacaoId, quantidade: q,
    anterior: ultima ? ultima.quantidade : null,
    diferenca: ultima ? arred(q - ultima.quantidade) : null,
    observacoes: observacoes.trim(), movimentoId
  };
  await db.contagensStock.add(reg);
  await db.artigos.update(artigoId, { estadoCompra: 'por_comprar', updatedAt: t });
  return reg;
}

// ───────────── cálculo (funções puras) ─────────────

export interface StockLocal {
  localizacaoId: string;
  quantidade: number;
  data: string; // data da contagem que a originou
}

export interface StockArtigo {
  artigo: Artigo;
  total: number;
  porLocal: StockLocal[];
  ultimaContagem: string | null;
}

/** Stock atual = última contagem de cada local; total = soma dos locais. */
export function stockPorArtigo(artigos: Artigo[], contagens: ContagemStock[]): StockArtigo[] {
  const ultimas = new Map<string, ContagemStock>();
  for (const c of contagens) {
    if (c.deletedAt) continue; // anulada
    const k = `${c.artigoId}|${c.localizacaoId}`;
    const atual = ultimas.get(k);
    if (!atual || c.createdAt > atual.createdAt) ultimas.set(k, c);
  }
  return artigos.map((artigo) => {
    const porLocal = [...ultimas.values()]
      .filter((c) => c.artigoId === artigo.id)
      .map((c) => ({ localizacaoId: c.localizacaoId, quantidade: c.quantidade, data: c.createdAt }));
    const datas = porLocal.map((l) => l.data).sort();
    return {
      artigo,
      porLocal,
      total: arred(porLocal.reduce((s, l) => s + l.quantidade, 0)),
      ultimaContagem: datas.at(-1) ?? null
    };
  });
}

export type SituacaoStock = 'sem_minimo' | 'ok' | 'abaixo';
export const situacao = (s: StockArtigo): SituacaoStock =>
  s.artigo.stockMinimo === null ? 'sem_minimo' : s.total < s.artigo.stockMinimo ? 'abaixo' : 'ok';

export interface LinhaCompra {
  artigo: Artigo;
  atual: number;
  minimo: number;
  sugerida: number;
  /** Valor estimado; null se não houver preço. */
  valor: number | null;
}

/** Lista de compras: artigos abaixo do mínimo. Nunca cria encomendas. */
export function listaCompras(stocks: StockArtigo[]): LinhaCompra[] {
  return stocks
    .filter((s) => situacao(s) === 'abaixo')
    .map((s) => {
      const minimo = s.artigo.stockMinimo!;
      const sugerida = s.artigo.qtdSugerida ?? arred(minimo - s.total);
      return { artigo: s.artigo, atual: s.total, minimo, sugerida, valor: s.artigo.preco === null ? null : arred(sugerida * s.artigo.preco) };
    })
    .sort((a, b) => a.artigo.nome.localeCompare(b.artigo.nome, 'pt'));
}

/** Edita só a quantidade sugerida de compra (null = voltar ao cálculo automático). */
export async function definirQtdSugerida(db: OfficeDB, id: string, valor: number | string | null): Promise<void> {
  const v = numeroOpcional(valor, 'Quantidade sugerida');
  const n = await db.artigos.update(id, { qtdSugerida: v, updatedAt: agora() });
  if (!n) throw new Error('O artigo não existe.');
}

/**
 * Anula (lógico) uma contagem feita por engano. Só a mais recente de cada artigo/local,
 * para o histórico continuar coerente: a anterior volta a ser a atual.
 */
export async function anularContagem(db: OfficeDB, id: string): Promise<void> {
  await db.transaction('rw', db.contagensStock, async () => {
    const c = await db.contagensStock.get(id);
    if (!c || c.deletedAt) throw new Error('A contagem não existe.');
    if (c.movimentoId) throw new Error('Esta contagem veio de um movimento: anula o movimento.');
    const ativas = (await db.contagensStock.where('[artigoId+localizacaoId]').equals([c.artigoId, c.localizacaoId]).toArray()).filter((x) => !x.deletedAt);
    const ultima = ativas.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).at(-1);
    if (ultima?.id !== id) throw new Error('Só se pode anular a contagem mais recente deste artigo neste local.');
    const t = agora();
    await db.contagensStock.update(id, { deletedAt: t, updatedAt: t });
  });
}
