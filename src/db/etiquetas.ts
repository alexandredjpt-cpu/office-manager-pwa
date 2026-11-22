import type { Localizacao } from './schema';

/**
 * Conteúdo do QR de um local: o endereço da app nesse local. Só leva o identificador interno
 * (sem nome nem dados). A câmara do telemóvel abre a app no local; o leitor da app também o reconhece.
 */
export function conteudoQrLocal(base: string, localId: string): string {
  return `${base.replace(/#.*$/, '')}#/locais/${localId}`;
}

/** Identificador do local num QR lido (aceita qualquer endereço que acabe em #/locais/<id>). */
export function localDoQr(texto: string, locais: Pick<Localizacao, 'id' | 'deletedAt'>[]): string | null {
  const m = /#\/locais\/([0-9a-fA-F-]{36})(?:[?/].*)?$/.exec(texto.trim());
  if (!m) return null;
  const l = locais.find((x) => x.id === m[1].toLowerCase() && !x.deletedAt);
  return l ? l.id : null;
}
