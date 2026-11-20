import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB, type Anomalia, type Equipamento, type Inspecao } from '../src/db/schema';
import { criarEquipamento, criarLocalizacao } from '../src/db/repo';
import { criarAnomalia } from '../src/db/anomalias';
import { criarLembrete, type Evento } from '../src/db/agenda';
import { arquivarNota, criarNota, dividirNota, marcarNotaTratada, notasAbertas, rotaConverter } from '../src/db/notas';
import { resumoHoje } from '../src/db/resumo';
import { lerOrdem, guardarOrdem, ordenarListaAnomalias, ordenarListaArtigos, ordenarListaEquipamentos, ordenarListaLocais } from '../src/db/ordenar';
import { modelosDeEquipamento } from '../src/db/consultas';
import { modoEfetivo } from '../src/ui/tema';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';
import { soTemDadosExemplo, criarDadosExemplo } from '../src/db/exemplo';
import type { StockArtigo } from '../src/db/stock';

let db: OfficeDB;
beforeEach(async () => { db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open(); });

const base = { deletedAt: null, updatedAt: '' };
const an = (id: string, p: Anomalia['prioridade'], e: Anomalia['estado'], criada: string, local: string): Anomalia =>
  ({ ...base, id, codigo: id, titulo: id, descricao: '', localizacaoId: local, equipamentoId: null, prioridade: p, estado: e, dataResolucao: null, createdAt: criada });

describe('ordenar listas', () => {
  const lista = [an('A', 'baixa', 'por_resolver', '2026-11-01', 'l2'), an('B', 'alta', 'em_intervencao', '2026-11-03', 'l1'), an('C', 'media', 'resolvida', '2026-11-02', 'l1')];
  const nome = (id: string | null) => (id ? ({ l1: 'Sala 10', l2: 'Sala 2' } as Record<string, string>)[id] ?? '' : '');
  it('anomalias: prioridade (de sempre), recentes, antigas, local (ordem natural) e estado', () => {
    expect(ordenarListaAnomalias(lista, 'prioridade', nome).map((a) => a.id)).toEqual(['B', 'A', 'C']);
    expect(ordenarListaAnomalias(lista, 'recentes', nome).map((a) => a.id)).toEqual(['B', 'C', 'A']);
    expect(ordenarListaAnomalias(lista, 'antigas', nome).map((a) => a.id)).toEqual(['A', 'C', 'B']);
    expect(ordenarListaAnomalias(lista, 'local', nome).map((a) => a.id)).toEqual(['A', 'B', 'C']); // «Sala 2» antes de «Sala 10»
    expect(ordenarListaAnomalias(lista, 'estado', nome).map((a) => a.id)).toEqual(['A', 'B', 'C']);
  });
  it('equipamentos: garantia com vazios no fim; local sem local no fim', () => {
    const eq = (id: string, fim: string | null, local: string | null) => ({ ...base, id, codigo: id, nome: id, categoria: '', fimGarantia: fim, localizacaoId: local, createdAt: id }) as unknown as Equipamento;
    const l = [eq('EQ-3', null, null), eq('EQ-1', '2027-01-01', 'l1'), eq('EQ-2', '2026-12-01', 'l2')];
    expect(ordenarListaEquipamentos(l, 'garantia', nome).map((e) => e.id)).toEqual(['EQ-2', 'EQ-1', 'EQ-3']);
    expect(ordenarListaEquipamentos(l, 'local', (id) => (id ? nome(id) : '')).map((e) => e.id)).toEqual(['EQ-2', 'EQ-1', 'EQ-3']);
    expect(ordenarListaEquipamentos(l, 'codigo', nome).map((e) => e.id)).toEqual(['EQ-1', 'EQ-2', 'EQ-3']);
  });
  it('locais por piso e por nº de equipamentos; artigos mais em falta primeiro', () => {
    const lo = [{ l: { nome: 'B', piso: '10' }, n: 1 }, { l: { nome: 'A', piso: '2' }, n: 5 }, { l: { nome: 'C', piso: '' }, n: 0 }] as never[];
    expect(ordenarListaLocais(lo, 'piso').map((x: { l: { nome: string } }) => x.l.nome)).toEqual(['A', 'B', 'C']);
    expect(ordenarListaLocais(lo, 'equipamentos').map((x: { l: { nome: string } }) => x.l.nome)).toEqual(['A', 'B', 'C']);
    const s = (nome: string, total: number, min: number | null) => ({ artigo: { nome, codigo: nome, categoria: '', stockMinimo: min }, total }) as unknown as StockArtigo;
    expect(ordenarListaArtigos([s('Sem mín', 0, null), s('Folga', 9, 2), s('Falta 5', 1, 6)], 'falta').map((x) => x.artigo.nome)).toEqual(['Falta 5', 'Folga', 'Sem mín']);
  });
  it('a ordem escolhida fica guardada; valor estranho volta à de sempre', () => {
    const m = new Map<string, string>();
    const armazem = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(lerOrdem('anomalias', armazem)).toBe('prioridade');
    guardarOrdem('anomalias', 'recentes', armazem);
    expect(lerOrdem('anomalias', armazem)).toBe('recentes');
    m.set('om.ordem.anomalias', 'qualquer');
    expect(lerOrdem('anomalias', armazem)).toBe('prioridade');
  });
});

