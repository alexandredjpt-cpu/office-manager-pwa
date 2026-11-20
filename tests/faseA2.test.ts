import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { criarLocalizacao } from '../src/db/repo';
import { criarArtigo, registarContagem } from '../src/db/stock';
import { criarFornecedor } from '../src/db/encomendas';
import { anexarDocumento } from '../src/db/documentos';
import { colocarMarcador, ondeEsta } from '../src/db/plantas';
import { registarMovimento } from '../src/db/movimentos';
import { linhasDiferencas, relatorioDiferencas } from '../src/export/relatorios';
import { pesquisar } from '../src/db/pesquisa';
import { CAMPOS, MODELOS_BASE, camposVazios, preencher } from '../src/db/emails';

const img = () => new File([new Uint8Array([1, 2, 3])], 'planta.png', { type: 'image/png' });
let db: OfficeDB; let sala: string; let armario: string; let art: string;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open();
  sala = (await criarLocalizacao(db, { nome: 'Sala', tipo: 'divisao' })).id;
  armario = (await criarLocalizacao(db, { nome: 'Armário A', tipo: 'armazenamento' })).id;
  art = (await criarArtigo(db, { nome: 'Caneta' })).id;
});

describe('diferenças entre contagens', () => {
  it('lista variações com origem; filtra período, local e sem diferença; anuladas fora', async () => {
    await registarContagem(db, art, sala, 10);
    await registarContagem(db, art, sala, 10);
    await registarContagem(db, art, sala, 7);
    await registarMovimento(db, { tipo: 'transferencia', artigoId: art, origemId: sala, destinoId: armario, quantidade: 2, motivo: 'arrumar' });
    const locs = await db.localizacoes.toArray();
    const nl = (id: string) => locs.find((l) => l.id === id)?.nome ?? '?';
    const todas = async (f = {}) => linhasDiferencas(await db.contagensStock.toArray(), await db.artigos.toArray(), await db.movimentosStock.toArray(), nl, f);
    const l = await todas();
    expect(l.map((x) => [x.local, x.diferenca, x.origem])).toEqual(expect.arrayContaining([['Sala', null, 'Primeira contagem'], ['Sala', -3, 'Contagem'], ['Sala', -2, 'Transferência'], ['Armário A', null, 'Transferência']]));
    expect(l.some((x) => x.diferenca === 0)).toBe(false);
    expect((await todas({ incluirSemDiferenca: true })).some((x) => x.diferenca === 0)).toBe(true);
    expect((await todas({ localizacaoId: armario })).length).toBe(1);
    expect(await todas({ de: '2999-01-01' })).toEqual([]);
    const rel = relatorioDiferencas(l, { localizacaoId: sala }, nl);
    expect(rel.colunas.reduce((t, c) => t + c.largura, 0)).toBe(182);
    expect(rel.linhas.some((r) => r[5] === '-3')).toBe(true);
    expect(rel.filtros).toContain('local: Sala');
  });
});

describe('pesquisa de fornecedores e documentos', () => {
  it('encontra fornecedor pelo nome/contacto e documento pelo nome, com rota do dono', async () => {
    const f = await criarFornecedor(db, { nome: 'Papelaria Central', contacto: 'Rui' });
    const d = await anexarDocumento(db, 'fornecedor', f.id, new File([new Uint8Array([1])], 'Contrato 2026.pdf', { type: 'application/pdf' }));
    const base = { equipamentos: [], artigos: [], locais: [], anomalias: [], stockDe: () => '', nomeLocal: () => '', fornecedores: await db.fornecedores.toArray(), documentos: await db.documentos.toArray(), nomeDono: () => 'Papelaria Central' };
    expect(pesquisar('rui', base).map((r) => [r.tipo, r.rota])).toEqual([['fornecedor', `/fornecedores/${f.id}`]]);
    expect(pesquisar('contrato', base).map((r) => [r.tipo, r.rota, r.detalhe])).toEqual([['documento', `/fornecedores/${f.id}`, 'Fornecedor: Papelaria Central']]);
    expect(pesquisar('papelaria', base).map((r) => r.tipo)).toEqual(['fornecedor', 'documento']);
    void d;
  });
});

describe('local de armazenamento na planta', () => {
  it('um ponto por local; não pode apontar para o próprio local; ondeEsta devolve a sala', async () => {
    const planta = (await anexarDocumento(db, 'localizacao', sala, img())).id;
    const m1 = await colocarMarcador(db, planta, 'local', armario, 0.1, 0.2);
    const m2 = await colocarMarcador(db, planta, 'local', armario, 0.5, 0.5);
    expect(m2.id).toBe(m1.id);
    await expect(colocarMarcador(db, planta, 'local', sala, 0.5, 0.5)).rejects.toThrow('outro local');
    await expect(colocarMarcador(db, planta, 'local', 'nada', 0.5, 0.5)).rejects.toThrow('não existe');
    expect((await ondeEsta(db, 'local', armario)).map((x) => x.localizacaoId)).toEqual([sala]);
  });
});

describe('modelos de e-mail', () => {
  it('os 9 modelos só usam campos conhecidos; avaria preenche anomalia, equipamento e local', () => {
    expect(MODELOS_BASE).toHaveLength(9);
    for (const m of MODELOS_BASE) expect(preencher(m, camposVazios()).desconhecidos, m.nome).toEqual([]);
    expect(Object.keys(camposVazios()).sort()).toEqual([...CAMPOS].sort());
    const avaria = MODELOS_BASE.find((m) => m.nome === 'Comunicação de avaria a fornecedor')!;
    const r = preencher(avaria, { ...camposVazios(), contacto: 'Exmos. Senhores', anomalia: 'AN-000001', equipamento: 'Router', local: 'Sala', descricao: 'Não liga', prioridade: 'Alta', responsavel: 'Eu' });
    expect(r.assunto).toBe('Avaria AN-000001 — Router');
    expect(r.corpo).toContain('Local: Sala');
    expect(r.emBranco).toEqual([]);
  });
});
