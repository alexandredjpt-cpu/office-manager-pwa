import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { abaterEquipamento, criarEquipamento, criarLocalizacao, desativarEquipamento, eliminarLocalizacao } from '../src/db/repo';
import { criarAnomalia } from '../src/db/anomalias';
import { avaliarLinha, cancelarInspecao, concluirInspecao, iniciarInspecao, resumir, vincularAnomalia } from '../src/db/inspecoes';
import { apagarDadosExemplo, criarDadosExemplo } from '../src/db/exemplo';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`);
  await db.open();
});
async function cenario() {
  const l = await criarLocalizacao(db, { nome: 'Sala', tipo: 'divisao' });
  const a = await criarEquipamento(db, { nome: 'A', localizacaoId: l.id });
  const b = await criarEquipamento(db, { nome: 'B', localizacaoId: l.id });
  const dsc = await criarEquipamento(db, { nome: 'Desativado', localizacaoId: l.id });
  await desativarEquipamento(db, dsc.id);
  const ab = await criarEquipamento(db, { nome: 'Abatido', localizacaoId: l.id });
  await abaterEquipamento(db, ab.id, 'x');
  await criarEquipamento(db, { nome: 'Noutro sítio' });
  return { l, a, b };
}
const linhas = (id: string) => db.inspecaoLinhas.where('inspecaoId').equals(id).toArray();

describe('iniciar', () => {
  it('fixa só os equipamentos ativos do local e gera IN-', async () => {
    const { l } = await cenario();
    const i = await iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'pontual' });
    expect(i.codigo).toBe('IN-000001');
    expect(i.estado).toBe('em_curso');
    const ls = await linhas(i.id);
    expect(ls).toHaveLength(2);
    expect(ls.every((x) => x.resultado === null)).toBe(true);
  });
  it('recusa local inválido, sem equipamentos, modalidade inválida e duplicada', async () => {
    const vazio = await criarLocalizacao(db, { nome: 'Vazio', tipo: 'divisao' });
    await expect(iniciarInspecao(db, { localizacaoId: 'x', modalidade: 'pontual' })).rejects.toThrow('localização');
    await expect(iniciarInspecao(db, { localizacaoId: vazio.id, modalidade: 'pontual' })).rejects.toThrow('equipamentos ativos');
    const { l } = await cenario();
    await expect(iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'xx' as never })).rejects.toThrow('modalidade');
    await iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'periodica' });
    await expect(iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'pontual' })).rejects.toThrow('em curso');
    expect(await db.inspecoes.count()).toBe(1);
  });
});

describe('avaliar e concluir', () => {
  it('só conclui com todas avaliadas; não verificado conta como avaliado', async () => {
    const { l } = await cenario();
    const i = await iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'pontual' });
    const [x, y] = await linhas(i.id);
    await avaliarLinha(db, x.id, 'conforme');
    await expect(concluirInspecao(db, i.id)).rejects.toThrow('Faltam avaliar 1');
    await avaliarLinha(db, y.id, 'nao_verificado', 'porta fechada');
    await concluirInspecao(db, i.id, 'tudo visto');
    const c = await db.inspecoes.get(i.id);
    expect(c?.estado).toBe('concluida');
    expect(c?.concluidaEm).not.toBeNull();
    expect(resumir(await linhas(i.id))).toEqual({ conformes: 1, comAnomalia: 0, naoVerificados: 1, porAvaliar: 0, total: 2 });
  });
  it('concluída não se altera nem volta a concluir; cancelada fica registada', async () => {
    const { l } = await cenario();
    const i = await iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'pontual' });
    const [x, y] = await linhas(i.id);
    await avaliarLinha(db, x.id, 'conforme');
    await avaliarLinha(db, y.id, 'conforme');
    await concluirInspecao(db, i.id);
    await expect(avaliarLinha(db, x.id, 'com_anomalia')).rejects.toThrow('em curso');
    await expect(concluirInspecao(db, i.id)).rejects.toThrow('em curso');
    await expect(cancelarInspecao(db, i.id)).rejects.toThrow('em curso');
    const j = await iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'extraordinaria' });
    await cancelarInspecao(db, j.id);
    expect((await db.inspecoes.get(j.id))?.estado).toBe('cancelada');
    expect(j.codigo).toBe('IN-000002');
  });
});

describe('anomalia a partir da inspeção', () => {
  it('liga a linha à anomalia e marca «com anomalia»', async () => {
    const { l, a } = await cenario();
    const i = await iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'pontual' });
    const linha = (await linhas(i.id)).find((x) => x.equipamentoId === a.id)!;
    const an = await criarAnomalia(db, { titulo: 'Avaria', localizacaoId: l.id, equipamentoId: a.id, prioridade: 'media' });
    await vincularAnomalia(db, linha.id, an.id);
    const r = await db.inspecaoLinhas.get(linha.id);
    expect(r?.resultado).toBe('com_anomalia');
    expect(r?.anomaliaId).toBe(an.id);
    await expect(vincularAnomalia(db, linha.id, 'nada')).rejects.toThrow('não existe');
  });
});

describe('ligações, exemplo e cópia', () => {
  it('não elimina local com inspeção em curso', async () => {
    const { l } = await cenario();
    const i = await iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'pontual' });
    await expect(eliminarLocalizacao(db, l.id)).rejects.toThrow('inspeção');
    await cancelarInspecao(db, i.id);
  });
  it('apagar exemplos limpa inspeções e repõe IN-000001', async () => {
    await criarDadosExemplo(db);
    const l = (await db.localizacoes.toArray()).find((x) => x.nome.startsWith('Sala'))!;
    await iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'pontual' });
    await apagarDadosExemplo(db);
    expect(await db.inspecoes.count()).toBe(0);
    expect(await db.inspecaoLinhas.count()).toBe(0);
    const n = await criarLocalizacao(db, { nome: 'Real', tipo: 'divisao' });
    await criarEquipamento(db, { nome: 'E', localizacaoId: n.id });
    expect((await iniciarInspecao(db, { localizacaoId: n.id, modalidade: 'pontual' })).codigo).toBe('IN-000001');
  });
  it('a cópia leva inspeções e linhas', async () => {
    const { l } = await cenario();
    await iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'pontual' });
    const { blob } = await exportarCopia(db);
    const db2 = new OfficeDB(`t-${crypto.randomUUID()}`);
    await db2.open();
    await restaurarCopia(db2, blob);
    expect(await db2.inspecoes.count()).toBe(1);
    expect(await db2.inspecaoLinhas.count()).toBe(2);
  });
});
