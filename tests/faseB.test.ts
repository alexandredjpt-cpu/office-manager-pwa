import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { criarLocalizacao } from '../src/db/repo';
import { anularContagem, criarArtigo, registarContagem, stockPorArtigo } from '../src/db/stock';
import { anularMovimento, registarMovimento } from '../src/db/movimentos';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB; let a: string; let l1: string; let l2: string;
const stock = async (loc: string) => (stockPorArtigo(await db.artigos.toArray(), await db.contagensStock.toArray())[0].porLocal.find((x) => x.localizacaoId === loc)?.quantidade ?? 0);
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open();
  l1 = (await criarLocalizacao(db, { nome: 'Armazém', tipo: 'divisao' })).id;
  l2 = (await criarLocalizacao(db, { nome: 'Sala', tipo: 'divisao' })).id;
  a = (await criarArtigo(db, { nome: 'Papel' })).id;
  await registarContagem(db, a, l1, 10);
});

describe('movimentos de stock', () => {
  it('transferência: origem diminui, destino aumenta, total mantém-se', async () => {
    await registarMovimento(db, { artigoId: a, tipo: 'transferencia', quantidade: 4, origemId: l1, destinoId: l2, motivo: 'Reposição' });
    expect(await stock(l1)).toBe(6); expect(await stock(l2)).toBe(4);
    const [s] = stockPorArtigo(await db.artigos.toArray(), await db.contagensStock.toArray());
    expect(s.total).toBe(10);
  });
  it('não excede o disponível nem aceita dados inválidos', async () => {
    const base = { artigoId: a, tipo: 'transferencia' as const, quantidade: 11, origemId: l1, destinoId: l2, motivo: 'x' };
    await expect(registarMovimento(db, base)).rejects.toThrow('Só há 10');
    await expect(registarMovimento(db, { ...base, quantidade: 1, destinoId: l1 })).rejects.toThrow('diferentes');
    await expect(registarMovimento(db, { ...base, quantidade: 1, destinoId: undefined })).rejects.toThrow('destino');
    await expect(registarMovimento(db, { ...base, quantidade: 1, motivo: ' ' })).rejects.toThrow('motivo');
    await expect(registarMovimento(db, { ...base, quantidade: -1 })).rejects.toThrow('positiva');
    await expect(registarMovimento(db, { ...base, quantidade: 0 })).rejects.toThrow('inválida');
    expect(await stock(l1)).toBe(10); expect(await db.movimentosStock.count()).toBe(0);
  });
  it('falha a meio não deixa nada gravado (atómico)', async () => {
    await expect(registarMovimento(db, { artigoId: a, tipo: 'transferencia', quantidade: 2, origemId: l1, destinoId: 'inexistente', motivo: 'x' })).rejects.toThrow();
    expect(await stock(l1)).toBe(10);
  });
  it('perda, dano e ajuste', async () => {
    await registarMovimento(db, { artigoId: a, tipo: 'perda', quantidade: 2, origemId: l1, motivo: 'Extravio' });
    await registarMovimento(db, { artigoId: a, tipo: 'dano', quantidade: 1, origemId: l1, motivo: 'Molhado', responsavel: 'Alex' });
    await registarMovimento(db, { artigoId: a, tipo: 'ajuste', quantidade: 3, origemId: l1, motivo: 'Achei caixa' });
    await registarMovimento(db, { artigoId: a, tipo: 'ajuste', quantidade: -1, origemId: l1, motivo: 'Correção' });
    expect(await stock(l1)).toBe(9);
    await expect(registarMovimento(db, { artigoId: a, tipo: 'ajuste', quantidade: -50, origemId: l1, motivo: 'x' })).rejects.toThrow('Só há');
    expect((await db.movimentosStock.toArray()).find((m) => m.tipo === 'dano')?.responsavel).toBe('Alex');
  });
  it('contagem de movimento não se anula; o movimento anula-se se for o último', async () => {
    const m = await registarMovimento(db, { artigoId: a, tipo: 'transferencia', quantidade: 4, origemId: l1, destinoId: l2, motivo: 'x' });
    const gerada = (await db.contagensStock.toArray()).find((c) => c.movimentoId === m.id)!;
    await expect(anularContagem(db, gerada.id)).rejects.toThrow('movimento');
    await anularMovimento(db, m.id);
    expect(await stock(l1)).toBe(10); expect(await stock(l2)).toBe(0);
    await expect(anularMovimento(db, m.id)).rejects.toThrow('não existe');
  });
  it('não anula movimento já seguido de outra contagem', async () => {
    const m = await registarMovimento(db, { artigoId: a, tipo: 'perda', quantidade: 1, origemId: l1, motivo: 'x' });
    await registarContagem(db, a, l1, 7);
    await expect(anularMovimento(db, m.id)).rejects.toThrow('posteriores');
    expect(await stock(l1)).toBe(7);
  });
  it('cópia inclui movimentos', async () => {
    await registarMovimento(db, { artigoId: a, tipo: 'perda', quantidade: 1, origemId: l1, motivo: 'x' });
    const { blob } = await exportarCopia(db);
    const d2 = new OfficeDB(`t-${crypto.randomUUID()}`); await d2.open();
    await restaurarCopia(d2, blob);
    expect(await d2.movimentosStock.count()).toBe(1);
  });
});
