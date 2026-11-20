/**
 * Escolha da câmara para ler códigos. Telemóveis com várias câmaras atrás (ex.: Samsung S2x) podem abrir
 * a ultra grande angular ou a teleobjetiva, que não focam ao perto. Preferimos a principal traseira.
 */
export interface Camara { deviceId: string; label: string }

const TRASEIRA = /back|rear|traseira|trás|tras|environment/i;
const FRONTAL = /front|frontal|user|selfie/i;
const SECUNDARIA = /ultra|wide|grande angular|tele|macro|depth|profundidade/i;

/** Número do Camera2 do Android («camera2 0, facing back» → 0); a principal costuma ser a de número mais baixo. */
const numero = (label: string) => { const m = /camera2?\s*(\d+)/i.exec(label); return m ? Number(m[1]) : 99; };

/** Câmaras traseiras pela ordem a experimentar (a principal primeiro). Sem nomes visíveis, mantém a ordem do sistema. */
export function ordenarCamaras(lista: Camara[]): Camara[] {
  if (!lista.some((c) => c.label)) return lista;
  const traseiras = lista.filter((c) => TRASEIRA.test(c.label) || !FRONTAL.test(c.label));
  const base = traseiras.length ? traseiras : lista;
  return [...base].sort((a, b) => Number(SECUNDARIA.test(a.label)) - Number(SECUNDARIA.test(b.label)) || numero(a.label) - numero(b.label));
}

const CHAVE = 'om.camaraLeitor';
export function lerCamaraPreferida(): string | null { try { return localStorage.getItem(CHAVE); } catch { return null; } }
export function guardarCamaraPreferida(id: string): void { try { localStorage.setItem(CHAVE, id); } catch { /* sem armazenamento */ } }

/** A preferida (a última que leu bem) passa para a frente, se ainda existir. */
export function comPreferida(lista: Camara[], preferida: string | null): Camara[] {
  const p = lista.find((c) => c.deviceId === preferida);
  return p ? [p, ...lista.filter((c) => c !== p)] : lista;
}
