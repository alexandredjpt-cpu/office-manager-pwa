import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { criarArtigo } from '../src/db/stock';
import { arquivarContacto, atualizarContacto, criarContacto } from '../src/db/contactos';
import {
  criarEncomenda, criarFornecedor, definirLinha, lerUltimoAprovador, mudarAprovador, mudarEstadoEncomenda, registarAprovacao, submeterParaAprovacao
} from '../src/db/encomendas';
import { MODELOS_BASE, camposEncomenda, montarWhatsApp, numeroWhatsApp, preencher, textoAvisoAprovacao } from '../src/db/emails';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB; let enc: string; let forn: string;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open();
  forn = (await criarFornecedor(db, { nome: 'Papelaria' })).id;
  const a = (await criarArtigo(db, { nome: 'Papel', unidade: 'resmas', preco: 4.5 })).id;
  enc = (await criarEncomenda(db, forn)).id;
  await definirLinha(db, enc, a, 10);
});

describe('contactos', () => {
  it('valida nome, e-mail, telefone e duplicados', async () => {
    await expect(criarContacto(db, { nome: ' ' })).rejects.toThrow('obrigatório');
    await expect(criarContacto(db, { nome: 'X', email: 'mau' })).rejects.toThrow('E-mail');
    await expect(criarContacto(db, { nome: 'X', telefone: '12' })).rejects.toThrow('Telefone');
    const c = await criarContacto(db, { nome: 'Chefe', funcao: 'Gestor', email: 'c@ex.pt', telefone: '912 345 678', aprovador: true }); // privacy-ok
    expect(c.aprovador).toBe(true);
    await expect(criarContacto(db, { nome: 'chefe' })).rejects.toThrow('Já existe');
    await atualizarContacto(db, c.id, { nome: 'Chefe', aprovador: false });
    await arquivarContacto(db, c.id);
    expect((await db.contactos.get(c.id))?.deletedAt).not.toBeNull();
  });
});

describe('WhatsApp', () => {
  it('normaliza números', () => {
    expect(numeroWhatsApp('912 345 678')).toBe('351912345678'); // privacy-ok
    expect(numeroWhatsApp('+351 912 345 678')).toBe('351912345678'); // privacy-ok
    expect(numeroWhatsApp('00351912345678')).toBe('351912345678');
    expect(numeroWhatsApp('123')).toBeNull();
    expect(numeroWhatsApp('812345678')).toBeNull();
  });
  it('monta ligação com texto codificado', () => {
    const u = montarWhatsApp('912345678', 'Olá, é a EN-1 & café')!; // privacy-ok
    expect(u.startsWith('https://wa.me/351912345678?text=')).toBe(true);
    expect(u).toContain('caf%C3%A9');
    expect(montarWhatsApp('abc', 'x')).toBeNull();
    expect(textoAvisoAprovacao('Rui', 'EN-000001', 'Papelaria', 'Alex')).toContain('e-mail');
  });
});

describe('aprovação', () => {
  it('submeter com aprovador guarda-o, sugere-o da próxima vez e regista no histórico', async () => {
    const c = await criarContacto(db, { nome: 'Chefe', aprovador: true });
    await submeterParaAprovacao(db, enc, c.id);
    const e = (await db.encomendas.get(enc))!;
    expect([e.estado, e.aprovadorId]).toEqual(['pendente', c.id]);
    expect(await lerUltimoAprovador(db)).toBe(c.id);
    expect((await db.encomendaEventos.toArray()).some((x) => x.texto.includes('Aprovador: Chefe'))).toBe(true);
  });
  it('aprovador é opcional; inexistente é recusado sem mudar o estado', async () => {
    await expect(submeterParaAprovacao(db, enc, 'nada')).rejects.toThrow('aprovador');
    expect((await db.encomendas.get(enc))?.estado).toBe('rascunho');
    await submeterParaAprovacao(db, enc, null);
    expect((await db.encomendas.get(enc))?.estado).toBe('pendente');
  });
  it('mudar aprovador só em pendente', async () => {
    const c = await criarContacto(db, { nome: 'A' });
    await expect(mudarAprovador(db, enc, c.id)).rejects.toThrow('pendente');
    await submeterParaAprovacao(db, enc, null);
    await mudarAprovador(db, enc, c.id);
    expect((await db.encomendas.get(enc))?.aprovadorId).toBe(c.id);
  });
  it('registar aprovação exige quem aprovou e guarda a nota', async () => {
    await submeterParaAprovacao(db, enc, null);
    await expect(registarAprovacao(db, enc, ' ')).rejects.toThrow('quem aprovou');
    await registarAprovacao(db, enc, 'Chefe', 'confirmou por e-mail');
    expect((await db.encomendas.get(enc))?.estado).toBe('aprovada');
    expect((await db.encomendaEventos.toArray()).some((x) => x.texto.includes('Aprovada por Chefe. confirmou por e-mail'))).toBe(true);
    await expect(registarAprovacao(db, enc, 'Outro')).rejects.toThrow('Não se pode');
  });
  it('modelo de aprovação traz total estimado e aprovador', async () => {
    const e = (await db.encomendas.get(enc))!;
    const campos = camposEncomenda(e, await db.fornecedores.get(forn), await db.encomendaLinhas.toArray(), await db.artigos.toArray(), 'Alex', 'hoje', 'Chefe');
    const r = preencher(MODELOS_BASE.find((m) => m.nome === 'Pedido de aprovação')!, campos);
    expect(r.corpo).toContain('Bom dia Chefe');
    expect(r.corpo).toMatch(/Total estimado: 45,00/);
    expect(r.emBranco).toEqual([]);
  });
  it('total assinala artigos sem preço; sem nenhum preço fica em branco', async () => {
    const b = (await criarArtigo(db, { nome: 'Sem preço' })).id;
    await definirLinha(db, enc, b, 1);
    const e = (await db.encomendas.get(enc))!;
    const c = camposEncomenda(e, undefined, await db.encomendaLinhas.toArray(), await db.artigos.toArray(), '', '', '');
    expect(c.total).toContain('sem preço em 1');
    const so = camposEncomenda(e, undefined, (await db.encomendaLinhas.toArray()).filter((l) => l.artigoId === b), await db.artigos.toArray(), '', '', '');
    expect(so.total).toBe('');
  });
  it('contactos entram na cópia e rascunho pode ser cancelado como antes', async () => {
    await criarContacto(db, { nome: 'Chefe' });
    const { blob } = await exportarCopia(db);
    const d2 = new OfficeDB(`t-${crypto.randomUUID()}`); await d2.open();
    await restaurarCopia(d2, blob);
    expect(await d2.contactos.count()).toBe(1);
    await mudarEstadoEncomenda(db, enc, 'cancelada');
  });
});
