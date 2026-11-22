import type { Catalogo, OfficeDB, PedidoHavi, ProdutoHavi } from './schema';
import type { Evento } from './agenda';
import { agora, novoId } from './repo';

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Definições da primeira caixa (HAVI), antes de haver várias. Migradas na primeira abertura. */
const META_ANTIGAS = { destinatarios: 'havi.destinatarios', modelo: 'havi.modelo', rascunho: 'havi.rascunho' };
const META_MIGRADO = 'catalogos.migrado';
/** Chaves ainda mais antigas, só neste browser. */
const LOCAIS_ANTIGAS = { lista: 'om.havi.destinatarios', um: 'om.havi.email' };

/** Texto base do e-mail. {{data}} = dia de entrega; {{produtos}} = linhas do pedido. */
export const MODELO_PADRAO = 'Bom dia,\n\nAgradeço a entrega dos produtos abaixo, na descarga de dia {{data}}.\n\nProdutos:\n{{produtos}}\n\nObrigado';

/** Texto base do e-mail de falta na entrega. */
export const MODELO_FALTA_PADRAO = 'Bom dia,\n\nNa entrega de {{data}} faltaram os produtos abaixo.\n\n{{produtos}}\n\nAgradeço o envio na próxima entrega.\n\nObrigado';

export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function jsonOu<T>(texto: string | undefined | null, base: T): T {
  if (!texto) return base;
  try { return JSON.parse(texto) as T; } catch { return base; }
}

// ----- caixas -----

const semAcentos = (s: string) => s.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const igual = (a: string, b: string) => semAcentos(a) === semAcentos(b);

export function ordenarCatalogos(lista: Catalogo[]): Catalogo[] {
  const fim = Number.MAX_SAFE_INTEGER;
  return [...lista].filter((c) => !c.deletedAt).sort((a, b) => (a.ordem ?? fim) - (b.ordem ?? fim) || a.nome.localeCompare(b.nome, 'pt'));
}

/** Cria uma caixa. O nome tem de ser único (sem distinguir maiúsculas nem acentos). */
export async function criarCatalogo(db: OfficeDB, nome: string, extra: Partial<Catalogo> = {}): Promise<Catalogo> {
  const n = nome.trim();
  if (!n) throw new Error('A caixa precisa de um nome.');
  const t = agora();
  const novo: Catalogo = {
    id: novoId(), createdAt: t, updatedAt: t, deletedAt: null,
    destinatarios: [], modelo: MODELO_PADRAO, rascunho: {}, diasEntrega: [], antecedencia: 0, ordem: 0, ...extra, nome: n
  };
  await db.transaction('rw', db.catalogos, async () => {
    const atuais = ordenarCatalogos(await db.catalogos.toArray());
    if (atuais.some((c) => igual(c.nome, n))) throw new Error(`Já existe uma caixa chamada ${n}.`);
    novo.ordem = extra.ordem ?? atuais.length;
    await db.catalogos.add(novo);
  });
  return novo;
}

/** Altera campos de uma caixa. O nome continua a ter de ser único. */
export async function guardarCatalogo(db: OfficeDB, id: string, campos: Partial<Omit<Catalogo, 'id' | 'createdAt'>>): Promise<void> {
  const t = agora();
  await db.transaction('rw', db.catalogos, async () => {
    const atual = await db.catalogos.get(id);
    if (!atual || atual.deletedAt) throw new Error('A caixa já não existe.');
    let mudancas = campos;
    if (campos.nome !== undefined) {
      const n = campos.nome.trim();
      if (!n) throw new Error('A caixa precisa de um nome.');
      const outras = ordenarCatalogos(await db.catalogos.toArray()).filter((c) => c.id !== id);
      if (outras.some((c) => igual(c.nome, n))) throw new Error(`Já existe uma caixa chamada ${n}.`);
      mudancas = { ...campos, nome: n };
    }
    await db.catalogos.update(id, { ...mudancas, updatedAt: t });
  });
}

