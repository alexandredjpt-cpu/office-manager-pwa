import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { OfficeDB, TABELAS, type ContagemStock } from '../src/db/schema';
import { criarEquipamento, criarLocalizacao, abaterEquipamento } from '../src/db/repo';
import { criarArtigo, stockPorArtigo } from '../src/db/stock';
import {
  anexarDocumento, definirCategoria, desligarDocumento, documentosDe, equipamentosIguais, ligacoesDoDocumento, ligarDocumento, removerDocumento
} from '../src/db/documentos';
import { sugestaoTrimestral } from '../src/db/sugestao';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB;
beforeEach(async () => { db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open(); });
const pdf = (n = 'manual.pdf') => new File([new Uint8Array(30)], n, { type: 'application/pdf' });

describe('documentos ligados a vários registos e categorias', () => {
  it('liga um manual a 10 cadeiras sem copiar o ficheiro; desligar e remover', async () => {
    const loc = (await criarLocalizacao(db, { nome: 'Sala', tipo: 'divisao' })).id;
    const cadeiras = [];
    for (let i = 0; i < 10; i++) cadeiras.push(await criarEquipamento(db, { nome: 'Cadeira', marca: 'X', modelo: 'Y', localizacaoId: loc }));
    const outra = await criarEquipamento(db, { nome: 'Cadeira', marca: 'X', modelo: 'Z', localizacaoId: loc });
    const d = await anexarDocumento(db, 'equipamento', cadeiras[0].id, pdf(), '', 'manual');
    expect(d.categoria).toBe('manual');
    const todos = await db.equipamentos.toArray();
    const iguais = equipamentosIguais(todos, cadeiras[0]);
    expect(iguais.map((e) => e.id).sort()).toEqual(cadeiras.slice(1).map((e) => e.id).sort());
    expect(iguais.some((e) => e.id === outra.id)).toBe(false);
    // inclui o dono e um repetido: são ignorados
    const n = await ligarDocumento(db, d.id, [...iguais, cadeiras[0], iguais[0]].map((e) => ({ entidade: 'equipamento' as const, entidadeId: e.id })));
    expect(n).toBe(9);
    expect(await db.documentos.count()).toBe(1);
    expect(await ligarDocumento(db, d.id, [{ entidade: 'equipamento', entidadeId: cadeiras[3].id }])).toBe(0);
    const na5 = await documentosDe(db, 'equipamento', cadeiras[5].id);
    expect(na5.map((x) => [x.doc.id, !!x.ligacao])).toEqual([[d.id, true]]);
    const noDono = await documentosDe(db, 'equipamento', cadeiras[0].id);
    expect(noDono.map((x) => x.ligacao)).toEqual([null]);
    await desligarDocumento(db, na5[0].ligacao!.id);
    expect(await documentosDe(db, 'equipamento', cadeiras[5].id)).toEqual([]);
    expect((await ligacoesDoDocumento(db, d.id)).length).toBe(8);
    // categoria
    await definirCategoria(db, d.id, 'garantia');
    expect((await db.documentos.get(d.id))?.categoria).toBe('garantia');
    await expect(definirCategoria(db, d.id, 'xpto' as never)).rejects.toThrow('Categoria');
    // registos que não existem / abatidos
    await expect(ligarDocumento(db, d.id, [{ entidade: 'equipamento', entidadeId: 'nada' }])).rejects.toThrow('não existe');
    await abaterEquipamento(db, outra.id, 'partida');
    await expect(ligarDocumento(db, d.id, [{ entidade: 'equipamento', entidadeId: outra.id }])).rejects.toThrow('não existe');
    // documento removido no dono desaparece de todos
    await removerDocumento(db, d.id);
    expect(await documentosDe(db, 'equipamento', cadeiras[3].id)).toEqual([]);
  });

  it('liga a outros tipos de registo e entra na cópia (completa e leve); cópia antiga restaura', async () => {
    const loc = (await criarLocalizacao(db, { nome: 'Arrumos', tipo: 'armazem' })).id;
    const eq = (await criarEquipamento(db, { nome: 'Router', localizacaoId: loc })).id;
    const d = await anexarDocumento(db, 'localizacao', loc, pdf('contrato.pdf'), '', 'contrato');
    await ligarDocumento(db, d.id, [{ entidade: 'equipamento', entidadeId: eq }]);
    const { blob } = await exportarCopia(db);
    const outra = new OfficeDB(`t-${crypto.randomUUID()}`); await outra.open();
    await restaurarCopia(outra, blob);
    expect((await documentosDe(outra, 'equipamento', eq)).map((x) => x.doc.categoria)).toEqual(['contrato']);
    const leve = await exportarCopia(db, { semDocumentos: true });
    const outra2 = new OfficeDB(`t-${crypto.randomUUID()}`); await outra2.open();
    await restaurarCopia(outra2, leve.blob);
    expect(await outra2.documentoLigacoes.count()).toBe(1);
    expect(await documentosDe(outra2, 'equipamento', eq)).toEqual([]); // sem o ficheiro, não aparece
    // cópia antiga: sem a tabela nova
    const zip = await JSZip.loadAsync(blob);
    zip.remove('dados/documentoLigacoes.json');
    const mf = JSON.parse(await zip.file('manifesto.json')!.async('string'));
    delete mf.contagens.documentoLigacoes; mf.versaoEsquema = 15;
    zip.file('manifesto.json', JSON.stringify(mf));
    const outra3 = new OfficeDB(`t-${crypto.randomUUID()}`); await outra3.open();
    await restaurarCopia(outra3, await zip.generateAsync({ type: 'blob' }));
    expect(await outra3.documentoLigacoes.count()).toBe(0);
    expect(TABELAS).toContain('documentoLigacoes');
  });
});

