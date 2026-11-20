import type { CategoriaDocumento, Documento, DocumentoLigacao, EntidadeDocumento, OfficeDB } from './schema';
import { agora, novoId } from './repo';

export const LIMITE_BYTES = 25 * 1024 * 1024; // 25 MB por ficheiro
export const AVISO_TOTAL_BYTES = 200 * 1024 * 1024;
const TIPOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export function tipoPermitido(mime: string): boolean {
  return TIPOS.includes(mime);
}

/** Nome seguro para mostrar e partilhar (sem caminhos nem caracteres estranhos). */
export const limparNome = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'documento';

export async function anexarDocumento(db: OfficeDB, entidade: EntidadeDocumento, entidadeId: string, ficheiro: File, descricao = '', categoria?: CategoriaDocumento): Promise<Documento> {
  if (categoria !== undefined && !CATEGORIAS_DOCUMENTO.includes(categoria)) throw new Error('Categoria de documento inválida.');
  if (!tipoPermitido(ficheiro.type)) throw new Error(`«${ficheiro.name}»: só se aceitam PDF e imagens (JPG, PNG, WebP).`);
  if (ficheiro.size === 0) throw new Error(`«${ficheiro.name}» está vazio.`);
  if (ficheiro.size > LIMITE_BYTES) throw new Error(`«${ficheiro.name}» tem ${(ficheiro.size / 1048576).toFixed(1)} MB; o limite é ${LIMITE_BYTES / 1048576} MB.`);
  const dono = { equipamento: db.equipamentos, fornecedor: db.fornecedores, encomenda: db.encomendas, localizacao: db.localizacoes }[entidade];
  const reg = await dono.get(entidadeId);
  if (!reg || (reg as { deletedAt: string | null }).deletedAt) throw new Error('O registo ao qual queres anexar não existe.');
  const t = agora();
  const d: Documento = {
    id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, entidade, entidadeId,
    nome: limparNome(ficheiro.name), descricao: descricao.trim(), mime: ficheiro.type, tamanho: ficheiro.size,
    blob: new Blob([await ficheiro.arrayBuffer()], { type: ficheiro.type }),
    ...(categoria ? { categoria } : {})
  };
  await db.documentos.add(d);
  return d;
}

/** Anulação lógica: o ficheiro continua nas cópias de segurança. */
export async function removerDocumento(db: OfficeDB, id: string): Promise<void> {
  const n = await db.documentos.update(id, { deletedAt: agora(), updatedAt: agora() });
  if (!n) throw new Error('O documento não existe.');
}

export async function espacoUsado(db: OfficeDB): Promise<{ ficheiros: number; bytes: number }> {
  const ativos = await db.documentos.filter((d) => !d.deletedAt).toArray();
  return { ficheiros: ativos.length, bytes: ativos.reduce((s, d) => s + d.tamanho, 0) };
}

export const formatarTamanho = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// ---------- Categorias e ligação a vários registos ----------

export const CATEGORIAS_DOCUMENTO: CategoriaDocumento[] = ['manual', 'fatura', 'garantia', 'contrato', 'outro'];
export const ROTULO_CATEGORIA: Record<CategoriaDocumento, string> = { manual: 'Manual', fatura: 'Fatura', garantia: 'Garantia', contrato: 'Contrato', outro: 'Outro' };

export async function definirCategoria(db: OfficeDB, id: string, categoria: CategoriaDocumento): Promise<void> {
  if (!CATEGORIAS_DOCUMENTO.includes(categoria)) throw new Error('Categoria de documento inválida.');
  const d = await db.documentos.get(id);
  if (!d || d.deletedAt) throw new Error('O documento não existe.');
  await db.documentos.update(id, { categoria, updatedAt: agora() });
}

export interface Alvo { entidade: EntidadeDocumento; entidadeId: string }

