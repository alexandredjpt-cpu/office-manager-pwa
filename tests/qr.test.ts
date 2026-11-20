import { describe, expect, it } from 'vitest';
import { campoDeChave, interpretarQr, notaQr } from '../src/db/qrEquipamento';
import { equipamentoPorCodigo } from '../src/db/pesquisa';
import type { Equipamento } from '../src/db/schema';

describe('QR dos equipamentos', () => {
  it('reconhece os nomes de campo usuais (pt/en, com pontuação)', () => {
    expect(['S/N', 'Serial No.', 'Nº de série', 'MODEL NO', 'Manufacturer', 'P/N', 'Descrição'].map(campoDeChave))
      .toEqual(['numeroSerie', 'numeroSerie', 'numeroSerie', 'modelo', 'marca', 'modelo', 'nome']);
    expect(campoDeChave('Voltagem')).toBeNull();
  });
  it('texto «Chave: valor» em linhas, ; ou |', () => {
    expect(interpretarQr('Brand: Acme\nModel: X-200\nS/N: AB12345\nVoltage: 230V')).toMatchObject({ formato: 'chave-valor', campos: { marca: 'Acme', modelo: 'X-200', numeroSerie: 'AB12345' } });
    expect(interpretarQr('MODEL=LX-9;SN=99887').campos).toEqual({ modelo: 'LX-9', numeroSerie: '99887' });
    expect(interpretarQr('Produto: Projetor | Ref: PJ-1').campos).toEqual({ nome: 'Projetor', modelo: 'PJ-1' });
  });
  it('JSON (também com objetos dentro)', () => {
    expect(interpretarQr('{"device":{"manufacturer":"Acme","model":"Z1"},"serialNumber":"S-77","fw":"1.2"}').campos)
      .toEqual({ marca: 'Acme', modelo: 'Z1', numeroSerie: 'S-77' });
  });
  it('endereço web: parâmetros reconhecidos e o endereço vai para as notas', () => {
    const l = interpretarQr('https://suporte.exemplo.com/produto?model=K5&sn=XYZ9&lang=pt');
    expect(l).toMatchObject({ formato: 'url', campos: { modelo: 'K5', numeroSerie: 'XYZ9' } });
    expect(notaQr(l)).toBe('QR do fabricante: https://suporte.exemplo.com/produto?model=K5&sn=XYZ9&lang=pt');
    expect(interpretarQr('https://exemplo.com/p/123').campos).toEqual({});
  });
  it('GS1: parênteses, separador FNC1 e Digital Link', () => {
    expect(interpretarQr('(01)05601234567893(21)SER123(240)REF-9').campos).toEqual({ numeroSerie: 'SER123', modelo: 'REF-9' });
    const fnc = String.fromCharCode(29);
    expect(interpretarQr(`0105601234567893${'11'}260115${'21'}ABC99${fnc}240R2`).campos).toEqual({ numeroSerie: 'ABC99', modelo: 'R2' });
    expect(interpretarQr('https://id.exemplo.com/01/05601234567893/21/S%2F55').campos).toEqual({ numeroSerie: 'S/55' });
  });
  it('texto sem campos: nada inventado, conteúdo para as notas', () => {
    const l = interpretarQr('Obrigado por escolher a nossa marca');
    expect(l).toMatchObject({ formato: 'texto', campos: {} });
    expect(notaQr(l)).toBe('QR: Obrigado por escolher a nossa marca');
  });
  it('a Pesquisa encontra o equipamento pelo nº de série dentro do QR', () => {
    const e = { id: 'e1', deletedAt: null, codigo: 'EQ-000001', numeroSerie: 'AB12345', numeroImobilizado: '' } as unknown as Equipamento;
    expect(equipamentoPorCodigo('Model: X-200\nS/N: AB12345', [e])?.id).toBe('e1');
    expect(equipamentoPorCodigo('Model: X-200\nS/N: OUTRO', [e])).toBeNull();
  });
});
