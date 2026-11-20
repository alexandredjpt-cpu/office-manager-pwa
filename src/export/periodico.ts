import type { Anomalia, Encomenda, Fornecedor, Inspecao, InspecaoLinha } from '../db/schema';
import { ESTADOS_ANOMALIA, PRIORIDADES } from '../db/anomalias';
import { ESTADOS_ENCOMENDA } from '../db/encomendas';
import { MODALIDADES, resumir } from '../db/inspecoes';
import { hojeIso, somarDias } from '../db/agenda';
import type { LinhaCompra } from '../db/stock';
import {
  ALTURA_UTIL, MARGEM, dataCurta, desenharCabecalho, desenharTabela, novoDocumento, rodapes, sanear, type Cabecalho, type Coluna
} from './pdf';

export type TipoPeriodo = 'semana_atual' | 'semana_anterior' | 'mes_atual' | 'mes_anterior';
export const PERIODOS: Record<TipoPeriodo, string> = { semana_atual: 'Esta semana', semana_anterior: 'Semana passada', mes_atual: 'Este mês', mes_anterior: 'Mês passado' };

export interface Periodo { de: string; ate: string; texto: string }

/** Semanas de segunda a domingo; meses de calendário. Datas AAAA-MM-DD locais. */
export function periodoDe(tipo: TipoPeriodo, hoje = new Date()): Periodo {
  const h = hojeIso(hoje);
  let de: string, ate: string;
  if (tipo.startsWith('semana')) {
    const seg = somarDias(h, -((hoje.getDay() + 6) % 7));
    de = tipo === 'semana_atual' ? seg : somarDias(seg, -7);
    ate = somarDias(de, 6);
  } else {
    const ref = tipo === 'mes_atual' ? new Date(hoje.getFullYear(), hoje.getMonth(), 1) : new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    de = hojeIso(ref);
    ate = hojeIso(new Date(ref.getFullYear(), ref.getMonth() + 1, 0));
  }
  const dia = (d: string) => d.split('-').reverse().join('/');
  return { de, ate, texto: `${PERIODOS[tipo]}: ${dia(de)} a ${dia(ate)}` };
}

/** Dia local de um instante ISO (os registos guardam UTC). */
const diaLocal = (iso: string) => hojeIso(new Date(iso));
const dentro = (dia: string, p: Periodo) => dia >= p.de && dia <= p.ate;

export interface Seccao { titulo: string; colunas: Coluna[]; linhas: string[][]; vazio: string }
export interface RelatorioPeriodo { titulo: string; periodo: Periodo; resumo: string[]; seccoes: Seccao[] }

