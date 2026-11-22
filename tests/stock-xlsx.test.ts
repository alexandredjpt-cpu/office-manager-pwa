import { describe, expect, it } from 'vitest';
import { folhasDeStock } from '../src/export/stockXlsx';
import type { Artigo, ContagemStock, Localizacao } from '../src/db/schema';

const base = { createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', deletedAt: null };
const local = (id: string, nome: string, piso = ''): Localizacao => ({ ...base, id, nome, tipo: 'sala', notas: '', piso });
const artigo = (id: string, codigo: string, nome: string, extra: Partial<Artigo> = {}): Artigo => ({
  ...base, id, codigo, nome, categoria: 'Economato', unidade: 'un', stockMinimo: null, qtdSugerida: null,
  fornecedor: 'Papelaria', preco: null, estadoCompra: 'por_comprar', notas: '', ...extra
});
const contagem = (artigoId: string, localizacaoId: string, quantidade: number, createdAt: string, extra: Partial<ContagemStock> = {}): ContagemStock =>
  ({ ...base, id: `${artigoId}-${localizacaoId}-${createdAt}`, createdAt, artigoId, localizacaoId, quantidade, anterior: null, diferenca: null, observacoes: '', ...extra });

const locais = [local('L2', 'Copa', '1'), local('L1', 'Armazém', '0')];
const artigos = [artigo('A1', 'AR-000001', 'Canetas', { stockMinimo: 10, preco: 0.5 }), artigo('A2', 'AR-000002', 'Papel')];
const contagens = [
  contagem('A1', 'L1', 4, '2026-11-01T10:00:00.000Z'),
  contagem('A1', 'L1', 6, '2026-11-10T10:00:00.000Z'), // conta só a última de cada local
  contagem('A1', 'L2', 2, '2026-11-05T10:00:00.000Z')
];

describe('Stock para Excel', () => {
  const [porLocal, totais] = folhasDeStock(artigos, contagens, locais);

  it('uma linha por artigo em cada local, com nomes em vez de identificadores', () => {
    expect(porLocal.cabecalho.slice(0, 5)).toEqual(['Local', 'Piso', 'Ala', 'Código', 'Artigo']);
    expect(porLocal.linhas).toHaveLength(2);
    expect(porLocal.linhas[0]).toEqual(['Armazém', '0', '', 'AR-000001', 'Canetas', 'Economato', 'un', 6, '10/11/2026', 0.5, 3]);
    expect(porLocal.linhas[1][0]).toBe('Copa');
  });

  it('o total soma os locais, diz a situação e onde está', () => {
    const canetas = totais.linhas.find((l) => l[0] === 'AR-000001')!;
    expect(canetas[4]).toBe(8);
    expect(canetas[6]).toBe('Abaixo do mínimo');
    expect(canetas[7]).toBe('Armazém (6); Copa (2)');
    expect(canetas[11]).toBe(4);
  });

  it('artigo nunca contado aparece a zero no total e não aparece por local', () => {
    const papel = totais.linhas.find((l) => l[0] === 'AR-000002')!;
    expect(papel[4]).toBe(0);
    expect(papel[6]).toBe('Sem mínimo definido');
    expect(porLocal.linhas.some((l) => l[3] === 'AR-000002')).toBe(false);
  });

  it('contagem anulada não conta, e artigo arquivado fica de fora', () => {
    const [pl, tt] = folhasDeStock(
      [...artigos, artigo('A3', 'AR-000003', 'Antigo', { deletedAt: '2026-11-02T10:00:00.000Z' })],
      [...contagens, contagem('A1', 'L2', 99, '2026-11-20T10:00:00.000Z', { deletedAt: '2026-11-20T11:00:00.000Z' })],
      locais
    );
    expect(pl.linhas.find((l) => l[0] === 'Copa')![7]).toBe(2);
    expect(tt.linhas.some((l) => l[0] === 'AR-000003')).toBe(false);
  });
});
