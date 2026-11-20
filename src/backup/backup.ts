import type JSZip from 'jszip';

// Carregado só quando é preciso (fora do arranque da app).
const carregarZip = async () => (await import('jszip')).default;
import { TABELAS, TABELAS_COM_DATA, type OfficeDB, type Fotografia, type Documento, type NomeTabela } from '../db/schema';
import { agora } from '../db/repo';
import { cifrar, decifrar, eCifrada, ErroPalavraPasse } from './cifra';
import { migrarFornecedorTexto } from '../db/stock';

export { ErroPalavraPasse };

export const FORMATO = 1;
export const APP_ID = 'office-manager-pwa';
const CHAVE_ULTIMA = 'ultimaCopia';

export interface Manifesto {
  app: typeof APP_ID;
  formato: number;
  versaoEsquema: number;
  exportadoEm: string;
  contagens: Record<string, number>;
  /** Cópia leve: sem documentos anexos. O restauro mantém os documentos existentes. */
  semDocumentos?: boolean;
}

type FotoSemBlob = Omit<Fotografia, 'blob'> & { ficheiro: string };
type DocSemBlob = Omit<Documento, 'blob'> & { ficheiro: string };

const extDoc = (nome: string) => (/\.([a-z0-9]{1,5})$/i.exec(nome)?.[1] ?? 'bin').toLowerCase();

const extensao = (mime: string) =>
  ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[mime] ?? 'bin';

/** Gera o ZIP completo (JSON + fotografias). Inclui registos eliminados logicamente. */
export async function exportarCopia(db: OfficeDB, opcoes: { semDocumentos?: boolean; palavraPasse?: string } = {}): Promise<{ blob: Blob; nome: string; manifesto: Manifesto }> {
  const leve = opcoes.semDocumentos === true;
  const zip = new (await carregarZip())();
  const exportadoEm = agora();
  const contagens: Record<string, number> = {};

  await db.transaction('r', TABELAS.map((t) => db.table(t)), async () => {
    for (const t of TABELAS) {
      if (leve && t === 'documentos') continue;
      const linhas = await db.table(t).toArray();
      contagens[t] = linhas.length;
      if (t === 'fotografias') {
        const meta: FotoSemBlob[] = (linhas as Fotografia[]).map(({ blob, ...resto }) => {
          const ficheiro = `fotos/${resto.id}.${extensao(resto.mime)}`;
          zip.file(ficheiro, blob);
          return { ...resto, ficheiro };
        });
        zip.file(`dados/${t}.json`, JSON.stringify(meta, null, 1));
      } else if (t === 'documentos') {
        const meta: DocSemBlob[] = (linhas as Documento[]).map(({ blob, ...resto }) => {
          const ficheiro = `documentos/${resto.id}.${extDoc(resto.nome)}`;
          zip.file(ficheiro, blob);
          return { ...resto, ficheiro };
        });
        zip.file(`dados/${t}.json`, JSON.stringify(meta, null, 1));
      } else {
        zip.file(`dados/${t}.json`, JSON.stringify(linhas, null, 1));
      }
    }
  });

  const manifesto: Manifesto = { app: APP_ID, formato: FORMATO, versaoEsquema: db.verno, exportadoEm, contagens, ...(leve ? { semDocumentos: true } : {}) };
  zip.file('manifesto.json', JSON.stringify(manifesto, null, 2));

  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/zip' });
  const blob = opcoes.palavraPasse ? await cifrar(zipBlob, opcoes.palavraPasse) : zipBlob;
  await db.meta.put({ chave: CHAVE_ULTIMA, valor: exportadoEm });
  const carimbo = exportadoEm.slice(0, 16).replace(/[:T]/g, '-');
  const ext = opcoes.palavraPasse ? '-cifrada.omc' : '.zip';
  return { blob, nome: `office-manager-copia${leve ? '-leve' : ''}-${carimbo}${ext}`, manifesto };
}

export class ErroCopia extends Error {}

/** Limites de segurança do restauro (cópia corrompida ou adulterada não rebenta a app). */
export const MAX_DESCOMPRIMIDO = 1.5 * 1024 ** 3;
export const MAX_LINHAS = 500_000;

/** Cada linha tem de ser um objeto; nas tabelas de registos: id único, datas em texto, deletedAt nulo ou texto. */
export function validarLinhas(t: NomeTabela, linhas: unknown[]): void {
  if (linhas.length > MAX_LINHAS) throw new ErroCopia(`dados/${t}.json tem registos a mais.`);
  const comData = (TABELAS_COM_DATA as readonly string[]).includes(t);
  const ids = new Set<string>();
  for (const [i, l] of linhas.entries()) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) throw new ErroCopia(`dados/${t}.json: registo ${i + 1} inválido.`);
    if (!comData) continue;
    const r = l as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id || r.id.length > 100) throw new ErroCopia(`dados/${t}.json: registo ${i + 1} sem identificador válido.`);
    if (ids.has(r.id)) throw new ErroCopia(`dados/${t}.json: identificador repetido (${r.id}).`);
    ids.add(r.id);
    if (typeof r.createdAt !== 'string' || typeof r.updatedAt !== 'string') throw new ErroCopia(`dados/${t}.json: registo ${r.id} sem datas.`);
    if (r.deletedAt !== null && r.deletedAt !== undefined && typeof r.deletedAt !== 'string') throw new ErroCopia(`dados/${t}.json: registo ${r.id} com estado inválido.`);
  }
}

