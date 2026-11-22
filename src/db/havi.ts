import type { OfficeDB, ProdutoHavi } from './schema';
import { agora, novoId } from './repo';

const CHAVE_DESTINATARIOS = 'om.havi.destinatarios';
const CHAVE_EMAIL_ANTIGO = 'om.havi.email';
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Destinatários das encomendas HAVI: o primeiro é «Para», os restantes são «Cópia».
 * Ficam só neste telemóvel (não vão para o código nem para as cópias públicas).
 */
export function lerDestinatariosHavi(): string[] {
  try {
    const raw = localStorage.getItem(CHAVE_DESTINATARIOS);
    if (raw) return JSON.parse(raw) as string[];
    const antigo = localStorage.getItem(CHAVE_EMAIL_ANTIGO);
    return antigo ? [antigo] : [];
  } catch { return []; }
}

export function guardarDestinatariosHavi(lista: string[]): void {
  try { localStorage.setItem(CHAVE_DESTINATARIOS, JSON.stringify(lista)); } catch { /* armazenamento indisponível */ }
}

export function emailValido(e: string): boolean {
  return EMAIL_VALIDO.test(e.trim());
}

/** mailto com «Para» e «Cópia». A app não envia: só abre a tua app de e-mail. */
export function montarMailtoHavi(destinatarios: string[], assunto: string, corpo: string): string {
  const [para, ...cc] = destinatarios;
  const enc = (t: string) => encodeURIComponent(t).replace(/%40/g, '@');
  const cabecalhos = [cc.length ? `cc=${enc(cc.join(','))}` : '', `subject=${encodeURIComponent(assunto)}`, `body=${encodeURIComponent(corpo)}`].filter(Boolean).join('&');
  return `mailto:${enc(para)}?${cabecalhos}`;
}

const UNIDADES = new Set(['cx', 'un', 'pac']);

/** Código sem pontos nem espaços: «09211.780» → «09211780», «2627 010» → «2627010». */
export function normalizarCodigo(c: string): string {
  return c.replace(/[\s.]/g, '');
}

export interface LinhaImport { codigo: string; nome: string }

/**
 * Lê linhas coladas do Word/Excel. Formato aceite: «CÓDIGO [QTD] [UNIDADE] NOME».
 * A quantidade e a unidade são ignoradas (são do pedido, não do produto).
 * Linhas sem código numérico (cabeçalhos, texto livre) são saltadas.
 */
export function lerTabelaHavi(texto: string): LinhaImport[] {
  const out: LinhaImport[] = [];
  for (const bruto of texto.split(/\r?\n/)) {
    const t = bruto.trim().split(/\s+/).filter(Boolean);
    if (t.length < 2 || !/^[\d.]+$/.test(t[0])) continue;
    let codigo = normalizarCodigo(t[0]);
    let i = 1;
    // «2627 010» é um só código: um grupo de 3 dígitos seguido de números.
    if (/^\d{3}$/.test(t[1] ?? '') && /^\d+$/.test(t[2] ?? '')) { codigo += t[1]; i = 2; }
    if (/^\d+$/.test(t[i] ?? '')) i++;
    if (UNIDADES.has((t[i] ?? '').toLowerCase())) i++;
    const nome = t.slice(i).join(' ').trim();
    if (codigo && nome) out.push({ codigo, nome });
  }
  return out;
}

/** Importa linhas coladas: cria os produtos novos e atualiza o nome dos que já existem. */
export async function importarTabelaHavi(db: OfficeDB, texto: string): Promise<{ novos: number; atualizados: number }> {
  const linhas = lerTabelaHavi(texto);
  const t = agora();
  let novos = 0;
  let atualizados = 0;
  await db.transaction('rw', db.produtosHavi, async () => {
    const atuais = (await db.produtosHavi.toArray()).filter((p) => !p.deletedAt);
    for (const l of linhas) {
      const ex = atuais.find((p) => p.codigo === l.codigo);
      if (ex) {
        if (ex.nome !== l.nome) { await db.produtosHavi.update(ex.id, { nome: l.nome, updatedAt: t }); ex.nome = l.nome; atualizados++; }
      } else {
        const p: ProdutoHavi = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, codigo: l.codigo, nome: l.nome };
        await db.produtosHavi.add(p);
        atuais.push(p);
        novos++;
      }
    }
  });
  return { novos, atualizados };
}

