import type { LinhaCompra, StockArtigo } from '../db/stock';
import { situacao } from '../db/stock';
import { criarXlsx, type Celula } from './xlsx';

const hojeIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const SITUACAO = { sem_minimo: 'Sem mínimo', ok: 'OK', abaixo: 'Abaixo do mínimo' } as const;
const dia = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

export const CABECALHO_INVENTARIO = ['Código', 'Artigo', 'Categoria', 'Unidade', 'Total', 'Mínimo', 'Situação', 'Por local', 'Última contagem', 'Fornecedor', 'Preço'];
export const CABECALHO_COMPRAS = ['Código', 'Artigo', 'Unidade', 'Atual', 'Mínimo', 'Quantidade sugerida', 'Fornecedor', 'Preço unitário', 'Valor estimado', 'Estado'];

export function linhasInventario(lista: StockArtigo[], nomeLocal: (id: string) => string): Celula[][] {
  return lista.map((s) => [
    s.artigo.codigo, s.artigo.nome, s.artigo.categoria, s.artigo.unidade, s.total, s.artigo.stockMinimo,
    SITUACAO[situacao(s)],
    s.porLocal.map((l) => `${nomeLocal(l.localizacaoId)}: ${l.quantidade}`).join('; '),
    dia(s.ultimaContagem), s.artigo.fornecedor, s.artigo.preco
  ]);
}

export function linhasCompras(lista: LinhaCompra[]): Celula[][] {
  return lista.map((c) => [
    c.artigo.codigo, c.artigo.nome, c.artigo.unidade, c.atual, c.minimo, c.sugerida, c.artigo.fornecedor,
    c.artigo.preco, c.valor, c.artigo.estadoCompra === 'comprado' ? 'Comprado' : 'Por comprar'
  ]);
}

export async function exportarInventarioXlsx(lista: StockArtigo[], nomeLocal: (id: string) => string) {
  return { blob: await criarXlsx('Inventário', CABECALHO_INVENTARIO, linhasInventario(lista, nomeLocal)), nome: `inventario-${hojeIso()}.xlsx` };
}

export async function exportarComprasXlsx(lista: LinhaCompra[]) {
  return { blob: await criarXlsx('Lista de compras', CABECALHO_COMPRAS, linhasCompras(lista)), nome: `lista-compras-${hojeIso()}.xlsx` };
}
