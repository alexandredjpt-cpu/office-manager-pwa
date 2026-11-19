import type { Encomenda, EncomendaLinha, Artigo, Fornecedor } from './schema';

export interface ModeloBase { nome: string; assunto: string; corpo: string }

/** Modelos que vêm com a app (só leitura; podem ser duplicados para editar). Sem dados pessoais. */
export const MODELOS_BASE: ModeloBase[] = [
  {
    nome: 'Pedido de encomenda',
    assunto: 'Pedido de encomenda {{encomenda}}',
    corpo: 'Bom dia {{contacto}},\n\nGostaria de encomendar:\n\n{{artigos}}\n\nPeço confirmação de disponibilidade e prazo de entrega.\n\nCumprimentos,\n{{responsavel}}'
  },
  {
    nome: 'Pedido de orçamento',
    assunto: 'Pedido de orçamento ({{encomenda}})',
    corpo: 'Bom dia {{contacto}},\n\nPeço orçamento para:\n\n{{artigos}}\n\nObrigado,\n{{responsavel}}'
  },
  {
    nome: 'Reclamação de receção',
    assunto: 'Reclamação — encomenda {{encomenda}}',
    corpo: 'Bom dia {{contacto}},\n\nNa receção da encomenda {{encomenda}} ({{data}}) verifiquei diferenças em relação ao pedido:\n\n{{artigos}}\n\nAgradeço indicação de como proceder.\n\nCumprimentos,\n{{responsavel}}'
  }
];

export const CAMPOS = ['fornecedor', 'contacto', 'encomenda', 'artigos', 'responsavel', 'data'] as const;
export type Campo = (typeof CAMPOS)[number];

/** Campos de uma encomenda. «contacto» cai para uma saudação neutra se não houver. */
export function camposEncomenda(
  e: Encomenda, f: Fornecedor | undefined, linhas: EncomendaLinha[], artigos: Artigo[], responsavel: string, hoje: string
): Record<Campo, string> {
  const nome = (id: string) => artigos.find((a) => a.id === id)?.nome ?? '?';
  const un = (id: string) => artigos.find((a) => a.id === id)?.unidade ?? '';
  const lista = linhas.filter((l) => !l.deletedAt).sort((a, b) => nome(a.artigoId).localeCompare(nome(b.artigoId), 'pt'))
    .map((l) => `- ${l.quantidade} ${un(l.artigoId)} ${nome(l.artigoId)}`.replace(/ {2,}/g, ' ')).join('\n');
  return { fornecedor: f?.nome ?? '', contacto: f?.contacto || 'Exmos. Senhores', encomenda: e.codigo, artigos: lista, responsavel, data: hoje };
}

export interface Preenchido { assunto: string; corpo: string; emBranco: Campo[]; desconhecidos: string[] }

/** Substitui {{campo}}. Campos vazios e campos que não existem ficam sinalizados (e visíveis no texto). */
export function preencher(modelo: { assunto: string; corpo: string }, campos: Record<Campo, string>): Preenchido {
  const emBranco = new Set<Campo>();
  const desconhecidos = new Set<string>();
  const sub = (t: string) => t.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (m, k: string) => {
    if (!(CAMPOS as readonly string[]).includes(k)) { desconhecidos.add(k); return m; }
    const v = campos[k as Campo];
    if (!v.trim()) emBranco.add(k as Campo);
    return v;
  });
  return { assunto: sub(modelo.assunto), corpo: sub(modelo.corpo), emBranco: [...emBranco], desconhecidos: [...desconhecidos] };
}

/** Limite prático de URL em clientes de e-mail móveis. */
export const LIMITE_MAILTO = 1800;

export function montarMailto(para: string, assunto: string, corpo: string): string {
  return `mailto:${encodeURIComponent(para.trim()).replace(/%40/g, '@')}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}
