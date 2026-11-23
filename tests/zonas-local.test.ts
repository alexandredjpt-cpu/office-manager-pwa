import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB, type Marcador, type Zona } from '../src/db/schema';
import { criarLocalizacao } from '../src/db/repo';
import { anexarDocumento } from '../src/db/documentos';
import { colocarMarcador } from '../src/db/plantas';
import { atualizarZona, CAMADAS, criarZona, etiquetaVisivel, lerCamadas, pontosVisiveis, removerZona } from '../src/db/zonas';

const img = () => new File([new Uint8Array(50)], 'planta.png', { type: 'image/png' });
const quadrado = (x: number, y: number, l: number) => [{ x, y }, { x: x + l, y }, { x: x + l, y: y + l }, { x, y: y + l }];

let db: OfficeDB; let piso: string; let planta: string;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open();
  piso = (await criarLocalizacao(db, { nome: 'Piso 2', tipo: 'divisao' })).id;
  planta = (await anexarDocumento(db, 'localizacao', piso, img())).id;
});

describe('zona que é um local', () => {
  it('liga, troca e desliga o local; recusa o próprio piso e um local já ligado', async () => {
    const a1 = (await criarLocalizacao(db, { nome: 'Armário 1', tipo: 'outro' })).id;
    const a2 = (await criarLocalizacao(db, { nome: 'Armário 2', tipo: 'outro' })).id;
    const z = await criarZona(db, planta, 'Armário 1', quadrado(0.1, 0.1, 0.1), a1);
    expect(z.localizacaoId).toBe(a1);
    await expect(criarZona(db, planta, 'Outra', quadrado(0.5, 0.5, 0.1), a1)).rejects.toThrow('já está ligado');
    await expect(criarZona(db, planta, 'Piso', quadrado(0.5, 0.5, 0.1), piso)).rejects.toThrow('Escolhe outro local');
    await expect(criarZona(db, planta, 'X', quadrado(0.5, 0.5, 0.1), 'nao-existe')).rejects.toThrow('não existe');
    await atualizarZona(db, z.id, { localizacaoId: a2 });
    expect((await db.zonas.get(z.id))?.localizacaoId).toBe(a2);
    await atualizarZona(db, z.id, { nome: 'Só o nome' });
    expect((await db.zonas.get(z.id))?.localizacaoId).toBe(a2);
    await atualizarZona(db, z.id, { localizacaoId: null });
    expect((await db.zonas.get(z.id))?.localizacaoId).toBeNull();
    // zona removida liberta o local
    const z2 = await criarZona(db, planta, 'A1', quadrado(0.3, 0.3, 0.1), a1);
    await removerZona(db, z2.id);
    await expect(criarZona(db, planta, 'A1 de novo', quadrado(0.3, 0.3, 0.1), a1)).resolves.toBeTruthy();
  });

  it('zona sem local continua a funcionar como antes', async () => {
    const z = await criarZona(db, planta, 'Open space', quadrado(0.1, 0.1, 0.2));
    expect(z.localizacaoId).toBeUndefined();
  });

  it('o ponto azul do local ligado deixa de se desenhar, mas não é apagado', async () => {
    const a1 = (await criarLocalizacao(db, { nome: 'Armário 1', tipo: 'outro' })).id;
    const m = await colocarMarcador(db, planta, 'local', a1, 0.15, 0.15);
    const z = await criarZona(db, planta, 'Armário 1', quadrado(0.1, 0.1, 0.1), a1);
    const todas = new Set(CAMADAS);
    expect(pontosVisiveis([m], [z], todas)).toHaveLength(0);
    expect(pontosVisiveis([m], [z], todas, { destaque: a1 })).toHaveLength(1);
    expect(await db.marcadores.get(m.id)).toBeTruthy();
    expect(pontosVisiveis([m], [{ ...z, deletedAt: 'x' } as Zona], todas)).toHaveLength(1);
  });
});

describe('camadas e nomes', () => {
  const m = (id: string, tipo: Marcador['tipo']): Marcador => ({ id, tipo, refId: `r${id}`, documentoId: 'd', x: 0.5, y: 0.5, createdAt: '', updatedAt: '', deletedAt: null });
  it('camadas desligadas escondem os pontos, exceto o selecionado', () => {
    const ms = [m('1', 'equipamento'), m('2', 'artigo'), m('3', 'anomalia')];
    const so = new Set(['equipamento'] as const);
    expect(pontosVisiveis(ms, [], new Set(so)).map((x) => x.id)).toEqual(['1']);
    expect(pontosVisiveis(ms, [], new Set(so), { sel: '2' }).map((x) => x.id)).toEqual(['1', '2']);
  });
  it('lerCamadas: guardado válido, estragado ou vazio', () => {
    expect([...lerCamadas('["zonas","artigo","inventada"]')]).toEqual(['zonas', 'artigo']);
    expect(lerCamadas('{lixo').size).toBe(CAMADAS.length);
    expect(lerCamadas(null).size).toBe(CAMADAS.length);
    expect(lerCamadas('[]').size).toBe(0);
  });
  it('nomes: selecionado sempre; zona aberta só os de dentro; planta inteira só com zoom ≥ 200%', () => {
    expect(etiquetaVisivel({ selecionado: true, zonaAberta: false, dentro: false, zoom: 1 })).toBe(true);
    expect(etiquetaVisivel({ selecionado: false, zonaAberta: false, dentro: false, zoom: 1 })).toBe(false);
    expect(etiquetaVisivel({ selecionado: false, zonaAberta: false, dentro: false, zoom: 2 })).toBe(true);
    expect(etiquetaVisivel({ selecionado: false, zonaAberta: true, dentro: true, zoom: 4 })).toBe(true);
    expect(etiquetaVisivel({ selecionado: false, zonaAberta: true, dentro: false, zoom: 4 })).toBe(false);
  });
});
