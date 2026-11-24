import type { CategoriaFornecedor, OfficeDB } from './schema';
import { agora, novoId } from './repo';

/** Chave de comparação: sem maiúsculas, sem espaços a mais. «Papel» e «papel » são a mesma categoria. */
const chave = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const limpar = (s: string) => s.trim().replace(/\s+/g, ' ');
const NOME_MAX = 40;

/** Separa o texto guardado («papel, limpeza; Papel») em categorias únicas. Mantém a grafia da primeira ocorrência. */
export function separarCategorias(texto: string | null | undefined): string[] {
  const vistos = new Map<string, string>();
  for (const parte of (texto ?? '').split(/[,;]/)) {
    const nome = limpar(parte);
    if (nome && !vistos.has(chave(nome))) vistos.set(chave(nome), nome);
  }
  return [...vistos.values()];
}

export const juntarCategorias = (lista: string[]): string => separarCategorias(lista.join(', ')).join(', ');

/** Verdadeiro se o fornecedor tem pelo menos uma das categorias escolhidas (ou se não há escolha). */
export function temCategoria(texto: string | null | undefined, selecionadas: string[]): boolean {
  if (selecionadas.length === 0) return true;
  const minhas = new Set(separarCategorias(texto).map(chave));
  return selecionadas.some((s) => minhas.has(chave(s)));
}

function nomeValido(bruto: string): string {
  const nome = limpar(bruto);
  if (!nome) throw new Error('O nome da categoria é obrigatório.');
  if (nome.length > NOME_MAX) throw new Error(`A categoria pode ter no máximo ${NOME_MAX} caracteres.`);
  if (/[,;]/.test(nome)) throw new Error('Não uses vírgulas nem ponto e vírgula no nome.');
  return nome;
}

export async function listarCategorias(db: OfficeDB): Promise<CategoriaFornecedor[]> {
  const ativas = await db.categoriasFornecedor.filter((c) => !c.deletedAt).toArray();
  return ativas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}

/** Cria a categoria, ou devolve a existente com o mesmo nome (sem diferenças de maiúsculas). */
export async function criarCategoria(db: OfficeDB, bruto: string): Promise<CategoriaFornecedor> {
  const nome = nomeValido(bruto);
  const existente = (await listarCategorias(db)).find((c) => chave(c.nome) === chave(nome));
  if (existente) return existente;
  const t = agora();
  const c: CategoriaFornecedor = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, nome };
  await db.categoriasFornecedor.add(c);
  return c;
}

/** Renomeia a categoria em todos os fornecedores. Se o novo nome já existe, funde as duas. */
export async function renomearCategoria(db: OfficeDB, id: string, bruto: string): Promise<void> {
  const nome = nomeValido(bruto);
  await db.transaction('rw', db.categoriasFornecedor, db.fornecedores, async () => {
    const c = await db.categoriasFornecedor.get(id);
    if (!c || c.deletedAt) throw new Error('A categoria não existe.');
    const t = agora();
    const outra = (await listarCategorias(db)).find((x) => x.id !== id && chave(x.nome) === chave(nome));
    if (outra) await db.categoriasFornecedor.update(id, { deletedAt: t, updatedAt: t });
    else await db.categoriasFornecedor.update(id, { nome, updatedAt: t });
    const destino = outra ? outra.nome : nome;
    const afetados = await db.fornecedores.filter((f) => !f.deletedAt && temCategoria(f.categorias, [c.nome])).toArray();
    for (const f of afetados) {
      const lista = separarCategorias(f.categorias).map((x) => (chave(x) === chave(c.nome) ? destino : x));
      await db.fornecedores.update(f.id, { categorias: juntarCategorias(lista), updatedAt: t });
    }
  });
}

/** Arquiva a categoria e tira-a de todos os fornecedores. */
export async function arquivarCategoria(db: OfficeDB, id: string): Promise<void> {
  await db.transaction('rw', db.categoriasFornecedor, db.fornecedores, async () => {
    const c = await db.categoriasFornecedor.get(id);
    if (!c || c.deletedAt) throw new Error('A categoria não existe.');
    const t = agora();
    await db.categoriasFornecedor.update(id, { deletedAt: t, updatedAt: t });
    const afetados = await db.fornecedores.filter((f) => !f.deletedAt && temCategoria(f.categorias, [c.nome])).toArray();
    for (const f of afetados) {
      const lista = separarCategorias(f.categorias).filter((x) => chave(x) !== chave(c.nome));
      await db.fornecedores.update(f.id, { categorias: juntarCategorias(lista), updatedAt: t });
    }
  });
}
