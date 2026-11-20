import type { Inspecao, InspecaoLinha, ModalidadeInspecao, OfficeDB, ResultadoInspecao } from './schema';
import { agora, novoId, proximoCodigo } from './repo';

export const MODALIDADES: Record<ModalidadeInspecao, string> = { pontual: 'Pontual', periodica: 'Periódica', extraordinaria: 'Extraordinária' };
export const RESULTADOS: Record<ResultadoInspecao, string> = { conforme: 'Conforme', com_anomalia: 'Com anomalia', nao_verificado: 'Não verificado' };
export const ESTADOS_INSPECAO = { em_curso: 'Em curso', concluida: 'Concluída', cancelada: 'Cancelada' } as const;

/**
 * Inicia uma inspeção: fixa a lista dos equipamentos ativos do local nesse momento.
 * Só uma inspeção em curso por local. A modalidade é só uma etiqueta: a app não agenda nada.
 */
export async function iniciarInspecao(db: OfficeDB, dados: { localizacaoId: string; modalidade: ModalidadeInspecao; observacoes?: string }): Promise<Inspecao> {
  return db.transaction('rw', [db.inspecoes, db.inspecaoLinhas, db.contadores, db.localizacoes, db.equipamentos], async () => {
    const loc = await db.localizacoes.get(dados.localizacaoId);
    if (!loc || loc.deletedAt) throw new Error('Escolhe a localização.');
    if (!(dados.modalidade in MODALIDADES)) throw new Error('Escolhe a modalidade.');
    const aberta = await db.inspecoes.where('localizacaoId').equals(dados.localizacaoId).filter((i) => i.estado === 'em_curso').first();
    if (aberta) throw new Error(`Já há uma inspeção em curso neste local (${aberta.codigo}).`);
    const equips = (await db.equipamentos.where('localizacaoId').equals(dados.localizacaoId).toArray())
      .filter((e) => !e.deletedAt && e.estado === 'ativo')
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
    if (equips.length === 0) throw new Error('Este local não tem equipamentos ativos para inspecionar.');
    const t = agora();
    const insp: Inspecao = {
      id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, codigo: await proximoCodigo(db, 'IN'),
      localizacaoId: dados.localizacaoId, modalidade: dados.modalidade, estado: 'em_curso', concluidaEm: null, observacoes: (dados.observacoes ?? '').trim()
    };
    await db.inspecoes.add(insp);
    await db.inspecaoLinhas.bulkAdd(equips.map((e) => ({
      id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, inspecaoId: insp.id, equipamentoId: e.id, resultado: null, observacoes: '', anomaliaId: null
    })));
    return insp;
  });
}

async function linhaEditavel(db: OfficeDB, linhaId: string): Promise<InspecaoLinha> {
  const l = await db.inspecaoLinhas.get(linhaId);
  if (!l) throw new Error('A linha não existe.');
  const i = await db.inspecoes.get(l.inspecaoId);
  if (!i || i.estado !== 'em_curso') throw new Error('A inspeção já não está em curso.');
  return l;
}

export async function avaliarLinha(db: OfficeDB, linhaId: string, resultado: ResultadoInspecao, observacoes = ''): Promise<void> {
  if (!(resultado in RESULTADOS)) throw new Error('Resultado inválido.');
  await db.transaction('rw', [db.inspecoes, db.inspecaoLinhas], async () => {
    await linhaEditavel(db, linhaId);
    // Uma anomalia já criada a partir desta linha continua ligada (fica no registo).
    await db.inspecaoLinhas.update(linhaId, { resultado, observacoes: observacoes.trim(), updatedAt: agora() });
  });
}

/**
 * Liga a linha à anomalia criada a partir dela (e marca-a «com anomalia»).
 * As fotografias tiradas ao equipamento na inspeção são copiadas para a anomalia (ficam nas duas).
 */
export async function vincularAnomalia(db: OfficeDB, linhaId: string, anomaliaId: string): Promise<void> {
  await db.transaction('rw', [db.inspecoes, db.inspecaoLinhas, db.anomalias, db.fotografias], async () => {
    await linhaEditavel(db, linhaId);
    const a = await db.anomalias.get(anomaliaId);
    if (!a || a.deletedAt) throw new Error('A anomalia não existe.');
    const t = agora();
    await db.inspecaoLinhas.update(linhaId, { anomaliaId, resultado: 'com_anomalia', updatedAt: t });
    const fotos = (await db.fotografias.where('[entidade+entidadeId]').equals(['inspecaoLinha', linhaId]).toArray()).filter((f) => !f.deletedAt);
    if (fotos.length) await db.fotografias.bulkAdd(fotos.map((f) => ({ ...f, id: novoId(), createdAt: t, updatedAt: t, entidade: 'anomalia' as const, entidadeId: anomaliaId })));
  });
}

/** Primeira linha ainda por avaliar a partir de `desde` (dá a volta); -1 se estão todas avaliadas. */
export function proximaPorAvaliar(resultados: (ResultadoInspecao | null)[], desde = 0): number {
  const n = resultados.length;
  for (let k = 0; k < n; k++) { const i = (desde + k) % n; if (resultados[i] === null) return i; }
  return -1;
}

export async function concluirInspecao(db: OfficeDB, id: string, observacoes = ''): Promise<void> {
  await db.transaction('rw', [db.inspecoes, db.inspecaoLinhas], async () => {
    const i = await db.inspecoes.get(id);
    if (!i) throw new Error('A inspeção não existe.');
    if (i.estado !== 'em_curso') throw new Error('A inspeção já não está em curso.');
    const linhas = await db.inspecaoLinhas.where('inspecaoId').equals(id).toArray();
    const porAvaliar = linhas.filter((l) => l.resultado === null).length;
    if (porAvaliar > 0) throw new Error(`Faltam avaliar ${porAvaliar} equipamento(s). Se não deu para verificar, marca «Não verificado».`);
    const t = agora();
    await db.inspecoes.update(id, { estado: 'concluida', concluidaEm: t, observacoes: observacoes.trim() || i.observacoes, updatedAt: t });
  });
}

/** Cancelar mantém o registo (nunca se apaga), mas não conta como realizada. */
export async function cancelarInspecao(db: OfficeDB, id: string): Promise<void> {
  const i = await db.inspecoes.get(id);
  if (!i) throw new Error('A inspeção não existe.');
  if (i.estado !== 'em_curso') throw new Error('A inspeção já não está em curso.');
  await db.inspecoes.update(id, { estado: 'cancelada', updatedAt: agora() });
}

export interface ResumoInspecao { conformes: number; comAnomalia: number; naoVerificados: number; porAvaliar: number; total: number }
export function resumir(linhas: InspecaoLinha[]): ResumoInspecao {
  const n = (r: ResultadoInspecao | null) => linhas.filter((l) => l.resultado === r).length;
  return { conformes: n('conforme'), comAnomalia: n('com_anomalia'), naoVerificados: n('nao_verificado'), porAvaliar: n(null), total: linhas.length };
}
