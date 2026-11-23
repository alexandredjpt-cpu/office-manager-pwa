import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { ERRO_CONSULTA, guardarPapel, lerPapel, papelDe } from '../src/db/papel';
import { criarLocalizacao } from '../src/db/repo';

let db: OfficeDB;
let n = 0;
beforeEach(async () => { db = new OfficeDB(`papel-${++n}-${Date.now()}`); await db.open(); });

const local = () => criarLocalizacao(db, { nome: 'Sala', tipo: 'sala', notas: '' });

describe('Papel de quem usa a app', () => {
  it('por omissão é gestor e escreve à vontade', async () => {
    expect(await lerPapel(db)).toBe('gestor');
    await expect(local()).resolves.toBeTruthy();
  });

  it('valor desconhecido ou em falta conta como gestor', () => {
    expect(papelDe(undefined)).toBe('gestor');
    expect(papelDe('chefe')).toBe('gestor');
    expect(papelDe('consulta')).toBe('consulta');
  });

  it('em consulta nenhuma escrita passa, em nenhuma tabela', async () => {
    await guardarPapel(db, 'consulta');
    await expect(local()).rejects.toThrow(ERRO_CONSULTA);
    await expect(db.anomalias.add({} as never)).rejects.toThrow(ERRO_CONSULTA);
    await expect(db.equipamentos.update('x', { nome: 'a' })).rejects.toThrow(ERRO_CONSULTA);
  });

  it('em consulta as leituras continuam a funcionar', async () => {
    const l = await local();
    await guardarPapel(db, 'consulta');
    expect((await db.localizacoes.get(l.id))?.nome).toBe('Sala');
    expect(await db.localizacoes.count()).toBe(1);
  });

  it('voltar a gestor devolve a escrita, sem fechar a app', async () => {
    await guardarPapel(db, 'consulta');
    await expect(local()).rejects.toThrow(ERRO_CONSULTA);
    await guardarPapel(db, 'gestor');
    await expect(local()).resolves.toBeTruthy();
  });

  it('o papel sobrevive a reabrir a base de dados', async () => {
    await guardarPapel(db, 'consulta');
    db.close();
    const outra = new OfficeDB(db.name);
    await outra.open();
    expect(await lerPapel(outra)).toBe('consulta');
    await expect(criarLocalizacao(outra, { nome: 'X', tipo: 'sala', notas: '' })).rejects.toThrow(ERRO_CONSULTA);
  });
});