/** Apaga a caixa e, com ela, o catálogo e os pedidos (apagar lógico: nada é removido do disco). */
export async function removerCatalogo(db: OfficeDB, id: string): Promise<void> {
  const t = agora();
  await db.transaction('rw', [db.catalogos, db.produtosHavi, db.pedidosHavi], async () => {
    await db.catalogos.update(id, { deletedAt: t, updatedAt: t });
    for (const l of await db.produtosHavi.where('catalogoId').equals(id).toArray()) {
      if (!l.deletedAt) await db.produtosHavi.update(l.id, { deletedAt: t, updatedAt: t });
    }
    for (const l of await db.pedidosHavi.where('catalogoId').equals(id).toArray()) {
      if (!l.deletedAt) await db.pedidosHavi.update(l.id, { deletedAt: t, updatedAt: t });
    }
  });
}

/**
 * Passa a caixa única da HAVI (definições soltas e produtos sem caixa) para a lista de caixas e,
 * na primeira vez, cria as caixas pedidas que ainda não existam. Também adota produtos sem caixa
 * vindos do restauro de uma cópia de segurança anterior a esta versão.
 */
export async function migrarParaCatalogos(db: OfficeDB, extras: string[] = []): Promise<void> {
  const jaMigrou = (await db.meta.get(META_MIGRADO))?.valor === '1';
  const orfaosProd = (await db.produtosHavi.toArray()).filter((p) => !p.catalogoId);
  const orfaosPed = (await db.pedidosHavi.toArray()).filter((p) => !p.catalogoId);
  const metas = await Promise.all([db.meta.get(META_ANTIGAS.destinatarios), db.meta.get(META_ANTIGAS.modelo), db.meta.get(META_ANTIGAS.rascunho)]);
  let destinatarios = jsonOu<string[]>(metas[0]?.valor, []);
  if (destinatarios.length === 0) {
    try {
      destinatarios = jsonOu<string[]>(localStorage.getItem(LOCAIS_ANTIGAS.lista), []);
      const um = localStorage.getItem(LOCAIS_ANTIGAS.um);
      if (destinatarios.length === 0 && um) destinatarios = [um];
    } catch { /* armazenamento indisponível */ }
  }
  const definicoesSoltas = destinatarios.length > 0 || !!metas[1] || !!metas[2];
  if (orfaosProd.length > 0 || orfaosPed.length > 0 || definicoesSoltas) {
    const existentes = ordenarCatalogos(await db.catalogos.toArray());
    const havi = existentes.find((c) => igual(c.nome, 'HAVI')) ?? await criarCatalogo(db, 'HAVI', {
      destinatarios, modelo: metas[1]?.valor || MODELO_PADRAO, rascunho: jsonOu<Record<string, number>>(metas[2]?.valor, {}),
      diasEntrega: [2, 5], antecedencia: 2
    });
    const t = agora();
    await db.transaction('rw', [db.produtosHavi, db.pedidosHavi, db.meta], async () => {
      for (const p of orfaosProd) await db.produtosHavi.update(p.id, { catalogoId: havi.id, updatedAt: t });
      for (const p of orfaosPed) await db.pedidosHavi.update(p.id, { catalogoId: havi.id, updatedAt: t });
      for (const chave of Object.values(META_ANTIGAS)) await db.meta.delete(chave);
    });
  }
  if (!jaMigrou) {
    const nomes = ordenarCatalogos(await db.catalogos.toArray()).map((c) => c.nome);
    for (const nome of extras) if (!nomes.some((n) => igual(n, nome))) await criarCatalogo(db, nome);
    await db.meta.put({ chave: META_MIGRADO, valor: '1' });
  }
}

// ----- destinatários e e-mail -----

export function emailValido(e: string): boolean {
  return EMAIL_VALIDO.test(e.trim());
}

/** mailto com «Para» e «Cópia». A app não envia: só abre a tua app de e-mail. */
export function montarMailto(destinatarios: string[], assunto: string, corpo: string): string {
  const [para, ...cc] = destinatarios;
  const enc = (t: string) => encodeURIComponent(t).replace(/%40/g, '@');
  const cabecalhos = [cc.length ? `cc=${enc(cc.join(','))}` : '', `subject=${encodeURIComponent(assunto)}`, `body=${encodeURIComponent(corpo)}`].filter(Boolean).join('&');
  return `mailto:${enc(para)}?${cabecalhos}`;
}

