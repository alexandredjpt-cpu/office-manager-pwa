import type { Documento, EntidadeDocumento, OfficeDB } from './schema';
import { agora, novoId } from './repo';

export const LIMITE_BYTES = 25 * 1024 * 1024; // 25 MB por ficheiro
export const AVISO_TOTAL_BYTES = 200 * 1024 * 1024;
const TIPOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export function tipoPermitido(mime: string): boolean {
  return TIPOS.includes(mime);
}

/** Nome seguro para mostrar e partilhar (sem caminhos nem caracteres estranhos). */
export const limparNome = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'documento';

export async function anexarDocumento(db: OfficeDB, entidade: EntidadeDocumento, entidadeId: string, ficheiro: File, descricao = ''): Promise<Documento> {
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
    blob: new Blob([await ficheiro.arrayBuffer()], { type: ficheiro.type })
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
