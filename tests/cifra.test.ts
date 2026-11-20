import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { criarLocalizacao } from '../src/db/repo';
import { cifrar, decifrar, eCifrada, validarPalavraPasse } from '../src/backup/cifra';
import { ErroCopia, ErroPalavraPasse, exportarCopia, lerCopia, restaurarCopia, validarLinhas } from '../src/backup/backup';

describe('cópia cifrada', () => {
  it('cifra e decifra; palavra-passe errada recusada; formato reconhecido', async () => {
    const dados = new Blob(['conteúdo secreto']);
    const c = await cifrar(dados, 'palavra-segura', 100_000);
    expect(await eCifrada(c)).toBe(true);
    expect(await eCifrada(dados)).toBe(false);
    expect(await (await decifrar(c, 'palavra-segura')).text()).toBe('conteúdo secreto');
    await expect(decifrar(c, 'errada!!')).rejects.toThrow('Palavra-passe errada');
    expect(await new Blob([c]).text()).not.toContain('secreto');
  });
  it('valida comprimento e confirmação', () => {
    expect(() => validarPalavraPasse('curta', 'curta')).toThrow('pelo menos 8');
    expect(() => validarPalavraPasse('12345678', '12345679')).toThrow('não são iguais');
    expect(() => validarPalavraPasse('12345678', '12345678')).not.toThrow();
  });
  it('exporta cifrada (.omc) e só restaura com a palavra-passe', async () => {
    const db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open();
    await criarLocalizacao(db, { nome: 'Sala', tipo: 'divisao' });
    const { blob, nome } = await exportarCopia(db, { palavraPasse: 'palavra-segura' });
    expect(nome).toMatch(/-cifrada\.omc$/);
    await expect(lerCopia(blob)).rejects.toBeInstanceOf(ErroPalavraPasse);
    await expect(lerCopia(blob, 'outra-coisa')).rejects.toThrow('Palavra-passe errada');
    const d2 = new OfficeDB(`t-${crypto.randomUUID()}`); await d2.open();
    await restaurarCopia(d2, blob, 'palavra-segura');
    expect((await d2.localizacoes.toArray()).map((l) => l.nome)).toEqual(['Sala']);
  }, 20_000);
});

describe('validação do restauro', () => {
  const ok = { id: 'a', createdAt: 'x', updatedAt: 'x', deletedAt: null };
  it('aceita linhas válidas e recusa as inválidas', () => {
    expect(() => validarLinhas('localizacoes', [ok, { ...ok, id: 'b', deletedAt: '2026-01-01' }])).not.toThrow();
    expect(() => validarLinhas('localizacoes', [ok, ok])).toThrow('repetido');
    expect(() => validarLinhas('localizacoes', [{ ...ok, id: '' }])).toThrow('identificador');
    expect(() => validarLinhas('localizacoes', [{ ...ok, createdAt: 5 }])).toThrow('datas');
    expect(() => validarLinhas('localizacoes', [{ ...ok, deletedAt: 3 }])).toThrow('estado');
    expect(() => validarLinhas('localizacoes', [null])).toThrow(ErroCopia);
    expect(() => validarLinhas('meta', [{ chave: 'x', valor: 'y' }])).not.toThrow();
  });
});
