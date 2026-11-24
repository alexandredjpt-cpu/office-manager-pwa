import { describe, expect, it } from 'vitest';
import {
  MAX_REGISTOS_POR_ENVIO, TABELAS_SINCRONIZADAS, conviteUtilizavel, desdeDe, deveGravar, gerarCodigo, gerarToken,
  normalizarCodigo, podeEscrever, resumo, validarEnvio
} from '../servidor/src/logica';

const agora = new Date('2026-11-24T10:00:00.000Z');
const convite = (extra: Partial<{ expiraEm: string; usadoEm: string | null }> = {}) =>
  ({ papel: 'consulta' as const, nome: 'Colega', expiraEm: '2026-11-26T10:00:00.000Z', usadoEm: null, ...extra });

describe('Servidor: quem pode escrever', () => {
  it('só o gestor', () => {
    expect(podeEscrever('gestor')).toBe(true);
    expect(podeEscrever('consulta')).toBe(false);
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
  const bom = { tabela: 'anomalias', id: 'a1', dados: { nome: 'x' }, atualizado: '2026-11-24T10:00:00.000Z' };

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
  it('recusa envios demasiado longos e o que não for uma lista', () => {
    expect(validarEnvio(Array.from({ length: MAX_REGISTOS_POR_ENVIO + 1 }, () => bom))).toMatchObject({ ok: false });
    expect(validarEnvio({ tabela: 'anomalias' })).toMatchObject({ ok: false });
  });
});

describe('Servidor: versões velhas e relógio', () => {
  it('não deixa uma versão velha apagar a boa', () => {
    expect(deveGravar('2026-11-24T10:00:00.000Z', null)).toBe(true);
    expect(deveGravar('2026-11-24T11:00:00.000Z', '2026-11-24T10:00:00.000Z')).toBe(true);
    expect(deveGravar('2026-11-24T09:00:00.000Z', '2026-11-24T10:00:00.000Z')).toBe(false);
    expect(deveGravar('2026-11-24T10:00:00.000Z', '2026-11-24T10:00:00.000Z')).toBe(false);
  });
  it('um «desde» estranho vale zero, e o telemóvel recebe tudo', () => {
    expect(desdeDe('42')).toBe(42);
    expect(desdeDe(null)).toBe(0);
    expect(desdeDe('-1')).toBe(0);
    expect(desdeDe('ontem')).toBe(0);
    expect(desdeDe('1e99')).toBe(0);
  });
});
