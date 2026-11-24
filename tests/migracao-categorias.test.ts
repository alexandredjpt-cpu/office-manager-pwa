import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';

describe('migração v20 → v21: categorias em texto viram catálogo', () => {
  it('normaliza os textos existentes e cria o catálogo sem repetições', async () => {
    const nome = `mig-${crypto.randomUUID()}`;
    // Base como estava na v20: só o que a migração lê.
    const antiga = new Dexie(nome);
    antiga.version(20).stores({ fornecedores: 'id, nome, deletedAt, updatedAt' });
    await antiga.open();
    const t = '2026-11-01T10:00:00.000Z';
    await antiga.table('fornecedores').bulkAdd([
      { id: 'a', nome: 'Delta', contacto: '', email: '', telefone: '', notas: '', categorias: 'papel,  Papel; limpeza', createdAt: t, updatedAt: t, deletedAt: null },
      { id: 'b', nome: 'Sanit', contacto: '', email: '', telefone: '', notas: '', categorias: 'Limpeza', createdAt: t, updatedAt: t, deletedAt: null }
    ]);
    antiga.close();

    const db = new OfficeDB(nome);
    await db.open();
    const cats = (await db.categoriasFornecedor.toArray()).map((c) => c.nome).sort();
    expect(cats).toHaveLength(2);
    expect(cats.map((c) => c.toLowerCase()).sort()).toEqual(['limpeza', 'papel']);
    expect((await db.fornecedores.get('a'))?.categorias).toBe('papel, limpeza');
    expect((await db.fornecedores.get('a'))?.updatedAt).toBe(t);
    expect((await db.fornecedores.get('b'))?.categorias).toBe('Limpeza');
    db.close();
  });
});
