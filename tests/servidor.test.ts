import { describe, expect, it } from 'vitest';
import {
  MAX_REGISTOS_POR_ENVIO, PAPEIS, TABELAS_SINCRONIZADAS, conviteUtilizavel, desdeDe, gerarCodigo, gerarToken,
  normalizarCodigo, papelValido, podeEscrever, podeGerir, resumo, validarEnvio
} from '../servidor/src/logica';

const agora = new Date('2026-11-24T10:00:00.000Z');
const convite = (extra: Partial<{ expiraEm: string; usadoEm: string | null }> = {}) =>
  ({ papel: 'consulta' as const, nome: 'Colega', expiraEm: '2026-11-26T10:00:00.000Z', usadoEm: null, ...extra });

describe('Servidor: quem pode escrever e quem pode gerir', () => {
  it('gestor e registo escrevem; só a consulta não', () => {
    expect(podeEscrever('gestor')).toBe(true);
    expect(podeEscrever('registo')).toBe(true);
    expect(podeEscrever('consulta')).toBe(false);
  });
  it('só o gestor gere pessoas', () => {
    expect(podeGerir('gestor')).toBe(true);
    expect(podeGerir('registo')).toBe(false);
    expect(podeGerir('consulta')).toBe(false);
  });
  it('há exatamente três papéis, e mais nenhum', () => {
    expect(PAPEIS).toEqual(['gestor', 'registo', 'consulta']);
    expect(papelValido('registo')).toBe(true);
    expect(papelValido('admin')).toBe(false);
    expect(papelValido(undefined)).toBe(false);
  });
});

describe('Servidor: códigos e tokens', () => {
  it('o código é curto, legível e sem letras que se confundem', () => {
    const c = gerarCodigo(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(c).not.toMatch(/[IO01]/);
  });
  it('aceita o código escrito à mão, com espaços, traços ou minúsculas', () => {
    expect(normalizarCodigo(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizarCodigo('ABCD2345')).toBe('ABCD2345');
  });
  it('o token é longo e seguro para ir num endereço', () => {
    const t = gerarToken(new Uint8Array(32).fill(251));
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThan(40);
  });
  it('o resumo é estável e não devolve o original', async () => {
    const r = await resumo('segredo');
    expect(r).toHaveLength(64);
    expect(r).toBe(await resumo('segredo'));
    expect(r).not.toContain('segredo');
    expect(r).not.toBe(await resumo('segred0'));
  });
});

describe('Servidor: convites', () => {
  it('um convite válido deixa entrar', () => {
    expect(conviteUtilizavel(convite(), agora)).toEqual({ ok: true });
  });
  it('código errado, já usado ou fora do prazo não deixam', () => {
    expect(conviteUtilizavel(null, agora)).toMatchObject({ ok: false, erro: 'Código inválido.' });
    expect(conviteUtilizavel(convite({ usadoEm: '2026-11-24T09:00:00.000Z' }), agora)).toMatchObject({ erro: 'Este código já foi usado.' });
    expect(conviteUtilizavel(convite({ expiraEm: '2026-11-24T09:59:59.000Z' }), agora)).toMatchObject({ erro: 'Este código expirou.' });
  });
});

describe('Servidor: o que a app envia', () => {
  const bom = { tabela: 'anomalias', id: 'a1', dados: { nome: 'x' }, atualizado: '2026-11-24T10:00:00.000Z', base: null };

  it('aceita uma lista válida', () => {
    expect(validarEnvio([bom])).toEqual({ ok: true, registos: [bom] });
  });
  it('recusa tabelas de fora da lista, como as fotografias', () => {
    expect(validarEnvio([{ ...bom, tabela: 'fotografias' }])).toMatchObject({ ok: false });
    expect(validarEnvio([{ ...bom, tabela: 'meta' }])).toMatchObject({ ok: false });
    expect(TABELAS_SINCRONIZADAS).toContain('anomalias');
  });
  it('recusa registos sem id, sem data, ou grandes de mais', () => {
    expect(validarEnvio([{ ...bom, id: '' }])).toMatchObject({ erro: 'Registo sem id.' });
    expect(validarEnvio([{ ...bom, atualizado: '' }])).toMatchObject({ ok: false });
    expect(validarEnvio([{ ...bom, dados: { grande: 'x'.repeat(300_000) } }])).toMatchObject({ ok: false });
  });
  it('exige a versão de base: null para registo novo, ou um número positivo', () => {
    expect(validarEnvio([{ ...bom, base: 3 }])).toMatchObject({ ok: true });
    expect(validarEnvio([{ ...bom, base: 0 }])).toMatchObject({ ok: false });
    expect(validarEnvio([{ ...bom, base: '3' }])).toMatchObject({ ok: false });
    const semBase: Record<string, unknown> = { ...bom };
    delete semBase.base;
    expect(validarEnvio([semBase])).toMatchObject({ ok: false });
  });
  it('recusa o mesmo registo duas vezes no mesmo envio', () => {
    expect(validarEnvio([bom, { ...bom, dados: { nome: 'y' } }])).toMatchObject({ ok: false });
  });
  it('recusa envios demasiado longos e o que não for uma lista', () => {
    expect(validarEnvio(Array.from({ length: MAX_REGISTOS_POR_ENVIO + 1 }, () => bom))).toMatchObject({ ok: false });
    expect(validarEnvio({ tabela: 'anomalias' })).toMatchObject({ ok: false });
  });
});

describe('Servidor: versões e relógio', () => {
  it('um «desde» estranho vale zero, e o telemóvel recebe tudo', () => {
    expect(desdeDe('42')).toBe(42);
    expect(desdeDe(null)).toBe(0);
    expect(desdeDe('-1')).toBe(0);
    expect(desdeDe('ontem')).toBe(0);
    expect(desdeDe('1e99')).toBe(0);
  });
});
