import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { OfficeDB, TABELAS } from '../src/db/schema';
import { criarEquipamento, criarLocalizacao } from '../src/db/repo';
import { criarArtigo } from '../src/db/stock';
import { anexarDocumento } from '../src/db/documentos';
import { colocarMarcador } from '../src/db/plantas';
import {
  areaZona, atualizarZona, avaliarTamanhoPlanta, contornoCruzado, criarZona, nitidez, pontoNaZona, preverTroca, proximoZoom,
  removerZona, transformacaoAlinhamento, trocarImagemPlanta, validarPontos, zonaEm, zoomParaZona, ZOOM_MAX
} from '../src/db/zonas';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';
import { exportarTudoXlsx } from '../src/export/tudo';

const quadrado = (x0: number, y0: number, l: number) => [{ x: x0, y: y0 }, { x: x0 + l, y: y0 }, { x: x0 + l, y: y0 + l }, { x: x0, y: y0 + l }];
const img = (n = 'planta.png') => new File([new Uint8Array(50)], n, { type: 'image/png' });

describe('geometria das zonas', () => {
  it('dentro/fora, área e contorno cruzado', () => {
    const q = quadrado(0.2, 0.2, 0.4);
    expect(pontoNaZona({ x: 0.3, y: 0.3 }, q)).toBe(true);
    expect(pontoNaZona({ x: 0.7, y: 0.3 }, q)).toBe(false);
    expect(areaZona(q)).toBeCloseTo(0.16);
    // forma em L (côncava): o canto vazio fica fora
    const L = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.2 }, { x: 0.2, y: 0.2 }, { x: 0.2, y: 0.5 }, { x: 0, y: 0.5 }];
    expect(pontoNaZona({ x: 0.1, y: 0.4 }, L)).toBe(true);
    expect(pontoNaZona({ x: 0.4, y: 0.4 }, L)).toBe(false);
    expect(contornoCruzado(L)).toBe(false);
    const laco = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0 }, { x: 0, y: 0.5 }];
    expect(contornoCruzado(laco)).toBe(true);
    expect(() => validarPontos(laco)).toThrow('cruza');
    expect(() => validarPontos(q.slice(0, 2))).toThrow('pelo menos 3');
    expect(() => validarPontos([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }])).toThrow('pequena');
    expect(() => validarPontos([{ x: 0, y: 0 }, { x: 1.2, y: 0 }, { x: 0, y: 1 }])).toThrow('fora');
  });
  it('toque em zonas sobrepostas abre a mais pequena', () => {
    const grande = { id: 'g', pontos: quadrado(0, 0, 0.8) }, pequena = { id: 'p', pontos: quadrado(0.1, 0.1, 0.2) };
    expect(zonaEm([grande, pequena], { x: 0.15, y: 0.15 })?.id).toBe('p');
    expect(zonaEm([grande, pequena], { x: 0.6, y: 0.6 })?.id).toBe('g');
    expect(zonaEm([grande, pequena], { x: 0.9, y: 0.9 })).toBeUndefined();
  });
  it('zoom ajusta-se ao tamanho da zona, até 1600%', () => {
    // caixa 360×600, imagem 2:1
    expect(zoomParaZona(quadrado(0, 0, 0.5), 360, 600, 2000, 1000)).toBeCloseTo(1.7, 5);
    expect(zoomParaZona(quadrado(0.4, 0.4, 0.1), 360, 600, 2000, 1000)).toBeCloseTo(8.5, 5);
    expect(zoomParaZona(quadrado(0.4, 0.4, 0.01), 360, 600, 2000, 1000)).toBe(ZOOM_MAX);
    expect(zoomParaZona(quadrado(0, 0, 1), 360, 600, 2000, 1000)).toBe(1);
    // zona alta e estreita: manda a altura da caixa
    const alta = [{ x: 0.5, y: 0 }, { x: 0.52, y: 0 }, { x: 0.52, y: 1 }, { x: 0.5, y: 1 }];
    expect(zoomParaZona(alta, 360, 600, 1000, 1000)).toBeCloseTo((0.85 * 600) / 360, 5);
    expect(proximoZoom(4, 1)).toBe(6);
    expect(proximoZoom(12, 1)).toBe(16);
    expect(proximoZoom(16, 1)).toBe(16);
    expect(proximoZoom(1.7, -1)).toBe(1.5);
  });
  it('nitidez e tamanho máximo da planta', () => {
    expect(nitidez(6623, 360, 4, 2.6).nivel).toBe('boa'); // Piso 2 a 200 dpi
    expect(nitidez(1101, 360, 4, 2.6).nivel).toBe('baixa');
    expect(nitidez(1101, 360, 2, 2.6).nivel).toBe('aceitavel');
    expect(avaliarTamanhoPlanta(6623, 4678).nivel).toBe('ok');
    expect(avaliarTamanhoPlanta(8000, 6000).nivel).toBe('aviso');
    expect(avaliarTamanhoPlanta(12000, 9000).nivel).toBe('recusa');
  });
  it('alinhamento por 2 pontos: escala, deslocação e proporções diferentes', () => {
    // Planta nova: o mesmo edifício a 3× e com margem de 100 px, numa imagem maior
    const antiga = { l: 1000, a: 500 }, nova = { l: 3400, a: 1800 };
    const px = (x: number, y: number, d: { l: number; a: number }) => ({ x: x / d.l, y: y / d.a });
    const pares = { antigo: [px(0, 0, antiga), px(1000, 500, antiga)] as [any, any], novo: [px(100, 100, nova), px(3100, 1600, nova)] as [any, any] };
    const t = transformacaoAlinhamento(pares, antiga, nova);
    expect(t.escala).toBeCloseTo(3);
    expect(t.rotacaoGraus).toBeCloseTo(0);
    const r = t.aplicar(px(500, 250, antiga));
    expect(r.x).toBeCloseTo(1600 / 3400);
    expect(r.y).toBeCloseTo(850 / 1800);
    expect(() => transformacaoAlinhamento({ antigo: [px(0, 0, antiga), px(5, 5, antiga)], novo: pares.novo }, antiga, nova)).toThrow('perto');
  });
  it('mesma imagem aumentada (3×) dá exatamente os mesmos pontos', () => {
    const pares = { antigo: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.8 }] as [any, any], novo: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.8 }] as [any, any] };
    const t = transformacaoAlinhamento(pares, { l: 1101, a: 484 }, { l: 3303, a: 1452 });
    const r = t.aplicar({ x: 0.37, y: 0.61 });
    expect(r.x).toBeCloseTo(0.37, 9);
    expect(r.y).toBeCloseTo(0.61, 9);
  });
});

