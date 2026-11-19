/**
 * Motor de PDF (jsPDF, carregado só quando se gera um relatório).
 * Fontes padrão do PDF: só Latin-1/WinAnsi, por isso o texto é saneado.
 */
import type { jsPDF } from 'jspdf';

export interface Coluna {
  titulo: string;
  largura: number; // mm; a soma deve dar ~182 (A4 com margens de 14 mm)
  direita?: boolean;
}

export interface RelatorioTabela {
  titulo: string;
  filtros: string[];
  colunas: Coluna[];
  linhas: string[][];
  resumo: string[];
}

export interface Cabecalho {
  emitidoEm: Date;
  responsavel: string;
}

const SUBSTITUIR: [RegExp, string][] = [[/→/g, '->'], [/≈/g, '~'], [/…/g, '...'], [/[‐‑‒]/g, '-'], [/ /g, ' ']];
/** Mantém Latin-1 + os poucos símbolos que o WinAnsi tem; o resto vira «?». */
export function sanear(texto: string): string {
  let t = texto;
  for (const [re, por] of SUBSTITUIR) t = t.replace(re, por);
  return t.replace(/[^ -~¡-ÿ€–—‘’“”•\n]/g, '?');
}

export const dataCurta = (iso: string | null) => {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};
export const dataHora = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const MARGEM = 14;
const LARGURA = 210 - 2 * MARGEM;
const ALTURA_UTIL = 297 - 20;

export async function novoDocumento(): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');
  return new jsPDF({ unit: 'mm', format: 'a4', compress: true });
}

/** Desenha o cabeçalho e devolve o y seguinte. */
export function desenharCabecalho(doc: jsPDF, titulo: string, cab: Cabecalho, extra: string[] = []): number {
  let y = 18;
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(15, 118, 110);
  doc.text(sanear(titulo), MARGEM, y);
  y += 6;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90);
  doc.text(sanear(`Emitido em ${dataHora(cab.emitidoEm)}${cab.responsavel ? ` | Responsável: ${cab.responsavel}` : ''}`), MARGEM, y);
  for (const linha of extra) {
    y += 4.5;
    doc.text(sanear(linha), MARGEM, y);
  }
  doc.setDrawColor(200).line(MARGEM, y + 2.5, MARGEM + LARGURA, y + 2.5);
  doc.setTextColor(0);
  return y + 8;
}

/** Rodapé «Página n de N» em todas as páginas. Chamar no fim. */
export function rodapes(doc: jsPDF): void {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(120);
    doc.text('Office Manager (pessoal)', MARGEM, 290);
    doc.text(`Página ${i} de ${n}`, MARGEM + LARGURA, 290, { align: 'right' });
  }
}

export function desenharTabela(doc: jsPDF, colunas: Coluna[], linhas: string[][], yInicial: number): number {
  const LINHA = 4.2, PAD = 1.6;
  let y = yInicial;

  const cabecalho = () => {
    doc.setFillColor(15, 118, 110).rect(MARGEM, y, LARGURA, 7, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(255);
    let x = MARGEM;
    for (const c of colunas) {
      doc.text(sanear(c.titulo), c.direita ? x + c.largura - 1.5 : x + 1.5, y + 4.7, { align: c.direita ? 'right' : 'left' });
      x += c.largura;
    }
    y += 7;
    doc.setTextColor(0).setFont('helvetica', 'normal').setFontSize(8.5);
  };

  cabecalho();
  linhas.forEach((linha, i) => {
    const partes = linha.map((c, j) => doc.splitTextToSize(sanear(c), colunas[j].largura - 3) as string[]);
    const altura = Math.max(...partes.map((p) => p.length)) * LINHA + 2 * PAD;
    if (y + altura > ALTURA_UTIL) {
      doc.addPage();
      y = 16;
      cabecalho();
    }
    if (i % 2 === 1) doc.setFillColor(243, 246, 246).rect(MARGEM, y, LARGURA, altura, 'F');
    let x = MARGEM;
    partes.forEach((p, j) => {
      const c = colunas[j];
      doc.text(p, c.direita ? x + c.largura - 1.5 : x + 1.5, y + PAD + 3, { align: c.direita ? 'right' : 'left' });
      x += c.largura;
    });
    y += altura;
  });
  doc.setDrawColor(200).line(MARGEM, y, MARGEM + LARGURA, y);
  return y + 5;
}

export async function gerarPdfTabela(r: RelatorioTabela, cab: Cabecalho): Promise<Blob> {
  const doc = await novoDocumento();
  let y = desenharCabecalho(doc, r.titulo, cab, r.filtros.length ? [`Filtros: ${r.filtros.join('; ')}`] : []);
  if (r.linhas.length === 0) {
    doc.setFontSize(10).text('Sem registos para estes filtros.', MARGEM, y);
    y += 8;
  } else {
    y = desenharTabela(doc, r.colunas, r.linhas, y);
  }
  doc.setFont('helvetica', 'bold').setFontSize(9);
  for (const linha of r.resumo) {
    if (y > ALTURA_UTIL) { doc.addPage(); y = 16; }
    doc.text(sanear(linha), MARGEM, y);
    y += 5;
  }
  rodapes(doc);
  return doc.output('blob');
}

export { MARGEM, LARGURA, ALTURA_UTIL };
