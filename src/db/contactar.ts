import type { Anomalia, Contacto, Fornecedor } from './schema';
import { numeroWhatsApp } from './emails';

/** Pessoa ou empresa a quem se pode ligar ou escrever a partir de um registo. */
export interface Destino { chave: string; nome: string; detalhe: string; telefone: string; email: string }

/** Contactos e fornecedores com telefone ou e-mail, por nome. */
export function destinosContacto(contactos: Contacto[], fornecedores: Fornecedor[]): Destino[] {
  const d: Destino[] = [
    ...contactos.filter((c) => !c.deletedAt).flatMap((c) => {
      const empresa = fornecedores.find((f) => f.id === c.fornecedorId && !f.deletedAt)?.nome;
      const detalhe = [c.funcao || 'Contacto', empresa].filter(Boolean).join(' · ');
      const principal: Destino = { chave: `c:${c.id}`, nome: c.nome, detalhe, telefone: c.telefone.trim(), email: c.email.trim() };
      // Segundo número/e-mail: um destino à parte, para cada canal ter o seu botão.
      const temSegundo = !!(c.telefone2?.trim() || c.email2?.trim());
      const segundo: Destino[] = temSegundo
        ? [{ chave: `c2:${c.id}`, nome: c.nome, detalhe: `${detalhe} · 2.º contacto`, telefone: (c.telefone2 ?? '').trim(), email: (c.email2 ?? '').trim() }]
        : [];
      return [principal, ...segundo];
    }),
    ...fornecedores.filter((f) => !f.deletedAt).map((f) => ({ chave: `f:${f.id}`, nome: f.nome, detalhe: f.contacto ? `Fornecedor · ${f.contacto}` : 'Fornecedor', telefone: f.telefone.trim(), email: f.email.trim() }))
  ];
  return d.filter((x) => x.telefone || x.email).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}

/** Ligação tel: (só +, algarismos); null se não parecer um número. */
export function telHref(tel: string): string | null {
  const t = tel.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return /^\+?\d{3,15}$/.test(t) ? `tel:${t}` : null;
}

export const temWhatsApp = (tel: string) => numeroWhatsApp(tel) !== null;

/** Mensagem curta sobre a anomalia (editável antes de abrir o WhatsApp). */
export function textoAnomalia(a: Pick<Anomalia, 'codigo' | 'titulo'>, para: string, local: string, equipamento: string, responsavel: string): string {
  const onde = [local, equipamento].filter(Boolean).join(' · ');
  return `${para ? `Olá ${para}, ` : 'Olá, '}temos uma avaria: ${a.titulo}${onde ? ` (${onde})` : ''}. Ref.ª ${a.codigo}. Quando é que podem ver?${responsavel ? ` — ${responsavel}` : ''}`;
}
