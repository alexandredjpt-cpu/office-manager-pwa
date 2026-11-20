import type { Marcador, OfficeDB } from './schema';
import { agora, novoId } from './repo';

/** Coloca (ou move) o marcador de um item numa planta. Um item só tem um marcador por planta. */
export async function colocarMarcador(db: OfficeDB, documentoId: string, tipo: Marcador['tipo'], refId: string, x: number, y: number): Promise<Marcador> {
  if (![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Posição fora da planta.');
  return db.transaction('rw', [db.documentos, db.equipamentos, db.artigos, db.anomalias, db.localizacoes, db.marcadores], async () => {
    const doc = await db.documentos.get(documentoId);
    if (!doc || doc.deletedAt) throw new Error('A planta não existe.');
    if (!doc.mime.startsWith('image/')) throw new Error('A planta tem de ser uma imagem (não PDF).');
    const alvo = tipo === 'equipamento' ? await db.equipamentos.get(refId) : tipo === 'anomalia' ? await db.anomalias.get(refId) : tipo === 'local' ? await db.localizacoes.get(refId) : await db.artigos.get(refId);
    if (tipo === 'local' && refId === doc.entidadeId) throw new Error('Escolhe outro local (um armário ou prateleira dentro deste).');
    if (!alvo || alvo.deletedAt) throw new Error('O item não existe.');
    const t = agora();
    // Equipamento, anomalia e local de armazenamento são únicos: um só ponto por planta (volta a colocar = mover).
    // Artigo pode estar em vários sítios: cada colocação cria um ponto novo.
    const existente = tipo !== 'artigo' ? (await db.marcadores.where('documentoId').equals(documentoId).toArray()).find((m) => !m.deletedAt && m.tipo === tipo && m.refId === refId) : undefined;
    if (existente) {
      await db.marcadores.update(existente.id, { x, y, updatedAt: t });
      return { ...existente, x, y, updatedAt: t };
    }
    const m: Marcador = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, documentoId, tipo, refId, x, y };
    await db.marcadores.add(m);
    return m;
  });
}

export async function removerMarcador(db: OfficeDB, id: string): Promise<void> {
  const n = await db.marcadores.update(id, { deletedAt: agora(), updatedAt: agora() });
  if (!n) throw new Error('O marcador não existe.');
}

/** Onde está um item: planta (documento) e local a que pertence. */
export async function ondeEsta(db: OfficeDB, tipo: Marcador['tipo'], refId: string): Promise<{ marcador: Marcador; localizacaoId: string }[]> {
  const ms = (await db.marcadores.where('[tipo+refId]').equals([tipo, refId]).toArray()).filter((m) => !m.deletedAt);
  const res: { marcador: Marcador; localizacaoId: string }[] = [];
  for (const m of ms) {
    const d = await db.documentos.get(m.documentoId);
    if (d && !d.deletedAt && d.entidade === 'localizacao') res.push({ marcador: m, localizacaoId: d.entidadeId });
  }
  return res;
}

/** Move um ponto já colocado (é o que se usa para os artigos, que podem ter vários pontos). */
export async function moverMarcador(db: OfficeDB, id: string, x: number, y: number): Promise<void> {
  if (![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Posição fora da planta.');
  const m = await db.marcadores.get(id);
  if (!m || m.deletedAt) throw new Error('O marcador não existe.');
  await db.marcadores.update(id, { x, y, updatedAt: agora() });
}
