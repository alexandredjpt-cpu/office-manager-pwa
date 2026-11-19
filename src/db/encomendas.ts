import type { Encomenda, EncomendaEvento, EncomendaLinha, EstadoEncomenda, Fornecedor, OfficeDB, Rececao, RececaoLinha } from './schema';
import { agora, normalizarData, novoId, proximoCodigo } from './repo';
import { hojeIso } from './agenda';
import { aplicarMovimento } from './movimentos';

const arred = (n: number) => Math.round(n * 1000) / 1000;
const TABELAS_ENC = (db: OfficeDB) => [db.encomendas, db.encomendaLinhas, db.encomendaEventos, db.rececoes, db.fornecedores, db.artigos, db.localizacoes, db.contagensStock, db.movimentosStock];

// ───────────── fornecedores ─────────────

export interface DadosFornecedor { nome: string; contacto?: string; email?: string; telefone?: string; notas?: string }

function validarFornecedor(d: DadosFornecedor) {
  const nome = d.nome.trim();
  if (!nome) throw new Error('O nome do fornecedor é obrigatório.');
  const email = (d.email ?? '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
  return { nome, contacto: (d.contacto ?? '').trim(), email, telefone: (d.telefone ?? '').trim(), notas: d.notas ?? '' };
}

export async function criarFornecedor(db: OfficeDB, d: DadosFornecedor): Promise<Fornecedor> {
  const v = validarFornecedor(d);
  const ativos = await db.fornecedores.filter((f) => !f.deletedAt).toArray();
  if (ativos.some((f) => f.nome.toLowerCase() === v.nome.toLowerCase())) throw new Error('Já existe um fornecedor com este nome.');
  const t = agora();
  const f: Fornecedor = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, ...v };
  await db.fornecedores.add(f);
  return f;
}

export async function atualizarFornecedor(db: OfficeDB, id: string, d: DadosFornecedor): Promise<void> {
  const f = await db.fornecedores.get(id);
  if (!f || f.deletedAt) throw new Error('O fornecedor não existe.');
  const v = validarFornecedor(d);
  const ativos = await db.fornecedores.filter((x) => !x.deletedAt && x.id !== id).toArray();
  if (ativos.some((x) => x.nome.toLowerCase() === v.nome.toLowerCase())) throw new Error('Já existe um fornecedor com este nome.');
  await db.fornecedores.update(id, { ...v, updatedAt: agora() });
}

/** Arquiva (lógico). Bloqueia se houver encomendas em curso. */
export async function arquivarFornecedor(db: OfficeDB, id: string): Promise<void> {
  const emCurso = await db.encomendas.where('fornecedorId').equals(id).filter((e) => !['entregue', 'cancelada'].includes(e.estado)).count();
  if (emCurso > 0) throw new Error(`Há ${emCurso} encomenda(s) em curso com este fornecedor.`);
  const n = await db.fornecedores.update(id, { deletedAt: agora(), updatedAt: agora() });
  if (!n) throw new Error('O fornecedor não existe.');
}

// ───────────── encomendas ─────────────

export const ESTADOS_ENCOMENDA: Record<EstadoEncomenda, string> = {
  rascunho: 'Rascunho', pendente: 'Pendente de aprovação', aprovada: 'Aprovada', encomendada: 'Encomendada',
  parcial: 'Parcialmente entregue', entregue: 'Entregue', cancelada: 'Cancelada'
};

/** Mudanças manuais permitidas. A passagem a parcial/entregue faz-se só pela receção (ou «fechar»). */
export const TRANSICOES: Record<EstadoEncomenda, EstadoEncomenda[]> = {
  rascunho: ['pendente', 'cancelada'],
  pendente: ['aprovada', 'rascunho', 'cancelada'],
  aprovada: ['encomendada', 'cancelada'],
  encomendada: ['cancelada'],
  parcial: ['entregue'], // «fechar como entregue», com confirmação
  entregue: [],
  cancelada: []
};

async function evento(db: OfficeDB, encomendaId: string, tipo: EncomendaEvento['tipo'], texto: string): Promise<void> {
  let t = agora();
  const ult = (await db.encomendaEventos.where('encomendaId').equals(encomendaId).toArray()).map((e) => e.createdAt).sort().at(-1);
  if (ult && t <= ult) t = new Date(Date.parse(ult) + 1).toISOString();
  await db.encomendaEventos.add({ id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, encomendaId, tipo, texto });
}