/** Lê e valida uma cópia (ZIP, ou cifrada com palavra-passe) sem tocar na base de dados. */
export async function lerCopia(original: Blob, palavraPasse?: string): Promise<{ manifesto: Manifesto; dados: Record<NomeTabela, unknown[]> }> {
  let ficheiro = original;
  if (await eCifrada(original)) {
    if (!palavraPasse) throw new ErroPalavraPasse('Esta cópia está protegida: escreve a palavra-passe.');
    ficheiro = await decifrar(original, palavraPasse);
  }
  let zip: JSZip;
  try {
    zip = await (await carregarZip()).loadAsync(ficheiro);
  } catch {
    throw new ErroCopia('O ficheiro não é um ZIP válido.');
  }
  const total = Object.values(zip.files).reduce((t, f) => t + ((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
  if (total > MAX_DESCOMPRIMIDO) throw new ErroCopia('A cópia é demasiado grande para restaurar neste telemóvel.');
  const mf = zip.file('manifesto.json');
  if (!mf) throw new ErroCopia('Falta manifesto.json: não é uma cópia desta app.');
  const manifesto = JSON.parse(await mf.async('string')) as Manifesto;
  if (manifesto.app !== APP_ID) throw new ErroCopia('Esta cópia é de outra aplicação.');
  if (manifesto.formato > FORMATO) throw new ErroCopia('Cópia criada por uma versão mais recente da app. Atualiza a app primeiro.');

  const dados = {} as Record<NomeTabela, unknown[]>;
  for (const t of TABELAS) {
    if (manifesto.semDocumentos && t === 'documentos') { dados[t] = []; continue; }
    const f = zip.file(`dados/${t}.json`);
    const linhas = f ? (JSON.parse(await f.async('string')) as unknown[]) : [];
    if (!Array.isArray(linhas)) throw new ErroCopia(`dados/${t}.json inválido.`);
    validarLinhas(t, linhas);
    if (t === 'fotografias') {
      dados[t] = await Promise.all(
        (linhas as FotoSemBlob[]).map(async ({ ficheiro, ...resto }) => {
          const fz = zip.file(ficheiro);
          if (!fz) throw new ErroCopia(`Fotografia em falta no ZIP: ${ficheiro}`);
          const buf = await fz.async('arraybuffer');
          return { ...resto, blob: new Blob([buf], { type: resto.mime }) };
        })
      );
    } else if (t === 'documentos') {
      dados[t] = await Promise.all(
        (linhas as DocSemBlob[]).map(async ({ ficheiro, ...resto }) => {
          const fz = zip.file(ficheiro);
          if (!fz) throw new ErroCopia(`Documento em falta no ZIP: ${ficheiro}`);
          return { ...resto, blob: new Blob([await fz.async('arraybuffer')], { type: resto.mime }) };
        })
      );
    } else {
      dados[t] = linhas;
    }
    if (dados[t].length !== (manifesto.contagens[t] ?? dados[t].length)) {
      throw new ErroCopia(`Contagem de ${t} não confere com o manifesto. Ficheiro incompleto?`);
    }
  }
  return { manifesto, dados };
}

/**
 * Substitui TODOS os dados pelos da cópia, numa única transação:
 * ou entra tudo, ou nada muda.
 */
export async function restaurarCopia(db: OfficeDB, ficheiro: Blob, palavraPasse?: string): Promise<Manifesto> {
  const { manifesto, dados } = await lerCopia(ficheiro, palavraPasse);
  await db.transaction('rw', TABELAS.map((t) => db.table(t)), async () => {
    for (const t of TABELAS) {
      if (manifesto.semDocumentos && t === 'documentos') continue; // cópia leve: mantém os documentos atuais
      await db.table(t).clear();
      await db.table(t).bulkAdd(dados[t]);
    }
    // A cópia restaurada é, por definição, a última cópia existente.
    await db.meta.put({ chave: CHAVE_ULTIMA, valor: manifesto.exportadoEm });
  });
  // Cópias antigas podem trazer artigos com o fornecedor só escrito.
  await migrarFornecedorTexto(db);
  return manifesto;
}

export const DIAS_AVISO = 7;
export const ALTERACOES_AVISO = 25;

export interface EstadoCopia {
  ultima: string | null;
  alteracoesDesde: number;
  emFalta: boolean;
  motivo: string | null;
}

/** Aviso: >7 dias desde a última cópia, ou ≥25 registos alterados desde então. */
export async function estadoCopia(db: OfficeDB, hoje = new Date()): Promise<EstadoCopia> {
  const ultima = (await db.meta.get(CHAVE_ULTIMA))?.valor ?? null;
  const desde = ultima ?? '';
  let alteracoesDesde = 0;
  for (const t of TABELAS_COM_DATA) {
    alteracoesDesde += await db.table(t).filter((r: { updatedAt: string }) => r.updatedAt > desde).count();
  }
  let motivo: string | null = null;
  if (!ultima && alteracoesDesde > 0) motivo = 'Ainda não fizeste nenhuma cópia de segurança.';
  else if (ultima) {
    const dias = (hoje.getTime() - new Date(ultima).getTime()) / 86_400_000;
    if (dias >= DIAS_AVISO && alteracoesDesde > 0) motivo = `Última cópia há ${Math.floor(dias)} dias.`;
    else if (alteracoesDesde >= ALTERACOES_AVISO) motivo = `${alteracoesDesde} registos alterados desde a última cópia.`;
  }
  return { ultima, alteracoesDesde, emFalta: motivo !== null, motivo };
}
