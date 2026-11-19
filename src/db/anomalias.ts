import type { Anomalia, Atividade, EstadoAnomalia, OfficeDB, Prioridade, TipoAtividade } from './schema';
import { agora, novoId, proximoCodigo } from './repo';

export const PRIORIDADES: Record<Prioridade, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
export const ESTADOS_ANOMALIA: Record<EstadoAnomalia, string> = {
  por_resolver: 'Por resolver',
  em_intervencao: 'Em intervenção',
  aguarda_verificacao: 'Aguarda verificação',
  resolvida: 'Resolvida'
};

export interface DadosAnomalia {
  titulo: string;
  descricao?: string;
  localizacaoId: string;
  equipamentoId?: string | null;
  prioridade: Prioridade | '';
}

async function validar(db: OfficeDB, d: DadosAnomalia, equipamentoAtual: string | null = null) {
  const titulo = d.titulo.trim();
  if (!titulo) throw new Error('A descrição curta é obrigatória.');
  if (!d.prioridade || !(d.prioridade in PRIORIDADES)) throw new Error('Escolhe a prioridade.');
  const loc = d.localizacaoId ? await db.localizacoes.get(d.localizacaoId) : undefined;
  if (!loc || loc.deletedAt) throw new Error('Escolhe a localização.');
  const equipamentoId = d.equipamentoId || null;
  if (equipamentoId) {
    const e = await db.equipamentos.get(equipamentoId);
    if (!e || e.deletedAt) throw new Error('O equipamento não existe.');
    // Um equipamento abatido só pode manter uma ligação que já existia.
    if (e.estado === 'abatido' && equipamentoId !== equipamentoAtual) throw new Error('Esse equipamento está abatido.');
  }
  return { titulo, descricao: d.descricao ?? '', localizacaoId: d.localizacaoId, equipamentoId, prioridade: d.prioridade };
}

async function registar(db: OfficeDB, anomaliaId: string, tipo: TipoAtividade, texto: string, t = agora()): Promise<Atividade> {
  // Ordem estritamente crescente por anomalia, mesmo dentro do mesmo milissegundo.
  const ultima = (await db.atividades.where('anomaliaId').equals(anomaliaId).toArray()).map((x) => x.createdAt).sort().at(-1);
  if (ultima && t <= ultima) t = new Date(Date.parse(ultima) + 1).toISOString();
  const reg: Atividade = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, anomaliaId, tipo, texto };
  await db.atividades.add(reg);
  return reg;
}

export async function criarAnomalia(db: OfficeDB, dados: DadosAnomalia): Promise<Anomalia> {
  return db.transaction('rw', [db.anomalias, db.atividades, db.contadores, db.localizacoes, db.equipamentos], async () => {
    const v = await validar(db, dados);
    const t = agora();
    const reg: Anomalia = {
      id: novoId(), createdAt: t, updatedAt: t, deletedAt: null,
      codigo: await proximoCodigo(db, 'AN'), ...v, estado: 'por_resolver', dataResolucao: null
    };
    await db.anomalias.add(reg);
    await registar(db, reg.id, 'estado', 'Anomalia registada.', t);
    return reg;
  });
}

export async function atualizarAnomalia(db: OfficeDB, id: string, dados: DadosAnomalia): Promise<Anomalia> {
  return db.transaction('rw', [db.anomalias, db.atividades, db.localizacoes, db.equipamentos], async () => {
    const a = await db.anomalias.get(id);
    if (!a || a.deletedAt) throw new Error('A anomalia não existe.');
    if (a.estado === 'resolvida') throw new Error('Anomalia resolvida: reabre-a para a alterar.');
    const v = await validar(db, dados, a.equipamentoId);
    const novo: Anomalia = { ...a, ...v, updatedAt: agora() };
    await db.anomalias.put(novo);
    if (a.prioridade !== v.prioridade) {
      await registar(db, id, 'nota', `Prioridade alterada: ${PRIORIDADES[a.prioridade]} → ${PRIORIDADES[v.prioridade]}.`);
    }
    return novo;
  });
}

/**
 * Muda o estado e regista no histórico. «Resolvida» é sempre decisão do utilizador
 * (a interface pede confirmação); uma intervenção concluída nunca a resolve sozinha.
 */
export async function mudarEstadoAnomalia(db: OfficeDB, id: string, novo: EstadoAnomalia, nota = ''): Promise<void> {
  await db.transaction('rw', [db.anomalias, db.atividades], async () => {
    const a = await db.anomalias.get(id);
    if (!a || a.deletedAt) throw new Error('A anomalia não existe.');
    if (a.estado === novo) throw new Error('A anomalia já está nesse estado.');
    if (a.estado === 'resolvida' && novo !== 'por_resolver') throw new Error('Uma anomalia resolvida só pode ser reaberta.');
    const t = agora();
    await db.anomalias.update(id, { estado: novo, dataResolucao: novo === 'resolvida' ? t.slice(0, 10) : null, updatedAt: t });
    const verbo = novo === 'resolvida' ? 'Resolvida (confirmado por ti)' : a.estado === 'resolvida' ? 'Reaberta' : ESTADOS_ANOMALIA[novo];
    await registar(db, id, 'estado', nota.trim() ? `${verbo}. ${nota.trim()}` : `${verbo}.`, t);
  });
}

export async function adicionarAtividade(db: OfficeDB, id: string, tipo: Exclude<TipoAtividade, 'estado'>, texto: string): Promise<Atividade> {
  const t = texto.trim();
  if (!t) throw new Error('Escreve o que aconteceu.');
  return db.transaction('rw', [db.anomalias, db.atividades], async () => {
    const a = await db.anomalias.get(id);
    if (!a || a.deletedAt) throw new Error('A anomalia não existe.');
    const reg = await registar(db, id, tipo, t);
    await db.anomalias.update(id, { updatedAt: reg.createdAt });
    return reg;
  });
}

const PESO: Record<Prioridade, number> = { alta: 0, media: 1, baixa: 2 };

/** Abertas primeiro, por prioridade e depois mais antigas primeiro; resolvidas por fim, mais recentes primeiro. */
export function ordenarAnomalias(lista: Anomalia[]): Anomalia[] {
  return [...lista].sort((a, b) => {
    const ra = a.estado === 'resolvida', rb = b.estado === 'resolvida';
    if (ra !== rb) return ra ? 1 : -1;
    if (ra) return (b.dataResolucao ?? '').localeCompare(a.dataResolucao ?? '');
    return PESO[a.prioridade] - PESO[b.prioridade] || a.createdAt.localeCompare(b.createdAt);
  });
}

export const estaAberta = (a: Anomalia) => !a.deletedAt && a.estado !== 'resolvida';

/** Anula (lógico) uma anomalia registada por engano. O motivo fica no histórico; o código não é reutilizado. */
export async function anularAnomalia(db: OfficeDB, id: string, motivo: string): Promise<void> {
  const m = motivo.trim();
  if (!m) throw new Error('Indica o motivo da anulação.');
  await db.transaction('rw', [db.anomalias, db.atividades], async () => {
    const a = await db.anomalias.get(id);
    if (!a || a.deletedAt) throw new Error('A anomalia não existe.');
    const t = agora();
    await registar(db, id, 'estado', `Anulada (registada por engano). ${m}`, t);
    await db.anomalias.update(id, { deletedAt: t, updatedAt: t });
  });
}
