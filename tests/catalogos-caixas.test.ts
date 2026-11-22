import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB, type Catalogo } from '../src/db/schema';
import {
  MODELO_PADRAO, criarCatalogo, diaDeEntrega, diaDeIso, guardarCatalogo, guardarHabituais, guardarProduto, habituaisDe,
  conferirPedido, faltasDe, habitosDePedido, montarEmailConferencia, importarTabela, isoDia, lembretesCatalogo, migrarParaCatalogos, montarEmail, montarEmailFalta,
  montarMailto, ordenarCatalogos, registarPedido, removerCatalogo
} from '../src/db/catalogos';
import { criarEncomenda } from '../src/db/encomendas';
import { criarAnomalia } from '../src/db/anomalias';
import { criarLocalizacao } from '../src/db/repo';
import { LIMITE_MAILTO } from '../src/db/emails';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB;
let n = 0;
beforeEach(async () => { db = new OfficeDB(`caixas-${++n}-${Date.now()}`); await db.open(); });

const linha = (i: number) => ({ codigo: `1032500${i % 10}`, nome: 'CHA CIDREIRA MC /melissa', quantidade: 6 });
const HAVI = { diasEntrega: [2, 5], antecedencia: 2 };

describe('Caixas: texto do e-mail', () => {
  it('troca {{data}} e {{produtos}} no texto do utilizador', () => {
    const e = montarEmail([linha(1)], new Date(2026, 10, 27), 'Olá,\nEntrega a {{data}}.\n{{produtos}}\nObrigado');
    expect(e.corpo).toContain('Entrega a 27 de novembro.');
    expect(e.corpo).toContain('10325001 --- 6 --- CHA CIDREIRA MC /melissa');
    expect(e.corpo.endsWith('Obrigado')).toBe(true);
    expect(e.assunto).toContain('sexta-feira');
  });
  it('sem {{produtos}} a lista vai no fim; texto vazio usa o padrão', () => {
    expect(montarEmail([linha(1)], new Date(2026, 10, 27), 'Só isto.').corpo).toMatch(/^Só isto\.\n\nCódigo --- Qtd/);
    expect(montarEmail([linha(1)], new Date(2026, 10, 27), '  ').corpo).toContain('Bom dia');
  });
  it('um pedido de 31 produtos passa o limite do mailto (por isso é copiado)', () => {
    const e = montarEmail(Array.from({ length: 31 }, (_, i) => linha(i)), new Date(2026, 10, 27));
    expect(montarMailto(['x'], e.assunto, e.corpo).length).toBeGreaterThan(LIMITE_MAILTO);
    expect(montarMailto(['x'], e.assunto, '').length).toBeLessThan(LIMITE_MAILTO);
  });
  it('dias: lê AAAA-MM-DD como dia local e reconhece os dias de entrega da caixa', () => {
    expect(isoDia(diaDeIso('2026-12-01')!)).toBe('2026-12-01');
    expect(diaDeIso('ontem')).toBeNull();
    expect(diaDeEntrega(diaDeIso('2026-12-01')!, HAVI.diasEntrega)).toBe(true);
    expect(diaDeEntrega(diaDeIso('2026-12-02')!, HAVI.diasEntrega)).toBe(false);
    expect(diaDeEntrega(diaDeIso('2026-12-02')!, [])).toBe(true);
  });
});

