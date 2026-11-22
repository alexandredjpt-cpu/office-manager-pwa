import type { OfficeDB, ProdutoHavi } from './schema';
import { agora, novoId } from './repo';

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const META_DESTINATARIOS = 'havi.destinatarios';
const META_MODELO = 'havi.modelo';
const META_RASCUNHO = 'havi.rascunho';
/** Chaves antigas (só neste browser); migradas para a BD para entrarem na cópia de segurança. */
const ANTIGAS = { lista: 'om.havi.destinatarios', um: 'om.havi.email' };

/** Texto base do e-mail. {{data}} = dia de entrega; {{produtos}} = linhas do pedido. O utilizador pode trocá-lo no ecrã. */
export const MODELO_HAVI_PADRAO = 'Bom dia,\n\nAgradeço a entrega dos produtos abaixo, na descarga de dia {{data}}.\n\nProdutos:\n{{produtos}}\n\nObrigado';

export interface DefinicoesHavi { destinatarios: string[]; modelo: string; rascunho: Record<string, number> }

function jsonOu<T>(texto: string | undefined, base: T): T {
  if (!texto) return base;
  try { return JSON.parse(texto) as T; } catch { return base; }
}

/** Destinatários (1.º = «Para», restantes = «Cópia»), texto do e-mail e quantidades por acabar. Tudo na BD local. */
export async function lerDefinicoesHavi(db: OfficeDB): Promise<DefinicoesHavi> {
  const [d, m, r] = await Promise.all([db.meta.get(META_DESTINATARIOS), db.meta.get(META_MODELO), db.meta.get(META_RASCUNHO)]);
  return { destinatarios: jsonOu<string[]>(d?.valor, []), modelo: m?.valor || MODELO_HAVI_PADRAO, rascunho: jsonOu<Record<string, number>>(r?.valor, {}) };
}

/** Passa os destinatários guardados pela versão anterior (localStorage) para a BD. Corre uma vez; não apaga nada que já exista. */
export async function migrarDefinicoesHavi(db: OfficeDB): Promise<void> {
  if (await db.meta.get(META_DESTINATARIOS)) return;
  let lista: string[] = [];
  try {
    lista = jsonOu<string[]>(localStorage.getItem(ANTIGAS.lista) ?? undefined, []);
    const um = localStorage.getItem(ANTIGAS.um);
    if (lista.length === 0 && um) lista = [um];
  } catch { /* armazenamento indisponível */ }
  if (lista.length) await db.meta.put({ chave: META_DESTINATARIOS, valor: JSON.stringify(lista) });
}

export async function guardarDestinatariosHavi(db: OfficeDB, lista: string[]): Promise<void> {
  await db.meta.put({ chave: META_DESTINATARIOS, valor: JSON.stringify(lista) });
}

export async function guardarModeloHavi(db: OfficeDB, texto: string): Promise<void> {
  await db.meta.put({ chave: META_MODELO, valor: texto.trim() ? texto : MODELO_HAVI_PADRAO });
}

export async function guardarRascunhoHavi(db: OfficeDB, qtd: Record<string, number>): Promise<void> {
  const limpo = Object.fromEntries(Object.entries(qtd).filter(([, q]) => q > 0));
  await db.meta.put({ chave: META_RASCUNHO, valor: JSON.stringify(limpo) });
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

/** AAAA-MM-DD no fuso do telemóvel. */
export function isoDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Lê AAAA-MM-DD como dia local (sem saltar de dia por causa do fuso). */
export function diaDeIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A HAVI só entrega à terça (2) e à sexta (5). */
export const diaDeEntregaHavi = (d: Date) => d.getDay() === 2 || d.getDay() === 5;

export function linhasDoPedido(linhas: LinhaPedido[]): string {
  return ['Código --- Qtd --- Descrição', ...linhas.map((l) => `${l.codigo} --- ${l.quantidade} --- ${l.nome}`)].join('\n');
}

/** E-mail do pedido: o texto do utilizador com {{data}} e {{produtos}} preenchidos. Sem {{produtos}}, a lista vai no fim. */
export function montarEmailHavi(linhas: LinhaPedido[], entrega: Date, modelo: string = MODELO_HAVI_PADRAO): { assunto: string; corpo: string } {
  const data = entrega.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' });
  const semana = entrega.toLocaleDateString('pt-PT', { weekday: 'long' });
  const produtos = linhasDoPedido(linhas);
  const base = modelo.trim() || MODELO_HAVI_PADRAO;
  const comData = base.replace(/\{\{\s*data\s*\}\}/g, data);
  const corpo = /\{\{\s*produtos\s*\}\}/.test(comData) ? comData.replace(/\{\{\s*produtos\s*\}\}/g, produtos) : `${comData}\n\n${produtos}`;
  return { assunto: `Encomenda para entrega ${semana}, ${data}`, corpo };
}

/** Regista o pedido preparado. Repetir o mesmo pedido (mesma entrega e linhas) não duplica o registo. */
export async function registarPedidoHavi(db: OfficeDB, entrega: string, linhas: LinhaPedido[]): Promise<void> {
  if (linhas.length === 0) return;
  const t = agora();
  await db.transaction('rw', db.pedidosHavi, async () => {
    const ultimo = (await db.pedidosHavi.orderBy('createdAt').reverse().filter((p) => !p.deletedAt).first());
    if (ultimo && ultimo.entrega === entrega && JSON.stringify(ultimo.linhas) === JSON.stringify(linhas)) return;
    await db.pedidosHavi.add({ id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, entrega, linhas });
  });
}
