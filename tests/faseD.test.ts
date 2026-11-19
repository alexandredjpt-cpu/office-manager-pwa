import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { criarLocalizacao } from '../src/db/repo';
import { criarArtigo, registarContagem, stockPorArtigo } from '../src/db/stock';
import { anularMovimento } from '../src/db/movimentos';
import {
  arquivarFornecedor, atualizarFornecedor, criarEncomenda, criarFornecedor, definirLinha, mudarEstadoEncomenda, registarRececao, removerLinha
} from '../src/db/encomendas';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB; let forn: string; let a1: string; let a2: string; let loc: string;
const stock = async (a: string) => stockPorArtigo(await db.artigos.toArray(), await db.contagensStock.toArray()).find((s) => s.artigo.id === a)!.total;
async function encomendada() {
  const e = await criarEncomenda(db, forn);
  await definirLinha(db, e.id, a1, 10); await definirLinha(db, e.id, a2, 4);
  for (const s of ['pendente', 'aprovada', 'encomendada'] as const) await mudarEstadoEncomenda(db, e.id, s);
  return e;
}
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open();
  forn = (await criarFornecedor(db, { nome: 'Papelaria X', email: 'a@b.pt' })).id; // privacy-ok
  a1 = (await criarArtigo(db, { nome: 'Papel' })).id; a2 = (await criarArtigo(db, { nome: 'Canetas' })).id;
  loc = (await criarLocalizacao(db, { nome: 'Armazém', tipo: 'divisao' })).id;
  await registarContagem(db, a1, loc, 5);
});

describe('fornecedores', () => {
  it('valida, impede duplicados e arquiva só sem encomendas em curso', async () => {
    await expect(criarFornecedor(db, { nome: ' ' })).rejects.toThrow('obrigatório');
    await expect(criarFornecedor(db, { nome: 'Y', email: 'mau' })).rejects.toThrow('E-mail');
    await expect(criarFornecedor(db, { nome: 'papelaria x' })).rejects.toThrow('Já existe');
    await atualizarFornecedor(db, forn, { nome: 'Papelaria X', telefone: '123' });
    const e = await criarEncomenda(db, forn);
    await expect(arquivarFornecedor(db, forn)).rejects.toThrow('em curso');
    await mudarEstadoEncomenda(db, e.id, 'cancelada');
    await arquivarFornecedor(db, forn);
    await expect(criarEncomenda(db, forn)).rejects.toThrow('fornecedor');
  });
});

describe('encomendas', () => {
  it('códigos EN- sequenciais e fluxo de estados com histórico', async () => {
    const e1 = await criarEncomenda(db, forn); const e2 = await criarEncomenda(db, forn);
    expect([e1.codigo, e2.codigo]).toEqual(['EN-000001', 'EN-000002']);
    await expect(mudarEstadoEncomenda(db, e1.id, 'pendente')).rejects.toThrow('pelo menos um artigo');
    await definirLinha(db, e1.id, a1, 3);
    await expect(mudarEstadoEncomenda(db, e1.id, 'encomendada')).rejects.toThrow('Não se pode');
    await mudarEstadoEncomenda(db, e1.id, 'pendente');
    await expect(definirLinha(db, e1.id, a2, 1)).rejects.toThrow('rascunho');
    await mudarEstadoEncomenda(db, e1.id, 'rascunho');
    await definirLinha(db, e1.id, a1, 6); // atualiza a mesma linha
    expect((await db.encomendaLinhas.toArray()).filter((l) => !l.deletedAt)).toHaveLength(1);
    const l = (await db.encomendaLinhas.toArray())[0];
    await removerLinha(db, l.id);
    await expect(definirLinha(db, e1.id, a1, 0)).rejects.toThrow('maior que zero');
    expect((await db.encomendaEventos.where('encomendaId').equals(e1.id).toArray()).length).toBe(3);
  });
  it('encomendar não mexe no stock', async () => {
    await encomendada();
    expect(await stock(a1)).toBe(5);
  });
  it('receção parcial: só o aceite entra; encomenda fica aberta', async () => {
    const e = await encomendada();
    await registarRececao(db, e.id, { localizacaoId: loc, linhas: [{ artigoId: a1, aceite: 6, danificada: 2, rejeitada: 1 }] });
    expect(await stock(a1)).toBe(11); // 5 + 6 (danificadas/rejeitadas não entram)
    expect((await db.encomendas.get(e.id))?.estado).toBe('parcial');
    const l = (await db.encomendaLinhas.toArray()).find((x) => x.artigoId === a1)!;
    expect([l.aceite, l.danificada, l.rejeitada]).toEqual([6, 2, 1]);
  });
  it('receção completa fecha a encomenda; não aceita a mais; atómica', async () => {
    const e = await encomendada();
    await expect(registarRececao(db, e.id, { localizacaoId: loc, linhas: [{ artigoId: a1, aceite: 3 }, { artigoId: a2, aceite: 9 }] })).rejects.toThrow('Só faltam 4');
    expect(await stock(a1)).toBe(5); expect(await db.rececoes.count()).toBe(0);
    await expect(registarRececao(db, e.id, { linhas: [{ artigoId: a1, aceite: 1 }] })).rejects.toThrow('local');
    await expect(registarRececao(db, e.id, { localizacaoId: loc, linhas: [] })).rejects.toThrow('pelo menos');
    await registarRececao(db, e.id, { localizacaoId: loc, linhas: [{ artigoId: a1, aceite: 4 }] });
    await registarRececao(db, e.id, { localizacaoId: loc, linhas: [{ artigoId: a1, aceite: 6 }, { artigoId: a2, aceite: 4 }] });
    expect((await db.encomendas.get(e.id))?.estado).toBe('entregue');
    expect(await stock(a1)).toBe(15); expect(await stock(a2)).toBe(4);
    await expect(registarRececao(db, e.id, { localizacaoId: loc, linhas: [{ artigoId: a1, aceite: 1 }] })).rejects.toThrow('Só se recebe');
  });
  it('só danificados: não precisa de local nem mexe no stock', async () => {
    const e = await encomendada();
    await registarRececao(db, e.id, { linhas: [{ artigoId: a1, danificada: 10 }] });
    expect(await stock(a1)).toBe(5);
    expect((await db.encomendas.get(e.id))?.estado).toBe('parcial');
  });
  it('fechar parcial como entregue; cancelar só antes de receber; entrada não se anula como movimento', async () => {
    const e = await encomendada();
    await registarRececao(db, e.id, { localizacaoId: loc, linhas: [{ artigoId: a1, aceite: 2 }] });
    await expect(mudarEstadoEncomenda(db, e.id, 'cancelada')).rejects.toThrow('Não se pode');
    const mov = (await db.movimentosStock.toArray())[0];
    await expect(anularMovimento(db, mov.id)).rejects.toThrow('receção');
    await mudarEstadoEncomenda(db, e.id, 'entregue', 'o resto não vem');
    expect((await db.encomendas.get(e.id))?.estado).toBe('entregue');
  });
  it('cópia inclui tudo', async () => {
    const e = await encomendada();
    await registarRececao(db, e.id, { localizacaoId: loc, linhas: [{ artigoId: a1, aceite: 1 }] });
    const { blob } = await exportarCopia(db);
    const d2 = new OfficeDB(`t-${crypto.randomUUID()}`); await d2.open();
    await restaurarCopia(d2, blob);
    expect([await d2.fornecedores.count(), await d2.encomendas.count(), await d2.encomendaLinhas.count(), await d2.rececoes.count()]).toEqual([1, 1, 2, 1]);
  });
});
