import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { criarContacto } from '../src/db/contactos';
import { destinosContacto } from '../src/db/contactar';

let db: OfficeDB;
beforeEach(async () => { db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open(); });

describe('segundo telefone e segundo e-mail', () => {
  it('guarda os dois e gera um destino à parte para o segundo meio', async () => {
    const p = await criarContacto(db, { nome: 'Ana', telefone: '912345678', email: 'a@x.pt', telefone2: '+351 213456789', email2: 'ana.fixo@x.pt' }); // privacy-ok: dados de teste fictícios
    const d = destinosContacto(await db.contactos.toArray(), []);
    expect(d.find((x) => x.chave === `c:${p.id}`)).toMatchObject({ telefone: '912345678', email: 'a@x.pt' }); // privacy-ok: dados de teste fictícios
    expect(d.find((x) => x.chave === `c2:${p.id}`)).toMatchObject({ telefone: '+351 213456789', email: 'ana.fixo@x.pt' }); // privacy-ok: dados de teste fictícios
  });

  it('sem segundo meio não há destino extra', async () => {
    const p = await criarContacto(db, { nome: 'Rui', telefone: '912345678' }); // privacy-ok: dados de teste fictícios
    const d = destinosContacto(await db.contactos.toArray(), []);
    expect(d.some((x) => x.chave === `c2:${p.id}`)).toBe(false);
  });

  it('recusa segundo telefone ou e-mail iguais ao primeiro e formatos inválidos', async () => {
    await expect(criarContacto(db, { nome: 'A', telefone: '912345678', telefone2: '912345678' })).rejects.toThrow('igual ao primeiro'); // privacy-ok: dados de teste fictícios
    await expect(criarContacto(db, { nome: 'B', email: 'b@x.pt', email2: 'B@x.pt' })).rejects.toThrow('igual ao primeiro'); // privacy-ok: dados de teste fictícios
    await expect(criarContacto(db, { nome: 'C', telefone2: '123' })).rejects.toThrow('Segundo telefone inválido');
    await expect(criarContacto(db, { nome: 'D', email2: 'nao-e-email' })).rejects.toThrow('Segundo e-mail inválido');
  });
});
