import { normalizar } from './consultas';

/** Campos da ficha que um QR de equipamento pode trazer. */
export type CampoQr = 'nome' | 'marca' | 'modelo' | 'numeroSerie' | 'categoria';
export const ROTULOS_QR: Record<CampoQr, string> = { nome: 'Nome', marca: 'Marca', modelo: 'Modelo', numeroSerie: 'Nº de série', categoria: 'Categoria' };
export const CAMPOS_QR: CampoQr[] = ['nome', 'marca', 'modelo', 'numeroSerie', 'categoria'];

export interface LeituraQr {
  formato: 'json' | 'chave-valor' | 'url' | 'gs1' | 'texto';
  campos: Partial<Record<CampoQr, string>>;
  /** Endereço web do QR (ex.: página do fabricante), para guardar nas notas. */
  url: string | null;
  bruto: string;
}

/** Nomes de campo usados pelos fabricantes (sem acentos, minúsculas, pontuação trocada por espaço). */
const SINONIMOS: [CampoQr, string[]][] = [
  ['numeroSerie', ['sn', 's n', 'serial', 'serialno', 'serial no', 'serial number', 'serialnumber', 'numero de serie', 'n de serie', 'n serie', 'no serie', 'n o serie', 'serie', 'ser no', 'seriennummer', 'numero serie', 'nr serie']],
  ['modelo', ['model', 'modelo', 'model no', 'model number', 'modelno', 'mdl', 'type', 'tipo', 'ref', 'referencia', 'reference', 'pn', 'p n', 'part number', 'part no', 'product code', 'mtm']],
  ['marca', ['brand', 'marca', 'manufacturer', 'mfr', 'mfg', 'maker', 'fabricante', 'vendor', 'make']],
  ['nome', ['name', 'nome', 'product', 'produto', 'product name', 'description', 'descricao', 'designacao', 'device', 'equipamento', 'item']],
  ['categoria', ['category', 'categoria', 'class', 'classe', 'familia', 'family']]
];

const chave = (k: string) => normalizar(k).replace(/[^a-z0-9]+/g, ' ').trim();

export function campoDeChave(k: string): CampoQr | null {
  const c = chave(k);
  for (const [campo, nomes] of SINONIMOS) if (nomes.includes(c) || nomes.includes(c.replace(/ /g, ''))) return campo;
  return null;
}

const limpo = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);

function juntar(pares: [string, unknown][]): Partial<Record<CampoQr, string>> {
  const r: Partial<Record<CampoQr, string>> = {};
  for (const [k, v] of pares) {
    const campo = campoDeChave(k);
    const valor = limpo(v);
    if (campo && valor && !r[campo]) r[campo] = valor;
  }
  return r;
}

const FNC1 = String.fromCharCode(29);

/** GS1: (01) GTIN, (21) nº de série, (240) referência. Aceita parênteses, separador FNC1 ou endereço «Digital Link». */
function gs1(texto: string): Partial<Record<CampoQr, string>> | null {
  const t = texto.trim();
  if (/^https?:\/\/[^/]+\/(?:[^?#]*\/)?01\/\d{8,14}/i.test(t)) {
    const serie = /\/21\/([^/?#]+)/.exec(t)?.[1];
    return serie ? { numeroSerie: decodeURIComponent(serie) } : {};
  }
  if (/^\(01\)\d{14}/.test(t)) {
    const ai = (n: string) => new RegExp(`\\(${n}\\)([^(]+)`).exec(t)?.[1]?.trim();
    const r: Partial<Record<CampoQr, string>> = {};
    const serie = ai('21'), ref = ai('240');
    if (serie) r.numeroSerie = serie;
    if (ref) r.modelo = ref;
    return r;
  }
  const sem = t.replace(/^\][A-Za-z]\d/, '');
  if (/^01\d{14}/.test(sem) && (sem.includes(FNC1) || sem.length > 16)) {
    const FIXOS: Record<string, number> = { '01': 14, '11': 6, '13': 6, '15': 6, '17': 6 };
    const r: Partial<Record<CampoQr, string>> = {};
    let i = 0;
    while (i < sem.length) {
      if (sem[i] === FNC1) { i++; continue; }
      const ai = sem.startsWith('240', i) ? '240' : sem.slice(i, i + 2);
      i += ai.length;
      if (FIXOS[ai]) { i += FIXOS[ai]; continue; }
      if (!['10', '21', '240'].includes(ai)) break; // identificador desconhecido: pára (não adivinha)
      const fim = sem.indexOf(FNC1, i);
      const v = sem.slice(i, fim < 0 ? undefined : fim);
      if (ai === '21') r.numeroSerie = v;
      else if (ai === '240') r.modelo = v;
      i = fim < 0 ? sem.length : fim + 1;
    }
    return r;
  }
  return null;
}

/**
 * Lê o texto de um QR de equipamento. Nunca inventa: só devolve campos com nome reconhecido.
 * Formatos: JSON, «Chave: valor» (linhas, «;» ou «|»), endereço web com parâmetros, GS1, ou texto livre.
 */
export function interpretarQr(texto: string): LeituraQr {
  const bruto = texto.replace(/\r/g, '').trim().slice(0, 4000);
  if (/^[[{]/.test(bruto)) {
    try {
      const v = JSON.parse(bruto) as unknown;
      const obj = Array.isArray(v) ? v[0] : v;
      if (obj && typeof obj === 'object') {
        const pares: [string, unknown][] = [];
        const percorrer = (o: Record<string, unknown>, nivel: number) => {
          for (const [k, x] of Object.entries(o)) {
            if (x && typeof x === 'object' && !Array.isArray(x)) { if (nivel < 2) percorrer(x as Record<string, unknown>, nivel + 1); }
            else pares.push([k, x]);
          }
        };
        percorrer(obj as Record<string, unknown>, 0);
        return { formato: 'json', campos: juntar(pares), url: null, bruto };
      }
    } catch { /* não é JSON: segue */ }
  }
  const g = gs1(bruto);
  if (g) return { formato: 'gs1', campos: g, url: /^https?:\/\//i.test(bruto) ? bruto : null, bruto };
  if (/^https?:\/\/\S+$/i.test(bruto)) {
    let campos: Partial<Record<CampoQr, string>> = {};
    try { campos = juntar([...new URL(bruto).searchParams.entries()]); } catch { /* endereço estranho */ }
    return { formato: 'url', campos, url: bruto, bruto };
  }
  const pares = bruto.split(/\n|;|\|/).map((p) => p.trim()).filter(Boolean)
    .map((p) => /^([^:=]{1,30})[:=]\s*(.+)$/.exec(p))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => [m[1], m[2]] as [string, string]);
  const campos = juntar(pares);
  if (Object.keys(campos).length) return { formato: 'chave-valor', campos, url: null, bruto };
  return { formato: 'texto', campos: {}, url: null, bruto };
}

/** Linha para as notas da ficha com o conteúdo do QR (para não se perder o que a app não reconheceu). */
export const notaQr = (l: LeituraQr) => (l.url ? `QR do fabricante: ${l.url}` : `QR: ${l.bruto.replace(/\n+/g, ' · ').slice(0, 500)}`);
