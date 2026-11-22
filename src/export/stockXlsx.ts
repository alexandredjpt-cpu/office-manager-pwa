import type { Artigo, ContagemStock, Localizacao, OfficeDB } from '../db/schema';
import { situacao, stockPorArtigo } from '../db/stock';
import { criarXlsxFolhas, type Celula, type Folha } from './xlsx';

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-PT') : '');
const arred = (n: number) => Math.round(n * 1000) / 1000;
const porNome = (a: string, b: string) => a.localeCompare(b, 'pt', { numeric: true });
const SITUACAO: Record<string, string> = { abaixo: 'Abaixo do mínimo', ok: 'Ok', sem_minimo: 'Sem mínimo definido' };

/** Duas folhas legíveis: uma linha por artigo em cada local, e o total de cada artigo. */
export function folhasDeStock(artigos: Artigo[], contagens: ContagemStock[], locais: Localizacao[]): Folha[] {
  const local = (id: string) => locais.find((l) => l.id === id);
  const stocks = stockPorArtigo(artigos.filter((a) => !a.deletedAt), contagens);

  const porLocal: Celula[][] = [];
  for (const s of stocks) {
    for (const l of s.porLocal) {
      const loc = local(l.localizacaoId);
      porLocal.push([
        loc?.nome ?? '?', loc?.piso ?? '', loc?.ala ?? '',
        s.artigo.codigo, s.artigo.nome, s.artigo.categoria, s.artigo.unidade,
        l.quantidade, dia(l.data),
        s.artigo.preco, s.artigo.preco === null ? null : arred(s.artigo.preco * l.quantidade)
      ]);
    }
  }
  porLocal.sort((a, b) => porNome(String(a[0]), String(b[0])) || porNome(String(a[4]), String(b[4])));

  const totais: Celula[][] = stocks
    .sort((a, b) => porNome(a.artigo.nome, b.artigo.nome))
    .map((s) => [
      s.artigo.codigo, s.artigo.nome, s.artigo.categoria, s.artigo.unidade,
      s.total, s.artigo.stockMinimo, SITUACAO[situacao(s)] ?? '',
      s.porLocal.map((l) => `${local(l.localizacaoId)?.nome ?? '?'} (${l.quantidade})`).join('; '),
      dia(s.ultimaContagem), s.artigo.fornecedor,
      s.artigo.preco, s.artigo.preco === null ? null : arred(s.artigo.preco * s.total)
    ]);

  return [
    {
      nome: 'Stock por local',
      cabecalho: ['Local', 'Piso', 'Ala', 'Código', 'Artigo', 'Categoria', 'Unidade', 'Quantidade', 'Última contagem', 'Preço', 'Valor'],
      linhas: porLocal
    },
    {
      nome: 'Total por artigo',
      cabecalho: ['Código', 'Artigo', 'Categoria', 'Unidade', 'Total', 'Mínimo', 'Situação', 'Locais', 'Última contagem', 'Fornecedor', 'Preço', 'Valor'],
      linhas: totais
    }
  ];
}

/** Ficheiro Excel com o stock e onde está. Artigos nunca contados aparecem só no total, a zero. */
export async function exportarStockXlsx(db: OfficeDB, hoje = new Date()): Promise<{ blob: Blob; nome: string; linhas: number }> {
  const [artigos, contagens, locais] = await Promise.all([db.artigos.toArray(), db.contagensStock.toArray(), db.localizacoes.toArray()]);
  const folhas = folhasDeStock(artigos, contagens, locais);
  const d = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  return { blob: await criarXlsxFolhas(folhas), nome: `stock-${d}.xlsx`, linhas: folhas[0].linhas.length };
}
