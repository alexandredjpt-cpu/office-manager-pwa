import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { abaterEquipamento, adicionarFoto, criarEquipamento, criarLocalizacao, eliminarLocalizacao } from '../src/db/repo';
import { adicionarAtividade, atualizarAnomalia, criarAnomalia, estaAberta, mudarEstadoAnomalia, ordenarAnomalias } from '../src/db/anomalias';
import { apagarDadosExemplo, criarDadosExemplo, soTemDadosExemplo } from '../src/db/exemplo';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';
import { linhasAnomalias } from '../src/export/anomalias';

let db: OfficeDB;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`);
  await db.open();
});
const local = () => criarLocalizacao(db, { nome: 'Casa', tipo: 'divisao' });
const historico = async (id: string) => (await db.atividades.where('anomaliaId').equals(id).sortBy('createdAt')).map((x) => x.texto);

describe('criar anomalia', () => {
  it('gera código AN-, estado inicial e primeira entrada de histórico', async () => {
    const l = await local();
    const a = await criarAnomalia(db, { titulo: ' Torneira ', localizacaoId: l.id, prioridade: 'baixa' });
    expect(a.codigo).toBe('AN-000001');
    expect(a.titulo).toBe('Torneira');
    expect(a.estado).toBe('por_resolver');
    expect(await historico(a.id)).toEqual(['Anomalia registada.']);
  });
  it('exige título, local e prioridade escolhida (nunca automática)', async () => {
    const l = await local();
    await expect(criarAnomalia(db, { titulo: '', localizacaoId: l.id, prioridade: 'alta' })).rejects.toThrow('obrigatória');
    await expect(criarAnomalia(db, { titulo: 'x', localizacaoId: l.id, prioridade: '' })).rejects.toThrow('prioridade');
    await expect(criarAnomalia(db, { titulo: 'x', localizacaoId: '', prioridade: 'alta' })).rejects.toThrow('localização');
    expect(await db.anomalias.count()).toBe(0);
    expect(await db.contadores.get('AN')).toBeUndefined(); // falhou: o código não foi gasto
  });
  it('não liga a equipamento abatido nem inexistente', async () => {
    const l = await local();
    const e = await criarEquipamento(db, { nome: 'Velho', localizacaoId: l.id });
    await abaterEquipamento(db, e.id, 'avariado');
    await expect(criarAnomalia(db, { titulo: 'x', localizacaoId: l.id, equipamentoId: e.id, prioridade: 'alta' })).rejects.toThrow('abatido');
    await expect(criarAnomalia(db, { titulo: 'x', localizacaoId: l.id, equipamentoId: 'nada', prioridade: 'alta' })).rejects.toThrow('não existe');
  });
});

describe('estados e histórico', () => {
  it('regista cada mudança; resolver guarda a data e reabrir limpa-a', async () => {
    const l = await local();
    const a = await criarAnomalia(db, { titulo: 'x', localizacaoId: l.id, prioridade: 'media' });
    await mudarEstadoAnomalia(db, a.id, 'em_intervencao', 'chamei o técnico');
    await mudarEstadoAnomalia(db, a.id, 'aguarda_verificacao');
    await mudarEstadoAnomalia(db, a.id, 'resolvida');
    const r = await db.anomalias.get(a.id);
    expect(r?.estado).toBe('resolvida');
    expect(r?.dataResolucao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await mudarEstadoAnomalia(db, a.id, 'por_resolver', 'voltou');
    expect((await db.anomalias.get(a.id))?.dataResolucao).toBeNull();
    const h = await historico(a.id);
    expect(h).toHaveLength(5);
    expect(h[1]).toBe('Em intervenção. chamei o técnico');
    expect(h[3]).toContain('confirmado por ti');
    expect(h[4]).toBe('Reaberta. voltou');
  });
  it('uma intervenção registada não resolve a anomalia', async () => {
    const l = await local();
    const a = await criarAnomalia(db, { titulo: 'x', localizacaoId: l.id, prioridade: 'alta' });
    await adicionarAtividade(db, a.id, 'intervencao', 'Técnico veio e trocou a peça');
    expect((await db.anomalias.get(a.id))?.estado).toBe('por_resolver');
    await expect(adicionarAtividade(db, a.id, 'nota', '  ')).rejects.toThrow('Escreve');
  });
  it('resolvida não se edita nem muda para outro estado sem reabrir', async () => {
    const l = await local();
    const a = await criarAnomalia(db, { titulo: 'x', localizacaoId: l.id, prioridade: 'alta' });
    await mudarEstadoAnomalia(db, a.id, 'resolvida');
    await expect(atualizarAnomalia(db, a.id, { titulo: 'y', localizacaoId: l.id, prioridade: 'alta' })).rejects.toThrow('reabre');
    await expect(mudarEstadoAnomalia(db, a.id, 'em_intervencao')).rejects.toThrow('reaberta');
    await expect(mudarEstadoAnomalia(db, a.id, 'resolvida')).rejects.toThrow('já está');
  });
  it('alterar a prioridade fica no histórico', async () => {
    const l = await local();
    const a = await criarAnomalia(db, { titulo: 'x', localizacaoId: l.id, prioridade: 'baixa' });
    await atualizarAnomalia(db, a.id, { titulo: 'x', localizacaoId: l.id, prioridade: 'alta' });
    expect((await historico(a.id)).at(-1)).toBe('Prioridade alterada: Baixa → Alta.');
  });
});

describe('ligações e ordenação', () => {
  it('não elimina um local com anomalia aberta; elimina depois de resolvida', async () => {
    const l = await local();
    const a = await criarAnomalia(db, { titulo: 'x', localizacaoId: l.id, prioridade: 'alta' });
    await expect(eliminarLocalizacao(db, l.id)).rejects.toThrow('anomalia');
    await mudarEstadoAnomalia(db, a.id, 'resolvida');
    await eliminarLocalizacao(db, l.id);
  });
  it('fotografias de anomalias funcionam', async () => {
    const l = await local();
    const a = await criarAnomalia(db, { titulo: 'x', localizacaoId: l.id, prioridade: 'alta' });
    const f = await adicionarFoto(db, 'anomalia', a.id, new Blob(['x'], { type: 'image/jpeg' }));
    expect(f.entidade).toBe('anomalia');
    await expect(adicionarFoto(db, 'anomalia', 'nada', new Blob(['x'], { type: 'image/jpeg' }))).rejects.toThrow();
  });
  it('ordena: abertas por prioridade, resolvidas no fim', async () => {
    const l = await local();
    const b = await criarAnomalia(db, { titulo: 'baixa', localizacaoId: l.id, prioridade: 'baixa' });
    const r = await criarAnomalia(db, { titulo: 'resolvida', localizacaoId: l.id, prioridade: 'alta' });
    await mudarEstadoAnomalia(db, r.id, 'resolvida');
    const al = await criarAnomalia(db, { titulo: 'alta', localizacaoId: l.id, prioridade: 'alta' });
    const lista = ordenarAnomalias(await db.anomalias.toArray());
    expect(lista.map((x) => x.titulo)).toEqual(['alta', 'baixa', 'resolvida']);
    expect(estaAberta(b) && estaAberta(al) && !estaAberta((await db.anomalias.get(r.id))!)).toBe(true);
  });
});

describe('exemplo, cópia e Excel', () => {
  it('exemplo inclui anomalia; apagar repõe AN-000001', async () => {
    await criarDadosExemplo(db);
    expect(await db.anomalias.count()).toBe(1);
    expect(await soTemDadosExemplo(db)).toBe(true);
    await apagarDadosExemplo(db);
    expect(await db.atividades.count()).toBe(0);
    const l = await local();
    expect((await criarAnomalia(db, { titulo: 'x', localizacaoId: l.id, prioridade: 'alta' })).codigo).toBe('AN-000001');
  });
  it('uma anomalia real impede apagar os exemplos', async () => {
    await criarDadosExemplo(db);
    const l = (await db.localizacoes.toArray())[0];
    await criarAnomalia(db, { titulo: 'Real', localizacaoId: l.id, prioridade: 'alta' });
    expect(await soTemDadosExemplo(db)).toBe(false);
  });
  it('a cópia leva anomalias e histórico', async () => {
    await criarDadosExemplo(db);
    const { blob } = await exportarCopia(db);
    const db2 = new OfficeDB(`t-${crypto.randomUUID()}`);
    await db2.open();
    await restaurarCopia(db2, blob);
    expect(await db2.anomalias.count()).toBe(1);
    expect(await db2.atividades.count()).toBe(2);
  });
  it('linhas de Excel', async () => {
    await criarDadosExemplo(db);
    const [linha] = linhasAnomalias(await db.anomalias.toArray(), () => 'Sala', () => 'Router');
    expect(linha.slice(0, 6)).toEqual(['AN-000001', 'Wi-Fi instável (exemplo)', 'Média', 'Por resolver', 'Sala', 'Router']);
  });
});
