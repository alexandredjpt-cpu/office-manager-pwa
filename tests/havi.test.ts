import { describe, expect, it } from 'vitest';
import { lerTabelaHavi, montarEmailHavi, normalizarCodigo, proximaEntrega } from '../src/db/havi';

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
    expect(e.corpo).toContain('10325001 2 COMPAL PERA');
    expect(e.assunto).toContain('entrega');
  });
});
