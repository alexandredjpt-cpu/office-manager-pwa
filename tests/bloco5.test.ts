import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OfficeDB } from '../src/db/schema';
import { criarLocalizacao } from '../src/db/repo';
import { adicionarAtividade, criarAnomalia, mudarEstadoAnomalia } from '../src/db/anomalias';
import { criarArtigo, listaCompras, registarContagem, stockPorArtigo } from '../src/db/stock';
import { gerarPdfTabela, sanear, dataCurta } from '../src/export/pdf';
import { gerarPdfAnomalia, relatorioCompras, relatorioInventario, relatorioPendentes, relatorioResolvidas } from '../src/export/relatorios';

let db: OfficeDB;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`);
  await db.open();
});
const cab = { emitidoEm: new Date(2026, 10, 19, 21, 0), responsavel: 'Alexandre' };
const texto = (blob: Blob) => blob.arrayBuffer().then((b) => {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-'));
  writeFileSync(join(dir, 'a.pdf'), Buffer.from(b));
  return execFileSync('pdftotext', ['-layout', join(dir, 'a.pdf'), '-'], { encoding: 'utf8' });
});

describe('texto e datas', () => {
  it('sanear troca símbolos fora do WinAnsi e mantém acentos', () => {
    expect(sanear('Ação → ≈ 5€ ✓')).toBe('Ação -> ~ 5€ ?');
    expect(dataCurta('2026-11-19T10:00:00Z')).toBe('19/11/2026');
    expect(dataCurta(null)).toBe('');
  });
});

describe('relatórios de anomalias', () => {
  it('pendentes: só abertas, por prioridade, com filtro', async () => {
    const l = await criarLocalizacao(db, { nome: 'Cozinha', tipo: 'divisao' });
    await criarAnomalia(db, { titulo: 'Baixa um', localizacaoId: l.id, prioridade: 'baixa' });
    await criarAnomalia(db, { titulo: 'Alta um', localizacaoId: l.id, prioridade: 'alta' });
    const r = await criarAnomalia(db, { titulo: 'Fechada', localizacaoId: l.id, prioridade: 'alta' });
    await mudarEstadoAnomalia(db, r.id, 'resolvida');
    const todas = await db.anomalias.toArray();
    const rel = relatorioPendentes(todas, () => 'Cozinha', () => '');
    expect(rel.linhas.map((x) => x[1])).toEqual(['Alta um', 'Baixa um']);
    expect(rel.resumo[0]).toBe('Total: 2 (1 de prioridade alta)');
    expect(relatorioPendentes(todas, () => 'Cozinha', () => '', { prioridade: 'baixa' }).linhas).toHaveLength(1);
    const pdf = await texto(await gerarPdfTabela(rel, cab));
    expect(pdf).toContain('Anomalias pendentes');
    expect(pdf).toContain('Responsável: Alexandre');
    expect(pdf).toContain('Alta um');
    expect(pdf).toContain('Página 1 de 1');
    expect(pdf).not.toContain('Fechada');
  });
  it('resolvidas: datas do histórico e filtro por período', async () => {
    const l = await criarLocalizacao(db, { nome: 'Sala', tipo: 'divisao' });
    const a = await criarAnomalia(db, { titulo: 'Fuga', localizacaoId: l.id, prioridade: 'media' });
    await mudarEstadoAnomalia(db, a.id, 'em_intervencao');
    await mudarEstadoAnomalia(db, a.id, 'aguarda_verificacao');
    await mudarEstadoAnomalia(db, a.id, 'resolvida');
    const [x] = await db.anomalias.toArray();
    const atv = await db.atividades.toArray();
    const rel = relatorioResolvidas([x], atv, () => 'Sala');
    expect(rel.linhas).toHaveLength(1);
    expect(rel.linhas[0][4]).not.toBe(''); // intervenção
    expect(rel.linhas[0][5]).not.toBe(''); // verificação
    expect(relatorioResolvidas([x], atv, () => 'Sala', { de: '2999-01-01' }).linhas).toHaveLength(0);
  });
  it('vazio dá mensagem clara', async () => {
    const t = await texto(await gerarPdfTabela(relatorioPendentes([], () => '', () => ''), cab));
    expect(t).toContain('Sem registos');
  });
});

describe('inventário e compras', () => {
  it('inventário geral e por local; compras com total', async () => {
    const casa = await criarLocalizacao(db, { nome: 'Casa', tipo: 'divisao' });
    const gar = await criarLocalizacao(db, { nome: 'Garagem', tipo: 'armazenamento' });
    const a = await criarArtigo(db, { nome: 'Papel', stockMinimo: 5, preco: 2, fornecedor: 'Loja' });
    await registarContagem(db, a.id, casa.id, 1);
    await registarContagem(db, a.id, gar.id, 1);
    const s = stockPorArtigo(await db.artigos.toArray(), await db.contagensStock.toArray());
    const nome = (id: string) => (id === casa.id ? 'Casa' : 'Garagem');
    expect(relatorioInventario(s, nome).linhas[0][2]).toBe('2 un');
    const porLocal = relatorioInventario(s, nome, { localizacaoId: gar.id });
    expect(porLocal.titulo).toBe('Inventário: Garagem');
    expect(porLocal.linhas[0][2]).toBe('1 un');
    const compras = relatorioCompras(listaCompras(s));
    expect(compras.linhas[0][4]).toBe('3 un');
    expect(compras.resumo[0]).toContain('6,00 EUR');
    const t = await texto(await gerarPdfTabela(compras, cab));
    expect(t).toContain('Necessidades de compra');
  });
  it('muitas linhas paginam com cabeçalho repetido', async () => {
    const rel = relatorioInventario([], () => '');
    rel.linhas = Array.from({ length: 120 }, (_, i) => [`AR-${i}`, `Artigo ${i}`, '1 un', '', '', 'Casa: 1', '']);
    const t = await texto(await gerarPdfTabela(rel, cab));
    expect(t).toMatch(/Página 1 de [2-9]/);
    expect((t.match(/Quantidade/g) ?? []).length).toBeGreaterThan(1);
  });
});

describe('PDF individual', () => {
  it('inclui ficha, histórico e acentos', async () => {
    const l = await criarLocalizacao(db, { nome: 'Cozinha', tipo: 'divisao' });
    const a = await criarAnomalia(db, { titulo: 'Torneira avariada', descricao: 'Pinga à noite. Ação urgente.', localizacaoId: l.id, prioridade: 'alta' });
    await adicionarAtividade(db, a.id, 'intervencao', 'Canalizador trocou o vedante');
    const blob = await gerarPdfAnomalia((await db.anomalias.get(a.id))!, () => 'Cozinha', () => '', await db.atividades.toArray(), [], cab);
    const t = await texto(blob);
    for (const s of ['Anomalia AN-000001', 'Torneira avariada', 'Cozinha', 'Ação urgente', 'Canalizador trocou o vedante', 'Anomalia registada.']) expect(t).toContain(s);
  });
});