// ----- catálogo de produtos -----

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
export function lerTabela(texto: string): LinhaImport[] {
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

/** Importa linhas coladas para uma caixa: cria os produtos novos e atualiza o nome dos que já existem. */
export async function importarTabela(db: OfficeDB, catalogoId: string, texto: string): Promise<{ novos: number; atualizados: number }> {
  const linhas = lerTabela(texto);
  const t = agora();
  let novos = 0;
  let atualizados = 0;
  await db.transaction('rw', db.produtosHavi, async () => {
    const atuais = (await db.produtosHavi.where('catalogoId').equals(catalogoId).toArray()).filter((p) => !p.deletedAt);
    for (const l of linhas) {
      const ex = atuais.find((p) => p.codigo === l.codigo);
      if (ex) {
        if (ex.nome !== l.nome) { await db.produtosHavi.update(ex.id, { nome: l.nome, updatedAt: t }); ex.nome = l.nome; atualizados++; }
      } else {
        const p: ProdutoHavi = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, catalogoId, codigo: l.codigo, nome: l.nome };
        await db.produtosHavi.add(p);
        atuais.push(p);
        novos++;
      }
    }
  });
  return { novos, atualizados };
}

/** Criar ou editar um produto. O código tem de ser único dentro da caixa. */
export async function guardarProduto(db: OfficeDB, catalogoId: string, id: string | null, codigo: string, nome: string, habitual?: number): Promise<void> {
  const c = normalizarCodigo(codigo);
  const n = nome.trim();
  const h = habitual && habitual > 0 ? Math.floor(habitual) : undefined;
  if (!c) throw new Error('O produto precisa de um código.');
  if (!n) throw new Error('O produto precisa de um nome.');
  const t = agora();
  const dup = (await db.produtosHavi.where('catalogoId').equals(catalogoId).toArray()).find((p) => !p.deletedAt && p.codigo === c && p.id !== id);
  if (dup) throw new Error(`O código ${c} já existe nesta caixa (${dup.nome}).`);
  if (id) { await db.produtosHavi.update(id, { codigo: c, nome: n, habitual: h, updatedAt: t }); return; }
  await db.produtosHavi.add({ id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, catalogoId, codigo: c, nome: n, ...(h ? { habitual: h } : {}) });
}

/** As quantidades do pedido atual passam a ser as habituais (os produtos sem quantidade deixam de ter habitual). */
export async function guardarHabituais(db: OfficeDB, catalogoId: string, qtd: Record<string, number>): Promise<number> {
  const t = agora();
  let n = 0;
  await db.transaction('rw', db.produtosHavi, async () => {
    for (const p of await db.produtosHavi.where('catalogoId').equals(catalogoId).toArray()) {
      if (p.deletedAt) continue;
      const h = qtd[p.id] > 0 ? Math.floor(qtd[p.id]) : undefined;
      if (h) n++;
      if (p.habitual !== h) await db.produtosHavi.update(p.id, { habitual: h, updatedAt: t });
    }
  });
  return n;
}

/** Quantidades habituais por produto (só os que têm). */
export function habituaisDe(produtos: ProdutoHavi[]): Record<string, number> {
  return Object.fromEntries(produtos.filter((p) => !p.deletedAt && (p.habitual ?? 0) > 0).map((p) => [p.id, p.habitual as number]));
}

export async function removerProduto(db: OfficeDB, id: string): Promise<void> {
  await db.produtosHavi.update(id, { deletedAt: agora(), updatedAt: agora() });
}

/** Ordem escolhida pelo utilizador; sem ordem, vai para o fim, por nome. */
export function ordenarProdutos(lista: ProdutoHavi[]): ProdutoHavi[] {
  const fim = Number.MAX_SAFE_INTEGER;
  return [...lista].sort((a, b) => (a.ordem ?? fim) - (b.ordem ?? fim) || a.nome.localeCompare(b.nome, 'pt'));
}