describe('notas rápidas', () => {
  it('criar, tratar (uma só vez) e arquivar; vazias recusadas', async () => {
    await expect(criarNota(db, '   ')).rejects.toThrow('Escreve');
    const n1 = await criarNota(db, ' estore da sala 2 ');
    const n2 = await criarNota(db, 'pedir toner');
    expect(n1.texto).toBe('estore da sala 2');
    const loc = await criarLocalizacao(db, { nome: 'Sala 2', tipo: 'divisao' });
    const a = await criarAnomalia(db, { titulo: n1.texto, descricao: '', localizacaoId: loc.id, equipamentoId: null, prioridade: 'media' });
    await marcarNotaTratada(db, n1.id, 'anomalia', a.id);
    await expect(marcarNotaTratada(db, n1.id, 'anomalia', a.id)).rejects.toThrow('já foi tratada');
    expect(await db.notas.get(n1.id)).toMatchObject({ estado: 'tratada', destinoTipo: 'anomalia', destinoId: a.id });
    const l = await criarLembrete(db, { titulo: 'toner', data: '2026-12-01' });
    await marcarNotaTratada(db, n2.id, 'lembrete', l.id);
    const n3 = await criarNota(db, 'x');
    await arquivarNota(db, n3.id);
    expect(await notasAbertas(db)).toHaveLength(0);
    expect(await db.notas.count()).toBe(3); // nada se apaga
  });
  it('título curto da 1.ª linha; texto completo na descrição; rota com o id da nota', async () => {
    expect(dividirNota('curta')).toEqual({ titulo: 'curta', descricao: '' });
    const longa = `${'a'.repeat(100)}\nsegunda linha`;
    const d = dividirNota(longa);
    expect(d.titulo.length).toBe(80);
    expect(d.titulo.endsWith('…')).toBe(true);
    expect(d.descricao).toBe(longa);
    const n = await criarNota(db, 'linha 1\nlinha 2');
    const r = rotaConverter(n, 'lembrete');
    expect(r.startsWith('/agenda/novo?')).toBe(true);
    const q = new URLSearchParams(r.split('?')[1]);
    expect([q.get('nota'), q.get('titulo'), q.get('descricao')]).toEqual([n.id, 'linha 1', 'linha 1\nlinha 2']);
  });
  it('entram na cópia de segurança e impedem o «apagar dados de exemplo»', async () => {
    await criarDadosExemplo(db);
    expect(await soTemDadosExemplo(db)).toBe(true);
    await criarNota(db, 'real');
    expect(await soTemDadosExemplo(db)).toBe(false);
    const { blob } = await exportarCopia(db);
    const d2 = new OfficeDB(`t-${crypto.randomUUID()}`); await d2.open();
    await restaurarCopia(d2, blob);
    expect((await d2.notas.toArray()).map((n) => n.texto)).toEqual(['real']);
  });
});

