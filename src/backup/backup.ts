import type JSZip from 'jszip';

// Carregado só quando é preciso (fora do arranque da app).
const carregarZip = async () => (await import('jszip')).default;
import { TABELAS, type OfficeDB, type Fotografia, type NomeTabela } from '../db/schema';
import { agora } from '../db/repo';

export const FORMATO = 1;
export const APP_ID = 'office-manager-pwa';
const CHAVE_ULTIMA = 'ultimaCopia';

export interface Manifesto {
  app: typeof APP_ID;
  formato: number;
  versaoEsquema: number;
  exportadoEm: string;
  contagens: Record<string, number>;
}

type FotoSemBlob = Omit<Fotografia, 'blob'> & { ficheiro: string };

const extensao = (mime: string) =>
  ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[mime] ?? 'bin';

/** Gera o ZIP completo (JSON + fotografias). Inclui registos eliminados logicamente. */
export async function exportarCopia(db: OfficeDB): Promise<{ blob: Blob; nome: string; manifesto: Manifesto }> {
  const zip = new (await carregarZip())();
  const exportadoEm = agora();
  const contagens: Record<string, number> = {};

  await db.transaction('r', TABELAS.map((t) => db.table(t)), async () => {
    for (const t of TABELAS) {
      const linhas = await db.table(t).toArray();
      contagens[t] = linhas.length;
      if (t === 'fotografias') {
        const meta: FotoSemBlob[] = (linhas as Fotografia[]).map(({ blob, ...resto }) => {
          const ficheiro = `fotos/${resto.id}.${extensao(resto.mime)}`;
          zip.file(ficheiro, blob);
          return { ...resto, ficheiro };
        });
        zip.file(`dados/${t}.json`, JSON.stringify(meta, null, 1));
      } else {
        zip.file(`dados/${t}.json`, JSON.stringify(linhas, null, 1));
      }
    }
  });

  const manifesto: Manifesto = { app: APP_ID, formato: FORMATO, versaoEsquema: db.verno, exportadoEm, contagens };
  zip.file('manifesto.json', JSON.stringify(manifesto, null, 2));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/zip' });
  await db.meta.put({ chave: CHAVE_ULTIMA, valor: exportadoEm });
  const carimbo = exportadoEm.slice(0, 16).replace(/[:T]/g, '-');
  return { blob, nome: `office-manager-copia-${carimbo}.zip`, manifesto };
}

export class ErroCopia extends Error {}

/** Lê e valida um ZIP sem tocar na base de dados. */
export async function lerCopia(ficheiro: Blob): Promise<{ manifesto: Manifesto; dados: Record<NomeTabela, unknown[]> }> {
  let zip: JSZip;
  try {
    zip = await (await carregarZip()).loadAsync(ficheiro);
  } catch {
    throw new ErroCopia('O ficheiro não é um ZIP válido.');
  }
  const mf = zip.file('manifesto.json');
  if (!mf) throw new ErroCopia('Falta manifesto.json: não é uma cópia desta app.');
  const manifesto = JSON.parse(await mf.async('string')) as Manifesto;
  if (manifesto.app !== APP_ID) throw new ErroCopia('Esta cópia é de outra aplicação.');
  if (manifesto.formato > FORMATO) throw new ErroCopia('Cópia criada por uma versão mais recente da app. Atualiza a app primeiro.');

  const dados = {} as Record<NomeTabela, unknown[]>;
  for (const t of TABELAS) {
    const f = zip.file(`dados/${t}.json`);
    const linhas = f ? (JSON.parse(await f.async('string')) as unknown[]) : [];
    if (!Array.isArray(linhas)) throw new ErroCopia(`dados/${t}.json inválido.`);
    if (t === 'fotografias') {
      dados[t] = await Promise.all(
        (linhas as FotoSemBlob[]).map(async ({ ficheiro, ...resto }) => {
          const fz = zip.file(ficheiro);
          if (!fz) throw new ErroCopia(`Fotografia em falta no ZIP: ${ficheiro}`);
          const buf = await fz.async('arraybuffer');
          return { ...resto, blob: new Blob([buf], { type: resto.mime }) };
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
export async function restaurarCopia(db: OfficeDB, ficheiro: Blob): Promise<Manifesto> {
  const { manifesto, dados } = await lerCopia(ficheiro);
  await db.transaction('rw', TABELAS.map((t) => db.table(t)), async () => {
    for (const t of TABELAS) {
      await db.table(t).clear();
      await db.table(t).bulkAdd(dados[t]);
    }
    // A cópia restaurada é, por definição, a última cópia existente.
    await db.meta.put({ chave: CHAVE_ULTIMA, valor: manifesto.exportadoEm });
  });
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
  for (const t of ['localizacoes', 'equipamentos', 'fotografias'] as const) {
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
