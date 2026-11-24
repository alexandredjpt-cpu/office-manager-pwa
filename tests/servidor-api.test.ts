import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import servidor, { type Env } from '../servidor/src/index';
import { d1Falso } from './apoio/d1Falso';

// caminho a partir da raiz do projeto, que é onde o vitest corre
const ESQUEMA = readFileSync('servidor/schema.sql', 'utf8');
const SEGREDO = 'segredo-de-teste'; // privacy-ok (fictício)
let env: Env;

beforeEach(() => {
  env = { BD: d1Falso(ESQUEMA) as unknown as D1Database, SEGREDO_ARRANQUE: SEGREDO, ORIGEM_PERMITIDA: 'https://exemplo.test' };
});

type Resposta = { estado: number; corpo: Record<string, never> };
async function chamar(metodo: string, caminho: string, opcoes: { token?: string; corpo?: unknown } = {}): Promise<Resposta> {
  const r = await servidor.fetch(new Request(`https://servidor.test${caminho}`, {
    method: metodo,
    headers: { ...(opcoes.token ? { authorization: `Bearer ${opcoes.token}` } : {}), 'content-type': 'application/json' },
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo)
  }), env);
  return { estado: r.status, corpo: await r.json() };
}

const arrancar = async () => (await chamar('POST', '/api/arranque', { corpo: { segredo: SEGREDO, nome: 'Gestor' } })).corpo.token as unknown as string;
const registo = (id: string, atualizado: string, nome = 'Sala') =>
  ({ tabela: 'localizacoes', id, atualizado, dados: { id, nome, updatedAt: atualizado } });

describe('Servidor: arranque', () => {
  it('sem o segredo não cria ninguém', async () => {
    expect((await chamar('POST', '/api/arranque', { corpo: { segredo: 'errado' } })).estado).toBe(403);
  });
  it('com o segredo cria o primeiro gestor, e só uma vez', async () => {
    const r = await chamar('POST', '/api/arranque', { corpo: { segredo: SEGREDO, nome: 'Gestor' } });
    expect(r.estado).toBe(201);
    expect(String(r.corpo.token).length).toBeGreaterThan(40);
    expect((await chamar('POST', '/api/arranque', { corpo: { segredo: SEGREDO } })).estado).toBe(409);
  });
});

describe('Servidor: quem é quem', () => {
  it('sem token não se passa da porta', async () => {
    await arrancar();
    expect((await chamar('GET', '/api/eu')).estado).toBe(401);
    expect((await chamar('GET', '/api/eu', { token: 'inventado' })).estado).toBe(401); // privacy-ok (fictício)
  });
  it('com token diz quem é', async () => {
    const token = await arrancar();
    expect((await chamar('GET', '/api/eu', { token })).corpo).toMatchObject({ nome: 'Gestor', papel: 'gestor' });
  });
});

describe('Servidor: publicar e ler', () => {
  it('o gestor publica e volta a ler o que publicou', async () => {
    const token = await arrancar();
    const enviou = await chamar('POST', '/api/enviar', { token, corpo: [registo('l1', '2026-11-24T10:00:00.000Z')] });
    expect(enviou.corpo).toMatchObject({ gravados: 1 });
    const puxou = await chamar('GET', '/api/puxar?desde=0', { token });
    expect(puxou.corpo.registos).toHaveLength(1);
    expect((puxou.corpo.registos as never[])[0]).toMatchObject({ tabela: 'localizacoes', id: 'l1', dados: { nome: 'Sala' } });
  });

  it('só traz o que mudou desde a última vez', async () => {
    const token = await arrancar();
    await chamar('POST', '/api/enviar', { token, corpo: [registo('l1', '2026-11-24T10:00:00.000Z')] });
    const primeiro = await chamar('GET', '/api/puxar?desde=0', { token });
    const seq = primeiro.corpo.seq as unknown as number;
    expect((await chamar('GET', `/api/puxar?desde=${seq}`, { token })).corpo.registos).toHaveLength(0);
    await chamar('POST', '/api/enviar', { token, corpo: [registo('l2', '2026-11-24T11:00:00.000Z', 'Copa')] });
    const segundo = await chamar('GET', `/api/puxar?desde=${seq}`, { token });
    expect(segundo.corpo.registos).toHaveLength(1);
    expect((segundo.corpo.registos as never[])[0]).toMatchObject({ id: 'l2' });
  });

  it('cada registo tem o seu número, por isso nada se perde ao ler aos poucos', async () => {
    const token = await arrancar();
    await chamar('POST', '/api/enviar', { token, corpo: [1, 2, 3].map((n) => registo(`l${n}`, '2026-11-24T10:00:00.000Z')) });
    const pagina = await chamar('GET', '/api/puxar?desde=0&limite=2', { token });
    expect(pagina.corpo.registos).toHaveLength(2);
    expect(pagina.corpo.fim).toBe(false);
    const resto = await chamar('GET', `/api/puxar?desde=${pagina.corpo.seq}&limite=2`, { token });
    expect((resto.corpo.registos as never[]).map((r: { id: string }) => r.id)).toEqual(['l3']);
    expect(resto.corpo.fim).toBe(true);
  });

  it('uma versão velha não apaga a boa', async () => {
    const token = await arrancar();
    await chamar('POST', '/api/enviar', { token, corpo: [registo('l1', '2026-11-24T12:00:00.000Z', 'Novo')] });
    await chamar('POST', '/api/enviar', { token, corpo: [registo('l1', '2026-11-24T08:00:00.000Z', 'Velho')] });
    const puxou = await chamar('GET', '/api/puxar?desde=0', { token });
    expect((puxou.corpo.registos as never[])[0]).toMatchObject({ dados: { nome: 'Novo' } });
  });

  it('recusa tabelas que não se sincronizam', async () => {
    const token = await arrancar();
    const r = await chamar('POST', '/api/enviar', { token, corpo: [{ ...registo('f1', '2026-11-24T10:00:00.000Z'), tabela: 'fotografias' }] });
    expect(r.estado).toBe(400);
  });
});