async function registoExiste(db: OfficeDB, a: Alvo): Promise<boolean> {
  const t = { equipamento: db.equipamentos, fornecedor: db.fornecedores, encomenda: db.encomendas, localizacao: db.localizacoes }[a.entidade];
  if (!t) return false;
  const r = (await t.get(a.entidadeId)) as { deletedAt: string | null; estado?: string } | undefined;
  return !!r && !r.deletedAt && !(a.entidade === 'equipamento' && r.estado === 'abatido');
}

/**
 * Liga um documento a outros registos sem copiar o ficheiro.
 * Ignora o próprio dono e as ligações que já existem. Devolve quantas ligações novas criou.
 */
export async function ligarDocumento(db: OfficeDB, documentoId: string, alvos: Alvo[]): Promise<number> {
  if (alvos.length > 500) throw new Error('Demasiados registos de uma vez (máx. 500).');
  return db.transaction('rw', [db.documentos, db.documentoLigacoes, db.equipamentos, db.fornecedores, db.encomendas, db.localizacoes], async () => {
    const d = await db.documentos.get(documentoId);
    if (!d || d.deletedAt) throw new Error('O documento não existe.');
    const existentes = (await db.documentoLigacoes.where('documentoId').equals(documentoId).toArray()).filter((l) => !l.deletedAt);
    const chave = (a: Alvo) => `${a.entidade}|${a.entidadeId}`;
    const ja = new Set([chave(d), ...existentes.map(chave)]);
    let n = 0;
    const t = agora();
    for (const a of alvos) {
      if (ja.has(chave(a))) continue;
      if (!(await registoExiste(db, a))) throw new Error('Um dos registos escolhidos já não existe.');
      const l: DocumentoLigacao = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, documentoId, entidade: a.entidade, entidadeId: a.entidadeId };
      await db.documentoLigacoes.add(l);
      ja.add(chave(a));
      n++;
    }
    return n;
  });
}

/** Tira o documento deste registo (só a ligação; o documento continua no dono e nos outros). */
export async function desligarDocumento(db: OfficeDB, ligacaoId: string): Promise<void> {
  const n = await db.documentoLigacoes.update(ligacaoId, { deletedAt: agora(), updatedAt: agora() });
  if (!n) throw new Error('A ligação não existe.');
}

export interface DocumentoDoRegisto { doc: Documento; ligacao: DocumentoLigacao | null }

/** Documentos de um registo: os anexados aqui e os ligados a partir de outro registo. */
export async function documentosDe(db: OfficeDB, entidade: EntidadeDocumento, entidadeId: string): Promise<DocumentoDoRegisto[]> {
  const proprios = (await db.documentos.where('[entidade+entidadeId]').equals([entidade, entidadeId]).toArray()).filter((d) => !d.deletedAt);
  const ligacoes = (await db.documentoLigacoes.where('[entidade+entidadeId]').equals([entidade, entidadeId]).toArray()).filter((l) => !l.deletedAt);
  const ligados: DocumentoDoRegisto[] = [];
  for (const l of ligacoes) {
    const d = await db.documentos.get(l.documentoId);
    if (d && !d.deletedAt) ligados.push({ doc: d, ligacao: l });
  }
  return [...proprios.map((doc) => ({ doc, ligacao: null })), ...ligados].sort((a, b) => a.doc.createdAt.localeCompare(b.doc.createdAt));
}

/** Onde mais está ligado um documento (ligações ativas). */
export async function ligacoesDoDocumento(db: OfficeDB, documentoId: string): Promise<DocumentoLigacao[]> {
  return (await db.documentoLigacoes.where('documentoId').equals(documentoId).toArray()).filter((l) => !l.deletedAt);
}

const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
/** Equipamentos iguais (mesmo nome, marca e modelo), ativos ou desativados, sem o próprio. */
export function equipamentosIguais<T extends { id: string; nome: string; marca: string; modelo: string; deletedAt: string | null; estado: string }>(todos: T[], ref: T): T[] {
  const k = (e: T) => [e.nome, e.marca, e.modelo].map(norm).join('|');
  return todos.filter((e) => e.id !== ref.id && !e.deletedAt && e.estado !== 'abatido' && k(e) === k(ref));
}
