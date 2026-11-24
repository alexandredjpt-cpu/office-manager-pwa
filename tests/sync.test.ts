import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import servidor, { type Env } from '../servidor/src/index';
import { TABELAS_SINCRONIZADAS as TABELAS_SERVIDOR } from '../servidor/src/logica';
import { d1Falso } from './apoio/d1Falso';
import { OfficeDB } from '../src/db/schema';
import { ERRO_CONSULTA } from '../src/db/papel';
import { criarLocalizacao } from '../src/db/repo';
import { TABELAS_SINCRONIZADAS, desligar, guardarLigacao, ligarComConvite, manterMinha, sincronizar, usarDoServidor } from '../src/sync/motor';
import { URL_SERVIDOR, criarConvite, cortarAcesso, pedir } from '../src/sync/cliente';

let env: Env;
let telemoveis = 0;
const SEGREDO = 'segredo-de-teste'; // privacy-ok (fictício)

beforeEach(() => {
  env = { BD: d1Falso(readFileSync('servidor/schema.sql', 'utf8')) as unknown as D1Database, SEGREDO_ARRANQUE: SEGREDO, ORIGEM_PERMITIDA: 'https://app.test' };
  // O «servidor» de teste é o Worker de verdade, com a base de dados de mentira.
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (!url.startsWith(URL_SERVIDOR)) throw new Error(`Pedido fora do servidor: ${url}`);
    return servidor.fetch(new Request(url, init), env);
  });
});

async function telemovel(): Promise<OfficeDB> {
  const db = new OfficeDB(`telemovel-${++telemoveis}-${Date.now()}`);
  await db.open();
  return db;
}

/** O primeiro gestor, como no arranque real: com o segredo, uma vez. */
async function gestor(): Promise<{ db: OfficeDB; token: string }> {
  const r = await pedir<{ token: string }>('POST', '/api/arranque', { corpo: { segredo: SEGREDO, nome: 'Alexandre' } });
  const db = await telemovel();
  await guardarLigacao(db, r.token, 'Alexandre', 'gestor');
  return { db, token: r.token };
}

async function convidar(gestorToken: string, nome: string, papel: 'registo' | 'consulta' | 'gestor') {
  return (await criarConvite(gestorToken, nome, papel)).codigo;
}

const sala = (db: OfficeDB, nome: string) => criarLocalizacao(db, { nome, tipo: 'sala', notas: '' });

describe('Sincronização: as mesmas tabelas que o servidor', () => {
  it('a app e o servidor falam das mesmas tabelas', () => {
    expect([...TABELAS_SINCRONIZADAS].sort()).toEqual([...TABELAS_SERVIDOR].sort());
  });
});