describe('Servidor: convidar, consultar e remover', () => {
  async function comColega() {
    const gestor = await arrancar();
    await chamar('POST', '/api/enviar', { token: gestor, corpo: [registo('l1', '2026-11-24T10:00:00.000Z')] });
    const convite = await chamar('POST', '/api/convites', { token: gestor, corpo: { nome: 'Colega', papel: 'consulta' } });
    const entrou = await chamar('POST', '/api/entrar', { corpo: { codigo: convite.corpo.codigo, dispositivo: 'Telemóvel' } });
    return { gestor, codigo: convite.corpo.codigo as unknown as string, colega: entrou.corpo.token as unknown as string, entrou };
  }

  it('o convite deixa entrar uma vez e dá acesso de consulta', async () => {
    const { codigo, entrou } = await comColega();
    expect(entrou.estado).toBe(201);
    expect(entrou.corpo).toMatchObject({ nome: 'Colega', papel: 'consulta' });
    const segunda = await chamar('POST', '/api/entrar', { corpo: { codigo } });
    expect(segunda.estado).toBe(403);
    expect(String(segunda.corpo.erro)).toContain('já foi usado');
  });

  it('o código funciona escrito à mão, com minúsculas e espaços', async () => {
    const gestor = await arrancar();
    const convite = await chamar('POST', '/api/convites', { token: gestor, corpo: { nome: 'Colega' } });
    const sujo = ` ${String(convite.corpo.codigo).toLowerCase().replace('-', ' ')} `;
    expect((await chamar('POST', '/api/entrar', { corpo: { codigo: sujo } })).estado).toBe(201);
  });

  it('quem é de consulta lê tudo mas não escreve nada', async () => {
    const { colega } = await comColega();
    expect((await chamar('GET', '/api/puxar?desde=0', { token: colega })).corpo.registos).toHaveLength(1);
    const tentou = await chamar('POST', '/api/enviar', { token: colega, corpo: [registo('l9', '2026-11-24T10:00:00.000Z')] });
    expect(tentou.estado).toBe(403);
    expect((await chamar('POST', '/api/convites', { token: colega, corpo: { nome: 'Outro' } })).estado).toBe(403);
    expect((await chamar('GET', '/api/utilizadores', { token: colega })).estado).toBe(403);
  });

  it('remover corta o acesso na hora', async () => {
    const { gestor, colega } = await comColega();
    const lista = await chamar('GET', '/api/utilizadores', { token: gestor });
    const colegaId = (lista.corpo.utilizadores as never[]).find((u: { nome: string }) => u.nome === 'Colega') as unknown as { id: string };
    expect((await chamar('DELETE', `/api/utilizadores/${colegaId.id}`, { token: gestor })).estado).toBe(200);
    expect((await chamar('GET', '/api/puxar?desde=0', { token: colega })).estado).toBe(401);
    expect((await chamar('GET', '/api/eu', { token: gestor })).estado).toBe(200);
  });

  it('o gestor não se remove a si próprio', async () => {
    const gestor = await arrancar();
    const lista = await chamar('GET', '/api/utilizadores', { token: gestor });
    const eu = (lista.corpo.utilizadores as never[])[0] as unknown as { id: string };
    expect((await chamar('DELETE', `/api/utilizadores/${eu.id}`, { token: gestor })).estado).toBe(400);
  });
});

describe('Servidor: portas fechadas', () => {
  it('endereços que não existem dão 404 e o browser sabe quem pode falar com o servidor', async () => {
    const token = await arrancar();
    expect((await chamar('GET', '/api/seja-o-que-for', { token })).estado).toBe(404);
    const previa = await servidor.fetch(new Request('https://servidor.test/api/puxar', { method: 'OPTIONS' }), env);
    expect(previa.status).toBe(204);
    expect(previa.headers.get('access-control-allow-origin')).toBe('https://exemplo.test');
  });
});

describe('Servidor: endurecimento da auditoria de 24 nov', () => {
  it('sem origem configurada, o CORS fecha na app conhecida — nunca abre a toda a gente', async () => {
    const semOrigem = { ...env, ORIGEM_PERMITIDA: undefined };
    const r = await servidor.fetch(new Request('https://servidor.test/api/puxar', { method: 'OPTIONS' }), semOrigem);
    expect(r.headers.get('access-control-allow-origin')).toBe('https://office-manager-pwa.pages.dev');
    expect(r.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('um registo corrompido na base não derruba a leitura dos outros', async () => {
    const token = await arrancar();
    await chamar('POST', '/api/enviar', { token, corpo: [registo('bom', '2026-11-24T10:00:00.000Z')] });
    await (env.BD as unknown as { prepare: (s: string) => { bind: (...a: unknown[]) => { run: () => Promise<unknown> } } })
      .prepare('INSERT INTO registos (tabela, id, dados, atualizado, seq) VALUES (?, ?, ?, ?, ?)')
      .bind('anomalias', 'podre', '{isto nao é json', '2026-11-24T10:00:00.000Z', 99).run();
    const r = await chamar('GET', '/api/puxar?desde=0', { token });
    expect(r.estado).toBe(200);
    expect(r.corpo.registos).toHaveLength(2);
    const podre = (r.corpo.registos as never[]).find((x: { id: string }) => x.id === 'podre') as unknown as { dados: unknown };
    expect(podre.dados).toBeNull();
  });
});