describe('resumo de hoje', () => {
  const hoje = new Date(2026, 10, 20);
  const ev = (tipo: Evento['tipo'], data: string): Evento => ({ chave: `${tipo}${data}`, tipo, data, alertaDesde: data, titulo: '', detalhe: '', rota: '' });
  it('agenda: atrasadas e de hoje; garantias só no próprio dia; futuras não contam', () => {
    const r = resumoHoje({ eventos: [ev('lembrete', '2026-11-18'), ev('manutencao', '2026-11-20'), ev('lembrete', '2026-11-25'), ev('garantia', '2026-11-20'), ev('garantia', '2026-11-01')], anomalias: [], inspecoes: [], aComprar: 0, notas: 0 }, hoje);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ chave: 'agenda', urgente: true, texto: '3 tarefas na agenda', detalhe: '2 para hoje · 1 atrasada' });
  });
  it('anomalias abertas (alta = urgente), inspeções, compras e notas; nada pendente = lista vazia', () => {
    const r = resumoHoje({
      eventos: [], aComprar: 2, notas: 1,
      anomalias: [an('A', 'alta', 'por_resolver', '', 'l'), an('B', 'baixa', 'aguarda_verificacao', '', 'l'), an('C', 'alta', 'resolvida', '', 'l')],
      inspecoes: [{ ...base, estado: 'em_curso' } as Inspecao, { ...base, estado: 'concluida' } as Inspecao]
    }, hoje);
    expect(r.map((l) => l.chave)).toEqual(['anomalias', 'inspecoes', 'compras', 'notas']);
    expect(r[0]).toMatchObject({ urgente: true, texto: '2 anomalias abertas', detalhe: '1 de prioridade alta · 1 a aguardar verificação' });
    expect(r[1].texto).toBe('1 inspeção em curso');
    expect(r[3].rota).toBe('');
    expect(resumoHoje({ eventos: [], anomalias: [], inspecoes: [], aComprar: 0, notas: 0 }, hoje)).toEqual([]);
  });
});

describe('copiar equipamento igual', () => {
  it('agrupa iguais sem acentos/maiúsculas, conta abatidos, ignora eliminados', async () => {
    await criarEquipamento(db, { nome: 'Cadeira', categoria: 'Mobiliário', marca: 'X', modelo: 'M1', localizacaoId: null });
    await criarEquipamento(db, { nome: 'cadeira ', categoria: 'mobiliario', marca: 'x', modelo: 'm1', localizacaoId: null });
    await criarEquipamento(db, { nome: 'Cadeira', categoria: 'Mobiliário', marca: 'X', modelo: 'M2', localizacaoId: null });
    const e = await criarEquipamento(db, { nome: 'Monitor', categoria: '', marca: '', modelo: '', localizacaoId: null });
    await db.equipamentos.update(e.id, { deletedAt: '2026-01-01' });
    const m = modelosDeEquipamento(await db.equipamentos.toArray());
    expect(m.map((x) => [x.nome.toLowerCase(), x.modelo.toLowerCase(), x.quantos])).toEqual([['cadeira', 'm1', 2], ['cadeira', 'm2', 1]]);
  });
});

describe('modo escuro', () => {
  it('automático segue o telemóvel; claro e escuro são fixos', () => {
    expect(modoEfetivo('auto', true)).toBe('escuro');
    expect(modoEfetivo('auto', false)).toBe('claro');
    expect(modoEfetivo('escuro', false)).toBe('escuro');
    expect(modoEfetivo('claro', true)).toBe('claro');
  });
});
