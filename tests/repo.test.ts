import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { abaterEquipamento, criarEquipamento, criarLocalizacao, eliminarLogico, proximoCodigo } from '../src/db/repo';

let db: OfficeDB;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`);
  await db.open();
});

describe('códigos legíveis', () => {
  it('são sequenciais e com 6 dígitos', async () => {
    expect(await proximoCodigo(db, 'EQ')).toBe('EQ-000001');
    expect(await proximoCodigo(db, 'EQ')).toBe('EQ-000002');
    expect(await proximoCodigo(db, 'ANO')).toBe('ANO-000001');
  });

  it('não se repetem em criações simultâneas', async () => {
    const regs = await Promise.all(Array.from({ length: 20 }, (_, i) => criarEquipamento(db, { nome: `Item ${i}` })));
    expect(new Set(regs.map((r) => r.codigo)).size).toBe(20);
  });

  it('nunca são reutilizados depois de um abate', async () => {
    const a = await criarEquipamento(db, { nome: 'Portátil fictício' });
    await abaterEquipamento(db, a.id, 'Avariado');
    const b = await criarEquipamento(db, { nome: 'Outro' });
    expect(b.codigo).toBe('EQ-000002');
  });
});

describe('ciclo de vida', () => {
  it('abate guarda motivo e data e mantém o registo', async () => {
    const e = await criarEquipamento(db, { nome: 'Impressora fictícia' });
    await abaterEquipamento(db, e.id, 'Substituída');
    const r = await db.equipamentos.get(e.id);
    expect(r?.estado).toBe('abatido');
    expect(r?.motivoAbate).toBe('Substituída');
    expect(r?.dataAbate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('abate sem motivo é recusado', async () => {
    const e = await criarEquipamento(db, { nome: 'X' });
    await expect(abaterEquipamento(db, e.id, '  ')).rejects.toThrow('motivo');
  });

  it('eliminação lógica não apaga o registo', async () => {
    const l = await criarLocalizacao(db, { nome: 'Garagem', tipo: 'armazenamento' });
    await eliminarLogico(db, 'localizacoes', l.id);
    const r = await db.localizacoes.get(l.id);
    expect(r?.deletedAt).not.toBeNull();
    expect(await db.localizacoes.count()).toBe(1);
  });

  it('nome vazio é recusado', async () => {
    await expect(criarLocalizacao(db, { nome: ' ', tipo: 'outro' })).rejects.toThrow('obrigatório');
  });
});
