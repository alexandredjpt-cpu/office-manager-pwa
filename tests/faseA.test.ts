import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { criarEquipamento, criarLocalizacao, eliminarLocalizacao } from '../src/db/repo';
import { anularAnomalia, criarAnomalia } from '../src/db/anomalias';
import { anularContagem, criarArtigo, registarContagem, stockPorArtigo } from '../src/db/stock';
import {
  adiarLembrete, alertasAtivos, atualizarLembrete, cancelarLembrete, concluirLembrete, criarLembrete, eventosAgenda, grupoDe, somarDias
} from '../src/db/agenda';
import { pesquisar } from '../src/db/pesquisa';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`);
  await db.open();
});
const hoje = new Date(2026, 10, 19);

describe('lembretes e agenda', () => {
  it('datas e antecedência são escolhidas pelo utilizador e validadas', async () => {
    await expect(criarLembrete(db, { titulo: '', data: '2026-12-01' })).rejects.toThrow('obrigatório');
    await expect(criarLembrete(db, { titulo: 'x', data: '' })).rejects.toThrow('data');
    await expect(criarLembrete(db, { titulo: 'x', data: '2026-12-01', antecedenciaDias: -1 })).rejects.toThrow('Antecedência');
    await expect(criarLembrete(db, { titulo: 'x', data: '2026-12-01', equipamentoId: 'nada' })).rejects.toThrow('não existe');
    const l = await criarLembrete(db, { titulo: 'Revisão', data: '2026-12-01', antecedenciaDias: '7' });
    expect(l.antecedenciaDias).toBe(7);
  });
  it('o aviso começa na data menos a antecedência', async () => {
    const l = await criarLembrete(db, { titulo: 'Caldeira', data: '2026-11-25', antecedenciaDias: 7 });
    const ev = eventosAgenda([], [l], () => '');
    expect(ev[0].alertaDesde).toBe('2026-11-18');
    expect(alertasAtivos(ev, hoje)).toHaveLength(1);
    expect(alertasAtivos(ev, new Date(2026, 10, 10))).toHaveLength(0);
  });
  it('garantias entram na agenda; abatidos e muito expiradas não avisam', async () => {
    const e1 = await criarEquipamento(db, { nome: 'Router', fimGarantia: '2026-12-10' });
    await criarEquipamento(db, { nome: 'Velho', fimGarantia: '2026-01-01' });
    const e3 = await criarEquipamento(db, { nome: 'Sem garantia' });
    const ev = eventosAgenda(await db.equipamentos.toArray(), [], () => '');
    expect(ev.map((x) => x.titulo)).toEqual(['Fim da garantia: Velho', 'Fim da garantia: Router']);
    expect(alertasAtivos(ev, hoje).map((x) => x.titulo)).toEqual(['Fim da garantia: Router']);
    expect(e1.id && e3.id).toBeTruthy();
  });
  it('concluir, cancelar, adiar e editar', async () => {
    const l = await criarLembrete(db, { titulo: 'A', data: '2026-12-01' });
    await adiarLembrete(db, l.id, '2026-12-20');
    expect((await db.lembretes.get(l.id))?.data).toBe('2026-12-20');
    await atualizarLembrete(db, l.id, { titulo: 'A2', data: '2026-12-20', antecedenciaDias: 3 });
    await concluirLembrete(db, l.id);
    expect(eventosAgenda([], await db.lembretes.toArray(), () => '')).toHaveLength(0);
    await expect(cancelarLembrete(db, l.id)).rejects.toThrow('já foi');
    await expect(adiarLembrete(db, l.id, '2027-01-01')).rejects.toThrow('já foi');
  });
  it('grupos e soma de dias', () => {
    expect(somarDias('2026-12-30', 3)).toBe('2027-01-02');
    expect(grupoDe('2026-11-10', hoje)).toBe('atrasado');
    expect(grupoDe('2026-11-24', hoje)).toBe('semana');
    expect(grupoDe('2026-12-10', hoje)).toBe('mes');
    expect(grupoDe('2027-03-01', hoje)).toBe('depois');
  });
});

describe('anular', () => {
  it('anula só a contagem mais recente; a anterior volta a valer', async () => {
    const l = await criarLocalizacao(db, { nome: 'Casa', tipo: 'divisao' });
    const a = await criarArtigo(db, { nome: 'Pilhas' });
    const c1 = await registarContagem(db, a.id, l.id, 10);
    const c2 = await registarContagem(db, a.id, l.id, 99);
    await expect(anularContagem(db, c1.id)).rejects.toThrow('mais recente');
    await anularContagem(db, c2.id);
    const [s] = stockPorArtigo([a], await db.contagensStock.toArray());
    expect(s.total).toBe(10);
    const c3 = await registarContagem(db, a.id, l.id, 8);
    expect(c3.anterior).toBe(10); // a anulada não conta
    await expect(anularContagem(db, c2.id)).rejects.toThrow('não existe');
  });
  it('anular anomalia exige motivo, esconde-a, guarda o histórico e não bloqueia o local', async () => {
    const l = await criarLocalizacao(db, { nome: 'Casa', tipo: 'divisao' });
    const a = await criarAnomalia(db, { titulo: 'Engano', localizacaoId: l.id, prioridade: 'alta' });
    await expect(anularAnomalia(db, a.id, ' ')).rejects.toThrow('motivo');
    await anularAnomalia(db, a.id, 'duplicada');
    expect((await db.anomalias.get(a.id))?.deletedAt).not.toBeNull();
    expect((await db.atividades.toArray()).some((x) => x.texto.includes('duplicada'))).toBe(true);
    await eliminarLocalizacao(db, l.id);
    const b = await criarAnomalia(db, { titulo: 'Outra', localizacaoId: (await criarLocalizacao(db, { nome: 'X', tipo: 'divisao' })).id, prioridade: 'baixa' });
    expect(b.codigo).toBe('AN-000002');
  });
});

describe('pesquisa global', () => {
  it('encontra em todos os tipos, sem acentos, e exige 2 caracteres', async () => {
    const l = await criarLocalizacao(db, { nome: 'Cozinha', tipo: 'divisao' });
    await criarEquipamento(db, { nome: 'Máquina de café', localizacaoId: l.id });
    const art = await criarArtigo(db, { nome: 'Café moído' });
    await criarAnomalia(db, { titulo: 'Café derramado', localizacaoId: l.id, prioridade: 'baixa' });
    const dados = {
      equipamentos: await db.equipamentos.toArray(), artigos: await db.artigos.toArray(), locais: await db.localizacoes.toArray(), anomalias: await db.anomalias.toArray(),
      stockDe: () => 'sem contagem', nomeLocal: (id: string) => (id === l.id ? 'Cozinha' : '')
    };
    const r = pesquisar('CAFE', dados);
    expect(r.map((x) => x.tipo).sort()).toEqual(['anomalia', 'artigo', 'equipamento']);
    expect(pesquisar('cozinha', dados).map((x) => x.tipo)).toContain('local');
    expect(pesquisar('c', dados)).toEqual([]);
    expect(pesquisar('café moído', dados)[0].id).toBe(art.id);
  });
});

describe('cópia', () => {
  it('leva lembretes', async () => {
    await criarLembrete(db, { titulo: 'X', data: '2026-12-01' });
    const { blob } = await exportarCopia(db);
    const db2 = new OfficeDB(`t-${crypto.randomUUID()}`);
    await db2.open();
    await restaurarCopia(db2, blob);
    expect(await db2.lembretes.count()).toBe(1);
  });
});
