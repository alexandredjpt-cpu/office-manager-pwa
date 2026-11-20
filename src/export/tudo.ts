import { TABELAS, type NomeTabela, type OfficeDB } from '../db/schema';
import { criarXlsxFolhas, type Celula, type Folha } from './xlsx';

/** Nome de cada folha (≤31 caracteres). */
export const NOMES_FOLHAS: Record<NomeTabela, string> = {
  localizacoes: 'Locais', equipamentos: 'Equipamentos', fotografias: 'Fotografias', artigos: 'Artigos',
  contagensStock: 'Contagens', anomalias: 'Anomalias', atividades: 'Histórico de anomalias', inspecoes: 'Inspeções',
  inspecaoLinhas: 'Linhas de inspeção', lembretes: 'Lembretes', movimentosStock: 'Movimentos de stock', manutencoes: 'Manutenções',
  execucoes: 'Execuções de manutenção', fornecedores: 'Fornecedores', encomendas: 'Encomendas', encomendaLinhas: 'Linhas de encomenda',
  encomendaEventos: 'Histórico de encomendas', rececoes: 'Receções', documentos: 'Documentos', modelosEmail: 'Modelos de e-mail',
  contactos: 'Contactos', marcadores: 'Marcadores de planta', kits: 'Kits', kitLocais: 'Kits nos locais',
  emailsPreparados: 'E-mails preparados', notas: 'Notas rápidas', zonas: 'Zonas de planta', documentoLigacoes: 'Ligações de documentos', contadores: 'Contadores', meta: 'Definições'
};

/** O Excel não aceita mais de 32 767 caracteres numa célula. */
const MAX_CELULA = 32000;

export function valorCelula(v: unknown): Celula {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > MAX_CELULA ? `${s.slice(0, MAX_CELULA)}…` : s;
}

/** Uma folha por tabela: todas as colunas que aparecem nos registos, pela ordem em que aparecem. Ficheiros (fotos, documentos) ficam de fora; só os dados. */
export function folhaDe(nome: string, registos: Record<string, unknown>[]): Folha {
  const colunas: string[] = [];
  for (const r of registos) for (const k of Object.keys(r)) if (k !== 'blob' && !colunas.includes(k)) colunas.push(k);
  return { nome, cabecalho: colunas, linhas: registos.map((r) => colunas.map((c) => valorCelula(r[c]))) };
}

export async function exportarTudoXlsx(db: OfficeDB, hoje = new Date()): Promise<{ blob: Blob; nome: string; folhas: number; registos: number }> {
  const folhas: Folha[] = [];
  let registos = 0;
  await db.transaction('r', TABELAS.map((t) => db.table(t)), async () => {
    for (const t of TABELAS) {
      const linhas = (await db.table(t).toArray()) as Record<string, unknown>[];
      registos += linhas.length;
      folhas.push(folhaDe(NOMES_FOLHAS[t], linhas));
    }
  });
  const d = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  return { blob: await criarXlsxFolhas(folhas), nome: `office-manager-tudo-${d}.xlsx`, folhas: folhas.length, registos };
}