/** Sobe (-1) ou desce (+1) um produto. Renumera a caixa inteira para ficar estável. */
export async function moverProduto(db: OfficeDB, catalogoId: string, id: string, direcao: -1 | 1): Promise<void> {
  const t = agora();
  await db.transaction('rw', db.produtosHavi, async () => {
    const lista = ordenarProdutos((await db.produtosHavi.where('catalogoId').equals(catalogoId).toArray()).filter((p) => !p.deletedAt));
    const i = lista.findIndex((p) => p.id === id);
    const j = i + direcao;
    if (i < 0 || j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    for (let k = 0; k < lista.length; k++) {
      if (lista[k].ordem !== k) await db.produtosHavi.update(lista[k].id, { ordem: k, updatedAt: t });
    }
  });
}

// ----- datas de entrega -----

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

export const diaDeEntrega = (d: Date, dias: number[]) => dias.length === 0 || dias.includes(d.getDay());

/**
 * Próxima entrega possível: conta a antecedência que o fornecedor precisa e avança até
 * um dia de entrega. Com a HAVI (terça e sexta, 2 dias), enviar à segunda ou terça dá sexta,
 * e enviar de quarta a domingo dá a terça seguinte.
 */
export function proximaEntrega(envio: Date, dias: number[] = [], antecedencia = 0): Date {
  const d = new Date(envio.getFullYear(), envio.getMonth(), envio.getDate() + Math.max(0, antecedencia));
  for (let i = 0; i < 7 && !diaDeEntrega(d, dias); i++) d.setDate(d.getDate() + 1);
  return d;
}

// ----- pedido -----

export interface LinhaPedido { codigo: string; nome: string; quantidade: number }

export function linhasDoPedido(linhas: LinhaPedido[], rotulo = 'Qtd'): string {
  return [`Código --- ${rotulo} --- Descrição`, ...linhas.map((l) => `${l.codigo} --- ${l.quantidade} --- ${l.nome}`)].join('\n');
}

/** E-mail do pedido: o texto do utilizador com {{data}} e {{produtos}} preenchidos. Sem {{produtos}}, a lista vai no fim. */
export function montarEmail(linhas: LinhaPedido[], entrega: Date, modelo: string = MODELO_PADRAO): { assunto: string; corpo: string } {
  const data = entrega.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' });
  const semana = entrega.toLocaleDateString('pt-PT', { weekday: 'long' });
  const produtos = linhasDoPedido(linhas);
  const base = modelo.trim() || MODELO_PADRAO;
  const comData = base.replace(/\{\{\s*data\s*\}\}/g, data);
  const corpo = /\{\{\s*produtos\s*\}\}/.test(comData) ? comData.replace(/\{\{\s*produtos\s*\}\}/g, produtos) : `${comData}\n\n${produtos}`;
  return { assunto: `Encomenda para entrega ${semana}, ${data}`, corpo };
}

/** Regista o pedido preparado. Repetir o mesmo pedido (mesma entrega e linhas) não duplica o registo. */
export async function registarPedido(db: OfficeDB, catalogoId: string, entrega: string, linhas: LinhaPedido[]): Promise<void> {
  if (linhas.length === 0) return;
  const t = agora();
  await db.transaction('rw', db.pedidosHavi, async () => {
    const anteriores = (await db.pedidosHavi.where('catalogoId').equals(catalogoId).toArray()).filter((p) => !p.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const ultimo = anteriores[anteriores.length - 1];
    if (ultimo && ultimo.entrega === entrega && JSON.stringify(ultimo.linhas) === JSON.stringify(linhas)) return;
    await db.pedidosHavi.add({ id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, catalogoId, entrega, linhas });
  });
}

/**
 * Lembretes para a Agenda, um por dia de entrega da caixa: nesse dia ainda vais a tempo da
 * entrega seguinte. Não aparece se já houver um pedido preparado para essa entrega.
 */
export function lembretesCatalogo(cat: Catalogo, hoje: Date, pedidos: Pick<PedidoHavi, 'entrega' | 'catalogoId' | 'deletedAt'>[], dias = 14): Evento[] {
  if (cat.deletedAt || cat.diasEntrega.length === 0) return [];
  const feitos = new Set(pedidos.filter((p) => !p.deletedAt && p.catalogoId === cat.id).map((p) => p.entrega));
  const ev: Evento[] = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + i);
    if (!cat.diasEntrega.includes(d.getDay())) continue;
    const entrega = proximaEntrega(d, cat.diasEntrega, cat.antecedencia);
    if (feitos.has(isoDia(entrega))) continue;
    const data = isoDia(d);
    ev.push({
      chave: `catalogo-${cat.id}-${data}`, tipo: 'lembrete', data, alertaDesde: data,
      titulo: `Encomendar à ${cat.nome} para chegar ${entrega.toLocaleDateString('pt-PT', { weekday: 'long' })}`,
      detalhe: `${cat.nome} · entrega ${entrega.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' })}`,
      rota: `/catalogos/${cat.id}`
    });
  }
  return ev;
}