export async function criarEncomenda(db: OfficeDB, fornecedorId: string, notas = ''): Promise<Encomenda> {
  const f = await db.fornecedores.get(fornecedorId);
  if (!f || f.deletedAt) throw new Error('Escolhe um fornecedor.');
  const codigo = await proximoCodigo(db, 'EN');
  const t = agora();
  const e: Encomenda = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, codigo, fornecedorId, estado: 'rascunho', notas };
  await db.transaction('rw', [db.encomendas, db.encomendaEventos], async () => {
    await db.encomendas.add(e);
    await evento(db, e.id, 'estado', 'Criada como rascunho.');
  });
  return e;
}

async function obter(db: OfficeDB, id: string): Promise<Encomenda> {
  const e = await db.encomendas.get(id);
  if (!e || e.deletedAt) throw new Error('A encomenda não existe.');
  return e;
}

/** Só em rascunho. Uma encomenda nunca é criada a partir de uma necessidade de compra sem passar por aqui. */
export async function definirLinha(db: OfficeDB, encomendaId: string, artigoId: string, quantidade: number | string): Promise<void> {
  const q = Number(String(quantidade).replace(',', '.'));
  if (!Number.isFinite(q) || q <= 0) throw new Error('A quantidade tem de ser maior que zero.');
  await db.transaction('rw', [db.encomendas, db.encomendaLinhas, db.artigos], async () => {
    const e = await obter(db, encomendaId);
    if (e.estado !== 'rascunho') throw new Error('Só se editam linhas em rascunho.');
    const a = await db.artigos.get(artigoId);
    if (!a || a.deletedAt) throw new Error('O artigo não existe.');
    const t = agora();
    const existente = (await db.encomendaLinhas.where('encomendaId').equals(encomendaId).toArray()).find((l) => l.artigoId === artigoId && !l.deletedAt);
    if (existente) await db.encomendaLinhas.update(existente.id, { quantidade: arred(q), updatedAt: t });
    else await db.encomendaLinhas.add({ id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, encomendaId, artigoId, quantidade: arred(q), aceite: 0, danificada: 0, rejeitada: 0 });
  });
}

export async function removerLinha(db: OfficeDB, linhaId: string): Promise<void> {
  const l = await db.encomendaLinhas.get(linhaId);
  if (!l || l.deletedAt) throw new Error('A linha não existe.');
  const e = await obter(db, l.encomendaId);
  if (e.estado !== 'rascunho') throw new Error('Só se editam linhas em rascunho.');
  await db.encomendaLinhas.update(linhaId, { deletedAt: agora(), updatedAt: agora() });
}

export const linhasAtivas = (ls: EncomendaLinha[]) => ls.filter((l) => !l.deletedAt);

export async function mudarEstadoEncomenda(db: OfficeDB, id: string, novo: EstadoEncomenda, nota = ''): Promise<void> {
  await db.transaction('rw', [db.encomendas, db.encomendaLinhas, db.encomendaEventos], async () => {
    const e = await obter(db, id);
    if (!TRANSICOES[e.estado].includes(novo)) throw new Error(`Não se pode passar de «${ESTADOS_ENCOMENDA[e.estado]}» a «${ESTADOS_ENCOMENDA[novo]}».`);
    const ls = linhasAtivas(await db.encomendaLinhas.where('encomendaId').equals(id).toArray());
    if (novo === 'pendente' && ls.length === 0) throw new Error('Adiciona pelo menos um artigo antes de submeter.');
    await db.encomendas.update(id, { estado: novo, updatedAt: agora() });
    await evento(db, id, 'estado', `${ESTADOS_ENCOMENDA[e.estado]} → ${ESTADOS_ENCOMENDA[novo]}${nota.trim() ? `. ${nota.trim()}` : ''}`);
  });
}

// ───────────── receção ─────────────

export interface DadosRececao {
  data?: string;
  localizacaoId?: string;
  responsavel?: string;
  notas?: string;
  linhas: { artigoId: string; aceite?: number | string; danificada?: number | string; rejeitada?: number | string }[];
}

