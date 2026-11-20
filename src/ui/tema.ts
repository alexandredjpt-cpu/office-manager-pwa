/** Cores da app escolhidas no telemóvel (Mais → Aparência). Guardadas só neste dispositivo. */
export interface Tema { principal: string; destaque: string }

export const TEMA_ORIGINAL: Tema = { principal: '#0f766e', destaque: '' };
const CHAVE = 'om.tema';
const HEX = /^#[0-9a-f]{6}$/i;

export function hexValido(h: string): boolean { return HEX.test(h.trim()); }

function rgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbDe(h: string): [number, number, number] { return rgb(hexValido(h) ? h : TEMA_ORIGINAL.principal); }

function paraHex([r, g, b]: number[]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Mistura com branco (p > 0) ou preto (p < 0). */
function misturar(h: string, p: number): string {
  const c = rgb(h);
  const alvo = p >= 0 ? 255 : 0;
  const k = Math.abs(p);
  return paraHex(c.map((v) => v + (alvo - v) * k));
}

function luminancia(h: string): number {
  const [r, g, b] = rgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre duas cores (1 a 21). */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Tons 50–900 a partir da cor principal (o 700 é a própria cor). */
export function tons(h: string): Record<number, string> {
  return {
    50: misturar(h, 0.94), 100: misturar(h, 0.86), 200: misturar(h, 0.72), 300: misturar(h, 0.55), 400: misturar(h, 0.3),
    500: misturar(h, 0.12), 600: misturar(h, 0.06), 700: h, 800: misturar(h, -0.2), 900: misturar(h, -0.38)
  };
}

/** A principal leva texto branco por cima: exige contraste ≥ 3 (botões e cabeçalho legíveis). */
export function validarTema(t: Tema): Tema {
  const principal = t.principal.trim().toLowerCase();
  const destaque = t.destaque.trim().toLowerCase();
  if (!hexValido(principal)) throw new Error('Cor principal inválida (formato #RRGGBB).');
  if (destaque && !hexValido(destaque)) throw new Error('Cor de destaque inválida (formato #RRGGBB).');
  if (contraste(principal, '#ffffff') < 3) throw new Error('A cor principal é demasiado clara para texto branco. Usa-a como destaque e escolhe uma principal mais escura.');
  return { principal, destaque };
}

export function lerTema(): Tema {
  try {
    const t = JSON.parse(localStorage.getItem(CHAVE) ?? 'null') as Tema | null;
    return t ? validarTema(t) : TEMA_ORIGINAL;
  } catch { return TEMA_ORIGINAL; }
}

export function aplicarTema(t: Tema): void {
  const raiz = document.documentElement.style;
  for (const [n, cor] of Object.entries(tons(t.principal))) raiz.setProperty(`--color-teal-${n}`, cor);
  raiz.setProperty('--cor-destaque', t.destaque || 'transparent');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.principal);
}

export function guardarTema(t: Tema): Tema {
  const v = validarTema(t);
  try { localStorage.setItem(CHAVE, JSON.stringify(v)); } catch { /* sem armazenamento: só nesta sessão */ }
  aplicarTema(v);
  return v;
}

export function reporTema(): void {
  try { localStorage.removeItem(CHAVE); } catch { /* nada */ }
  aplicarTema(TEMA_ORIGINAL);
}

/** Modo claro/escuro. «auto» segue o modo do telemóvel. Guardado só neste dispositivo. */
export type ModoCor = 'claro' | 'escuro' | 'auto';
const CHAVE_MODO = 'om.modo';
const MODOS: ModoCor[] = ['claro', 'escuro', 'auto'];

export function lerModo(): ModoCor {
  try {
    const m = localStorage.getItem(CHAVE_MODO) as ModoCor | null;
    return m && MODOS.includes(m) ? m : 'claro';
  } catch { return 'claro'; }
}

/** Resolve «auto» com a preferência do sistema. */
export function modoEfetivo(m: ModoCor, sistemaEscuro: boolean): 'claro' | 'escuro' {
  return m === 'auto' ? (sistemaEscuro ? 'escuro' : 'claro') : m;
}

const consultaEscuro = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

export function aplicarModo(m: ModoCor): void {
  const escuro = modoEfetivo(m, consultaEscuro()?.matches ?? false) === 'escuro';
  document.documentElement.classList.toggle('escuro', escuro);
}

let ouvinte: (() => void) | null = null;
/** Aplica o modo e, em «auto», acompanha a mudança do telemóvel (ex.: escuro à noite). */
export function iniciarModo(m: ModoCor = lerModo()): void {
  aplicarModo(m);
  const q = consultaEscuro();
  if (ouvinte && q) q.removeEventListener('change', ouvinte);
  ouvinte = null;
  if (m === 'auto' && q) { ouvinte = () => aplicarModo('auto'); q.addEventListener('change', ouvinte); }
}

export function guardarModo(m: ModoCor): void {
  if (!MODOS.includes(m)) return;
  try { localStorage.setItem(CHAVE_MODO, m); } catch { /* sem armazenamento: só nesta sessão */ }
  iniciarModo(m);
}