describe('Caixas: criar, editar e apagar', () => {
  it('o nome tem de ser único, sem distinguir maiúsculas nem acentos', async () => {
    await criarCatalogo(db, 'HAVI');
    await expect(criarCatalogo(db, ' havi ')).rejects.toThrow('Já existe');
    await expect(criarCatalogo(db, '  ')).rejects.toThrow('nome');
    const nespresso = await criarCatalogo(db, 'Nespresso');
    await expect(guardarCatalogo(db, nespresso.id, { nome: 'HAVI' })).rejects.toThrow('Já existe');
    await guardarCatalogo(db, nespresso.id, { nome: 'Nespresso Profissional' });
    expect(ordenarCatalogos(await db.catalogos.toArray()).map((c) => c.nome)).toEqual(['HAVI', 'Nespresso Profissional']);
  });
  it('cada caixa tem o seu catálogo e os códigos repetem-se entre caixas', async () => {
    const a = await criarCatalogo(db, 'HAVI');
    const b = await criarCatalogo(db, 'Delta');
    await importarTabela(db, a.id, '10325001 2 cx SUMO PERA');
    await importarTabela(db, b.id, '10325001 1 cx CAFE DELTA');
    await expect(guardarProduto(db, a.id, null, '10325001', 'Outro')).rejects.toThrow('já existe nesta caixa');
    const produtos = await db.produtosHavi.toArray();
    expect(produtos.filter((p) => p.catalogoId === a.id).map((p) => p.nome)).toEqual(['SUMO PERA']);
    expect(produtos.filter((p) => p.catalogoId === b.id).map((p) => p.nome)).toEqual(['CAFE DELTA']);
  });
  it('apagar a caixa leva o catálogo e os pedidos, e não toca nas outras', async () => {
    const a = await criarCatalogo(db, 'HAVI');
    const b = await criarCatalogo(db, 'Delta');
    await importarTabela(db, a.id, '10325001 SUMO PERA');
    await importarTabela(db, b.id, '20000001 CAFE');
    await registarPedido(db, a.id, '2026-11-27', [linha(1)]);
    await removerCatalogo(db, a.id);
    expect(ordenarCatalogos(await db.catalogos.toArray()).map((c) => c.nome)).toEqual(['Delta']);
    expect((await db.produtosHavi.toArray()).filter((p) => !p.deletedAt).map((p) => p.catalogoId)).toEqual([b.id]);
    expect((await db.pedidosHavi.toArray()).every((p) => p.deletedAt)).toBe(true);
  });
});

describe('Caixas: definições e pedidos na base de dados', () => {
  it('a caixa nova começa com o texto padrão e sem destinatários', async () => {
    const c = await criarCatalogo(db, 'Nespresso');
    expect(c).toMatchObject({ destinatarios: [], modelo: MODELO_PADRAO, rascunho: {}, diasEntrega: [], antecedencia: 0 });
  });
  it('destinatários, texto e quantidades sobrevivem à cópia de segurança', async () => {
    const c = await criarCatalogo(db, 'HAVI', HAVI);
    await guardarCatalogo(db, c.id, { destinatarios: ['um', 'dois'], modelo: 'Texto meu {{produtos}}', rascunho: { a: 3 } });
    await registarPedido(db, c.id, '2026-11-27', [linha(1)]);
    const copia = await exportarCopia(db);
    const outra = new OfficeDB(`caixas-restauro-${Date.now()}`); await outra.open();
    await restaurarCopia(outra, copia.blob);
    expect(ordenarCatalogos(await outra.catalogos.toArray())[0]).toMatchObject({
      nome: 'HAVI', destinatarios: ['um', 'dois'], modelo: 'Texto meu {{produtos}}', rascunho: { a: 3 }, diasEntrega: [2, 5], antecedencia: 2
    });
    expect(await outra.pedidosHavi.count()).toBe(1);
  });
  it('preparar duas vezes o mesmo pedido não duplica; o de outra caixa fica à parte', async () => {
    const a = await criarCatalogo(db, 'HAVI');
    const b = await criarCatalogo(db, 'Delta');
    await registarPedido(db, a.id, '2026-11-27', [linha(1)]);
    await registarPedido(db, a.id, '2026-11-27', [linha(1)]);
    expect(await db.pedidosHavi.count()).toBe(1);
    await registarPedido(db, b.id, '2026-11-27', [linha(1)]);
    await registarPedido(db, a.id, '2026-11-27', []);
    expect((await db.pedidosHavi.toArray()).map((p) => p.catalogoId).sort()).toEqual([a.id, b.id].sort());
  });
});

