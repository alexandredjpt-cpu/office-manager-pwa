import type { Localizacao } from '../db/schema';
import { conteudoQrLocal } from '../db/etiquetas';
import { novoDocumento, sanear } from './pdf';

/** Matriz do QR (true = módulo escuro). Correção de erros M: aguenta etiquetas um pouco riscadas. */
export async function matrizQr(texto: string): Promise<boolean[][]> {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, l) => Array.from({ length: n }, (_, c) => qr.isDark(l, c)));
}

const COLUNAS = 2;
const LINHAS = 4;
const MARGEM_X = 10;
const MARGEM_Y = 13.5;
const CELULA_L = 95;
const CELULA_A = 67.5;
const LADO_QR = 44;

/** Etiquetas para colar nas portas: 8 por folha A4, cada uma com o QR e o nome do local. */
export async function gerarPdfEtiquetas(locais: Localizacao[], base: string): Promise<Blob> {
  const doc = await novoDocumento();
  for (let i = 0; i < locais.length; i++) {
    const l = locais[i];
    const pos = i % (COLUNAS * LINHAS);
    if (i > 0 && pos === 0) doc.addPage();
    const x = MARGEM_X + (pos % COLUNAS) * CELULA_L;
    const y = MARGEM_Y + Math.floor(pos / COLUNAS) * CELULA_A;
    // linha de corte
    doc.setDrawColor(200).setLineWidth(0.1).setLineDashPattern([1, 1], 0).rect(x, y, CELULA_L, CELULA_A).setLineDashPattern([], 0);

    const m = await matrizQr(conteudoQrLocal(base, l.id));
    const passo = LADO_QR / m.length;
    const qx = x + 6;
    const qy = y + (CELULA_A - LADO_QR) / 2;
    doc.setFillColor(0, 0, 0);
    for (let li = 0; li < m.length; li++) for (let c = 0; c < m.length; c++) if (m[li][c]) doc.rect(qx + c * passo, qy + li * passo, passo + 0.02, passo + 0.02, 'F');

    const tx = qx + LADO_QR + 6;
    const largura = x + CELULA_L - 4 - tx;
    doc.setTextColor(0).setFont('helvetica', 'bold').setFontSize(15);
    const nome = (doc.splitTextToSize(sanear(l.nome), largura) as string[]).slice(0, 4);
    doc.text(nome, tx, qy + 7);
    const sub = [l.piso ? `Piso ${l.piso}` : '', l.ala ? `Ala ${l.ala}` : ''].filter(Boolean).join(' · ');
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90);
    if (sub) doc.text(sanear(sub), tx, qy + 7 + nome.length * 6.5 + 1);
    doc.setFontSize(7).text(doc.splitTextToSize('Ler com a câmara ou com a app Office Manager', largura) as string[], tx, qy + LADO_QR - 4);
  }
  return doc.output('blob');
}
