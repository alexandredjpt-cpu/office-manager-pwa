import { describe, expect, it } from 'vitest';
import { conteudoQrLocal, localDoQr } from '../src/db/etiquetas';
import { matrizQr } from '../src/export/etiquetas';

const id = '3f2b8c1e-7a4d-4e9b-9c11-5d6e7f8a9b0c';
const locais = [{ id, deletedAt: null }, { id: '11111111-2222-4333-8444-555555555555', deletedAt: '2026-01-01' }];

describe('Etiquetas QR dos locais', () => {
  it('o QR leva o endereço da app no local, sem dados', () => {
    expect(conteudoQrLocal('https://app.exemplo.test/#/mais', id)).toBe(`https://app.exemplo.test/#/locais/${id}`);
  });
  it('o leitor reconhece o local e ignora locais apagados ou outros textos', () => {
    expect(localDoQr(conteudoQrLocal('https://app.exemplo.test/', id), locais)).toBe(id);
    expect(localDoQr(`https://outro.exemplo.test/x/#/locais/${id}?destaque=1`, locais)).toBe(id);
    expect(localDoQr('https://app.exemplo.test/#/locais/11111111-2222-4333-8444-555555555555', locais)).toBeNull();
    expect(localDoQr('0288U', locais)).toBeNull();
  });
  it('gera uma matriz QR quadrada com os três cantos de referência', async () => {
    const m = await matrizQr(conteudoQrLocal('https://app.exemplo.test/', id));
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((l) => l.length === m.length)).toBe(true);
    const n = m.length;
    for (const [l, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      expect(m[l].slice(c, c + 7).every(Boolean)).toBe(true);        // barra de cima do canto
      expect(m[l + 3][c + 3]).toBe(true);                              // centro do canto
      expect(m[l + 1][c + 1]).toBe(false);                             // anel claro
    }
  });
});
