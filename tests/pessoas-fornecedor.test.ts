import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { atualizarContacto, criarContacto } from '../src/db/contactos';
import { criarFornecedor } from '../src/db/encomendas';
import { destinosContacto } from '../src/db/contactar';

let db: OfficeDB; let forn: string; let outra: string;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open();
  forn = (await criarFornecedor(db, { nome: 'HAVI' })).id;
  outra = (await criarFornecedor(db, { nome: 'Delta' })).id;
});

describe('pessoas de contacto ligadas a fornecedores', () => {
  it('liga uma pessoa a uma empresa e mostra a empresa nos destinos', async () => {
    const p = await criarContacto(db, { nome: 'Ana', funcao: 'Comercial', telefone: '912345678', fornecedorId: forn }); // privacy-ok: número de teste fictício
    expect(p.fornecedorId).toBe(forn);
    const d = destinosContacto(await db.contactos.toArray(), await db.fornecedores.toArray());
    expect(d.find((x) => x.chave === `c:${p.id}`)?.detalhe).toBe('Comercial · HAVI');
  });

  it('a mesma pessoa (nome) pode existir em empresas diferentes, mas não duas vezes na mesma', async () => {
    await criarContacto(db, { nome: 'Rui', fornecedorId: forn });
    await expect(criarContacto(db, { nome: 'Rui', fornecedorId: outra })).resolves.toBeTruthy();
    await expect(criarContacto(db, { nome: 'Rui', fornecedorId: forn })).rejects.toThrow('nesta empresa');
  });

  it('recusa empresa inexistente ou arquivada', async () => {
    await expect(criarContacto(db, { nome: 'X', fornecedorId: 'nao-existe' })).rejects.toThrow('não existe');
    await db.fornecedores.update(outra, { deletedAt: new Date().toISOString() });
    await expect(criarContacto(db, { nome: 'Y', fornecedorId: outra })).rejects.toThrow('não existe');
  });

  it('mudar de empresa e tirar a empresa funcionam', async () => {
    const p = await criarContacto(db, { nome: 'Ana', fornecedorId: forn });
    await atualizarContacto(db, p.id, { nome: 'Ana', fornecedorId: outra });
    expect((await db.contactos.get(p.id))?.fornecedorId).toBe(outra);
    await atualizarContacto(db, p.id, { nome: 'Ana', fornecedorId: '' });
    expect((await db.contactos.get(p.id))?.fornecedorId).toBeNull();
  });
});
