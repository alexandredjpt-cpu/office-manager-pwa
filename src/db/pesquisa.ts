import type { Anomalia, Artigo, Equipamento, Localizacao } from './schema';
import { normalizar } from './consultas';

export type TipoResultado = 'equipamento' | 'artigo' | 'local' | 'anomalia';
export interface ResultadoPesquisa { tipo: TipoResultado; id: string; titulo: string; detalhe: string; rota: string }

export interface DadosPesquisa {
  equipamentos: Equipamento[];
  artigos: Artigo[];
  locais: Localizacao[];
  anomalias: Anomalia[];
  /** Descrição dos locais onde há stock de um artigo. */
  stockDe: (artigoId: string) => string;
  nomeLocal: (id: string) => string;
}

export const MIN_CARACTERES = 2;
const LIMITE = 8;

const bate = (termos: string[], ...campos: (string | null | undefined)[]) => {
  const palheiro = normalizar(campos.filter(Boolean).join(' '));
  return termos.every((t) => palheiro.includes(t));
};

/** Procura em tudo ao mesmo tempo; devolve no máximo 8 resultados por tipo. */
export function pesquisar(texto: string, d: DadosPesquisa): ResultadoPesquisa[] {
  const termos = normalizar(texto).split(/\s+/).filter(Boolean);
  if (termos.join('').length < MIN_CARACTERES) return [];
  const fim = <T,>(l: T[]) => l.slice(0, LIMITE);
  return [
    ...fim(d.equipamentos.filter((e) => !e.deletedAt && bate(termos, e.codigo, e.nome, e.categoria, e.marca, e.modelo, e.numeroSerie, e.notas, d.nomeLocal(e.localizacaoId ?? ''))))
      .map((e) => ({ tipo: 'equipamento' as const, id: e.id, titulo: e.nome, detalhe: `${e.codigo} · ${d.nomeLocal(e.localizacaoId ?? '') || 'sem local'}`, rota: `/equipamentos/${e.id}` })),
    ...fim(d.artigos.filter((a) => !a.deletedAt && bate(termos, a.codigo, a.nome, a.categoria, a.fornecedor, a.notas)))
      .map((a) => ({ tipo: 'artigo' as const, id: a.id, titulo: a.nome, detalhe: `${a.codigo} · ${d.stockDe(a.id)}`, rota: `/stock/${a.id}` })),
    ...fim(d.locais.filter((l) => !l.deletedAt && bate(termos, l.nome, l.notas)))
      .map((l) => ({ tipo: 'local' as const, id: l.id, titulo: l.nome, detalhe: 'Local', rota: `/locais/${l.id}` })),
    ...fim(d.anomalias.filter((a) => !a.deletedAt && bate(termos, a.codigo, a.titulo, a.descricao, d.nomeLocal(a.localizacaoId))))
      .map((a) => ({ tipo: 'anomalia' as const, id: a.id, titulo: a.titulo, detalhe: `${a.codigo} · ${d.nomeLocal(a.localizacaoId)}`, rota: `/anomalias/${a.id}` }))
  ];
}
