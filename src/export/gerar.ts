import type { OfficeDB, Prioridade } from '../db/schema';
import { listaCompras, stockPorArtigo } from '../db/stock';
import { gerarPdfTabela, type Cabecalho } from './pdf';
import { fotoParaPdf, gerarPdfAnomalia, relatorioCompras, relatorioInventario, relatorioPendentes, relatorioResolvidas, type FotoPdf } from './relatorios';

const CHAVE_RESPONSAVEL = 'responsavel';
const hoje = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const lerResponsavel = async (db: OfficeDB) => (await db.meta.get(CHAVE_RESPONSAVEL))?.valor ?? '';
export const guardarResponsavel = (db: OfficeDB, nome: string) => db.meta.put({ chave: CHAVE_RESPONSAVEL, valor: nome.trim() });

async function contexto(db: OfficeDB) {
  const [locais, equips] = await Promise.all([db.localizacoes.toArray(), db.equipamentos.toArray()]);
  const cab: Cabecalho = { emitidoEm: new Date(), responsavel: await lerResponsavel(db) };
  return {
    cab,
    nomeLocal: (id: string) => locais.find((l) => l.id === id)?.nome ?? '?',
    nomeEquip: (id: string | null) => (id ? equips.find((e) => e.id === id)?.nome ?? '?' : '')
  };
}

export type Resultado = { blob: Blob; nome: string };

export async function pdfPendentes(db: OfficeDB, prioridade: Prioridade | ''): Promise<Resultado> {
  const c = await contexto(db);
  const rel = relatorioPendentes(await db.anomalias.filter((a) => !a.deletedAt).toArray(), c.nomeLocal, c.nomeEquip, { prioridade });
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
  const fotos = (await Promise.all(fotosDb.map(fotoParaPdf))).filter((f): f is FotoPdf => f !== null);
  const blob = await gerarPdfAnomalia(a, c.nomeLocal, c.nomeEquip, await db.atividades.where('anomaliaId').equals(id).toArray(), fotos, c.cab);
  return { blob, nome: `anomalia-${a.codigo}.pdf` };
}
