import { describe, expect, it } from 'vitest';
import { TEMA_ORIGINAL, contraste, tons, validarTema } from '../src/ui/tema';

describe('tema de cores', () => {
  it('contraste WCAG conhecido e tons do mais claro ao mais escuro', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 0);
    const t = tons('#336699');
    expect(t[700]).toBe('#336699');
    expect(contraste(t[50], '#ffffff')).toBeLessThan(contraste(t[700], '#ffffff'));
    expect(contraste(t[900], '#ffffff')).toBeGreaterThan(contraste(t[700], '#ffffff'));
  });
  it('valida formato e legibilidade da cor principal; destaque opcional', () => {
    expect(validarTema(TEMA_ORIGINAL)).toEqual(TEMA_ORIGINAL);
    expect(validarTema({ principal: ' #1E3A8A ', destaque: '' })).toEqual({ principal: '#1e3a8a', destaque: '' });
    expect(() => validarTema({ principal: 'azul', destaque: '' })).toThrow('principal inválida');
    expect(() => validarTema({ principal: '#f5f5a0', destaque: '' })).toThrow('demasiado clara');
    expect(() => validarTema({ principal: '#1e3a8a', destaque: '#12' })).toThrow('destaque inválida');
  });
});
