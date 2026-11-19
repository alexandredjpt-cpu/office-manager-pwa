import { beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { OfficeDB } from '../src/db/schema';
import {
  abaterEquipamento, adicionarFoto, atualizarEquipamento, atualizarLocalizacao, criarEquipamento, criarLocalizacao,
  desativarEquipamento, eliminarLocalizacao, normalizarData, reativarEquipamento
} from '../src/db/repo';
import { diasAte, estadoGarantia } from '../src/db/garantia';
import { FILTROS_INICIAIS, categoriasDe, filtrarEquipamentos, normalizar } from '../src/db/consultas';
import { apagarDadosExemplo, criarDadosExemplo, soTemDadosExemplo } from '../src/db/exemplo';
import { dimensoesAlvo } from '../src/fotos/comprimir';
import { criarXlsx, escXml, letraColuna } from '../src/export/xlsx';
import { linhasEquipamentos, nomeFicheiroEquipamentos } from '../src/export/equipamentos';

let db: OfficeDB;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`);
  await db.open();
});

describe('edição de equipamentos', () => {
  it('atualiza campos, apara espaços e mantém o código', async () => {
    const e = await criarEquipamento(db, { nome: 'Antigo' });
    const n = await atualizarEquipamento(db, e.id, { nome: '  Novo nome ', marca: ' X ', fimGarantia: '2027-05-01' });
    expect(n.nome).toBe('Novo nome');
    expect(n.marca).toBe('X');
    expect(n.codigo).toBe(e.codigo);
    expect(n.updatedAt >= e.updatedAt).toBe(true);
  });

  it('recusa nome vazio, datas inexistentes e garantia anterior à aquisição', async () => {
    const e = await criarEquipamento(db, { nome: 'A' });
    await expect(atualizarEquipamento(db, e.id, { nome: ' ' })).rejects.toThrow('obrigatório');
    await expect(atualizarEquipamento(db, e.id, { fimGarantia: '2026-02-31' })).rejects.toThrow('inválida');
    await expect(atualizarEquipamento(db, e.id, { dataAquisicao: '2026-06-01', fimGarantia: '2026-05-01' })).rejects.toThrow('anterior');
    expect((await db.equipamentos.get(e.id))?.fimGarantia).toBeNull();
  });

  it('recusa localização inexistente ou eliminada', async () => {
    const e = await criarEquipamento(db, { nome: 'A' });
    await expect(atualizarEquipamento(db, e.id, { localizacaoId: 'nao-existe' })).rejects.toThrow('não existe');
    const l = await criarLocalizacao(db, { nome: 'L', tipo: 'outro' });
    await eliminarLocalizacao(db, l.id);
    await expect(atualizarEquipamento(db, e.id, { localizacaoId: l.id })).rejects.toThrow('não existe');
  });

  it('data vazia limpa o campo', async () => {
    const e = await criarEquipamento(db, { nome: 'A', fimGarantia: '2027-01-01' });
    expect((await atualizarEquipamento(db, e.id, { fimGarantia: '' })).fimGarantia).toBeNull();
    expect(normalizarData(undefined, 'x')).toBeNull();
  });
});

describe('ciclo de vida', () => {
  it('ativo ⇄ desativado, e abatido é definitivo', async () => {
    const e = await criarEquipamento(db, { nome: 'A' });
    await expect(reativarEquipamento(db, e.id)).rejects.toThrow();
    await desativarEquipamento(db, e.id);
    expect((await db.equipamentos.get(e.id))?.estado).toBe('desativado');
    await reativarEquipamento(db, e.id);
    await abaterEquipamento(db, e.id, 'Avariado');
    await expect(abaterEquipamento(db, e.id, 'Outra vez')).rejects.toThrow('já está abatido');
    await expect(desativarEquipamento(db, e.id)).rejects.toThrow();
    await expect(atualizarEquipamento(db, e.id, { nome: 'B' })).rejects.toThrow('abatido');
    expect((await db.equipamentos.get(e.id))?.motivoAbate).toBe('Avariado');
  });
});

describe('localizações', () => {
  it('edita e recusa nome vazio', async () => {
    const l = await criarLocalizacao(db, { nome: 'Sala', tipo: 'divisao' });
    expect((await atualizarLocalizacao(db, l.id, { nome: ' Copa ', tipo: 'zona_comum' })).nome).toBe('Copa');
    await expect(atualizarLocalizacao(db, l.id, { nome: '' })).rejects.toThrow('obrigatório');
  });

  it('só elimina se não houver equipamentos não abatidos lá', async () => {
    const l = await criarLocalizacao(db, { nome: 'Sala', tipo: 'divisao' });
    const e = await criarEquipamento(db, { nome: 'A', localizacaoId: l.id });
    await expect(eliminarLocalizacao(db, l.id)).rejects.toThrow('1 equipamento');
    await abaterEquipamento(db, e.id, 'x');
    await eliminarLocalizacao(db, l.id);
    expect((await db.localizacoes.get(l.id))?.deletedAt).not.toBeNull();
  });
});

describe('fotografias', () => {
  it('adiciona a equipamento e localização; recusa não-imagens e donos inexistentes', async () => {
    const e = await criarEquipamento(db, { nome: 'A' });
    const l = await criarLocalizacao(db, { nome: 'L', tipo: 'outro' });
    const img = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    await adicionarFoto(db, 'equipamento', e.id, img);
    await adicionarFoto(db, 'localizacao', l.id, img);
    expect(await db.fotografias.where('[entidade+entidadeId]').equals(['equipamento', e.id]).count()).toBe(1);
    await expect(adicionarFoto(db, 'equipamento', e.id, new Blob(['x'], { type: 'text/plain' }))).rejects.toThrow('imagem');
    await expect(adicionarFoto(db, 'equipamento', 'x', img)).rejects.toThrow('não existe');
    await expect(adicionarFoto(db, 'anomalia', 'x', img)).rejects.toThrow('não existe');
  });
});

describe('garantia', () => {
  const hoje = new Date(2026, 10, 19, 15, 0); // 19 nov 2026, hora local
  it('classifica por dias', () => {
    expect(estadoGarantia(null, hoje)).toEqual({ estado: 'sem', dias: null });
    expect(estadoGarantia('2026-11-18', hoje)).toEqual({ estado: 'expirada', dias: -1 });
    expect(estadoGarantia('2026-11-19', hoje)).toEqual({ estado: 'a_terminar', dias: 0 });
    expect(estadoGarantia('2027-01-18', hoje)).toEqual({ estado: 'a_terminar', dias: 60 });
    expect(estadoGarantia('2027-01-19', hoje)).toEqual({ estado: 'ativa', dias: 61 });
  });
  it('conta dias certos através de mudança de hora', () => {
    expect(diasAte('2027-04-01', new Date(2027, 2, 20, 23, 30))).toBe(12);
  });
});

describe('pesquisa e filtros', () => {
  it('ignora acentos e maiúsculas, combina termos e filtros', async () => {
    const sala = await criarLocalizacao(db, { nome: 'Sala', tipo: 'divisao' });
    await criarEquipamento(db, { nome: 'Câmara de vigilância', categoria: 'Segurança', marca: 'Acme', localizacaoId: sala.id });
    const b = await criarEquipamento(db, { nome: 'Impressora', categoria: 'Escritório', numeroSerie: 'SN-123' });
    await desativarEquipamento(db, b.id);
    const lista = await db.equipamentos.toArray();
    const nome = (id: string | null) => (id === sala.id ? 'Sala' : '');
    const f = (p: Partial<typeof FILTROS_INICIAIS>) => filtrarEquipamentos(lista, { ...FILTROS_INICIAIS, ...p }, nome).map((e) => e.nome);

    expect(f({ texto: 'CAMARA' })).toEqual(['Câmara de vigilância']);
    expect(f({ texto: 'acme sala' })).toEqual(['Câmara de vigilância']);
    expect(f({ texto: 'sn-123' })).toEqual([]); // desativado, filtro por omissão = ativos
    expect(f({ texto: 'sn-123', estado: 'todos' })).toEqual(['Impressora']);
    expect(f({ estado: 'desativado' })).toEqual(['Impressora']);
    expect(f({ localizacaoId: '-', estado: 'todos' })).toEqual(['Impressora']);
    expect(f({ categoria: 'Segurança' })).toEqual(['Câmara de vigilância']);
    expect(categoriasDe(lista)).toEqual(['Escritório', 'Segurança']);
    expect(normalizar('Ação')).toBe('acao');
  });
});

describe('dados de exemplo', () => {
  it('apagar repõe os contadores: os primeiros registos reais são EQ-000001', async () => {
    await criarDadosExemplo(db);
    expect(await soTemDadosExemplo(db)).toBe(true);
    await apagarDadosExemplo(db);
    expect(await db.equipamentos.count()).toBe(0);
    expect(await db.contadores.count()).toBe(0);
    expect((await criarEquipamento(db, { nome: 'Real' })).codigo).toBe('EQ-000001');
  });

  it('recusa apagar se houver um registo real, sem alterar nada', async () => {
    await criarDadosExemplo(db);
    await criarEquipamento(db, { nome: 'Real' });
    expect(await soTemDadosExemplo(db)).toBe(false);
    await expect(apagarDadosExemplo(db)).rejects.toThrow('dados reais');
    expect(await db.equipamentos.count()).toBe(3);
    expect((await db.contadores.get('EQ'))?.ultimo).toBe(3);
  });

  it('base vazia não conta como exemplo', async () => {
    expect(await soTemDadosExemplo(db)).toBe(false);
  });

  it('o exemplo inclui uma garantia a terminar, para ver o destaque', async () => {
    await criarDadosExemplo(db);
    const r = (await db.equipamentos.toArray()).map((e) => estadoGarantia(e.fimGarantia).estado).sort();
    expect(r).toEqual(['a_terminar', 'ativa']);
  });
});

describe('compressão: dimensões', () => {
  it('reduz o lado maior e mantém a proporção; não aumenta', () => {
    expect(dimensoesAlvo(4000, 3000, 1280)).toEqual({ w: 1280, h: 960 });
    expect(dimensoesAlvo(3000, 4000, 1280)).toEqual({ w: 960, h: 1280 });
    expect(dimensoesAlvo(800, 600, 1280)).toEqual({ w: 800, h: 600 });
    expect(dimensoesAlvo(10000, 1, 100)).toEqual({ w: 100, h: 1 });
  });
});

describe('Excel', () => {
  it('letras de coluna', () => {
    expect([0, 25, 26, 27, 701, 702].map(letraColuna)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  it('escapa XML e remove caracteres de controlo', () => {
    expect(escXml('a&b<c>"d"\u0001')).toBe('a&amp;b&lt;c&gt;&quot;d&quot;');
  });

  it('gera um .xlsx com a estrutura certa, cabeçalho e valores escapados', async () => {
    const blob = await criarXlsx('Equip: [x]', ['Nome', 'Qtd'], [['A & B <ok>', 3], ['=SOMA(1)', null]]);
    const z = await JSZip.loadAsync(blob);
    expect(Object.keys(z.files).sort()).toEqual([
      '[Content_Types].xml', '_rels/', '_rels/.rels', 'xl/', 'xl/_rels/', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
      'xl/workbook.xml', 'xl/worksheets/', 'xl/worksheets/sheet1.xml'
    ]);
    const sheet = await z.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('A &amp; B &lt;ok&gt;');
    expect(sheet).toContain('<c r="B2"><v>3</v></c>');
    expect(sheet).toContain('t="inlineStr"><is><t xml:space="preserve">=SOMA(1)</t>'); // texto, nunca fórmula
    expect(sheet).toContain('<autoFilter ref="A1:B3"/>');
    expect(await z.file('xl/workbook.xml')!.async('string')).toContain('name="Equip   x "');
  });

  it('linhas de equipamentos seguem o cabeçalho', async () => {
    const e = await criarEquipamento(db, { nome: 'Router', fimGarantia: '2020-01-01' });
    const [linha] = linhasEquipamentos([e], () => 'Sala', new Date(2026, 10, 19));
    expect(linha.slice(0, 2)).toEqual(['EQ-000001', 'Router']);
    expect(linha[6]).toBe('Sala');
    expect(linha[10]).toBe('Expirada');
    expect(nomeFicheiroEquipamentos(new Date(2026, 10, 9))).toBe('equipamentos-2026-11-09.xlsx');
  });
});
