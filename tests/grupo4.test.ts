import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB, type Equipamento } from '../src/db/schema';
import { adicionarFoto, criarEquipamento, criarLocalizacao, guardarFotoAnotada, reporFotoOriginal, abaterEquipamento } from '../src/db/repo';
import { comPreferida, ordenarCamaras } from '../src/fotos/camera';
import { desenharFormas, espessura, pontasSeta } from '../src/fotos/anotar';
import { historicoEquipamento } from '../src/db/historico';
import { criarAnomalia, mudarEstadoAnomalia } from '../src/db/anomalias';
import { avaliarLinha, concluirInspecao, iniciarInspecao } from '../src/db/inspecoes';
import { guardarAssinatura } from '../src/db/inspecoes';

let db: OfficeDB;
beforeEach(async () => { db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open(); });
const img = (t = 'x') => new Blob([t], { type: 'image/jpeg' });

describe('escolha da câmara do leitor', () => {
  it('Samsung: principal traseira primeiro, frontal fora, ultra/tele no fim; sem nomes mantém a ordem', () => {
    const s = [
      { deviceId: 'a', label: 'camera2 1, facing front' }, { deviceId: 'b', label: 'camera2 3, facing back' },
      { deviceId: 'c', label: 'camera2 0, facing back' }, { deviceId: 'd', label: 'camera2 2, facing back' }
    ];
    expect(ordenarCamaras(s).map((c) => c.deviceId)).toEqual(['c', 'd', 'b']);
    expect(ordenarCamaras([{ deviceId: 'x', label: 'Back Ultra Wide' }, { deviceId: 'y', label: 'Back Camera' }]).map((c) => c.deviceId)).toEqual(['y', 'x']);
    const sem = [{ deviceId: '1', label: '' }, { deviceId: '2', label: '' }];
    expect(ordenarCamaras(sem)).toEqual(sem);
    expect(comPreferida(ordenarCamaras(s), 'b').map((c) => c.deviceId)).toEqual(['b', 'c', 'd']);
    expect(comPreferida(ordenarCamaras(s), 'zz').map((c) => c.deviceId)).toEqual(['c', 'd', 'b']);
  });
});

describe('desenhar nas fotos', () => {
  it('anotada toma o lugar da original (mesma posição e fase); repor volta à original; assinaturas não', async () => {
    const l = await criarLocalizacao(db, { nome: 'Sala', tipo: 'divisao' });
    const a = await criarAnomalia(db, { titulo: 'Fissura', descricao: '', localizacaoId: l.id, prioridade: 'baixa' });
    const o = await adicionarFoto(db, 'anomalia', a.id, img('original'), { fase: 'depois' });
    const n1 = await guardarFotoAnotada(db, o.id, img('anotada1'));
    expect([n1.createdAt, n1.fase, n1.anotadaDe]).toEqual([o.createdAt, 'depois', o.id]);
    const n2 = await guardarFotoAnotada(db, n1.id, img('anotada2'));
    expect(n2.anotadaDe).toBe(o.id); // aponta sempre para a original verdadeira
    const ativas = async () => (await db.fotografias.toArray()).filter((f) => !f.deletedAt).map((f) => f.id);
    expect(await ativas()).toEqual([n2.id]);
    await expect(guardarFotoAnotada(db, o.id, img())).rejects.toThrow('já não existe');
    const r = await reporFotoOriginal(db, n2.id);
    expect(r.id).toBe(o.id);
    expect(await ativas()).toEqual([o.id]);
    await expect(reporFotoOriginal(db, o.id)).rejects.toThrow('original');
    expect(await db.fotografias.count()).toBe(3); // nada apagado fisicamente
  });
  it('não anota assinaturas', async () => {
    const l = await criarLocalizacao(db, { nome: 'Sala', tipo: 'divisao' });
    await criarEquipamento(db, { nome: 'PC', localizacaoId: l.id });
    const i = await iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'pontual' });
    await guardarAssinatura(db, i.id, new Blob(['p'], { type: 'image/png' }), 'Ana');
    const ass = (await db.fotografias.toArray())[0];
    await expect(guardarFotoAnotada(db, ass.id, img())).rejects.toThrow('assinaturas');
  });
  it('geometria: espessura proporcional, pontas da seta simétricas, desenha cada forma', () => {
    expect([espessura(320), espessura(1280)]).toEqual([3, 8]);
    const [p1, p2] = pontasSeta([0, 0], [100, 0], 8);
    expect(p1[0]).toBeCloseTo(p2[0]); expect(p1[1]).toBeCloseTo(-p2[1]); expect(p1[0]).toBeLessThan(100);
    const chamadas: string[] = [];
    const ctx = { save: () => chamadas.push('save'), restore: () => {}, beginPath: () => {}, moveTo: () => chamadas.push('move'), lineTo: () => chamadas.push('line'), stroke: () => chamadas.push('stroke'), ellipse: () => chamadas.push('ellipse'), strokeStyle: '', lineWidth: 0, lineCap: 'round', lineJoin: 'round', shadowColor: '', shadowBlur: 0 } as never;
    desenharFormas(ctx, [{ tipo: 'circulo', cor: '#f00', pontos: [[0, 0], [10, 10]] }, { tipo: 'seta', cor: '#f00', pontos: [[0, 0], [50, 50]] }, { tipo: 'livre', cor: '#f00', pontos: [[0, 0], [1, 1], [2, 2]] }], 1280);
    expect(chamadas.filter((c) => c === 'stroke')).toHaveLength(3);
    expect(chamadas).toContain('ellipse');
  });
});

describe('histórico do equipamento', () => {
  it('junta registo, anomalias, inspeções e abate, do mais recente para o mais antigo', async () => {
    const l = await criarLocalizacao(db, { nome: 'Sala 1', tipo: 'divisao' });
    const e = await criarEquipamento(db, { nome: 'Projetor', localizacaoId: l.id });
    const outro = await criarEquipamento(db, { nome: 'Outro', localizacaoId: l.id });
    const a = await criarAnomalia(db, { titulo: 'Lâmpada fraca', descricao: '', localizacaoId: l.id, equipamentoId: e.id, prioridade: 'media' });
    await criarAnomalia(db, { titulo: 'Não é deste', descricao: '', localizacaoId: l.id, equipamentoId: outro.id, prioridade: 'media' });
    await mudarEstadoAnomalia(db, a.id, 'resolvida', 'trocada');
    const i = await iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'periodica' });
    for (const ln of await db.inspecaoLinhas.toArray()) await avaliarLinha(db, ln.id, 'conforme', ln.equipamentoId === e.id ? 'ok, limpo' : '');
    await concluirInspecao(db, i.id);
    await abaterEquipamento(db, e.id, 'obsoleto');
    const eq = (await db.equipamentos.get(e.id)) as Equipamento;
    const h = historicoEquipamento(eq, {
      anomalias: await db.anomalias.toArray(), inspecoes: await db.inspecoes.toArray(), linhas: await db.inspecaoLinhas.toArray(),
      execucoes: [], manutencoes: [], nomeLocal: () => 'Sala 1'
    });
    expect(h.map((x) => x.tipo)).toEqual(['abate', 'inspecao', 'anomalia', 'criado']);
    expect(h[1].detalhe).toContain('ok, limpo');
    expect(h[2].detalhe).toContain('Resolvida');
    expect(h.some((x) => x.texto.includes('Não é deste'))).toBe(false);
  });
});
