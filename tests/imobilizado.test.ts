import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { atualizarEquipamento, criarEquipamento } from '../src/db/repo';
import { equipamentoPorCodigo, pesquisar } from '../src/db/pesquisa';

let db: OfficeDB;
beforeEach(async () => { db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open(); });

describe('nº de imobilizado', () => {
  it('guarda sem espaços, é único (sem maiúsculas) e pode ser mudado', async () => {
    const a = await criarEquipamento(db, { nome: 'PC', numeroImobilizado: ' IMB-0042 ' });
    expect(a.numeroImobilizado).toBe('IMB-0042');
    await expect(criarEquipamento(db, { nome: 'Outro', numeroImobilizado: 'imb-0042' })).rejects.toThrow('já está no equipamento EQ-000001');
    const b = await criarEquipamento(db, { nome: 'Impressora' });
    expect(b.numeroImobilizado).toBe('');
    await expect(atualizarEquipamento(db, b.id, { numeroImobilizado: 'IMB-0042' })).rejects.toThrow('já está');
    await atualizarEquipamento(db, a.id, { numeroImobilizado: 'IMB-0042' }); // o próprio não conta
    await atualizarEquipamento(db, b.id, { numeroImobilizado: 'IMB-0043' });
    expect((await db.equipamentos.get(b.id))?.numeroImobilizado).toBe('IMB-0043');
    await expect(criarEquipamento(db, { nome: 'X', numeroImobilizado: '9'.repeat(41) })).rejects.toThrow('demasiado longo');
  });
  it('leitura encontra por imobilizado, código EQ ou nº de série; pesquisa também', async () => {
    const a = await criarEquipamento(db, { nome: 'PC', numeroImobilizado: '000123', numeroSerie: 'SN-9' });
    const lista = await db.equipamentos.toArray();
    expect(equipamentoPorCodigo('000123', lista)?.id).toBe(a.id);
    expect(equipamentoPorCodigo('eq-000001', lista)?.id).toBe(a.id);
    expect(equipamentoPorCodigo(' sn-9 ', lista)?.id).toBe(a.id);
    expect(equipamentoPorCodigo('999', lista)).toBeNull();
    const r = pesquisar('000123', { equipamentos: lista, artigos: [], locais: [], anomalias: [], stockDe: () => '', nomeLocal: () => '' });
    expect(r.map((x) => x.id)).toEqual([a.id]);
  });

  it('etiqueta Code 39 «001777»: zeros à esquerda não contam para repetidos nem para a leitura', async () => {
    const a = await criarEquipamento(db, { nome: 'Cadeira', numeroImobilizado: '001777' });
    expect(a.numeroImobilizado).toBe('001777');
    await expect(criarEquipamento(db, { nome: 'Outra', numeroImobilizado: '1777' })).rejects.toThrow('já está');
    const lista = await db.equipamentos.toArray();
    expect(equipamentoPorCodigo('1777', lista)?.id).toBe(a.id);
    expect(equipamentoPorCodigo('0001777', lista)?.id).toBe(a.id);
    expect(equipamentoPorCodigo('17770', lista)).toBeNull();
  });
});
