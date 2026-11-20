import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { atualizarLocalizacao, criarEquipamento, criarLocalizacao } from '../src/db/repo';
import { atualizarFornecedor, criarFornecedor, nifValido, resumoCompras } from '../src/db/encomendas';
import { registarPreparado } from '../src/db/emails';
import { diasDaSemana, eventosAgenda, grelhaMes } from '../src/db/agenda';
import { relatorioHistoricoInspecoes, relatorioPendentes } from '../src/export/relatorios';
import { criarAnomalia } from '../src/db/anomalias';
import { iniciarInspecao } from '../src/db/inspecoes';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB;
beforeEach(async () => { db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open(); });

describe('fornecedor completo', () => {
  it('NIF português validado (módulo 11), estrangeiro com prefixo, campos novos guardados', async () => {
    expect(nifValido('501964843')).toBe(true);
    expect(nifValido('501964844')).toBe(false);
    await expect(criarFornecedor(db, { nome: 'A', nif: '123456780' })).rejects.toThrow('NIF inválido');
    const f = await criarFornecedor(db, { nome: 'A', nif: 'PT 501 964 843', morada: ' Rua X ', categorias: 'papelaria', condicoes: 'portes grátis', prazoPagamento: '30 dias' });
    expect([f.nif, f.morada, f.prazoPagamento]).toEqual(['501964843', 'Rua X', '30 dias']);
    await atualizarFornecedor(db, f.id, { nome: 'A', nif: 'es b12345678' });
    expect((await db.fornecedores.get(f.id))?.nif).toBe('ES B12345678');
    await expect(atualizarFornecedor(db, f.id, { nome: 'A', nif: 'xyz' })).rejects.toThrow('NIF inválido');
  });
  it('resumo de compras ignora rascunhos e canceladas; estimativa com preço atual', () => {
    const encs = [
      { id: 'e1', estado: 'entregue', deletedAt: null }, { id: 'e2', estado: 'encomendada', deletedAt: null },
      { id: 'e3', estado: 'rascunho', deletedAt: null }, { id: 'e4', estado: 'cancelada', deletedAt: null }
    ];
    const linhas = [
      { encomendaId: 'e1', artigoId: 'a', quantidade: 2, aceite: 2, deletedAt: null },
      { encomendaId: 'e2', artigoId: 'b', quantidade: 1, aceite: 0, deletedAt: null },
      { encomendaId: 'e3', artigoId: 'a', quantidade: 100, aceite: 0, deletedAt: null }
    ];
    expect(resumoCompras(encs, linhas, new Map([['a', 1.5], ['b', null]]))).toEqual({ encomendas: 2, entregues: 1, valorEstimado: 3, linhasSemPreco: 1 });
  });
});

describe('registo de e-mails preparados', () => {
  it('guarda e entra na cópia de segurança', async () => {
    await registarPreparado(db, { canal: 'email', modelo: 'M', paraNome: ' Rui ', paraEmail: '', assunto: 'x'.repeat(400), origem: 'anomalia', refId: 'a1' });
    const [r] = await db.emailsPreparados.toArray();
    expect([r.paraNome, r.assunto.length]).toEqual(['Rui', 300]);
    const { blob } = await exportarCopia(db);
    const d2 = new OfficeDB(`t-${crypto.randomUUID()}`); await d2.open();
    await restaurarCopia(d2, blob);
    expect(await d2.emailsPreparados.count()).toBe(1);
  });
});

describe('calendário', () => {
  it('grelha do mês começa à segunda e cobre o mês inteiro', () => {
    const g = grelhaMes(2026, 11);
    expect(g[0][0]).toEqual({ data: '2026-10-26', doMes: false });
    expect(g.flat().filter((c) => c.doMes)).toHaveLength(30);
    expect(g.every((s) => s.length === 7)).toBe(true);
    expect(grelhaMes(2026, 2).flat().filter((c) => c.doMes)).toHaveLength(28);
  });
  it('semana de segunda a domingo; eventos trazem o equipamento', async () => {
    expect(diasDaSemana('2026-11-20')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
    expect(diasDaSemana('2026-11-16')[0]).toBe('2026-11-16');
    const loc = await criarLocalizacao(db, { nome: 'S', tipo: 'divisao' });
    const e = await criarEquipamento(db, { nome: 'Router', localizacaoId: loc.id, fimGarantia: '2027-01-01' });
    expect(eventosAgenda(await db.equipamentos.toArray(), [], () => '')[0].equipamentoId).toBe(e.id);
  });
});

describe('piso e ala', () => {
  it('guarda, valida comprimento e filtra relatórios por piso', async () => {
    const p0 = await criarLocalizacao(db, { nome: 'Receção', tipo: 'divisao', piso: ' 0 ', ala: 'Norte' });
    const p1 = await criarLocalizacao(db, { nome: 'Sala 1', tipo: 'divisao', piso: '1' });
    expect([p0.piso, p0.ala]).toEqual(['0', 'Norte']);
    await expect(criarLocalizacao(db, { nome: 'X', tipo: 'divisao', piso: 'x'.repeat(31) })).rejects.toThrow('Piso');
    await atualizarLocalizacao(db, p1.id, { ala: 'Sul' });
    expect((await db.localizacoes.get(p1.id))?.piso).toBe('1');
    await criarAnomalia(db, { titulo: 'A0', localizacaoId: p0.id, prioridade: 'alta' });
    await criarAnomalia(db, { titulo: 'A1', localizacaoId: p1.id, prioridade: 'baixa' });
    await criarEquipamento(db, { nome: 'PC', localizacaoId: p1.id });
    await iniciarInspecao(db, { localizacaoId: p1.id, modalidade: 'pontual' });
    const locs = await db.localizacoes.toArray();
    const pisoDe = (id: string) => locs.find((l) => l.id === id)?.piso ?? '';
    const nl = (id: string) => locs.find((l) => l.id === id)?.nome ?? '';
    const rp = relatorioPendentes(await db.anomalias.toArray(), nl, () => '', { piso: '1', pisoDe });
    expect(rp.linhas.map((l) => l[1])).toEqual(['A1']);
    expect(rp.filtros).toContain('piso 1');
    const ri = relatorioHistoricoInspecoes(await db.inspecoes.toArray(), [], nl, { piso: '0', pisoDe });
    expect([ri.linhas.length, ri.titulo]).toEqual([0, 'Inspeções do piso 0']);
    expect(relatorioHistoricoInspecoes(await db.inspecoes.toArray(), [], nl).titulo).toBe('Histórico geral de inspeções');
  });
});
