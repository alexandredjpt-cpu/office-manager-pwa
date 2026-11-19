import type { Execucao, Manutencao, OfficeDB } from './schema';
import { agora, novoId, normalizarData } from './repo';
import { hojeIso, somarDias } from './agenda';

export interface DadosManutencao {
  equipamentoId: string;
  titulo: string;
  descricao?: string;
  responsavel?: string;
  proximaData: string;
  antecedenciaDias?: number | string;
  frequenciaDias?: number | string | null;
}

function inteiro(v: number | string | null | undefined, nome: string, min: number, max: number, vazio: number | null): number | null {
  if (v === '' || v === null || v === undefined) return vazio;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${nome}: indica um número inteiro de dias entre ${min} e ${max}.`);
  return n;
}

function validar(d: DadosManutencao) {
  const titulo = d.titulo.trim();
  if (!titulo) throw new Error('A tarefa precisa de um título.');
  const proximaData = normalizarData(d.proximaData, 'Data');
  if (!proximaData) throw new Error('Escolhe a data da próxima manutenção.');
  return {
    titulo, proximaData, descricao: d.descricao ?? '', responsavel: (d.responsavel ?? '').trim(),
    antecedenciaDias: inteiro(d.antecedenciaDias, 'Antecedência', 0, 365, 0)!,
    frequenciaDias: inteiro(d.frequenciaDias, 'Repetição', 1, 3650, null)
  };
}

export async function criarManutencao(db: OfficeDB, d: DadosManutencao): Promise<Manutencao> {
  const v = validar(d);
  const e = await db.equipamentos.get(d.equipamentoId);
  if (!e || e.deletedAt) throw new Error('O equipamento não existe.');
  if (e.estado === 'abatido') throw new Error('Equipamento abatido: não se agenda manutenção.');
  const t = agora();
  const reg: Manutencao = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, equipamentoId: d.equipamentoId, ...v, estado: 'ativa' };
  await db.manutencoes.add(reg);
  return reg;
}

async function ativa(db: OfficeDB, id: string): Promise<Manutencao> {
  const m = await db.manutencoes.get(id);
  if (!m || m.deletedAt) throw new Error('A manutenção não existe.');
  if (m.estado !== 'ativa') throw new Error('Esta manutenção já foi concluída ou cancelada.');
  return m;
}

export async function atualizarManutencao(db: OfficeDB, id: string, d: DadosManutencao): Promise<void> {
  const m = await ativa(db, id);
  await db.manutencoes.update(id, { ...validar({ ...d, equipamentoId: m.equipamentoId }), updatedAt: agora() });
}

export async function cancelarManutencao(db: OfficeDB, id: string): Promise<void> {
  await ativa(db, id);
  await db.manutencoes.update(id, { estado: 'cancelada', updatedAt: agora() });
}

export interface DadosExecucao { data?: string; responsavel?: string; notas?: string; reagendar?: boolean }

/**
 * Regista a execução. A data seguinte NUNCA muda sozinha:
 * só com `reagendar: true` (a UI pede confirmação) e repetição configurada — nova data = data da execução + repetição.
 * Sem reagendar, a tarefa fica «concluída» (sai da agenda).
 */
export async function concluirManutencao(db: OfficeDB, id: string, d: DadosExecucao = {}): Promise<{ proximaData: string | null }> {
  return db.transaction('rw', [db.manutencoes, db.execucoes], async () => {
    const m = await ativa(db, id);
    const data = d.data ? normalizarData(d.data, 'Data') : hojeIso();
    if (!data) throw new Error('Escolhe a data da execução.');
    if (d.reagendar && !m.frequenciaDias) throw new Error('Esta tarefa não tem repetição configurada.');
    const t = agora();
    const ex: Execucao = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, manutencaoId: id, equipamentoId: m.equipamentoId, data, responsavel: (d.responsavel ?? m.responsavel).trim(), notas: d.notas ?? '' };
    await db.execucoes.add(ex);
    if (d.reagendar) {
      const proxima = somarDias(data, m.frequenciaDias!);
      await db.manutencoes.update(id, { proximaData: proxima, updatedAt: t });
      return { proximaData: proxima };
    }
    await db.manutencoes.update(id, { estado: 'concluida', updatedAt: t });
    return { proximaData: null };
  });
}
