import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { OfficeDB } from '../src/db/schema';
import { adicionarFoto, criarEquipamento, criarLocalizacao } from '../src/db/repo';
import { atualizarArtigo, criarArtigo, limparCodigoBarras } from '../src/db/stock';
import { artigoPorCodigo } from '../src/db/pesquisa';
import { avaliarLinha, iniciarInspecao, proximaPorAvaliar, vincularAnomalia } from '../src/db/inspecoes';
import { criarAnomalia } from '../src/db/anomalias';
import { sugerirLocal } from '../src/db/consultas';
import { dividirDitado } from '../src/db/notas';
import { exportarTudoXlsx, folhaDe, valorCelula } from '../src/export/tudo';
import { nomesFolhas } from '../src/export/xlsx';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB;
beforeEach(async () => { db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open(); });

describe('código de barras nos artigos', () => {
  it('limpa espaços e hífenes, recusa repetidos e lixo, e encontra por EAN ou código AR-', async () => {
    expect(limparCodigoBarras(' 560 1234-567890 ')).toBe('5601234567890');
    const a = await criarArtigo(db, { nome: 'Papel A4', codigoBarras: '5601234 567890' });
    expect(a.codigoBarras).toBe('5601234567890');
    await expect(criarArtigo(db, { nome: 'Outro', codigoBarras: '5601234567890' })).rejects.toThrow(a.codigo);
    await expect(criarArtigo(db, { nome: 'Outro', codigoBarras: 'ab#1' })).rejects.toThrow('inválido');
    const b = await criarArtigo(db, { nome: 'Toner' });
    await expect(atualizarArtigo(db, b.id, { nome: 'Toner', codigoBarras: '5601234567890' })).rejects.toThrow('já está');
    await atualizarArtigo(db, a.id, { nome: 'Papel A4', codigoBarras: '5601234567890' }); // o próprio pode manter
    const todos = await db.artigos.toArray();
    expect(artigoPorCodigo('5601234567890', todos)?.id).toBe(a.id);
    expect(artigoPorCodigo(b.codigo.toLowerCase(), todos)?.id).toBe(b.id);
    expect(artigoPorCodigo('000', todos)).toBeNull();
  });
});

describe('inspeção rápida', () => {
  it('próxima por avaliar dá a volta e devolve -1 quando acabou', () => {
    expect(proximaPorAvaliar(['conforme', null, null], 2)).toBe(2);
    expect(proximaPorAvaliar(['conforme', null, 'conforme'], 2)).toBe(1);
    expect(proximaPorAvaliar(['conforme', 'nao_verificado'], 0)).toBe(-1);
  });
  it('fotos tiradas ao equipamento passam para a anomalia criada a partir da linha', async () => {
    const l = await criarLocalizacao(db, { nome: 'Sala', tipo: 'divisao' });
    const e = await criarEquipamento(db, { nome: 'Monitor', localizacaoId: l.id });
    const i = await iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'pontual' });
    const [linha] = await db.inspecaoLinhas.toArray();
    await avaliarLinha(db, linha.id, 'com_anomalia', 'ecrã partido');
    await adicionarFoto(db, 'inspecaoLinha', linha.id, new Blob(['x'], { type: 'image/jpeg' }));
    await expect(adicionarFoto(db, 'inspecaoLinha', 'nada', new Blob(['x'], { type: 'image/jpeg' }))).rejects.toThrow();
    const a = await criarAnomalia(db, { titulo: 'ecrã partido', descricao: '', localizacaoId: l.id, equipamentoId: e.id, prioridade: 'alta' });
    await vincularAnomalia(db, linha.id, a.id);
    const fotos = await db.fotografias.toArray();
    expect(fotos.map((f) => f.entidade).sort()).toEqual(['anomalia', 'inspecaoLinha']);
    expect(fotos.find((f) => f.entidade === 'anomalia')?.entidadeId).toBe(a.id);
    expect((await db.inspecaoLinhas.get(linha.id))?.anomaliaId).toBe(a.id);
    expect(i.estado).toBe('em_curso');
    // a cópia de segurança aceita as fotos novas
    const { blob } = await exportarCopia(db);
    const d2 = new OfficeDB(`t-${crypto.randomUUID()}`); await d2.open();
    await restaurarCopia(d2, blob);
    expect(await d2.fotografias.count()).toBe(2);
  });
});

describe('ditar anomalia', () => {
  it('título = 1.ª frase; descrição = tudo; frase única fica só no título', () => {
    expect(dividirDitado('Estore partido na sala dois. Faz barulho quando sobe')).toEqual({ titulo: 'Estore partido na sala dois.', descricao: 'Estore partido na sala dois. Faz barulho quando sobe' });
    expect(dividirDitado('  luz fundida  ')).toEqual({ titulo: 'luz fundida', descricao: '' });
  });
  it('sugere o local pelo nome (sem acentos), o mais longo ganha; palavras soltas não contam', () => {
    const locais = [{ id: '1', nome: 'Sala' }, { id: '2', nome: 'Sala de Reuniões' }, { id: '3', nome: 'Copa' }, { id: '4', nome: 'WC' }, { id: '5', nome: 'Arquivo (piso -1)' }];
    expect(sugerirLocal('a luz da sala de reunioes está fundida', locais)?.id).toBe('2');
    expect(sugerirLocal('cheira mal na copa', locais)?.id).toBe('3');
    expect(sugerirLocal('o copão partiu-se', locais)).toBeNull();
    expect(sugerirLocal('humidade no arquivo', locais)?.id).toBe('5');
    expect(sugerirLocal('o wc entupiu', locais)).toBeNull(); // nomes com menos de 3 letras não se adivinham
  });
});

describe('exportar tudo para Excel', () => {
  it('uma folha por tabela, sem ficheiros, com nomes únicos e células seguras', async () => {
    expect(nomesFolhas(['Abc', 'abc', 'x'.repeat(40), 'a/b', ''])).toEqual(['Abc', 'abc (2)', 'x'.repeat(31), 'a b', 'Folha5']);
    expect([valorCelula(true), valorCelula(null), valorCelula({ a: 1 }), valorCelula(Infinity)]).toEqual(['Sim', null, '{"a":1}', null]);
    expect((valorCelula('y'.repeat(40000)) as string).length).toBe(32001);
    expect(folhaDe('T', [{ a: 1, blob: new Blob(['x']) }, { b: 2 }]).cabecalho).toEqual(['a', 'b']);

    const l = await criarLocalizacao(db, { nome: 'Sala <1> & "A"', tipo: 'divisao' });
    const e = await criarEquipamento(db, { nome: 'Monitor', localizacaoId: l.id });
    await adicionarFoto(db, 'equipamento', e.id, new Blob(['x'], { type: 'image/jpeg' }));
    const r = await exportarTudoXlsx(db, new Date(2026, 10, 20));
    expect(r.nome).toBe('office-manager-tudo-2026-11-20.xlsx');
    const zip = await JSZip.loadAsync(await r.blob.arrayBuffer());
    const livro = await zip.file('xl/workbook.xml')!.async('string');
    expect((livro.match(/<sheet /g) ?? []).length).toBe(r.folhas);
    expect(livro).toContain('name="Equipamentos"');
    const nomes = Object.keys(zip.files).filter((f) => f.startsWith('xl/worksheets/') && f.endsWith('.xml'));
    expect(nomes).toHaveLength(r.folhas);
    const conteudo = (await Promise.all(nomes.map((n) => zip.file(n)!.async('string')))).join('');
    expect(conteudo).toContain('Sala &lt;1&gt; &amp; &quot;A&quot;');
    expect(conteudo).not.toContain('blob');
  });
});