describe('Caixas: quantidades habituais', () => {
  it('guarda a habitual na ficha e a partir do pedido atual, por caixa', async () => {
    const a = await criarCatalogo(db, 'HAVI');
    const b = await criarCatalogo(db, 'Delta');
    await guardarProduto(db, a.id, null, '111', 'CHA', 6);
    await guardarProduto(db, a.id, null, '222', 'SUMO');
    await guardarProduto(db, b.id, null, '333', 'CAFE', 4);
    const [cha, sumo] = (await db.produtosHavi.where('catalogoId').equals(a.id).toArray()).sort((x, y) => x.codigo.localeCompare(y.codigo));
    expect(habituaisDe([cha, sumo])).toEqual({ [cha.id]: 6 });
    expect(await guardarHabituais(db, a.id, { [sumo.id]: 3 })).toBe(1);
    expect(habituaisDe(await db.produtosHavi.where('catalogoId').equals(a.id).toArray())).toEqual({ [sumo.id]: 3 });
    // a caixa Delta não foi tocada
    expect(habituaisDe(await db.produtosHavi.where('catalogoId').equals(b.id).toArray())).toEqual({ [(await db.produtosHavi.where('codigo').equals('333').first())!.id]: 4 });
  });
});

describe('Caixas: lembretes na agenda', () => {
  const seg = new Date(2026, 10, 23); // segunda-feira
  const t = new Date().toISOString();
  const havi: Catalogo = { id: 'c1', createdAt: t, updatedAt: t, deletedAt: null, nome: 'HAVI', destinatarios: [], modelo: MODELO_PADRAO, rascunho: {}, diasEntrega: [2, 5], antecedencia: 2 };
  it('um lembrete por dia de entrega, a apontar para a caixa', () => {
    const ev = lembretesCatalogo(havi, seg, [], 7);
    expect(ev.map((e) => e.data)).toEqual(['2026-11-24', '2026-11-27']);
    expect(ev[0].titulo).toContain('HAVI');
    expect(ev[0].rota).toBe('/catalogos/c1');
  });
  it('com o pedido dessa entrega já preparado, o lembrete desaparece', () => {
    // o lembrete de terça 24 é para a entrega de sexta 27; preparado o pedido, só fica o de sexta 27 (entrega 1 dez)
    const ev = lembretesCatalogo(havi, seg, [{ entrega: '2026-11-27', catalogoId: 'c1', deletedAt: null }], 7);
    expect(ev.map((e) => e.data)).toEqual(['2026-11-27']);
  });
  it('o pedido de outra caixa não conta, e sem dias de entrega não há lembretes', () => {
    expect(lembretesCatalogo(havi, seg, [{ entrega: '2026-11-27', catalogoId: 'outra', deletedAt: null }], 7)).toHaveLength(2);
    expect(lembretesCatalogo({ ...havi, diasEntrega: [] }, seg, [], 7)).toHaveLength(0);
  });
});

describe('Caixas: migração da antiga caixa única da HAVI', () => {
  it('passa definições e produtos para a caixa HAVI e cria as caixas pedidas', async () => {
    const t = new Date().toISOString();
    await db.meta.put({ chave: 'havi.destinatarios', valor: JSON.stringify(['pedidos@exemplo.test']) }); // privacy-ok (fictício)
    await db.meta.put({ chave: 'havi.modelo', valor: 'Texto antigo {{produtos}}' });
    await db.meta.put({ chave: 'havi.rascunho', valor: JSON.stringify({ p1: 4 }) });
    await db.produtosHavi.add({ id: 'p1', createdAt: t, updatedAt: t, deletedAt: null, catalogoId: '', codigo: '10325001', nome: 'SUMO PERA' });
    await db.pedidosHavi.add({ id: 'e1', createdAt: t, updatedAt: t, deletedAt: null, catalogoId: '', entrega: '2026-11-27', linhas: [linha(1)] });

    await migrarParaCatalogos(db, ['Nespresso', 'Delta']);

    const caixas = ordenarCatalogos(await db.catalogos.toArray());
    expect(caixas.map((c) => c.nome)).toEqual(['HAVI', 'Nespresso', 'Delta']);
    expect(caixas[0]).toMatchObject({
      destinatarios: ['pedidos@exemplo.test'], modelo: 'Texto antigo {{produtos}}', rascunho: { p1: 4 }, diasEntrega: [2, 5], antecedencia: 2 // privacy-ok (fictício)
    });
    expect((await db.produtosHavi.get('p1'))!.catalogoId).toBe(caixas[0].id);
    expect((await db.pedidosHavi.get('e1'))!.catalogoId).toBe(caixas[0].id);
    expect(await db.meta.get('havi.destinatarios')).toBeUndefined();
  });
  it('corre uma só vez: não recria caixas que o utilizador apagou', async () => {
    await migrarParaCatalogos(db, ['Nespresso', 'Delta']);
    const antes = ordenarCatalogos(await db.catalogos.toArray());
    await removerCatalogo(db, antes[0].id);
    await migrarParaCatalogos(db, ['Nespresso', 'Delta']);
    expect(ordenarCatalogos(await db.catalogos.toArray())).toHaveLength(antes.length - 1);
  });
  it('adota produtos sem caixa vindos do restauro de uma cópia antiga', async () => {
    await migrarParaCatalogos(db, ['Nespresso']);
    const t = new Date().toISOString();
    await db.produtosHavi.add({ id: 'orfao', createdAt: t, updatedAt: t, deletedAt: null, catalogoId: '', codigo: '999', nome: 'ANTIGO' });
    await migrarParaCatalogos(db, ['Nespresso']);
    const havi = ordenarCatalogos(await db.catalogos.toArray()).find((c) => c.nome === 'HAVI');
    expect((await db.produtosHavi.get('orfao'))!.catalogoId).toBe(havi!.id);
  });
});

