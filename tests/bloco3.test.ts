import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { criarLocalizacao, eliminarLocalizacao } from '../src/db/repo';
import {
  arquivarArtigo, atualizarArtigo, criarArtigo, definirEstadoCompra, listaCompras, registarContagem, situacao, stockPorArtigo
} from '../src/db/stock';
import { apagarDadosExemplo, criarDadosExemplo, soTemDadosExemplo } from '../src/db/exemplo';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';
import { linhasCompras, linhasInventario } from '../src/export/stock';

let db: OfficeDB;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`);
  await db.open();
});

const stocks = async () => stockPorArtigo(await db.artigos.filter((a) => !a.deletedAt).toArray(), await db.contagensStock.toArray());

describe('artigos', () => {
  it('cria com código AR-, unidade por omissão e valida números', async () => {
    const a = await criarArtigo(db, { nome: ' Papel ', stockMinimo: '5', preco: '4,5' });
    expect(a.codigo).toBe('AR-000001');
    expect(a.nome).toBe('Papel');
    expect(a.unidade).toBe('un');
    expect(a.stockMinimo).toBe(5);
    expect(a.preco).toBe(4.5);
    await expect(criarArtigo(db, { nome: '' })).rejects.toThrow('obrigatório');
    await expect(criarArtigo(db, { nome: 'x', stockMinimo: -1 })).rejects.toThrow('negativo');
    await expect(criarArtigo(db, { nome: 'x', preco: 'abc' })).rejects.toThrow('número');
  });
  it('não reutiliza códigos depois de arquivar', async () => {
    const a = await criarArtigo(db, { nome: 'A' });
    await arquivarArtigo(db, a.id);
    expect((await criarArtigo(db, { nome: 'B' })).codigo).toBe('AR-000002');
    await expect(atualizarArtigo(db, a.id, { nome: 'A2' })).rejects.toThrow('não existe');
  });
});

describe('contagens e stock', () => {
  it('guarda anterior e diferença; stock atual é a última contagem por local', async () => {
    const l1 = await criarLocalizacao(db, { nome: 'Casa', tipo: 'divisao' });
    const l2 = await criarLocalizacao(db, { nome: 'Garagem', tipo: 'armazenamento' });
    const a = await criarArtigo(db, { nome: 'Pilhas' });
    const c1 = await registarContagem(db, a.id, l1.id, 10);
    expect(c1.anterior).toBeNull();
    expect(c1.diferenca).toBeNull();
    const c2 = await registarContagem(db, a.id, l1.id, 7, 'usei 3');
    expect(c2.anterior).toBe(10);
    expect(c2.diferenca).toBe(-3);
    await registarContagem(db, a.id, l2.id, 4);
    const [s] = await stocks();
    expect(s.total).toBe(11);
    expect(s.porLocal).toHaveLength(2);
    expect(await db.contagensStock.count()).toBe(3); // histórico nunca apagado
  });
  it('contagens seguidas no mesmo instante mantêm a ordem', async () => {
    const l = await criarLocalizacao(db, { nome: 'Casa', tipo: 'divisao' });
    const a = await criarArtigo(db, { nome: 'X' });
    for (const q of [1, 2, 3, 4, 5]) await registarContagem(db, a.id, l.id, q);
    expect((await stocks())[0].total).toBe(5);
    expect((await db.contagensStock.toArray()).filter((c) => c.quantidade === 5)[0].anterior).toBe(4);
  });
  it('valida artigo, local e quantidade; aceita decimais', async () => {
    const l = await criarLocalizacao(db, { nome: 'Casa', tipo: 'divisao' });
    const a = await criarArtigo(db, { nome: 'Arroz', unidade: 'kg' });
    await expect(registarContagem(db, a.id, l.id, -1)).rejects.toThrow('negativo');
    await expect(registarContagem(db, a.id, l.id, '')).rejects.toThrow('número');
    await expect(registarContagem(db, a.id, 'inexistente', 1)).rejects.toThrow('local');
    await expect(registarContagem(db, 'x', l.id, 1)).rejects.toThrow('artigo');
    expect((await registarContagem(db, a.id, l.id, '1,25')).quantidade).toBe(1.25);
    expect((await registarContagem(db, a.id, l.id, 0.1 + 0.2)).quantidade).toBe(0.3);
  });
  it('não elimina um local com stock; elimina depois de contado a 0', async () => {
    const l = await criarLocalizacao(db, { nome: 'Casa', tipo: 'divisao' });
    const a = await criarArtigo(db, { nome: 'Sal' });
    await registarContagem(db, a.id, l.id, 2);
    await expect(eliminarLocalizacao(db, l.id)).rejects.toThrow('stock');
    await registarContagem(db, a.id, l.id, 0);
    await eliminarLocalizacao(db, l.id);
    expect((await db.localizacoes.get(l.id))?.deletedAt).not.toBeNull();
  });
});

describe('stock mínimo e lista de compras', () => {
  it('lista só artigos abaixo do mínimo, com sugerida calculada ou editada', async () => {
    const l = await criarLocalizacao(db, { nome: 'Casa', tipo: 'divisao' });
    const a = await criarArtigo(db, { nome: 'Papel', stockMinimo: 5, preco: 2 });
    const b = await criarArtigo(db, { nome: 'Sal', stockMinimo: 2 });
    const c = await criarArtigo(db, { nome: 'Sem mínimo' });
    await registarContagem(db, a.id, l.id, 3);
    await registarContagem(db, b.id, l.id, 2); // igual ao mínimo: não é falta
    await registarContagem(db, c.id, l.id, 0);
    let lista = listaCompras(await stocks());
    expect(lista.map((x) => x.artigo.nome)).toEqual(['Papel']);
    expect(lista[0].sugerida).toBe(2);
    expect(lista[0].valor).toBe(4);
    await atualizarArtigo(db, a.id, { nome: 'Papel', stockMinimo: 5, preco: 2, qtdSugerida: 10 });
    lista = listaCompras(await stocks());
    expect(lista[0].sugerida).toBe(10);
    expect(lista[0].valor).toBe(20);
  });
  it('artigo com mínimo e sem contagens conta como 0; sem preço, valor nulo', async () => {
    await criarArtigo(db, { nome: 'Novo', stockMinimo: 3 });
    const [x] = listaCompras(await stocks());
    expect(x.atual).toBe(0);
    expect(x.sugerida).toBe(3);
    expect(x.valor).toBeNull();
  });
  it('estado «comprado» volta a «por comprar» com nova contagem; nunca cria encomendas', async () => {
    const l = await criarLocalizacao(db, { nome: 'Casa', tipo: 'divisao' });
    const a = await criarArtigo(db, { nome: 'Papel', stockMinimo: 5 });
    await definirEstadoCompra(db, a.id, 'comprado');
    expect((await db.artigos.get(a.id))?.estadoCompra).toBe('comprado');
    await registarContagem(db, a.id, l.id, 1);
    expect((await db.artigos.get(a.id))?.estadoCompra).toBe('por_comprar');
  });
  it('situação por artigo', async () => {
    const l = await criarLocalizacao(db, { nome: 'Casa', tipo: 'divisao' });
    const a = await criarArtigo(db, { nome: 'A', stockMinimo: 2 });
    await registarContagem(db, a.id, l.id, 1);
    expect(situacao((await stocks())[0])).toBe('abaixo');
    await registarContagem(db, a.id, l.id, 2);
    expect(situacao((await stocks())[0])).toBe('ok');
  });
});

describe('exemplo, cópia e Excel', () => {
  it('dados de exemplo incluem artigos e são apagados com os contadores', async () => {
    await criarDadosExemplo(db);
    expect(await soTemDadosExemplo(db)).toBe(true);
    expect(listaCompras(await stocks()).map((x) => x.artigo.nome)).toEqual(['Papel A4 (exemplo)']);
    await criarArtigo(db, { nome: 'Real' });
    expect(await soTemDadosExemplo(db)).toBe(false);
    await expect(apagarDadosExemplo(db)).rejects.toThrow();
  });
  it('apagar exemplo repõe AR-000001', async () => {
    await criarDadosExemplo(db);
    await apagarDadosExemplo(db);
    expect((await criarArtigo(db, { nome: 'Real' })).codigo).toBe('AR-000001');
  });
  it('a cópia de segurança leva e restaura artigos e contagens', async () => {
    await criarDadosExemplo(db);
    const { blob } = await exportarCopia(db);
    const db2 = new OfficeDB(`t-${crypto.randomUUID()}`);
    await db2.open();
    await restaurarCopia(db2, blob);
    expect(await db2.artigos.count()).toBe(2);
    expect(await db2.contagensStock.count()).toBe(2);
  });
  it('linhas de Excel', async () => {
    await criarDadosExemplo(db);
    const s = await stocks();
    const inv = linhasInventario(s, () => 'Local');
    expect(inv).toHaveLength(2);
    expect(inv.some((r) => r[6] === 'Abaixo do mínimo')).toBe(true);
    expect(linhasCompras(listaCompras(s))[0][9]).toBe('Por comprar');
  });
});
