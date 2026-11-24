import type { OfficeDB } from './schema';

/** Papel de quem usa a app. Vem do servidor quando o telemóvel está ligado. */
export type Papel = 'gestor' | 'registo' | 'consulta';

export const CHAVE_PAPEL = 'app.papel';
export const ROTULO_PAPEL: Record<Papel, string> = { gestor: 'Gestor', registo: 'Registo', consulta: 'Só consulta' };

/**
 * Sem ligação ao servidor a app é de uso local e o papel é gestor. Com ligação, o papel é o que o
 * servidor diz. Não é segurança: o cadeado a sério é o servidor recusar as escritas.
 */
export function papelDe(valor: string | undefined): Papel {
  if (valor === 'consulta' || valor === 'registo') return valor;
  return 'gestor';
}

export async function lerPapel(db: OfficeDB): Promise<Papel> {
  return papelDe((await db.meta.get(CHAVE_PAPEL))?.valor);
}

export async function guardarPapel(db: OfficeDB, papel: Papel): Promise<void> {
  await db.meta.put({ chave: CHAVE_PAPEL, valor: papel });
}

/** Tabelas que continuam a poder ser escritas em modo de consulta (definições do próprio telemóvel). */
export const TABELAS_LIVRES = new Set(['meta', 'sincronia', 'sincConflitos']);

export const ERRO_CONSULTA = 'Esta app está em modo de consulta: não podes criar, alterar nem apagar registos.';