describe('Anomalia → encomenda', () => {
  it('a encomenda fica ligada e a anomalia regista-o no histórico', async () => {
    const local = await criarLocalizacao(db, { nome: 'Sala', tipo: 'sala', notas: '' });
    const an = await criarAnomalia(db, { titulo: 'Puxador partido', descricao: '', prioridade: 'media', localizacaoId: local.id, equipamentoId: null });
    const t = new Date().toISOString();
    await db.fornecedores.add({ id: 'f1', createdAt: t, updatedAt: t, deletedAt: null, nome: 'Ferragens', contacto: '', telefone: '', email: '', notas: '' });
    const e = await criarEncomenda(db, 'f1', '', an.id);
    expect(e.anomaliaId).toBe(an.id);
    const hist = await db.atividades.where('anomaliaId').equals(an.id).toArray();
    expect(hist.some((a) => a.texto.includes(e.codigo))).toBe(true);
    await expect(criarEncomenda(db, 'f1', '', 'nao-existe')).rejects.toThrow('anomalia');
  });
});

describe('Caixas: conferir a entrega', () => {
  const pedido = [{ codigo: '111', nome: 'CHA', quantidade: 6 }, { codigo: '222', nome: 'SUMO', quantidade: 2 }];

  it('antes de conferir não há faltas; depois, só o que não chegou', async () => {
    const c = await criarCatalogo(db, 'HAVI');
    await registarPedido(db, c.id, '2026-11-27', pedido);
    const p = (await db.pedidosHavi.toArray())[0];
    expect(faltasDe(p)).toEqual([]);
    await conferirPedido(db, p.id, { '111': 4, '222': 2 });
    const conferido = (await db.pedidosHavi.get(p.id))!;
    expect(conferido.conferidoEm).toBeTruthy();
    expect(faltasDe(conferido)).toEqual([{ codigo: '111', nome: 'CHA', quantidade: 2 }]);
  });

  it('chegou tudo fica conferido e sem faltas; entregas a mais não contam', async () => {
    const c = await criarCatalogo(db, 'HAVI');
    await registarPedido(db, c.id, '2026-11-27', pedido);
    const p = (await db.pedidosHavi.toArray())[0];
    await conferirPedido(db, p.id, { '111': 6, '222': 99 });
    const conferido = (await db.pedidosHavi.get(p.id))!;
    expect(conferido.recebido).toEqual({ '111': 6, '222': 2 });
    expect(faltasDe(conferido)).toEqual([]);
  });

  it('um código que não foi pedido conta como não entregue', async () => {
    const c = await criarCatalogo(db, 'HAVI');
    await registarPedido(db, c.id, '2026-11-27', pedido);
    const p = (await db.pedidosHavi.toArray())[0];
    await conferirPedido(db, p.id, { '999': 5 });
    expect(faltasDe((await db.pedidosHavi.get(p.id))!)).toHaveLength(2);
    await expect(conferirPedido(db, 'nao-existe', {})).rejects.toThrow('já não existe');
  });

  it('o e-mail de falta leva o que faltou e o texto da caixa', () => {
    const faltas = [{ codigo: '111', nome: 'CHA', quantidade: 2 }];
    const e = montarEmailFalta(faltas, new Date(2026, 10, 27));
    expect(e.assunto).toBe('Falta na entrega de 27 de novembro');
    expect(e.corpo).toContain('Código --- Em falta --- Descrição');
    expect(e.corpo).toContain('111 --- 2 --- CHA');
    expect(montarEmailFalta(faltas, new Date(2026, 10, 27), 'Faltou em {{data}}: {{produtos}}').corpo).toMatch(/^Faltou em 27 de novembro: Código/);
  });
});

