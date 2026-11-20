import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { criarEquipamento, criarLocalizacao } from '../src/db/repo';
import { atualizarArtigo, criarArtigo, registarContagem } from '../src/db/stock';
import { criarFornecedor } from '../src/db/encomendas';
import { anexarDocumento, removerDocumento } from '../src/db/documentos';
import { colocarMarcador, moverMarcador, ondeEsta, removerMarcador } from '../src/db/plantas';
import { registarMovimento } from '../src/db/movimentos';
import { criarAnomalia } from '../src/db/anomalias';
import { atividadeRecente } from '../src/db/atividade';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB; let loc: string; let eq: string; let art: string; let planta: string;
const img = (n = 'planta.png') => new File([new Uint8Array(50)], n, { type: 'image/png' });
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open();
  loc = (await criarLocalizacao(db, { nome: 'Sala', tipo: 'divisao' })).id;
  eq = (await criarEquipamento(db, { nome: 'Router', localizacaoId: loc })).id;
  art = (await criarArtigo(db, { nome: 'Papel' })).id;
  planta = (await anexarDocumento(db, 'localizacao', loc, img())).id;
});

describe('fornecedor nos artigos', () => {
  it('associa a uma ficha existente e recusa inexistente; texto livre mantém-se', async () => {
    const f = await criarFornecedor(db, { nome: 'Papelaria' });
    const a = await criarArtigo(db, { nome: 'Canetas', fornecedor: 'texto antigo', fornecedorId: f.id });
    expect([a.fornecedor, a.fornecedorId]).toEqual(['texto antigo', f.id]);
    await expect(criarArtigo(db, { nome: 'X', fornecedorId: 'nada' })).rejects.toThrow('fornecedor');
    await expect(atualizarArtigo(db, a.id, { nome: 'Canetas', fornecedorId: 'nada' })).rejects.toThrow('fornecedor');
    const b = await atualizarArtigo(db, a.id, { nome: 'Canetas', fornecedor: 'texto antigo', fornecedorId: '' });
    expect(b.fornecedorId).toBeNull();
  });
});

