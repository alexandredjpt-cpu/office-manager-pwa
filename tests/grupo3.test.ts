import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OfficeDB, type Contacto, type Fornecedor } from '../src/db/schema';
import { adicionarFoto, criarEquipamento, criarLocalizacao } from '../src/db/repo';
import { criarAnomalia, mudarEstadoAnomalia } from '../src/db/anomalias';
import { concluirInspecao, avaliarLinha, guardarAssinatura, iniciarInspecao } from '../src/db/inspecoes';
import { destinosContacto, telHref, textoAnomalia } from '../src/db/contactar';
import { gerarPdfAnomalia } from '../src/export/relatorios';
import { pdfAnomalia, pdfInspecao, pdfPeriodo } from '../src/export/gerar';
import { periodoDe, relatorioPeriodo } from '../src/export/periodico';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB;
beforeEach(async () => { db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open(); });

// PNG 1×1 válido (o jsPDF lê as dimensões).
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const png = () => new Blob([PNG], { type: 'image/png' });
const texto = (blob: Blob) => blob.arrayBuffer().then((b) => {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-'));
  writeFileSync(join(dir, 'a.pdf'), Buffer.from(b));
  return execFileSync('pdftotext', ['-layout', join(dir, 'a.pdf'), '-'], { encoding: 'utf8' });
});
const base = { deletedAt: null, createdAt: '', updatedAt: '' };

describe('contactar a partir da anomalia', () => {
  it('lista contactos e fornecedores com telefone ou e-mail; tel: e mensagem', () => {
    const c = [{ ...base, id: 'c1', nome: 'Rui', funcao: 'Técnico', telefone: '912 345 678', email: '', aprovador: false }, // privacy-ok (fictício)
      { ...base, id: 'c2', nome: 'Sem dados', funcao: '', telefone: '', email: '', aprovador: false }] as Contacto[];
    const f = [{ ...base, id: 'f1', nome: 'AVAC Lda', contacto: 'Ana', telefone: '', email: 'a@x.pt', notas: '' }] as Fornecedor[]; // privacy-ok (fictício)
    expect(destinosContacto(c, f).map((d) => [d.nome, d.detalhe])).toEqual([['AVAC Lda', 'Fornecedor · Ana'], ['Rui', 'Técnico']]);
    expect(telHref('+351 912-345-678')).toBe('tel:+351912345678'); // privacy-ok (fictício)
    expect(telHref('21 1+2')).toBe('tel:2112');
    expect(telHref('abc')).toBeNull();
    expect(textoAnomalia({ codigo: 'AN-000003', titulo: 'Ar condicionado sem frio' }, 'Rui', 'Sala 2', 'AC-1', 'Alexandre'))
      .toBe('Olá Rui, temos uma avaria: Ar condicionado sem frio (Sala 2 · AC-1). Ref.ª AN-000003. Quando é que podem ver? — Alexandre');
  });
});

describe('fotos de antes e depois', () => {
  it('fase gravada; PDF mostra «Antes e depois» só quando há fotos do depois', async () => {
    const l = await criarLocalizacao(db, { nome: 'Copa', tipo: 'divisao' });
    const a = await criarAnomalia(db, { titulo: 'Fuga na torneira', descricao: '', localizacaoId: l.id, prioridade: 'media' });
    await adicionarFoto(db, 'anomalia', a.id, png());
    let t = await texto((await pdfAnomalia(db, a.id)).blob);
    expect(t).toContain('Fotografias');
    expect(t).not.toContain('Antes e depois');
    await mudarEstadoAnomalia(db, a.id, 'resolvida', 'Trocado o vedante');
    const d = await adicionarFoto(db, 'anomalia', a.id, png(), { fase: 'depois' });
    expect(d.fase).toBe('depois');
    t = await texto((await pdfAnomalia(db, a.id)).blob);
    expect(t).toContain('Antes e depois');
    // sem fotos de antes, o lugar fica vazio mas a do depois aparece
    const vazio = await gerarPdfAnomalia((await db.anomalias.get(a.id))!, () => 'Copa', () => '', [], [], { emitidoEm: new Date(), responsavel: '' }, [{ dados: PNG, formato: 'PNG' }]);
    expect(await texto(vazio)).toContain('Depois');
  });
});

