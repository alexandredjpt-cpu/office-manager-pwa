import type { OfficeDB, Prioridade } from '../db/schema';
import { listaCompras, stockPorArtigo } from '../db/stock';
import { gerarPdfTabela, type Cabecalho } from './pdf';
import { linhasReposicao } from '../db/kits';
import { relatorioReposicao, relatorioDiferencas, linhasDiferencas, type FiltroDiferencas } from './relatorios';
import { criarXlsx } from './xlsx';
import { fotoParaPdf, gerarPdfAnomalia, relatorioCompras, relatorioInventario, relatorioPendentes, relatorioResolvidas, type FotoPdf } from './relatorios';
import { gerarPdfPeriodo, periodoDe, relatorioPeriodo, type TipoPeriodo } from './periodico';

const CHAVE_RESPONSAVEL = 'responsavel';
const hoje = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const lerResponsavel = async (db: OfficeDB) => (await db.meta.get(CHAVE_RESPONSAVEL))?.valor ?? '';
export const guardarResponsavel = (db: OfficeDB, nome: string) => db.meta.put({ chave: CHAVE_RESPONSAVEL, valor: nome.trim() });

async function contexto(db: OfficeDB) {
  const [locais, equips] = await Promise.all([db.localizacoes.toArray(), db.equipamentos.toArray()]);
  const cab: Cabecalho = { emitidoEm: new Date(), responsavel: await lerResponsavel(db) };
  return {
    cab,
    pisoDe: (id: string) => locais.find((l) => l.id === id)?.piso ?? '',
    nomeLocal: (id: string) => locais.find((l) => l.id === id)?.nome ?? '?',
    nomeEquip: (id: string | null) => (id ? equips.find((e) => e.id === id)?.nome ?? '?' : '')
  };
}

export type Resultado = { blob: Blob; nome: string };

export async function pdfPendentes(db: OfficeDB, prioridade: Prioridade | '', piso = ''): Promise<Resultado> {
  const c = await contexto(db);
  const rel = relatorioPendentes(await db.anomalias.filter((a) => !a.deletedAt).toArray(), c.nomeLocal, c.nomeEquip, { prioridade, piso, pisoDe: c.pisoDe });
  return { blob: await gerarPdfTabela(rel, c.cab), nome: `anomalias-pendentes-${hoje()}.pdf` };
}

export async function pdfResolvidas(db: OfficeDB, de: string, ate: string): Promise<Resultado> {
  const c = await contexto(db);
  const rel = relatorioResolvidas(await db.anomalias.toArray(), await db.atividades.toArray(), c.nomeLocal, { de, ate });
  return { blob: await gerarPdfTabela(rel, c.cab), nome: `anomalias-resolvidas-${hoje()}.pdf` };
}

async function stocks(db: OfficeDB) {
  return stockPorArtigo(await db.artigos.filter((a) => !a.deletedAt).toArray(), await db.contagensStock.toArray());
}

export async function pdfInventario(db: OfficeDB, localizacaoId: string): Promise<Resultado> {
  const c = await contexto(db);
  const rel = relatorioInventario(await stocks(db), c.nomeLocal, { localizacaoId });
  return { blob: await gerarPdfTabela(rel, c.cab), nome: `inventario-${hoje()}.pdf` };
}

export async function pdfCompras(db: OfficeDB): Promise<Resultado> {
  const c = await contexto(db);
  return { blob: await gerarPdfTabela(relatorioCompras(listaCompras(await stocks(db))), c.cab), nome: `necessidades-compra-${hoje()}.pdf` };
}

export async function pdfAnomalia(db: OfficeDB, id: string): Promise<Resultado> {
  const a = await db.anomalias.get(id);
  if (!a || a.deletedAt) throw new Error('A anomalia não existe.');
  const c = await contexto(db);
  const fotosDb = await db.fotografias.where('[entidade+entidadeId]').equals(['anomalia', id]).filter((f) => !f.deletedAt).sortBy('createdAt');
  const paraPdf = async (l: typeof fotosDb) => (await Promise.all(l.map(fotoParaPdf))).filter((f): f is FotoPdf => f !== null);
  const fotos = await paraPdf(fotosDb.filter((f) => f.fase !== 'depois'));
  const depois = await paraPdf(fotosDb.filter((f) => f.fase === 'depois'));
  const blob = await gerarPdfAnomalia(a, c.nomeLocal, c.nomeEquip, await db.atividades.where('anomaliaId').equals(id).toArray(), fotos, c.cab, depois);
  return { blob, nome: `anomalia-${a.codigo}.pdf` };
}

import { gerarPdfInspecao, relatorioHistoricoInspecoes } from './relatorios';

export async function pdfHistoricoInspecoes(db: OfficeDB, localizacaoId: string, piso = ''): Promise<Resultado> {
  const c = await contexto(db);
  const rel = relatorioHistoricoInspecoes(await db.inspecoes.toArray(), await db.inspecaoLinhas.toArray(), c.nomeLocal, { localizacaoId, piso, pisoDe: c.pisoDe });
  return { blob: await gerarPdfTabela(rel, c.cab), nome: `historico-inspecoes-${hoje()}.pdf` };
}