describe('plantas e marcadores', () => {
  it('coloca, move (sem duplicar) e remove', async () => {
    const m = await colocarMarcador(db, planta, 'equipamento', eq, 0.25, 0.5);
    const m2 = await colocarMarcador(db, planta, 'equipamento', eq, 0.75, 0.1);
    expect(m2.id).toBe(m.id);
    expect((await db.marcadores.toArray()).filter((x) => !x.deletedAt)).toHaveLength(1);
    expect((await db.marcadores.get(m.id))?.x).toBe(0.75);
    await colocarMarcador(db, planta, 'artigo', art, 0.5, 0.5);
    await removerMarcador(db, m.id);
    expect((await db.marcadores.toArray()).filter((x) => !x.deletedAt)).toHaveLength(1);
  });
  it('artigo pode ter vários pontos na mesma planta; equipamento só um; mover um ponto', async () => {
    const a1 = await colocarMarcador(db, planta, 'artigo', art, 0.1, 0.1);
    const a2 = await colocarMarcador(db, planta, 'artigo', art, 0.8, 0.8);
    expect(a2.id).not.toBe(a1.id);
    expect((await db.marcadores.toArray()).filter((x) => !x.deletedAt && x.tipo === 'artigo')).toHaveLength(2);
    await moverMarcador(db, a2.id, 0.3, 0.4);
    expect([(await db.marcadores.get(a2.id))?.x, (await db.marcadores.get(a1.id))?.x]).toEqual([0.3, 0.1]);
    await expect(moverMarcador(db, a2.id, 2, 0)).rejects.toThrow('fora');
    await removerMarcador(db, a1.id);
    await expect(moverMarcador(db, a1.id, 0.5, 0.5)).rejects.toThrow('não existe');
    expect((await ondeEsta(db, 'artigo', art)).map((x) => x.localizacaoId)).toEqual([loc]);
  });
  it('valida posição, planta, tipo de ficheiro e item', async () => {
    await expect(colocarMarcador(db, planta, 'equipamento', eq, 1.2, 0.5)).rejects.toThrow('fora');
    await expect(colocarMarcador(db, planta, 'equipamento', eq, NaN, 0.5)).rejects.toThrow('fora');
    await expect(colocarMarcador(db, 'nada', 'equipamento', eq, 0.5, 0.5)).rejects.toThrow('planta');
    await expect(colocarMarcador(db, planta, 'artigo', 'nada', 0.5, 0.5)).rejects.toThrow('item');
    const pdf = await anexarDocumento(db, 'localizacao', loc, new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' }));
    await expect(colocarMarcador(db, pdf.id, 'equipamento', eq, 0.5, 0.5)).rejects.toThrow('imagem');
  });
  it('ondeEsta devolve o local e ignora plantas removidas', async () => {
    await colocarMarcador(db, planta, 'equipamento', eq, 0.5, 0.5);
    expect((await ondeEsta(db, 'equipamento', eq)).map((x) => x.localizacaoId)).toEqual([loc]);
    await removerDocumento(db, planta);
    expect(await ondeEsta(db, 'equipamento', eq)).toEqual([]);
  });
  it('cópia completa leva marcadores', async () => {
    await colocarMarcador(db, planta, 'equipamento', eq, 0.1, 0.2);
    const { blob } = await exportarCopia(db);
    const d2 = new OfficeDB(`t-${crypto.randomUUID()}`); await d2.open();
    await restaurarCopia(d2, blob);
    expect([await d2.marcadores.count(), await d2.documentos.count()]).toEqual([1, 1]);
  });
});

describe('atividade recente', () => {
  it('junta áreas, ordena do mais recente e respeita o limite', async () => {
    await registarContagem(db, art, loc, 5);
    await registarMovimento(db, { artigoId: art, tipo: 'perda', quantidade: 1, origemId: loc, motivo: 'x' });
    await criarAnomalia(db, { titulo: 'Fuga', localizacaoId: loc, prioridade: 'alta' });
    const d = {
      anomalias: await db.anomalias.toArray(), atividades: await db.atividades.toArray(), contagens: await db.contagensStock.toArray(), movimentos: await db.movimentosStock.toArray(),
      encomendas: await db.encomendas.toArray(), encomendaEventos: await db.encomendaEventos.toArray(), execucoes: await db.execucoes.toArray(), inspecoes: await db.inspecoes.toArray(),
      artigos: await db.artigos.toArray(), locais: await db.localizacoes.toArray(), manutencoes: await db.manutencoes.toArray()
    };
    const r = atividadeRecente(d);
    expect(r[0].texto).toContain('Fuga');
    expect(r.some((x) => x.texto.includes('Contagem de Papel em Sala: 5'))).toBe(true);
    expect(r.some((x) => x.texto.startsWith('Perda: Papel'))).toBe(true);
    expect(r.filter((x) => x.texto.includes('Contagem')).length).toBe(1); // contagens de movimentos não duplicam
    expect(atividadeRecente(d, 2)).toHaveLength(2);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].quando >= r[i].quando).toBe(true);
  });
});

describe('tipo de local livre', () => {
  it('aceita texto próprio, valida vazio/comprimento e mantém os tipos de série', async () => {
    const c = await criarLocalizacao(db, { nome: 'Cozinha', tipo: ' Copa ' });
    expect(c.tipo).toBe('Copa');
    await expect(criarLocalizacao(db, { nome: 'X', tipo: '  ' })).rejects.toThrow('tipo');
    await expect(criarLocalizacao(db, { nome: 'X', tipo: 'a'.repeat(41) })).rejects.toThrow('longo');
    const { atualizarLocalizacao } = await import('../src/db/repo');
    await expect(atualizarLocalizacao(db, c.id, { tipo: '' })).rejects.toThrow('tipo');
    const u = await atualizarLocalizacao(db, c.id, { tipo: 'exterior' });
    expect(u.tipo).toBe('exterior');
    expect((await db.localizacoes.get(loc))?.tipo).toBe('divisao'); // dados antigos intactos
  });
});
