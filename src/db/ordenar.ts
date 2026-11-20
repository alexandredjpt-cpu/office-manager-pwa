import type { Anomalia, Equipamento, Localizacao } from './schema';
import type { StockArtigo } from './stock';
import { ordenarAnomalias } from './anomalias';

/** Ordens disponíveis em cada lista. A primeira de cada lista é a ordem de sempre (por omissão). */
export const ORDENS = {
  anomalias: { prioridade: 'Prioridade', recentes: 'Mais recentes', antigas: 'Mais antigas', local: 'Local', estado: 'Estado' },
  equipamentos: { codigo: 'Código', nome: 'Nome', local: 'Local', categoria: 'Categoria', recentes: 'Mais recentes', garantia: 'Fim da garantia' },
  locais: { nome: 'Nome', piso: 'Piso', equipamentos: 'Nº de equipamentos' },
  artigos: { nome: 'Nome', falta: 'Mais em falta', categoria: 'Categoria', codigo: 'Código' }
} as const;

export type ListaOrdenavel = keyof typeof ORDENS;
export type Ordem<L extends ListaOrdenavel> = keyof (typeof ORDENS)[L];

const txt = (a: string, b: string) => a.localeCompare(b, 'pt', { numeric: true, sensitivity: 'base' });
/** Vazios vão sempre para o fim. */
const txtVazioFim = (a: string, b: string) => (!a && b ? 1 : a && !b ? -1 : txt(a, b));

const PESO_ESTADO: Record<Anomalia['estado'], number> = { por_resolver: 0, em_intervencao: 1, aguarda_verificacao: 2, resolvida: 3 };

export function ordenarListaAnomalias(lista: Anomalia[], ordem: Ordem<'anomalias'>, nomeLocal: (id: string) => string): Anomalia[] {
  const base = ordenarAnomalias(lista); // desempate estável: prioridade e antiguidade
  const pos = new Map(base.map((a, i) => [a.id, i]));
  const desempate = (a: Anomalia, b: Anomalia) => pos.get(a.id)! - pos.get(b.id)!;
  switch (ordem) {
    case 'recentes': return [...lista].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case 'antigas': return [...lista].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case 'local': return [...lista].sort((a, b) => txt(nomeLocal(a.localizacaoId), nomeLocal(b.localizacaoId)) || desempate(a, b));
    case 'estado': return [...lista].sort((a, b) => PESO_ESTADO[a.estado] - PESO_ESTADO[b.estado] || desempate(a, b));
    default: return base;
  }
}

export function ordenarListaEquipamentos(lista: Equipamento[], ordem: Ordem<'equipamentos'>, nomeLocal: (id: string | null) => string): Equipamento[] {
  const porCodigo = (a: Equipamento, b: Equipamento) => a.codigo.localeCompare(b.codigo);
  switch (ordem) {
    case 'nome': return [...lista].sort((a, b) => txt(a.nome, b.nome) || porCodigo(a, b));
    case 'local': return [...lista].sort((a, b) => txtVazioFim(nomeLocal(a.localizacaoId), nomeLocal(b.localizacaoId)) || txt(a.nome, b.nome) || porCodigo(a, b));
    case 'categoria': return [...lista].sort((a, b) => txtVazioFim(a.categoria, b.categoria) || txt(a.nome, b.nome) || porCodigo(a, b));
    case 'recentes': return [...lista].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || porCodigo(b, a));
    case 'garantia': return [...lista].sort((a, b) => txtVazioFim(a.fimGarantia ?? '', b.fimGarantia ?? '') || porCodigo(a, b));
    default: return [...lista].sort(porCodigo);
  }
}

export function ordenarListaLocais<T extends { l: Localizacao; n: number }>(lista: T[], ordem: Ordem<'locais'>): T[] {
  const porNome = (a: T, b: T) => txt(a.l.nome, b.l.nome);
  switch (ordem) {
    case 'piso': return [...lista].sort((a, b) => txtVazioFim(a.l.piso ?? '', b.l.piso ?? '') || porNome(a, b));
    case 'equipamentos': return [...lista].sort((a, b) => b.n - a.n || porNome(a, b));
    default: return [...lista].sort(porNome);
  }
}

/** Quanto falta para o mínimo (positivo = abaixo). Sem mínimo definido vai para o fim. */
const falta = (s: StockArtigo) => (s.artigo.stockMinimo === null ? -Infinity : s.artigo.stockMinimo - s.total);

export function ordenarListaArtigos(lista: StockArtigo[], ordem: Ordem<'artigos'>): StockArtigo[] {
  const porNome = (a: StockArtigo, b: StockArtigo) => txt(a.artigo.nome, b.artigo.nome);
  switch (ordem) {
    case 'falta': return [...lista].sort((a, b) => falta(b) - falta(a) || porNome(a, b));
    case 'categoria': return [...lista].sort((a, b) => txtVazioFim(a.artigo.categoria, b.artigo.categoria) || porNome(a, b));
    case 'codigo': return [...lista].sort((a, b) => a.artigo.codigo.localeCompare(b.artigo.codigo));
    default: return [...lista].sort(porNome);
  }
}

/** A ordem escolhida fica guardada neste telemóvel, por lista. */
export function lerOrdem<L extends ListaOrdenavel>(lista: L, armazem: Pick<Storage, 'getItem'> | null = globalThis.localStorage ?? null): Ordem<L> {
  const padrao = Object.keys(ORDENS[lista])[0] as Ordem<L>;
  try {
    const v = armazem?.getItem(`om.ordem.${lista}`);
    return v && v in ORDENS[lista] ? (v as Ordem<L>) : padrao;
  } catch { return padrao; }
}

export function guardarOrdem<L extends ListaOrdenavel>(lista: L, ordem: Ordem<L>, armazem: Pick<Storage, 'setItem'> | null = globalThis.localStorage ?? null): void {
  try { armazem?.setItem(`om.ordem.${lista}`, String(ordem)); } catch { /* sem armazenamento: só nesta sessão */ }
}
