import type { Anomalia, Atividade, Fotografia } from '../db/schema';
import { ESTADOS_ANOMALIA, PRIORIDADES, estaAberta, ordenarAnomalias } from '../db/anomalias';
import { situacao, type LinhaCompra, type StockArtigo } from '../db/stock';
import {
  ALTURA_UTIL, LARGURA, MARGEM, dataCurta, desenharCabecalho, desenharTabela, novoDocumento, rodapes, sanear,
  type Cabecalho, type RelatorioTabela
} from './pdf';

const num = (n: number) => n.toLocaleString('pt-PT', { maximumFractionDigits: 3 });
const eur = (n: number) => `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;

type NomeLocal = (id: string) => string;
type NomeEquip = (id: string | null) => string;

export function relatorioPendentes(
  anomalias: Anomalia[], nomeLocal: NomeLocal, nomeEquip: NomeEquip, filtro: { prioridade?: Anomalia['prioridade'] | '' } = {}
): RelatorioTabela {
  const lista = ordenarAnomalias(anomalias.filter(estaAberta)).filter((a) => !filtro.prioridade || a.prioridade === filtro.prioridade);
  const linhas = lista.map((a) => [
    a.codigo, a.titulo, PRIORIDADES[a.prioridade], ESTADOS_ANOMALIA[a.estado],
    [nomeLocal(a.localizacaoId), nomeEquip(a.equipamentoId)].filter(Boolean).join(' / '), dataCurta(a.createdAt)
  ]);
  const altas = lista.filter((a) => a.prioridade === 'alta').length;
  return {
    titulo: 'Anomalias pendentes',
    filtros: filtro.prioridade ? [`prioridade ${PRIORIDADES[filtro.prioridade]}`] : [],
    colunas: [
      { titulo: 'Código', largura: 22 }, { titulo: 'Descrição', largura: 48 }, { titulo: 'Prioridade', largura: 20 },
      { titulo: 'Estado', largura: 28 }, { titulo: 'Local / equipamento', largura: 44 }, { titulo: 'Aberta', largura: 20 }
    ],
    linhas,
    resumo: [`Total: ${lista.length} (${altas} de prioridade alta)`]
  };
}

/** Datas de intervenção e verificação, lidas do histórico de estados. */
function datasDoHistorico(atividades: Atividade[], anomaliaId: string) {
  const dela = atividades.filter((x) => x.anomaliaId === anomaliaId && x.tipo === 'estado').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const primeira = (prefixo: string) => dela.find((x) => x.texto.startsWith(prefixo))?.createdAt ?? null;
  return { intervencao: primeira('Em intervenção'), verificacao: primeira('Aguarda verificação') };
}

export function relatorioResolvidas(
  anomalias: Anomalia[], atividades: Atividade[], nomeLocal: NomeLocal, filtro: { de?: string; ate?: string } = {}
): RelatorioTabela {
  const lista = anomalias
    .filter((a) => !a.deletedAt && a.estado === 'resolvida' && a.dataResolucao)
    .filter((a) => (!filtro.de || a.dataResolucao! >= filtro.de) && (!filtro.ate || a.dataResolucao! <= filtro.ate))
    .sort((a, b) => b.dataResolucao!.localeCompare(a.dataResolucao!));
  const linhas = lista.map((a) => {
    const d = datasDoHistorico(atividades, a.id);
    const dias = Math.max(0, Math.round((Date.parse(a.dataResolucao!) - Date.parse(a.createdAt.slice(0, 10))) / 86_400_000));
    return [a.codigo, a.titulo, nomeLocal(a.localizacaoId), dataCurta(a.createdAt), dataCurta(d.intervencao), dataCurta(d.verificacao), dataCurta(a.dataResolucao), String(dias)];
  });
  const periodo = filtro.de || filtro.ate ? [`período ${filtro.de ? dataCurta(filtro.de) : '...'} a ${filtro.ate ? dataCurta(filtro.ate) : '...'}`] : [];
  return {
    titulo: 'Histórico de anomalias resolvidas',
    filtros: periodo,
    colunas: [
      { titulo: 'Código', largura: 20 }, { titulo: 'Descrição', largura: 44 }, { titulo: 'Local', largura: 28 }, { titulo: 'Aberta', largura: 19 },
      { titulo: 'Interv.', largura: 19 }, { titulo: 'Verif.', largura: 19 }, { titulo: 'Resolvida', largura: 21 }, { titulo: 'Dias', largura: 12, direita: true }
    ],
    linhas,
    resumo: [`Total: ${lista.length} resolvida(s)`]
  };
}

export function relatorioInventario(stocks: StockArtigo[], nomeLocal: NomeLocal, filtro: { localizacaoId?: string } = {}): RelatorioTabela {
  const lista = stocks
    .filter((s) => !filtro.localizacaoId || s.porLocal.some((l) => l.localizacaoId === filtro.localizacaoId))
    .sort((a, b) => a.artigo.nome.localeCompare(b.artigo.nome, 'pt'));
  const SIT = { sem_minimo: '', ok: 'OK', abaixo: 'Abaixo do mínimo' } as const;
  const linhas = lista.map((s) => {
    const locais = s.porLocal.filter((l) => !filtro.localizacaoId || l.localizacaoId === filtro.localizacaoId);
    const qtd = filtro.localizacaoId ? locais.reduce((t, l) => t + l.quantidade, 0) : s.total;
    return [
      s.artigo.codigo, s.artigo.nome, `${num(qtd)} ${s.artigo.unidade}`, s.artigo.stockMinimo === null ? '' : num(s.artigo.stockMinimo),
      SIT[situacao(s)], locais.map((l) => `${nomeLocal(l.localizacaoId)}: ${num(l.quantidade)}`).join('; '), dataCurta(s.ultimaContagem)
    ];
  });
  return {
    titulo: filtro.localizacaoId ? `Inventário: ${nomeLocal(filtro.localizacaoId)}` : 'Inventário geral',
    filtros: [],
    colunas: [
      { titulo: 'Código', largura: 22 }, { titulo: 'Artigo', largura: 40 }, { titulo: 'Quantidade', largura: 22, direita: true }, { titulo: 'Mín.', largura: 12, direita: true },
      { titulo: 'Situação', largura: 24 }, { titulo: 'Por local', largura: 40 }, { titulo: 'Contado', largura: 22 }
    ],
    linhas,
    resumo: [`Total: ${lista.length} artigo(s)`, `Abaixo do mínimo: ${lista.filter((s) => situacao(s) === 'abaixo').length}`]
  };
}

export function relatorioCompras(linhas: LinhaCompra[]): RelatorioTabela {
  const total = linhas.reduce((s, l) => s + (l.valor ?? 0), 0);
  return {
    titulo: 'Necessidades de compra',
    filtros: [],
    colunas: [
      { titulo: 'Código', largura: 22 }, { titulo: 'Artigo', largura: 48 }, { titulo: 'Atual', largura: 18, direita: true }, { titulo: 'Mín.', largura: 16, direita: true },
      { titulo: 'Comprar', largura: 22, direita: true }, { titulo: 'Fornecedor', largura: 36 }, { titulo: 'Valor', largura: 20, direita: true }
    ],
    linhas: linhas.map((l) => [
      l.artigo.codigo, l.artigo.nome, num(l.atual), num(l.minimo), `${num(l.sugerida)} ${l.artigo.unidade}`, l.artigo.fornecedor,
      l.valor === null ? '' : eur(l.valor)
    ]),
    resumo: [`Total estimado: ${eur(total)}${linhas.some((l) => l.valor === null) ? ' (há artigos sem preço)' : ''}`, 'Lista de apoio: a app não faz encomendas.']
  };
}

export interface FotoPdf {
  dados: Uint8Array;
  formato: 'JPEG' | 'PNG';
}

export async function fotoParaPdf(f: Fotografia): Promise<FotoPdf | null> {
  const formato = f.mime === 'image/jpeg' ? 'JPEG' : f.mime === 'image/png' ? 'PNG' : null;
  return formato ? { dados: new Uint8Array(await f.blob.arrayBuffer()), formato } : null;
}

/** Ficha completa: dados, fotografias e histórico. */
export async function gerarPdfAnomalia(
  a: Anomalia, nomeLocal: NomeLocal, nomeEquip: NomeEquip, atividades: Atividade[], fotos: FotoPdf[], cab: Cabecalho
): Promise<Blob> {
  const doc = await novoDocumento();
  let y = desenharCabecalho(doc, `Anomalia ${a.codigo}`, cab);
  const nova = (precisa: number) => {
    if (y + precisa > ALTURA_UTIL) { doc.addPage(); y = 16; }
  };
  const campo = (rotulo: string, valor: string) => {
    if (!valor) return;
    const linhas = doc.splitTextToSize(sanear(valor), LARGURA - 38) as string[];
    nova(linhas.length * 4.6 + 1);
    doc.setFont('helvetica', 'bold').setFontSize(9.5).text(sanear(rotulo), MARGEM, y);
    doc.setFont('helvetica', 'normal').text(linhas, MARGEM + 38, y);
    y += linhas.length * 4.6 + 1.5;
  };
  doc.setFont('helvetica', 'bold').setFontSize(13).text(doc.splitTextToSize(sanear(a.titulo), LARGURA) as string[], MARGEM, y);
  y += (doc.splitTextToSize(sanear(a.titulo), LARGURA) as string[]).length * 6 + 2;
  campo('Estado', ESTADOS_ANOMALIA[a.estado]);
  campo('Prioridade', PRIORIDADES[a.prioridade]);
  campo('Localização', nomeLocal(a.localizacaoId));
  campo('Equipamento', nomeEquip(a.equipamentoId));
  campo('Aberta em', dataCurta(a.createdAt));
  campo('Resolvida em', dataCurta(a.dataResolucao));
  campo('Descrição', a.descricao);

  if (fotos.length) {
    y += 3;
    nova(10);
    doc.setFont('helvetica', 'bold').setFontSize(11).text('Fotografias', MARGEM, y);
    y += 4;
    const MAX_L = 84, MAX_A = 64;
    for (let i = 0; i < fotos.length; i += 2) {
      const par = fotos.slice(i, i + 2).map((f) => {
        const p = doc.getImageProperties(f.dados);
        const k = Math.min(MAX_L / p.width, MAX_A / p.height);
        return { f, l: p.width * k, h: p.height * k };
      });
      nova(MAX_A + 4);
      par.forEach(({ f, l, h }, j) => doc.addImage(f.dados, f.formato, MARGEM + j * (MAX_L + 6), y, l, h));
      y += Math.max(...par.map((p) => p.h)) + 5;
    }
  }

  const hist = atividades.filter((x) => x.anomaliaId === a.id).sort((p, q) => (p.createdAt < q.createdAt ? -1 : 1));
  if (hist.length) {
    y += 3;
    nova(14);
    doc.setFont('helvetica', 'bold').setFontSize(11).text('Histórico', MARGEM, y);
    y += 3;
    const TIPO = { estado: 'Estado', intervencao: 'Intervenção', contacto: 'Contacto', nota: 'Nota' } as const;
    y = desenharTabela(
      doc,
      [{ titulo: 'Data', largura: 24 }, { titulo: 'Tipo', largura: 26 }, { titulo: 'Registo', largura: 132 }],
      hist.map((x) => [dataCurta(x.createdAt), TIPO[x.tipo], x.texto]),
      y
    );
  }
  rodapes(doc);
  return doc.output('blob');
}