export async function pdfInspecao(db: OfficeDB, id: string): Promise<Resultado> {
  const i = await db.inspecoes.get(id);
  if (!i) throw new Error('A inspeção não existe.');
  const c = await contexto(db);
  const [linhas, equips, anomalias] = await Promise.all([db.inspecaoLinhas.where('inspecaoId').equals(id).toArray(), db.equipamentos.toArray(), db.anomalias.toArray()]);
  const itens = linhas
    .map((linha) => {
      const e = equips.find((x) => x.id === linha.equipamentoId);
      return { linha, codigo: e?.codigo ?? '?', nome: e?.nome ?? '?', codigoAnomalia: anomalias.find((a) => a.id === linha.anomaliaId)?.codigo ?? '' };
    })
    .sort((a, b) => a.codigo.localeCompare(b.codigo));
  // Fotografias da inspeção e, a seguir, as tiradas a cada equipamento (pela ordem dos equipamentos).
  const todasInsp = await db.fotografias.where('[entidade+entidadeId]').equals(['inspecao', id]).filter((f) => !f.deletedAt).sortBy('createdAt');
  const daInspecao = todasInsp.filter((f) => f.fase !== 'assinatura');
  const ass = todasInsp.filter((f) => f.fase === 'assinatura').pop();
  const assPdf = ass ? await fotoParaPdf(ass) : null;
  const porLinha = (await Promise.all(itens.map((it) => db.fotografias.where('[entidade+entidadeId]').equals(['inspecaoLinha', it.linha.id]).filter((f) => !f.deletedAt).sortBy('createdAt')))).flat();
  const fotos = (await Promise.all([...daInspecao, ...porLinha].map(fotoParaPdf))).filter((f): f is FotoPdf => f !== null);
  return { blob: await gerarPdfInspecao(i, c.nomeLocal(i.localizacaoId), itens, fotos, c.cab, assPdf && ass ? { foto: assPdf, nome: ass.legenda ?? '', quando: ass.createdAt } : null), nome: `inspecao-${i.codigo}.pdf` };
}

/** Folha de reposição dos kits ('' = todos os locais com kits). */
export async function pdfReposicao(db: OfficeDB, localizacaoId: string): Promise<Resultado> {
  const c = await contexto(db);
  const linhas = linhasReposicao(await db.kits.toArray(), await db.kitLocais.toArray(), await db.artigos.toArray(), await db.contagensStock.toArray(), localizacaoId);
  if (linhas.length === 0) throw new Error(localizacaoId ? 'Este local não tem kits com artigos.' : 'Ainda não há kits aplicados a locais.');
  const sufixo = localizacaoId ? c.nomeLocal(localizacaoId).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'todos';
  return { blob: await gerarPdfTabela(relatorioReposicao(linhas, c.nomeLocal, localizacaoId), c.cab), nome: `reposicao-${sufixo}-${hoje()}.pdf` };
}

async function dadosDiferencas(db: OfficeDB, f: FiltroDiferencas) {
  const c = await contexto(db);
  const linhas = linhasDiferencas(await db.contagensStock.toArray(), await db.artigos.toArray(), await db.movimentosStock.toArray(), c.nomeLocal, f);
  if (linhas.length === 0) throw new Error('Não há diferenças entre contagens com estes filtros.');
  return { c, linhas };
}

export async function pdfDiferencas(db: OfficeDB, f: FiltroDiferencas): Promise<Resultado> {
  const { c, linhas } = await dadosDiferencas(db, f);
  return { blob: await gerarPdfTabela(relatorioDiferencas(linhas, f, c.nomeLocal), c.cab), nome: `diferencas-contagens-${hoje()}.pdf` };
}

export async function xlsxDiferencas(db: OfficeDB, f: FiltroDiferencas): Promise<Resultado> {
  const { linhas } = await dadosDiferencas(db, f);
  const cab = ['Data', 'Local', 'Código', 'Artigo', 'Unidade', 'Anterior', 'Contado', 'Diferença', 'Origem', 'Observações'];
  const rows = linhas.map((l) => [l.data.slice(0, 16).replace('T', ' '), l.local, l.codigo, l.artigo, l.unidade, l.anterior, l.contado, l.diferenca, l.origem, l.observacoes]);
  return { blob: await criarXlsx('Diferenças', cab, rows), nome: `diferencas-contagens-${hoje()}.xlsx` };
}

/** Relatório semanal ou mensal: anomalias, inspeções, encomendas e compras. */
export async function pdfPeriodo(db: OfficeDB, tipo: TipoPeriodo, hojeData = new Date()): Promise<Resultado> {
  const c = await contexto(db);
  const p = periodoDe(tipo, hojeData);
  const [anomalias, inspecoes, linhasInspecao, encomendas, fornecedores] = await Promise.all([
    db.anomalias.toArray(), db.inspecoes.toArray(), db.inspecaoLinhas.toArray(), db.encomendas.toArray(), db.fornecedores.toArray()
  ]);
  const r = relatorioPeriodo({ anomalias, inspecoes, linhasInspecao, encomendas, fornecedores, compras: listaCompras(await stocks(db)), nomeLocal: c.nomeLocal, nomeEquip: c.nomeEquip }, p);
  return { blob: await gerarPdfPeriodo(r, c.cab), nome: `relatorio-${p.de}-a-${p.ate}.pdf` };
}

/** Etiquetas QR dos locais (todos os ativos, ou só os indicados), pela ordem do nome. */
export async function pdfEtiquetasLocais(db: OfficeDB, base: string, ids?: string[]): Promise<Resultado> {
  const { gerarPdfEtiquetas } = await import('./etiquetas');
  const locais = (await db.localizacoes.toArray()).filter((l) => !l.deletedAt && (!ids || ids.includes(l.id))).sort((a, b) => a.nome.localeCompare(b.nome, 'pt', { numeric: true }));
  if (locais.length === 0) throw new Error('Não há locais para etiquetar.');
  return { blob: await gerarPdfEtiquetas(locais, base), nome: `etiquetas-locais-${new Date().toISOString().slice(0, 10)}.pdf` };
}
