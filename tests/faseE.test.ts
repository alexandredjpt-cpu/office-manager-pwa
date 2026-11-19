import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { criarEquipamento } from '../src/db/repo';
import { criarEncomenda, criarFornecedor, definirLinha } from '../src/db/encomendas';
import { criarArtigo } from '../src/db/stock';
import { anexarDocumento, espacoUsado, LIMITE_BYTES, removerDocumento } from '../src/db/documentos';
import { MODELOS_BASE, camposEncomenda, montarMailto, preencher } from '../src/db/emails';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB; let eq: string;
const pdf = (nome = 'fatura.pdf', n = 100) => new File([new Uint8Array(n).fill(7)], nome, { type: 'application/pdf' });
beforeEach(async () => { db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open(); eq = (await criarEquipamento(db, { nome: 'Router' })).id; });

describe('documentos', () => {
  it('anexa PDF/imagem, valida tipo, tamanho e dono', async () => {
    const d = await anexarDocumento(db, 'equipamento', eq, pdf(), ' garantia ');
    expect([d.mime, d.tamanho, d.descricao]).toEqual(['application/pdf', 100, 'garantia']);
    await expect(anexarDocumento(db, 'equipamento', eq, new File(['x'], 'a.exe', { type: 'application/x-msdownload' }))).rejects.toThrow('só se aceitam');
    await expect(anexarDocumento(db, 'equipamento', eq, new File([], 'v.pdf', { type: 'application/pdf' }))).rejects.toThrow('vazio');
    await expect(anexarDocumento(db, 'equipamento', eq, pdf('g.pdf', LIMITE_BYTES + 1))).rejects.toThrow('limite');
    await expect(anexarDocumento(db, 'equipamento', 'nada', pdf())).rejects.toThrow('não existe');
    await expect(anexarDocumento(db, 'fornecedor', eq, pdf())).rejects.toThrow('não existe');
    expect((await anexarDocumento(db, 'equipamento', eq, pdf('../../x/y:z.pdf'))).nome).not.toMatch(/[\\/:]/);
  });
  it('remover é lógico e conta o espaço usado', async () => {
    const d = await anexarDocumento(db, 'equipamento', eq, pdf('a.pdf', 300));
    await anexarDocumento(db, 'equipamento', eq, pdf('b.pdf', 200));
    expect(await espacoUsado(db)).toEqual({ ficheiros: 2, bytes: 500 });
    await removerDocumento(db, d.id);
    expect(await espacoUsado(db)).toEqual({ ficheiros: 1, bytes: 200 });
    expect(await db.documentos.count()).toBe(2);
  });
});

describe('cópia completa e leve', () => {
  it('completa leva os documentos e restaura-os', async () => {
    await anexarDocumento(db, 'equipamento', eq, pdf('a.pdf', 50));
    const { blob, manifesto } = await exportarCopia(db);
    expect(manifesto.semDocumentos).toBeUndefined();
    const d2 = new OfficeDB(`t-${crypto.randomUUID()}`); await d2.open();
    await restaurarCopia(d2, blob);
    const [doc] = await d2.documentos.toArray();
    expect([doc.nome, doc.tamanho, doc.blob.size]).toEqual(['a.pdf', 50, 50]);
  });
  it('leve não inclui documentos e o restauro mantém os que existem', async () => {
    const { blob, manifesto, nome } = await exportarCopia(db, { semDocumentos: true });
    expect(manifesto.semDocumentos).toBe(true);
    expect(nome).toContain('leve');
    const d2 = new OfficeDB(`t-${crypto.randomUUID()}`); await d2.open();
    const eq2 = (await criarEquipamento(d2, { nome: 'Outro' })).id;
    await anexarDocumento(d2, 'equipamento', eq2, pdf('meu.pdf', 40));
    await restaurarCopia(d2, blob);
    expect(await d2.equipamentos.count()).toBe(1); // dados substituídos
    expect((await d2.documentos.toArray()).map((d) => d.nome)).toEqual(['meu.pdf']); // documentos preservados
  });
});

describe('modelos de e-mail', () => {
  it('preenche campos de uma encomenda', async () => {
    const f = await criarFornecedor(db, { nome: 'Papelaria', contacto: 'Ana' });
    const a = await criarArtigo(db, { nome: 'Papel A4', unidade: 'resmas' });
    const e = await criarEncomenda(db, f.id);
    await definirLinha(db, e.id, a.id, 10);
    const campos = camposEncomenda(e, f, await db.encomendaLinhas.toArray(), await db.artigos.toArray(), 'Alex', '19/11/2026');
    const r = preencher(MODELOS_BASE[0], campos);
    expect(r.assunto).toBe('Pedido de encomenda EN-000001');
    expect(r.corpo).toContain('Bom dia Ana');
    expect(r.corpo).toContain('- 10 resmas Papel A4');
    expect(r.corpo).toContain('Alex');
    expect(r.emBranco).toEqual([]);
  });
  it('sinaliza campos em branco e desconhecidos; saudação neutra sem contacto', () => {
    const base = { fornecedor: '', contacto: 'Exmos. Senhores', encomenda: 'EN-1', artigos: '', responsavel: '', data: 'hoje', aprovador: '', total: '' };
    const r = preencher({ assunto: 'A {{encomenda}}', corpo: '{{artigos}} {{responsavel}} {{xpto}} {{ contacto }}' }, base);
    expect(r.emBranco.sort()).toEqual(['artigos', 'responsavel']);
    expect(r.desconhecidos).toEqual(['xpto']);
    expect(r.corpo).toContain('{{xpto}}');
    expect(r.corpo).toContain('Exmos. Senhores');
  });
  it('mailto codifica acentos, quebras de linha e caracteres especiais', () => {
    const u = montarMailto('a@b.pt', 'Pedido & café', 'Linha 1\nLinha 2 ç?='); // privacy-ok
    expect(u.startsWith('mailto:a@b.pt?subject=')).toBe(true); // privacy-ok
    expect(u).toContain('Pedido%20%26%20caf%C3%A9');
    expect(u).toContain('%0A');
    expect(u.split('?').length).toBe(2);
    expect(montarMailto('', 'x', 'y').startsWith('mailto:?subject=')).toBe(true);
  });
});