describe('Caixas: o que costumas pedir', () => {
  const p = (createdAt: string, linhas: { codigo: string; quantidade: number }[]) =>
    ({ createdAt, linhas: linhas.map((l) => ({ ...l, nome: l.codigo })) });

  it('conta em quantos pedidos entrou e a quantidade mais repetida', () => {
    const h = habitosDePedido([
      p('2026-11-01', [{ codigo: 'a', quantidade: 6 }, { codigo: 'b', quantidade: 1 }]),
      p('2026-11-08', [{ codigo: 'a', quantidade: 6 }]),
      p('2026-11-15', [{ codigo: 'a', quantidade: 10 }])
    ]);
    expect(h.a).toEqual({ vezes: 3, normal: 6 });
    expect(h.b).toEqual({ vezes: 1, normal: 1 });
    expect(h.c).toBeUndefined();
  });

  it('em empate fica a quantidade do pedido mais recente', () => {
    const h = habitosDePedido([
      p('2026-11-01', [{ codigo: 'a', quantidade: 6 }]),
      p('2026-11-15', [{ codigo: 'a', quantidade: 10 }])
    ]);
    expect(h.a).toEqual({ vezes: 2, normal: 10 });
  });

  it('sem pedidos não há hábitos', () => {
    expect(habitosDePedido([])).toEqual({});
  });
});

describe('Caixas: aviso de que a entrega foi conferida', () => {
  const linhas = [{ codigo: '111', nome: 'CHA', quantidade: 6 }, { codigo: '222', nome: 'SUMO', quantidade: 2 }];
  const dia = new Date(2026, 10, 27);

  it('chegou tudo: diz que está correta e lista o que chegou', () => {
    const e = montarEmailConferencia({ linhas, recebido: { '111': 6, '222': 2 } }, dia);
    expect(e.assunto).toBe('Entrega de 27 de novembro conferida — tudo certo');
    expect(e.corpo).toContain('Chegou tudo o que foi pedido.');
    expect(e.corpo).toContain('Código --- Chegou --- Descrição');
    expect(e.corpo).toContain('111 --- 6 --- CHA');
  });

  it('com faltas: nomeia-as e deixa de fora o que não chegou de todo', () => {
    const e = montarEmailConferencia({ linhas, recebido: { '111': 4, '222': 0 } }, dia);
    expect(e.assunto).toContain('faltaram 2 produto(s)');
    expect(e.corpo).toContain('Faltaram:');
    expect(e.corpo).toContain('111 --- 2 --- CHA');
    expect(e.corpo).toContain('111 --- 4 --- CHA');
    expect(e.corpo).not.toContain('--- 0 --- SUMO');
  });

  it('texto próprio: sem {{produtos}} a lista vai no fim', () => {
    const e = montarEmailConferencia({ linhas, recebido: { '111': 6, '222': 2 } }, dia, 'Entrega {{data}}. {{faltas}}');
    expect(e.corpo).toMatch(/^Entrega 27 de novembro\. Chegou tudo o que foi pedido\.\n\nCódigo --- Chegou/);
  });
});