describe('Sincronização: duas pessoas, a mesma sala', () => {
  it('um registo criado num telemóvel aparece no outro', async () => {
    const { db: a, token } = await gestor();
    const l = await sala(a, 'Sala Norte');
    expect((await sincronizar(a)).enviados).toBe(1);

    const b = await telemovel();
    await ligarComConvite(b, await convidar(token, 'Ana', 'registo'));
    expect((await b.localizacoes.get(l.id))?.nome).toBe('Sala Norte');
  });

  it('uma edição de quem tem registo chega ao gestor na sincronização seguinte', async () => {
    const { db: a, token } = await gestor();
    const l = await sala(a, 'Sala Norte');
    await sincronizar(a);
    const b = await telemovel();
    await ligarComConvite(b, await convidar(token, 'Ana', 'registo'));

    await b.localizacoes.update(l.id, { nome: 'Sala Norte (Ana)', updatedAt: new Date().toISOString() });
    expect((await sincronizar(b)).enviados).toBe(1);
    await sincronizar(a);
    expect((await a.localizacoes.get(l.id))?.nome).toBe('Sala Norte (Ana)');
  });

  it('duas edições ao mesmo registo: quem chega tarde não apaga em silêncio, e escolhe', async () => {
    const { db: a, token } = await gestor();
    const l = await sala(a, 'Sala Norte');
    await sincronizar(a);
    const b = await telemovel();
    await ligarComConvite(b, await convidar(token, 'Ana', 'registo'));

    await b.localizacoes.update(l.id, { nome: 'Versão da Ana', updatedAt: '2026-11-24T10:00:00.000Z' });
    await sincronizar(b);
    await a.localizacoes.update(l.id, { nome: 'Versão do gestor', updatedAt: '2026-11-24T10:05:00.000Z' });

    const r = await sincronizar(a);
    expect(r.conflitos).toBe(1);
    expect((await a.localizacoes.get(l.id))?.nome).toBe('Versão do gestor');
    const conflito = (await a.sincConflitos.toArray())[0];
    expect((conflito.atual?.dados as { nome: string }).nome).toBe('Versão da Ana');

    await usarDoServidor(a, conflito);
    expect((await a.localizacoes.get(l.id))?.nome).toBe('Versão da Ana');
    expect((await sincronizar(a)).conflitos).toBe(0);
  });

  it('«ficar com a minha» envia a versão deste telemóvel por cima', async () => {
    const { db: a, token } = await gestor();
    const l = await sala(a, 'Sala Norte');
    await sincronizar(a);
    const b = await telemovel();
    await ligarComConvite(b, await convidar(token, 'Ana', 'registo'));
    await b.localizacoes.update(l.id, { nome: 'Da Ana', updatedAt: '2026-11-24T10:00:00.000Z' });
    await sincronizar(b);
    await a.localizacoes.update(l.id, { nome: 'Do gestor', updatedAt: '2026-11-24T10:05:00.000Z' });
    await sincronizar(a);

    await manterMinha(a, (await a.sincConflitos.toArray())[0]);
    expect((await sincronizar(a)).enviados).toBe(1);
    await sincronizar(b);
    expect((await b.localizacoes.get(l.id))?.nome).toBe('Do gestor');
  });

  it('um registo em conflito fica à espera: a sincronização não o volta a enviar sozinha', async () => {
    const { db: a, token } = await gestor();
    const l = await sala(a, 'Sala Norte');
    await sincronizar(a);
    const b = await telemovel();
    await ligarComConvite(b, await convidar(token, 'Ana', 'registo'));
    await b.localizacoes.update(l.id, { nome: 'Da Ana', updatedAt: '2026-11-24T10:00:00.000Z' });
    await sincronizar(b);
    await a.localizacoes.update(l.id, { nome: 'Do gestor', updatedAt: '2026-11-24T10:05:00.000Z' });
    await sincronizar(a);
    expect((await sincronizar(a)).enviados).toBe(0);
    expect(await a.sincConflitos.count()).toBe(1);
  });
});

describe('Sincronização: quem só consulta', () => {
  it('recebe tudo e não escreve nada', async () => {
    const { db: a, token } = await gestor();
    const l = await sala(a, 'Sala Norte');
    await sincronizar(a);
    const c = await telemovel();
    await ligarComConvite(c, await convidar(token, 'Rui', 'consulta'));
    expect((await c.localizacoes.get(l.id))?.nome).toBe('Sala Norte');
    await expect(sala(c, 'Nova')).rejects.toThrow(ERRO_CONSULTA);
  });
});

describe('Sincronização: acesso e ligações', () => {
  it('cortar o acesso deixa o telemóvel em consulta, com aviso, e sem token', async () => {
    const { db: a, token } = await gestor();
    await sala(a, 'Sala Norte');
    await sincronizar(a);
    const b = await telemovel();
    await ligarComConvite(b, await convidar(token, 'Ana', 'registo'));

    const pessoas = (await pedir<{ utilizadores: { id: string; nome: string }[] }>('GET', '/api/utilizadores', { token })).utilizadores;
    await cortarAcesso(token, pessoas.find((p) => p.nome === 'Ana')!.id);

    await expect(sincronizar(b)).rejects.toThrow();
    expect((await b.meta.get('servidor.token'))).toBeUndefined();
    expect((await b.meta.get('servidor.aviso'))?.valor).toContain('cortado');
    await expect(sala(b, 'Depois do corte')).rejects.toThrow(ERRO_CONSULTA);
  });

  it('um código usado não serve outra vez', async () => {
    const { token } = await gestor();
    const codigo = await convidar(token, 'Ana', 'registo');
    await ligarComConvite(await telemovel(), codigo);
    await expect(ligarComConvite(await telemovel(), codigo)).rejects.toThrow('já foi usado');
  });

  it('sem ligação, sincronizar diz porquê e não toca em nada', async () => {
    const solto = await telemovel();
    await expect(sincronizar(solto)).rejects.toThrow('não está ligado');
  });

  it('desligar mantém os dados locais e deixa de os enviar', async () => {
    const { db: a } = await gestor();
    const l = await sala(a, 'Sala Norte');
    await desligar(a);
    expect((await a.localizacoes.get(l.id))?.nome).toBe('Sala Norte');
    await expect(sincronizar(a)).rejects.toThrow('não está ligado');
  });
});
