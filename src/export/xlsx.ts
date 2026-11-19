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

export async function criarXlsx(nomeFolha: string, cabecalho: string[], linhas: Celula[][]): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const folha = nomeFolha.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Folha1';
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    CAB +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
  );
  zip.file(
    '_rels/.rels',
    CAB + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );
  zip.file(
    'xl/workbook.xml',
    CAB + `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="${escXml(folha)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    CAB +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`
  );
  zip.file('xl/styles.xml', ESTILOS);
  zip.file('xl/worksheets/sheet1.xml', folhaXml(cabecalho, linhas));
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}
