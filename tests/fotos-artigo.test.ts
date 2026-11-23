import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { adicionarFoto } from '../src/db/repo';
import { arquivarArtigo, criarArtigo } from '../src/db/stock';

let db: OfficeDB;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`);
  await db.open();
});

describe('fotografias do artigo', () => {
  const img = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

  it('aceita várias fotografias no mesmo artigo', async () => {
    const a = await criarArtigo(db, { nome: 'Papel A4' });
    await adicionarFoto(db, 'artigo', a.id, img());
    await adicionarFoto(db, 'artigo', a.id, img());
    await adicionarFoto(db, 'artigo', a.id, img());
    expect(await db.fotografias.where('[entidade+entidadeId]').equals(['artigo', a.id]).count()).toBe(3);
  });

  it('recusa artigo inexistente ou arquivado', async () => {
    await expect(adicionarFoto(db, 'artigo', 'x', img())).rejects.toThrow('não existe');
    const a = await criarArtigo(db, { nome: 'Toner' });
    await arquivarArtigo(db, a.id);
    await expect(adicionarFoto(db, 'artigo', a.id, img())).rejects.toThrow('não existe');
  });
});