let db: OfficeDB; let loc: string; let planta: string;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open();
  loc = (await criarLocalizacao(db, { nome: 'Piso X', tipo: 'divisao' })).id;
  planta = (await anexarDocumento(db, 'localizacao', loc, img())).id;
});

describe('zonas na base de dados', () => {
  it('cria, edita e remove sem mexer nos pontos já marcados', async () => {
    const eq = (await criarEquipamento(db, { nome: 'Impressora', localizacaoId: loc })).id;
    const m = await colocarMarcador(db, planta, 'equipamento', eq, 0.3, 0.4);
    const antes = await db.marcadores.get(m.id);
    const z = await criarZona(db, planta, '  Sala   A ', quadrado(0.2, 0.2, 0.3));
    expect(z.nome).toBe('Sala A');
    await atualizarZona(db, z.id, { pontos: [...quadrado(0.1, 0.1, 0.5)], nome: 'Sala B' });
    expect((await db.zonas.get(z.id))?.nome).toBe('Sala B');
    await expect(atualizarZona(db, z.id, { pontos: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0 }, { x: 0, y: 0.5 }] })).rejects.toThrow('cruza');
    await removerZona(db, z.id);
    expect((await db.zonas.get(z.id))?.deletedAt).not.toBeNull();
    expect(await db.marcadores.get(m.id)).toEqual(antes);
    await expect(criarZona(db, planta, '', quadrado(0, 0, 0.2))).rejects.toThrow('nome');
    await expect(criarZona(db, planta, 'x'.repeat(41), quadrado(0, 0, 0.2))).rejects.toThrow('40');
    const pdf = (await anexarDocumento(db, 'localizacao', loc, new File([new Uint8Array(10)], 'p.pdf', { type: 'application/pdf' }))).id;
    await expect(criarZona(db, pdf, 'Z', quadrado(0, 0, 0.2))).rejects.toThrow('imagem');
  });

  it('cópia completa e leve incluem as zonas; cópia antiga (sem zonas) restaura', async () => {
    await criarZona(db, planta, 'Receção', quadrado(0.1, 0.1, 0.2));
    for (const semDocumentos of [false, true]) {
      const { blob } = await exportarCopia(db, { semDocumentos });
      const outra = new OfficeDB(`t-${crypto.randomUUID()}`); await outra.open();
      await restaurarCopia(outra, blob);
      expect((await outra.zonas.toArray()).map((z) => z.nome)).toEqual(['Receção']);
    }
    // cópia antiga: sem ficheiro de zonas nem contagem no manifesto
    const { blob } = await exportarCopia(db);
    const zip = await JSZip.loadAsync(blob);
    zip.remove('dados/zonas.json');
    const mf = JSON.parse(await zip.file('manifesto.json')!.async('string'));
    delete mf.contagens.zonas; mf.versaoEsquema = 14;
    zip.file('manifesto.json', JSON.stringify(mf));
    const antiga = await zip.generateAsync({ type: 'blob' });
    const outra = new OfficeDB(`t-${crypto.randomUUID()}`); await outra.open();
    await restaurarCopia(outra, antiga);
    expect(await outra.zonas.count()).toBe(0);
    expect(await outra.documentos.count()).toBe(1);
    expect(TABELAS).toContain('zonas');
    const x = await exportarTudoXlsx(db);
    expect(x.folhas).toBe(TABELAS.length);
  });

  it('trocar imagem: pontos e zonas alinhados para a nova, antiga retirada, tudo ou nada', async () => {
    const eq = (await criarEquipamento(db, { nome: 'Router', localizacaoId: loc })).id;
    const art = (await criarArtigo(db, { nome: 'Papel' })).id;
    const m1 = await colocarMarcador(db, planta, 'equipamento', eq, 0.5, 0.5);
    const m2 = await colocarMarcador(db, planta, 'artigo', art, 0.25, 0.75);
    const z = await criarZona(db, planta, 'Open space', quadrado(0.2, 0.2, 0.4));
    const nova = (await anexarDocumento(db, 'localizacao', loc, img('nova.png'))).id;
    const antiga = { l: 1000, a: 500 }, novaD = { l: 2400, a: 1400 };
    // nova = antiga ×2 com margem de 200 px
    const pares = { antigo: [{ x: 0, y: 0 }, { x: 1, y: 1 }] as [any, any], novo: [{ x: 200 / 2400, y: 200 / 1400 }, { x: 2200 / 2400, y: 1200 / 1400 }] as [any, any] };
    const prev = preverTroca(await db.marcadores.toArray(), await db.zonas.toArray(), pares, antiga, novaD);
    expect(prev.fora).toBe(0);
    // pares errados → pontos fora → nada muda
    const maus = { antigo: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }] as [any, any], novo: [{ x: 0, y: 0 }, { x: 1, y: 1 }] as [any, any] };
    await expect(trocarImagemPlanta(db, planta, nova, maus, antiga, novaD)).rejects.toThrow('fora');
    expect((await db.marcadores.get(m1.id))?.documentoId).toBe(planta);
    expect((await db.documentos.get(planta))?.deletedAt).toBeNull();

    const r = await trocarImagemPlanta(db, planta, nova, pares, antiga, novaD);
    expect(r).toEqual({ marcadores: 2, zonas: 1 });
    const n1 = (await db.marcadores.get(m1.id))!;
    expect([n1.documentoId, n1.x, n1.y]).toEqual([nova, 0.5, 0.5]); // centro → centro
    const n2 = (await db.marcadores.get(m2.id))!;
    expect(n2.x).toBeCloseTo((200 + 250 * 2) / 2400, 5);
    expect(n2.y).toBeCloseTo((200 + 375 * 2) / 1400, 5);
    const nz = (await db.zonas.get(z.id))!;
    expect(nz.documentoId).toBe(nova);
    expect(nz.pontos[0].x).toBeCloseTo((200 + 200 * 2) / 2400, 5);
    expect((await db.documentos.get(planta))?.deletedAt).not.toBeNull();
    // a nova já tem pontos: não aceita outra troca para ela
    const terceira = (await anexarDocumento(db, 'localizacao', loc, img('3.png'))).id;
    await colocarMarcador(db, terceira, 'artigo', art, 0.1, 0.1);
    await expect(trocarImagemPlanta(db, nova, terceira, pares, novaD, novaD)).rejects.toThrow('já tem');
  });
});
