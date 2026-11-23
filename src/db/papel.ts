import type { OfficeDB } from './schema';

/** Papel de quem usa a app neste telemóvel. */
export type Papel = 'gestor' | 'consulta';

export const CHAVE_PAPEL = 'app.papel';
export const ROTULO_PAPEL: Record<Papel, string> = { gestor: 'Gestor', consulta: 'Só consulta' };

/**
 * Enquanto não há servidor, o papel é uma definição deste telemóvel e serve para preparar e
 * experimentar o modo de consulta. Não é segurança: o cadeado a sério é o servidor recusar
 * as escritas de quem é de consulta.
 */
export function papelDe(valor: string | undefined): Papel {
  return valor === 'consulta' ? 'consulta' : 'gestor';
}

export async function lerPapel(db: OfficeDB): Promise<Papel> {
  return papelDe((await db.meta.get(CHAVE_PAPEL))?.valor);
}

export async function guardarPapel(db: OfficeDB, papel: Papel): Promise<void> {
  await db.meta.put({ chave: CHAVE_PAPEL, valor: papel });
}

/** Tabelas que continuam a poder ser escritas em modo de consulta (definições do próprio telemóvel). */
export const TABELAS_LIVRES = new Set(['meta']);

export const ERRO_CONSULTA = 'Esta app está em modo de consulta: não podes criar, alterar nem apagar registos.';