describe('assinatura da inspeção', () => {
  it('exige nome e inspeção em curso; assinar outra vez substitui; aparece no PDF e na cópia', async () => {
    const l = await criarLocalizacao(db, { nome: 'Receção', tipo: 'divisao' });
    await criarEquipamento(db, { nome: 'Impressora', localizacaoId: l.id });
    const i = await iniciarInspecao(db, { localizacaoId: l.id, modalidade: 'periodica' });
    await expect(guardarAssinatura(db, i.id, png(), '  ')).rejects.toThrow('nome');
    await expect(guardarAssinatura(db, i.id, new Blob([], { type: 'image/png' }), 'Ana')).rejects.toThrow('vazia');
    await guardarAssinatura(db, i.id, png(), 'Ana Silva');
    await guardarAssinatura(db, i.id, png(), 'Ana M. Silva');
    const ativas = (await db.fotografias.toArray()).filter((f) => f.fase === 'assinatura' && !f.deletedAt);
    expect(ativas.map((f) => f.legenda)).toEqual(['Ana M. Silva']);
    const [linha] = await db.inspecaoLinhas.toArray();
    await avaliarLinha(db, linha.id, 'conforme');
    await concluirInspecao(db, i.id);
    await expect(guardarAssinatura(db, i.id, png(), 'Ana')).rejects.toThrow('em curso');
    const t = await texto((await pdfInspecao(db, i.id)).blob);
    expect(t).toContain('Assinatura');
    expect(t).toContain('Ana M. Silva');
    const { blob } = await exportarCopia(db);
    const d2 = new OfficeDB(`t-${crypto.randomUUID()}`); await d2.open();
    await restaurarCopia(d2, blob);
    expect((await d2.fotografias.toArray()).find((f) => f.fase === 'assinatura' && !f.deletedAt)?.legenda).toBe('Ana M. Silva');
  });
});

describe('relatório do período', () => {
  it('semanas de segunda a domingo e meses de calendário', () => {
    const sex = new Date(2026, 10, 20); // sexta, 20 nov 2026
    expect(periodoDe('semana_atual', sex)).toMatchObject({ de: '2026-11-16', ate: '2026-11-22' });
    expect(periodoDe('semana_anterior', sex)).toMatchObject({ de: '2026-11-09', ate: '2026-11-15' });
    expect(periodoDe('mes_atual', sex)).toMatchObject({ de: '2026-11-01', ate: '2026-11-30' });
    expect(periodoDe('mes_anterior', new Date(2026, 0, 10))).toMatchObject({ de: '2025-12-01', ate: '2025-12-31', texto: 'Mês passado: 01/12/2025 a 31/12/2025' });
    expect(periodoDe('semana_atual', new Date(2026, 10, 22)).de).toBe('2026-11-16'); // domingo pertence à semana que começou na segunda
  });
  it('conta registadas, resolvidas e por resolver no fim; ignora o que está fora do período', () => {
    const an = (id: string, criada: string, estado: string, resolvida: string | null, p = 'media') =>
      ({ ...base, id, codigo: id, titulo: id, descricao: '', localizacaoId: 'l', equipamentoId: null, prioridade: p, estado, dataResolucao: resolvida, createdAt: criada });
    const p = { de: '2026-11-09', ate: '2026-11-15', texto: '' };
    const r = relatorioPeriodo({
      anomalias: [an('A', '2026-11-10T10:00:00Z', 'resolvida', '2026-11-12', 'alta'), an('B', '2026-11-01T10:00:00Z', 'resolvida', '2026-11-14'), an('C', '2026-11-11T10:00:00Z', 'por_resolver', null), an('D', '2026-11-18T10:00:00Z', 'por_resolver', null), an('E', '2026-11-02T10:00:00Z', 'resolvida', '2026-11-17')] as never,
      inspecoes: [], linhasInspecao: [], encomendas: [], fornecedores: [], compras: [], nomeLocal: () => 'Sala', nomeEquip: () => ''
    }, p);
    expect(r.resumo.slice(0, 3)).toEqual(['Anomalias registadas: 2 (1 de prioridade alta)', 'Anomalias resolvidas: 2', 'Anomalias por resolver no fim do período: 2']);
    expect(r.seccoes[0].linhas.map((l) => l[0])).toEqual(['A', 'C']);
  });
  it('gera o PDF com todas as secções', async () => {
    const l = await criarLocalizacao(db, { nome: 'Sala 1', tipo: 'divisao' });
    await criarAnomalia(db, { titulo: 'Lâmpada fundida', descricao: '', localizacaoId: l.id, prioridade: 'baixa' });
    const r = await pdfPeriodo(db, 'semana_atual');
    expect(r.nome).toMatch(/^relatorio-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.pdf$/);
    const t = await texto(r.blob);
    for (const s of ['Relatório do período', 'Esta semana', 'Lâmpada fundida', 'Inspeções concluídas', 'A comprar']) expect(t).toContain(s);
  });
});
