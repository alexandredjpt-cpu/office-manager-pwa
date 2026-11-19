import { beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { OfficeDB } from '../src/db/schema';
import { criarEquipamento, criarLocalizacao, eliminarLogico, novoId, agora } from '../src/db/repo';
import { ErroCopia, estadoCopia, exportarCopia, restaurarCopia } from '../src/backup/backup';

const novaDb = async () => {
  const d = new OfficeDB(`t-${crypto.randomUUID()}`);
  await d.open();
  return d;
};

let db: OfficeDB;
beforeEach(async () => {
  db = await novaDb();
});

async function povoar(d: OfficeDB) {
  const l = await criarLocalizacao(d, { nome: 'Escritório de casa', tipo: 'divisao' });
  const apagada = await criarLocalizacao(d, { nome: 'Antiga', tipo: 'outro' });
  await eliminarLogico(d, 'localizacoes', apagada.id);
  const e = await criarEquipamento(d, { nome: 'Monitor fictício', localizacaoId: l.id });
  const t = agora();
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]);
  await d.fotografias.add({
    id: novoId(), createdAt: t, updatedAt: t, deletedAt: null,
    entidade: 'equipamento', entidadeId: e.id, blob: new Blob([bytes], { type: 'image/jpeg' }), mime: 'image/jpeg'
  });
  return { l, e, bytes };
}

describe('cópia de segurança', () => {
  it('ida e volta repõe tudo, incluindo eliminados, contadores e fotografias', async () => {
    const { e, bytes } = await povoar(db);
    const { blob, nome, manifesto } = await exportarCopia(db);
    expect(nome).toMatch(/^office-manager-copia-.*\.zip$/);
    expect(manifesto.contagens.localizacoes).toBe(2);

    const destino = await novaDb();
    await criarLocalizacao(destino, { nome: 'Lixo a substituir', tipo: 'outro' });
    await restaurarCopia(destino, blob);

    expect(await destino.localizacoes.count()).toBe(2);
    expect((await destino.localizacoes.filter((x) => x.deletedAt !== null).count())).toBe(1);
    expect((await destino.equipamentos.get(e.id))?.codigo).toBe('EQ-000001');
    expect((await destino.contadores.get('EQ'))?.ultimo).toBe(1);
    const foto = (await destino.fotografias.toArray())[0];
    expect(new Uint8Array(await foto.blob.arrayBuffer())).toEqual(bytes);

    // contador continua depois do restauro: nunca reutiliza
    const n = await criarEquipamento(destino, { nome: 'Novo' });
    expect(n.codigo).toBe('EQ-000002');
  });

  it('rejeita ficheiro que não é ZIP sem tocar nos dados', async () => {
    await povoar(db);
    await expect(restaurarCopia(db, new Blob(['olá']))).rejects.toBeInstanceOf(ErroCopia);
    expect(await db.localizacoes.count()).toBe(2);
  });

  it('rejeita ZIP de outra app', async () => {
    const z = new JSZip();
    z.file('manifesto.json', JSON.stringify({ app: 'outra', formato: 1 }));
    await expect(restaurarCopia(db, await z.generateAsync({ type: 'blob' }))).rejects.toThrow('outra aplicação');
  });

  it('rejeita ZIP truncado (contagens não conferem) e não altera dados', async () => {
    await povoar(db);
    const { blob } = await exportarCopia(db);
    const z = await JSZip.loadAsync(blob);
    z.file('dados/equipamentos.json', '[]');
    const outra = await novaDb();
    await criarLocalizacao(outra, { nome: 'Fica', tipo: 'outro' });
    await expect(restaurarCopia(outra, await z.generateAsync({ type: 'blob' }))).rejects.toThrow('não confere');
    expect(await outra.localizacoes.count()).toBe(1);
  });
});

describe('aviso de cópia', () => {
  it('sem dados não avisa', async () => {
    expect((await estadoCopia(db)).emFalta).toBe(false);
  });

  it('com dados e sem cópia avisa', async () => {
    await povoar(db);
    const s = await estadoCopia(db);
    expect(s.emFalta).toBe(true);
    expect(s.motivo).toContain('nenhuma');
  });

  it('logo após a cópia não avisa; 8 dias depois, com alterações, avisa', async () => {
    await povoar(db);
    await exportarCopia(db);
    expect((await estadoCopia(db)).emFalta).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    await criarLocalizacao(db, { nome: 'Nova', tipo: 'outro' });
    const daqui8 = new Date(Date.now() + 8 * 86_400_000);
    const s = await estadoCopia(db, daqui8);
    expect(s.emFalta).toBe(true);
    expect(s.motivo).toContain('8 dias');
  });

  it('8 dias sem alterações não avisa (nada a perder)', async () => {
    await povoar(db);
    await exportarCopia(db);
    expect((await estadoCopia(db, new Date(Date.now() + 8 * 86_400_000))).emFalta).toBe(false);
  });
});