export function relatorioPeriodo(d: {
  anomalias: Anomalia[]; inspecoes: Inspecao[]; linhasInspecao: InspecaoLinha[]; encomendas: Encomenda[]; fornecedores: Fornecedor[];
  compras: LinhaCompra[]; nomeLocal: (id: string) => string; nomeEquip: (id: string | null) => string;
}, p: Periodo): RelatorioPeriodo {
  const an = d.anomalias.filter((a) => !a.deletedAt);
  const abertas = an.filter((a) => dentro(diaLocal(a.createdAt), p)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const resolvidas = an.filter((a) => a.estado === 'resolvida' && a.dataResolucao && dentro(a.dataResolucao, p)).sort((a, b) => (a.dataResolucao ?? '').localeCompare(b.dataResolucao ?? ''));
  // Por resolver no fim do período: abertas até lá e ainda não resolvidas nessa data.
  const pendentesFim = an.filter((a) => diaLocal(a.createdAt) <= p.ate && !(a.estado === 'resolvida' && a.dataResolucao && a.dataResolucao <= p.ate));
  const insp = d.inspecoes.filter((i) => !i.deletedAt && i.estado === 'concluida' && i.concluidaEm && dentro(diaLocal(i.concluidaEm), p)).sort((a, b) => (a.concluidaEm ?? '').localeCompare(b.concluidaEm ?? ''));
  const encs = d.encomendas.filter((e) => !e.deletedAt && dentro(diaLocal(e.createdAt), p)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const nomeForn = (id: string) => d.fornecedores.find((f) => f.id === id)?.nome ?? '?';
  const onde = (a: Anomalia) => [d.nomeLocal(a.localizacaoId), d.nomeEquip(a.equipamentoId)].filter(Boolean).join(' / ');

  const comProblema = insp.reduce((t, i) => t + resumir(d.linhasInspecao.filter((l) => l.inspecaoId === i.id)).comAnomalia, 0);
  const colAnom: Coluna[] = [{ titulo: 'Código', largura: 22 }, { titulo: 'Descrição', largura: 62 }, { titulo: 'Prioridade', largura: 20 }, { titulo: 'Estado', largura: 30 }, { titulo: 'Local / equip.', largura: 48 }];

  return {
    titulo: 'Relatório do período',
    periodo: p,
    resumo: [
      `Anomalias registadas: ${abertas.length}${abertas.length ? ` (${abertas.filter((a) => a.prioridade === 'alta').length} de prioridade alta)` : ''}`,
      `Anomalias resolvidas: ${resolvidas.length}`,
      `Anomalias por resolver no fim do período: ${pendentesFim.length}`,
      `Inspeções concluídas: ${insp.length}${insp.length ? ` (${comProblema} equipamento(s) com anomalia)` : ''}`,
      `Encomendas criadas: ${encs.length}${encs.length ? ` (${encs.filter((e) => e.estado === 'entregue').length} já entregue(s))` : ''}`,
      `Artigos abaixo do mínimo (hoje): ${d.compras.length}`
    ],
    seccoes: [
      { titulo: 'Anomalias registadas no período', colunas: colAnom, vazio: 'Nenhuma.', linhas: abertas.map((a) => [a.codigo, a.titulo, PRIORIDADES[a.prioridade], ESTADOS_ANOMALIA[a.estado], onde(a)]) },
      {
        titulo: 'Anomalias resolvidas no período', vazio: 'Nenhuma.',
        colunas: [{ titulo: 'Código', largura: 22 }, { titulo: 'Descrição', largura: 70 }, { titulo: 'Resolvida', largura: 22 }, { titulo: 'Local / equip.', largura: 68 }],
        linhas: resolvidas.map((a) => [a.codigo, a.titulo, dataCurta(a.dataResolucao), onde(a)])
      },
      {
        titulo: 'Inspeções concluídas', vazio: 'Nenhuma.',
        colunas: [{ titulo: 'Código', largura: 22 }, { titulo: 'Local', largura: 56 }, { titulo: 'Modalidade', largura: 28 }, { titulo: 'Concluída', largura: 22 }, { titulo: 'Resultado', largura: 54 }],
        linhas: insp.map((i) => {
          const r = resumir(d.linhasInspecao.filter((l) => l.inspecaoId === i.id));
          return [i.codigo, d.nomeLocal(i.localizacaoId), MODALIDADES[i.modalidade], dataCurta(i.concluidaEm), `${r.conformes} conf. · ${r.comAnomalia} c/ anomalia · ${r.naoVerificados} n/ verif.`];
        })
      },
      {
        titulo: 'Encomendas criadas no período', vazio: 'Nenhuma.',
        colunas: [{ titulo: 'Código', largura: 22 }, { titulo: 'Fornecedor', largura: 80 }, { titulo: 'Estado', largura: 50 }, { titulo: 'Criada', largura: 30 }],
        linhas: encs.map((e) => [e.codigo, nomeForn(e.fornecedorId), ESTADOS_ENCOMENDA[e.estado], dataCurta(e.createdAt)])
      },
      {
        titulo: 'A comprar (abaixo do mínimo, hoje)', vazio: 'Nada abaixo do mínimo.',
        colunas: [{ titulo: 'Artigo', largura: 92 }, { titulo: 'Atual', largura: 30, direita: true }, { titulo: 'Mínimo', largura: 30, direita: true }, { titulo: 'Sugerido', largura: 30, direita: true }],
        linhas: d.compras.map((l) => [l.artigo.nome, String(l.atual), String(l.minimo), String(l.sugerida)])
      }
    ]
  };
}

export async function gerarPdfPeriodo(r: RelatorioPeriodo, cab: Cabecalho): Promise<Blob> {
  const doc = await novoDocumento();
  let y = desenharCabecalho(doc, r.titulo, cab, [r.periodo.texto]);
  doc.setFont('helvetica', 'bold').setFontSize(11).text('Resumo', MARGEM, y);
  y += 5;
  doc.setFont('helvetica', 'normal').setFontSize(9.5);
  for (const l of r.resumo) { doc.text(sanear(`• ${l}`), MARGEM, y); y += 4.8; }
  for (const s of r.seccoes) {
    y += 4;
    if (y + 16 > ALTURA_UTIL) { doc.addPage(); y = 16; }
    doc.setFont('helvetica', 'bold').setFontSize(11).text(sanear(s.titulo), MARGEM, y);
    y += 3;
    if (s.linhas.length === 0) {
      doc.setFont('helvetica', 'normal').setFontSize(9.5).text(sanear(s.vazio), MARGEM, y + 3);
      y += 6;
    } else {
      y = desenharTabela(doc, s.colunas, s.linhas, y);
    }
  }
  rodapes(doc);
  return doc.output('blob');
}