// ----- conferir a entrega -----

/** Guarda o que chegou. Quantidades acima da pedida não contam como entrega a mais. */
export async function conferirPedido(db: OfficeDB, pedidoId: string, recebido: Record<string, number>): Promise<void> {
  const t = agora();
  const p = await db.pedidosHavi.get(pedidoId);
  if (!p || p.deletedAt) throw new Error('O pedido já não existe.');
  const limpo: Record<string, number> = {};
  for (const l of p.linhas) limpo[l.codigo] = Math.max(0, Math.min(l.quantidade, Math.floor(recebido[l.codigo] ?? 0)));
  await db.pedidosHavi.update(pedidoId, { recebido: limpo, conferidoEm: t, updatedAt: t });
}

/** O que ficou por entregar. Vazio = chegou tudo (ou ainda não foi conferido). */
export function faltasDe(p: Pick<PedidoHavi, 'linhas' | 'recebido'>): LinhaPedido[] {
  if (!p.recebido) return [];
  return p.linhas
    .map((l) => ({ ...l, quantidade: l.quantidade - (p.recebido?.[l.codigo] ?? 0) }))
    .filter((l) => l.quantidade > 0);
}

/** E-mail a reclamar o que faltou na entrega. */
export function montarEmailFalta(faltas: LinhaPedido[], entrega: Date, modelo?: string): { assunto: string; corpo: string } {
  const data = entrega.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' });
  const produtos = linhasDoPedido(faltas, 'Em falta');
  const base = (modelo ?? '').trim() || MODELO_FALTA_PADRAO;
  const comData = base.replace(/\{\{\s*data\s*\}\}/g, data);
  const corpo = /\{\{\s*produtos\s*\}\}/.test(comData) ? comData.replace(/\{\{\s*produtos\s*\}\}/g, produtos) : `${comData}\n\n${produtos}`;
  return { assunto: `Falta na entrega de ${data}`, corpo };
}

// ----- o que costumas pedir -----

export interface Habito { vezes: number; normal: number }

/**
 * Por código: em quantos pedidos entrou e a quantidade que pedes mais vezes
 * (em caso de empate, a mais recente). Conta só os pedidos recebidos na lista.
 */
export function habitosDePedido(pedidos: Pick<PedidoHavi, 'linhas' | 'createdAt'>[]): Record<string, Habito> {
  const recentes = [...pedidos].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const out: Record<string, Habito> = {};
  const contagens: Record<string, Map<number, number>> = {};
  for (const p of recentes) {
    for (const l of p.linhas) {
      out[l.codigo] = { vezes: (out[l.codigo]?.vezes ?? 0) + 1, normal: out[l.codigo]?.normal ?? l.quantidade };
      const m = (contagens[l.codigo] ??= new Map());
      m.set(l.quantidade, (m.get(l.quantidade) ?? 0) + 1);
    }
  }
  for (const [codigo, m] of Object.entries(contagens)) {
    // a quantidade mais repetida; empate fica com a do pedido mais recente, que já está em `normal`
    let melhor = out[codigo].normal;
    let maior = m.get(melhor) ?? 0;
    for (const [q, n] of m) if (n > maior) { melhor = q; maior = n; }
    out[codigo].normal = melhor;
  }
  return out;
}