describe('sugestão de compra trimestral', () => {
  const hoje = new Date('2026-11-20T12:00:00Z');
  const dia = (n: number) => new Date(hoje.getTime() - n * 86_400_000).toISOString();
  let n = 0;
  const c = (artigoId: string, local: string, q: number, diasAtras: number, movimentoId: string | null = null): ContagemStock =>
    ({ id: `c${n++}`, createdAt: dia(diasAtras), updatedAt: dia(diasAtras), deletedAt: null, artigoId, localizacaoId: local, quantidade: q, anterior: null, diferenca: null, observacoes: '', movimentoId });

  it('estima o consumo pelas descidas, ignora movimentos e subidas sem registo', async () => {
    const papel = await criarArtigo(db, { nome: 'Papel', stockMinimo: 5 });
    const toner = await criarArtigo(db, { nome: 'Toner' });
    const pilhas = await criarArtigo(db, { nome: 'Pilhas' });
    const contagens = [
      // Papel no armazém A: 40 → 30 (−10) → 50 por receção (movimento) → 35 (−15) → 40 (subida sem registo) → 30 (−10). 60 dias.
      c(papel.id, 'A', 40, 60), c(papel.id, 'A', 30, 45), c(papel.id, 'A', 50, 40, 'm1'), c(papel.id, 'A', 35, 25), c(papel.id, 'A', 40, 15), c(papel.id, 'A', 30, 0),
      // Toner: só 10 dias de dados
      c(toner.id, 'A', 5, 10), c(toner.id, 'A', 4, 0),
      // anulada não conta
      { ...c(papel.id, 'A', 0, 1), deletedAt: dia(1) }
    ];
    const stocks = stockPorArtigo(await db.artigos.toArray(), contagens);
    const r = sugestaoTrimestral(stocks, contagens, hoje);
    const p = r.find((x) => x.stock.artigo.id === papel.id)!;
    expect(p.consumo).toBe(35);
    expect(p.dias).toBe(60);
    expect(p.subidasSemRegisto).toBe(1);
    expect(p.previsto).toBe(52.5); // 35 / 60 × 90
    expect(p.sugerida).toBe(28); // 52,5 + 5 − 30 = 27,5 → 28
    const t = r.find((x) => x.stock.artigo.id === toner.id)!;
    expect([t.motivo, t.sugerida]).toEqual(['poucos_dias', null]);
    expect(r.find((x) => x.stock.artigo.id === pilhas.id)!.motivo).toBe('sem_contagens');
  });

  it('par que começa antes dos 3 meses conta só a parte dentro; stock folgado → 0', async () => {
    const a = await criarArtigo(db, { nome: 'Copos' });
    const contagens = [c(a.id, 'A', 300, 180), c(a.id, 'A', 120, 0)]; // −180 em 180 dias → metade dentro
    const r = sugestaoTrimestral(stockPorArtigo(await db.artigos.toArray(), contagens), contagens, hoje)[0];
    expect(r.consumo).toBe(90);
    expect(r.dias).toBe(90);
    expect(r.previsto).toBe(90);
    expect(r.sugerida).toBe(0); // 90 + 0 − 120 < 0
    // vários locais somam
    const b = await criarArtigo(db, { nome: 'Pratos' });
    const cs = [c(b.id, 'A', 20, 30), c(b.id, 'A', 10, 0), c(b.id, 'B', 20, 30), c(b.id, 'B', 15, 0)];
    const rb = sugestaoTrimestral(stockPorArtigo([(await db.artigos.get(b.id))!], cs), cs, hoje)[0];
    expect([rb.consumo, rb.previsto, rb.sugerida]).toEqual([15, 45, 20]);
  });
});
