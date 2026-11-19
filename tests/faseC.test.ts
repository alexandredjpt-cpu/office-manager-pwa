import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { abaterEquipamento, criarEquipamento } from '../src/db/repo';
import { atualizarManutencao, cancelarManutencao, concluirManutencao, criarManutencao } from '../src/db/manutencao';
import { alertasAtivos, eventosAgenda } from '../src/db/agenda';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB; let eq: string;
beforeEach(async () => { db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open(); eq = (await criarEquipamento(db, { nome: 'Caldeira' })).id; });
const base = () => ({ equipamentoId: eq, titulo: 'Revisão', proximaData: '2026-12-10' });

describe('manutenção preventiva', () => {
  it('valida e exige data escolhida pelo utilizador', async () => {
    await expect(criarManutencao(db, { ...base(), titulo: ' ' })).rejects.toThrow('título');
    await expect(criarManutencao(db, { ...base(), proximaData: '' })).rejects.toThrow('data');
    await expect(criarManutencao(db, { ...base(), antecedenciaDias: -2 })).rejects.toThrow('Antecedência');
    await expect(criarManutencao(db, { ...base(), frequenciaDias: 0 })).rejects.toThrow('Repetição');
    await expect(criarManutencao(db, { ...base(), equipamentoId: 'x' })).rejects.toThrow('não existe');
    const m = await criarManutencao(db, { ...base(), antecedenciaDias: '5', frequenciaDias: '90' });
    expect([m.antecedenciaDias, m.frequenciaDias, m.estado]).toEqual([5, 90, 'ativa']);
  });
  it('não aceita equipamento abatido', async () => {
    await abaterEquipamento(db, eq, 'avariado');
    await expect(criarManutencao(db, base())).rejects.toThrow('abatido');
  });
  it('aparece na agenda e alerta pela antecedência', async () => {
    const m = await criarManutencao(db, { ...base(), antecedenciaDias: 7 });
    const ev = eventosAgenda([], [], () => 'Caldeira', await db.manutencoes.toArray());
    expect(ev[0]).toMatchObject({ tipo: 'manutencao', alertaDesde: '2026-12-03', detalhe: 'Caldeira' });
    expect(alertasAtivos(ev, new Date(2026, 11, 2))).toHaveLength(0);
    expect(alertasAtivos(ev, new Date(2026, 11, 3))).toHaveLength(1);
    await cancelarManutencao(db, m.id);
    expect(eventosAgenda([], [], () => '', await db.manutencoes.toArray())).toHaveLength(0);
  });
  it('concluir sem reagendar NÃO altera a data e termina a tarefa; regista execução', async () => {
    const m = await criarManutencao(db, { ...base(), frequenciaDias: 30 });
    const r = await concluirManutencao(db, m.id, { data: '2026-12-08', notas: 'ok' });
    expect(r.proximaData).toBeNull();
    const g = (await db.manutencoes.get(m.id))!;
    expect([g.estado, g.proximaData]).toEqual(['concluida', '2026-12-10']);
    expect(await db.execucoes.count()).toBe(1);
    await expect(concluirManutencao(db, m.id)).rejects.toThrow('já foi');
  });
  it('reagendar só com repetição configurada; nova data = execução + repetição', async () => {
    const sem = await criarManutencao(db, base());
    await expect(concluirManutencao(db, sem.id, { reagendar: true })).rejects.toThrow('repetição');
    expect(await db.execucoes.count()).toBe(0); // atómico
    const m = await criarManutencao(db, { ...base(), frequenciaDias: 30 });
    const r = await concluirManutencao(db, m.id, { data: '2026-12-20', reagendar: true });
    expect(r.proximaData).toBe('2027-01-19');
    expect((await db.manutencoes.get(m.id))?.estado).toBe('ativa');
    await concluirManutencao(db, m.id, { data: '2027-01-19', reagendar: true });
    expect(await db.execucoes.count()).toBe(2);
  });
  it('editar e cópia de segurança', async () => {
    const m = await criarManutencao(db, base());
    await atualizarManutencao(db, m.id, { ...base(), titulo: 'Revisão anual', proximaData: '2027-01-01' });
    await concluirManutencao(db, m.id);
    const { blob } = await exportarCopia(db);
    const d2 = new OfficeDB(`t-${crypto.randomUUID()}`); await d2.open();
    await restaurarCopia(d2, blob);
    expect([await d2.manutencoes.count(), await d2.execucoes.count()]).toEqual([1, 1]);
  });
});