const num = (v: number | string | undefined, nome: string) => {
  if (v === undefined || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${nome}: valor inválido.`);
  return arred(n);
};

/**
 * Regista uma receção (total ou parcial). Só a quantidade ACEITE entra no stock do local escolhido;
 * danificadas e rejeitadas ficam registadas mas não entram. Não deixa aceitar mais do que o pedido.
 * Entregue quando tudo o pedido foi aceite; caso contrário fica «parcialmente entregue».
 */
export async function registarRececao(db: OfficeDB, encomendaId: string, d: DadosRececao): Promise<Rececao> {
  return db.transaction('rw', TABELAS_ENC(db), async () => {
    const e = await obter(db, encomendaId);
    if (e.estado !== 'encomendada' && e.estado !== 'parcial') throw new Error('Só se recebe uma encomenda no estado «Encomendada» ou «Parcialmente entregue».');
    const data = d.data ? normalizarData(d.data, 'Data') : hojeIso();
    if (!data) throw new Error('Escolhe a data da receção.');
    const ls = linhasAtivas(await db.encomendaLinhas.where('encomendaId').equals(encomendaId).toArray());
    const recebidas: RececaoLinha[] = [];
    for (const x of d.linhas) {
      const linha = ls.find((l) => l.artigoId === x.artigoId);
      if (!linha) throw new Error('Há um artigo que não pertence a esta encomenda.');
      const r = { artigoId: x.artigoId, aceite: num(x.aceite, 'Aceite'), danificada: num(x.danificada, 'Danificada'), rejeitada: num(x.rejeitada, 'Rejeitada') };
      if (r.aceite + r.danificada + r.rejeitada === 0) continue;
      const falta = arred(linha.quantidade - linha.aceite);
      if (r.aceite > falta) throw new Error(`Só faltam ${falta} por receber deste artigo; não dá para aceitar ${r.aceite}.`);
      recebidas.push(r);
    }
    if (recebidas.length === 0) throw new Error('Indica pelo menos uma quantidade recebida.');
    const entraStock = recebidas.some((r) => r.aceite > 0);
    if (entraStock) {
      const loc = d.localizacaoId ? await db.localizacoes.get(d.localizacaoId) : null;
      if (!loc || loc.deletedAt) throw new Error('Escolhe o local onde entra o stock aceite.');
    }
    const t = agora();
    const rec: Rececao = {
      id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, encomendaId, data,
      localizacaoId: entraStock ? d.localizacaoId! : null, responsavel: (d.responsavel ?? '').trim(), notas: d.notas ?? '', linhas: recebidas
    };
    await db.rececoes.add(rec);
    for (const r of recebidas) {
      const linha = ls.find((l) => l.artigoId === r.artigoId)!;
      await db.encomendaLinhas.update(linha.id, {
        aceite: arred(linha.aceite + r.aceite), danificada: arred(linha.danificada + r.danificada), rejeitada: arred(linha.rejeitada + r.rejeitada), updatedAt: t
      });
      linha.aceite = arred(linha.aceite + r.aceite);
      if (r.aceite > 0) {
        await aplicarMovimento(db, {
          artigoId: r.artigoId, tipo: 'entrada', quantidade: r.aceite, origemId: d.localizacaoId!, motivo: `Receção ${e.codigo}`,
          responsavel: d.responsavel, data, rececaoId: rec.id
        });
      }
    }
    const completa = ls.every((l) => l.aceite >= l.quantidade);
    const novo: EstadoEncomenda = completa ? 'entregue' : 'parcial';
    await db.encomendas.update(encomendaId, { estado: novo, updatedAt: t });
    const resumo = recebidas.map((r) => `${r.aceite} aceite${r.danificada ? `, ${r.danificada} danificada(s)` : ''}${r.rejeitada ? `, ${r.rejeitada} rejeitada(s)` : ''}`).join('; ');
    await evento(db, encomendaId, 'rececao', `Receção em ${data}: ${resumo}. Estado: ${ESTADOS_ENCOMENDA[novo]}.`);
    return rec;
  });
}

export async function adicionarNota(db: OfficeDB, id: string, texto: string): Promise<void> {
  if (!texto.trim()) throw new Error('Escreve a nota.');
  await obter(db, id);
  await evento(db, id, 'nota', texto.trim());
}

/** Quantidade que ainda falta receber de cada linha. */
export const emFalta = (l: EncomendaLinha) => arred(Math.max(0, l.quantidade - l.aceite));
