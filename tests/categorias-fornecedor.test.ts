import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { criarFornecedor, atualizarFornecedor } from '../src/db/encomendas';
import { arquivarCategoria, criarCategoria, listarCategorias, renomearCategoria, separarCategorias, temCategoria, juntarCategorias } from '../src/db/categorias';

let db: OfficeDB;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open();
});

describe('categorias de fornecedores', () => {
  it('separa e normaliza: sem repetições nem diferenças de maiúsculas, espaços limpos', () => {
    expect(separarCategorias(' papel ,Papel; limpeza  ,, ')).toEqual(['papel', 'limpeza']);
    expect(juntarCategorias(['Papel', 'papel ', 'Limpeza'])).toBe('Papel, Limpeza');
  });

  it('filtro: basta uma categoria em comum; sem escolha mostra todos', () => {
    expect(temCategoria('Papel, Limpeza', ['cafetaria', 'limpeza'])).toBe(true);
    expect(temCategoria('Papel', ['limpeza'])).toBe(false);
    expect(temCategoria('', [])).toBe(true);
  });

  it('criar é idempotente por nome (ignora maiúsculas) e recusa vírgulas e nomes vazios', async () => {
    const a = await criarCategoria(db, 'Papelaria');
    const b = await criarCategoria(db, '  papelaria ');
    expect(b.id).toBe(a.id);
    await expect(criarCategoria(db, '   ')).rejects.toThrow('obrigatório');
    await expect(criarCategoria(db, 'a,b')).rejects.toThrow('vírgulas');
    expect((await listarCategorias(db)).map((c) => c.nome)).toEqual(['Papelaria']);
  });

  it('renomear muda todos os fornecedores', async () => {
    const cat = await criarCategoria(db, 'Papel');
    const f = await criarFornecedor(db, { nome: 'Delta', categorias: 'Papel, Cafetaria' });
    await renomearCategoria(db, cat.id, 'Papelaria');
    expect((await db.fornecedores.get(f.id))?.categorias).toBe('Papelaria, Cafetaria');
  });

  it('renomear para um nome já existente funde as duas', async () => {
    const papel = await criarCategoria(db, 'Papel');
    await criarCategoria(db, 'Papelaria');
    const f = await criarFornecedor(db, { nome: 'Delta', categorias: 'Papel' });
    await renomearCategoria(db, papel.id, 'papelaria');
    expect((await db.fornecedores.get(f.id))?.categorias).toBe('Papelaria');
    expect((await listarCategorias(db)).map((c) => c.nome)).toEqual(['Papelaria']);
  });

  it('arquivar tira a categoria de todos os fornecedores', async () => {
    const cat = await criarCategoria(db, 'Limpeza');
    const f = await criarFornecedor(db, { nome: 'Sanit', categorias: 'Limpeza, Higiene' });
    await arquivarCategoria(db, cat.id);
    expect((await db.fornecedores.get(f.id))?.categorias).toBe('Higiene');
    expect(await listarCategorias(db)).toEqual([]);
  });

  it('criar fornecedor normaliza as categorias escolhidas', async () => {
    const f = await criarFornecedor(db, { nome: 'Nespresso', categorias: 'Cafetaria,cafetaria' });
    expect(f.categorias).toBe('Cafetaria');
    await atualizarFornecedor(db, f.id, { nome: 'Nespresso', categorias: 'Cafetaria, Bebidas' });
    expect((await db.fornecedores.get(f.id))?.categorias).toBe('Cafetaria, Bebidas');
  });
});