/** Criar ou editar um produto do catálogo. O código tem de ser único. */
export async function guardarProdutoHavi(db: OfficeDB, id: string | null, codigo: string, nome: string): Promise<void> {
  const c = normalizarCodigo(codigo);
  const n = nome.trim();
  if (!c) throw new Error('O produto precisa de um código.');
  if (!n) throw new Error('O produto precisa de um nome.');
  const t = agora();
  const dup = (await db.produtosHavi.where('codigo').equals(c).toArray()).find((p) => !p.deletedAt && p.id !== id);
  if (dup) throw new Error(`O código ${c} já existe (${dup.nome}).`);
  if (id) { await db.produtosHavi.update(id, { codigo: c, nome: n, updatedAt: t }); return; }
  await db.produtosHavi.add({ id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, codigo: c, nome: n });
}

export async function removerProdutoHavi(db: OfficeDB, id: string): Promise<void> {
  await db.produtosHavi.update(id, { deletedAt: agora(), updatedAt: agora() });
}

/**
 * Próxima entrega HAVI (terça e sexta). Enviado segunda ou terça → sexta da mesma semana;
 * enviado de quarta a domingo → terça seguinte.
 */
export function proximaEntrega(envio: Date): Date {
  const d = new Date(envio.getFullYear(), envio.getMonth(), envio.getDate());
  const dia = d.getDay();
  const somar = dia === 1 || dia === 2 ? 5 - dia : (2 - dia + 7) % 7;
  d.setDate(d.getDate() + somar);
  return d;
}

/** Ordem escolhida pelo utilizador; sem ordem, vai para o fim, por nome. */
export function ordenarProdutos(lista: ProdutoHavi[]): ProdutoHavi[] {
  const fim = Number.MAX_SAFE_INTEGER;
  return [...lista].sort((a, b) => (a.ordem ?? fim) - (b.ordem ?? fim) || a.nome.localeCompare(b.nome, 'pt'));
}

/** Sobe (-1) ou desce (+1) um produto. Renumera o catálogo inteiro para ficar estável. */
export async function moverProdutoHavi(db: OfficeDB, id: string, direcao: -1 | 1): Promise<void> {
  const t = agora();
  await db.transaction('rw', db.produtosHavi, async () => {
    const lista = ordenarProdutos((await db.produtosHavi.toArray()).filter((p) => !p.deletedAt));
    const i = lista.findIndex((p) => p.id === id);
    const j = i + direcao;
    if (i < 0 || j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    for (let k = 0; k < lista.length; k++) {
      if (lista[k].ordem !== k) await db.produtosHavi.update(lista[k].id, { ordem: k, updatedAt: t });
    }
  });
}

export interface LinhaPedido { codigo: string; nome: string; quantidade: number }

/** Texto do e-mail: cabeçalho, data de entrega e uma linha por produto com quantidade. */
export function montarEmailHavi(linhas: LinhaPedido[], envio: Date): { entrega: Date; assunto: string; corpo: string } {
  const entrega = proximaEntrega(envio);
  const data = entrega.toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: '2-digit' });
  const assunto = `Encomenda HAVI — entrega ${data}`;
  const tabela = ['Código --- Qtd --- Descrição', ...linhas.map((l) => `${l.codigo} --- ${l.quantidade} --- ${l.nome}`)].join('\n');
  const corpo = `Boa tarde,\n\nSegue encomenda para entrega ${data} na abóboda.\n\n${tabela}\n\nObrigado.`;
  return { entrega, assunto, corpo };
}
