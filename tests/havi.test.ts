import { describe, expect, it } from 'vitest';
import { lerTabelaHavi, montarEmailHavi, normalizarCodigo, ordenarProdutos, proximaEntrega } from '../src/db/havi';

describe('HAVI: leitura da tabela', () => {
  it('tira pontos e espaços do código e ignora quantidade e unidade', () => {
    expect(lerTabelaHavi('10325001 2 cx COMPAL PERA')).toEqual([{ codigo: '10325001', nome: 'COMPAL PERA' }]);
    expect(lerTabelaHavi('09211.780 1 pac TOALHETE BALCAO')).toEqual([{ codigo: '09211780', nome: 'TOALHETE BALCAO' }]);
    expect(lerTabelaHavi('2627 010 6 cx CHA PRETO')).toEqual([{ codigo: '2627010', nome: 'CHA PRETO' }]);
  });

  it('aceita linhas só com código e nome, e salta cabeçalhos', () => {
    expect(lerTabelaHavi('WRIN Qtd Descrição\n14243010 TALHERES SALADA')).toEqual([{ codigo: '14243010', nome: 'TALHERES SALADA' }]);
  });

  it('normaliza códigos', () => {
    expect(normalizarCodigo('99999.038')).toBe('99999038');
  });
});

describe('HAVI: data de entrega (terça e sexta)', () => {
  const dia = (d: Date) => d.toLocaleDateString('en-CA');
  it('segunda e terça → sexta da mesma semana', () => {
    expect(dia(proximaEntrega(new Date(2026, 10, 23)))).toBe('2026-11-27');
    expect(dia(proximaEntrega(new Date(2026, 10, 24)))).toBe('2026-11-27');
  });
  it('quarta a domingo → terça seguinte', () => {
    expect(dia(proximaEntrega(new Date(2026, 10, 25)))).toBe('2026-12-01');
    expect(dia(proximaEntrega(new Date(2026, 10, 27)))).toBe('2026-12-01');
    expect(dia(proximaEntrega(new Date(2026, 10, 21)))).toBe('2026-11-24');
  });
  it('o e-mail traz a data e uma linha por produto', () => {
    const e = montarEmailHavi([{ codigo: '10325001', nome: 'COMPAL PERA', quantidade: 2 }], new Date(2026, 10, 21));
    expect(e.corpo).toContain('10325001 --- 2 --- COMPAL PERA');
    expect(e.assunto).toContain('entrega');
  });
});

describe('HAVI: ordem escolhida', () => {
  const p = (id: string, nome: string, ordem?: number) => ({ id, codigo: id, nome, createdAt: '', updatedAt: '', deletedAt: null, ordem });
  it('usa a ordem escolhida e manda os sem ordem para o fim, por nome', () => {
    const r = ordenarProdutos([p('a', 'ZUMO'), p('b', 'PERA', 1), p('c', 'AGUA', 0), p('d', 'CHA')]);
    expect(r.map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
  });
});

import { emailValido, montarMailtoHavi } from '../src/db/havi';
describe('HAVI: destinatários', () => {
  it('o primeiro é Para e os restantes vão em Cópia', () => {
    const url = montarMailtoHavi(['a@x.pt', 'b@y.pt', 'c@z.pt'], 'Assunto', 'Olá'); // privacy-ok (fictício)
    expect(url.startsWith('mailto:a@x.pt?cc=b@y.pt%2Cc@z.pt&')).toBe(true); // privacy-ok (fictício)
    expect(url).toContain('subject=Assunto');
  });
  it('valida endereços', () => {
    expect(emailValido('pessoa@empresa.pt')).toBe(true); // privacy-ok (fictício)
    expect(emailValido('pessoa@')).toBe(false);
  });
});
