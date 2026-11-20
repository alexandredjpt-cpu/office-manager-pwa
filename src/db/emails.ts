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
    nome: 'Pedido de aprovação',
    assunto: 'Pedido de aprovação — encomenda {{encomenda}}',
    corpo: 'Bom dia {{aprovador}},\n\nPeço aprovação para a encomenda {{encomenda}} ao fornecedor {{fornecedor}}:\n\n{{artigos}}\n\nTotal estimado: {{total}}\n\nObrigado,\n{{responsavel}}'
  },
  {
    nome: 'Reclamação de receção',
    assunto: 'Reclamação — encomenda {{encomenda}}',
    corpo: 'Bom dia {{contacto}},\n\nNa receção da encomenda {{encomenda}} ({{data}}) verifiquei diferenças em relação ao pedido:\n\n{{artigos}}\n\nAgradeço indicação de como proceder.\n\nCumprimentos,\n{{responsavel}}'
  },
  {
    nome: 'Comunicação de avaria a fornecedor',
    assunto: 'Avaria {{anomalia}} — {{equipamento}}',
    corpo: 'Bom dia {{contacto}},\n\nComunico a seguinte avaria:\n\nEquipamento: {{equipamento}}\nLocal: {{local}}\nDescrição: {{descricao}}\nPrioridade: {{prioridade}}\nReferência: {{anomalia}}\n\nPeço indicação de data para a intervenção.\n\nCumprimentos,\n{{responsavel}}'
  },
  {
    nome: 'Intervenção concluída',
    assunto: 'Intervenção concluída — {{anomalia}}',
    corpo: 'Bom dia {{contacto}},\n\nInformo que a intervenção relativa a {{anomalia}} ({{descricao}}, {{local}}) foi concluída em {{data}}.\nEstado atual: {{estado}}.\n\nCumprimentos,\n{{responsavel}}'
  },
  {
    nome: 'Envio de relatório de anomalias',
    assunto: 'Relatório de anomalias — {{data}}',
    corpo: 'Bom dia {{contacto}},\n\nEnvio em anexo o relatório de anomalias de {{data}}.\n\nCumprimentos,\n{{responsavel}}'
  },
  {
    nome: 'Envio de relatório de inspeção',
    assunto: 'Relatório de inspeção {{inspecao}} — {{local}}',
    corpo: 'Bom dia {{contacto}},\n\nEnvio em anexo o relatório da inspeção {{inspecao}} realizada em {{local}} ({{data}}).\n\nCumprimentos,\n{{responsavel}}'
  },
  {
    nome: 'Envio de inventário',
    assunto: 'Inventário — {{data}}',
    corpo: 'Bom dia {{contacto}},\n\nEnvio em anexo o inventário de {{data}}.\n\nCumprimentos,\n{{responsavel}}'
  }
];

export const CAMPOS = ['fornecedor', 'contacto', 'encomenda', 'artigos', 'responsavel', 'data', 'aprovador', 'total', 'anomalia', 'equipamento', 'local', 'descricao', 'prioridade', 'estado', 'inspecao'] as const;
export type Campo = (typeof CAMPOS)[number];

/** Todos os campos vazios (base para preencher só os que interessam). */
export function camposVazios(): Record<Campo, string> {
  return Object.fromEntries(CAMPOS.map((c) => [c, ''])) as Record<Campo, string>;
}

/** Campos de uma encomenda. «contacto» cai para uma saudação neutra se não houver. */
export function camposEncomenda(
  e: Encomenda, f: Fornecedor | undefined, linhas: EncomendaLinha[], artigos: Artigo[], responsavel: string, hoje: string, aprovador = ''
): Record<Campo, string> {
  const nome = (id: string) => artigos.find((a) => a.id === id)?.nome ?? '?';
  const un = (id: string) => artigos.find((a) => a.id === id)?.unidade ?? '';
  const lista = linhas.filter((l) => !l.deletedAt).sort((a, b) => nome(a.artigoId).localeCompare(nome(b.artigoId), 'pt'))
    .map((l) => `- ${l.quantidade} ${un(l.artigoId)} ${nome(l.artigoId)}`.replace(/ {2,}/g, ' ')).join('\n');
  const ativas = linhas.filter((l) => !l.deletedAt);
  const comPreco = ativas.filter((l) => artigos.find((a) => a.id === l.artigoId)?.preco != null);
  const soma = comPreco.reduce((t, l) => t + l.quantidade * (artigos.find((a) => a.id === l.artigoId)!.preco as number), 0);
  const semPreco = ativas.length - comPreco.length;
  const total = comPreco.length === 0 ? '' : `${soma.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })}${semPreco ? ` (sem preço em ${semPreco} artigo(s))` : ''}`;
  return { ...camposVazios(), fornecedor: f?.nome ?? '', contacto: f?.contacto || 'Exmos. Senhores', encomenda: e.codigo, artigos: lista, responsavel, data: hoje, aprovador, total };
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

/** Número para wa.me (só dígitos, com indicativo). 9 dígitos = Portugal (351). Devolve null se não der para usar. */
export function numeroWhatsApp(tel: string): string | null {
  let d = tel.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (/^[29]\d{8}$/.test(d)) d = `351${d}`;
  return /^\d{10,15}$/.test(d) ? d : null;
}

export const montarWhatsApp = (tel: string, texto: string): string | null => {
  const n = numeroWhatsApp(tel);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(texto)}` : null;
};

/** Mensagem curta a avisar que há um e-mail à espera de aprovação. */
export const textoAvisoAprovacao = (aprovador: string, codigo: string, fornecedor: string, responsavel: string) =>
  `${aprovador ? `Olá ${aprovador}, ` : 'Olá, '}enviei-te um e-mail com o pedido de aprovação da encomenda ${codigo}${fornecedor ? ` (${fornecedor})` : ''}. Consegues ver quando puderes?${responsavel ? ` — ${responsavel}` : ''}`;
