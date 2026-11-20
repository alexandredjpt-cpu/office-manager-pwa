/** Gerador mínimo de .xlsx (uma folha, texto/números, cabeçalho a negrito, filtro e painel fixo). */

export type Celula = string | number | null;

const SEM_CONTROLO = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
export const escXml = (s: string) =>
  s.replace(SEM_CONTROLO, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function letraColuna(i: number): string {
  let n = i + 1, s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CAB = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function celula(v: Celula, ref: string, estilo: number): string {
  const s = estilo ? ` s="${estilo}"` : '';
  if (v === null || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escXml(String(v))}</t></is></c>`;
}

export function folhaXml(cabecalho: string[], linhas: Celula[][]): string {
  const todas = [cabecalho, ...linhas];
  const larguras = cabecalho.map((_, c) =>
    Math.min(50, Math.max(8, ...todas.map((l) => String(l[c] ?? '').split('\n')[0].length + 2)))
  );
  const ultima = `${letraColuna(cabecalho.length - 1)}${todas.length}`;
  const dados = todas
    .map((l, r) => `<row r="${r + 1}">${l.map((v, c) => celula(v, `${letraColuna(c)}${r + 1}`, r === 0 ? 1 : 0)).join('')}</row>`)
    .join('');
  return (
    CAB +
    `<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${dados}</sheetData><autoFilter ref="A1:${ultima}"/></worksheet>`
  );
}

const ESTILOS =
  CAB +
  `<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

export interface Folha { nome: string; cabecalho: string[]; linhas: Celula[][] }

/** Nome de folha válido no Excel (≤31, sem []:*?/\\) e único no livro. */
export function nomesFolhas(nomes: string[]): string[] {
  const usados = new Set<string>();
  return nomes.map((n, i) => {
    const base = n.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || `Folha${i + 1}`;
    let nome = base, k = 2;
    while (usados.has(nome.toLowerCase())) { const suf = ` (${k++})`; nome = base.slice(0, 31 - suf.length) + suf; }
    usados.add(nome.toLowerCase());
    return nome;
  });
}

export async function criarXlsx(nomeFolha: string, cabecalho: string[], linhas: Celula[][]): Promise<Blob> {
  return criarXlsxFolhas([{ nome: nomeFolha, cabecalho, linhas }]);
}

/** Livro com várias folhas (uma por tabela, por exemplo). */
export async function criarXlsxFolhas(folhas: Folha[]): Promise<Blob> {
  if (folhas.length === 0) throw new Error('Nada para exportar.');
  const JSZip = (await import('jszip')).default;
  const nomes = nomesFolhas(folhas.map((f) => f.nome));
  const zip = new JSZip();
  const n = folhas.map((_, i) => i + 1);
  zip.file(
    '[Content_Types].xml',
    CAB +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      n.map((k) => `<Override PartName="/xl/worksheets/sheet${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
  );
  zip.file(
    '_rels/.rels',
    CAB + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );
  zip.file(
    'xl/workbook.xml',
    CAB + `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${n.map((k, i) => `<sheet name="${escXml(nomes[i])}" sheetId="${k}" r:id="rId${k}"/>`).join('')}</sheets></workbook>`
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    CAB +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${n.map((k) => `<Relationship Id="rId${k}" Type="${REL}/worksheet" Target="worksheets/sheet${k}.xml"/>`).join('')}<Relationship Id="rId${folhas.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`
  );
  zip.file('xl/styles.xml', ESTILOS);
  folhas.forEach((f, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, folhaXml(f.cabecalho.length ? f.cabecalho : ['(vazio)'], f.linhas)));
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}
