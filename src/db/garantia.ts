export type EstadoGarantia = 'sem' | 'ativa' | 'a_terminar' | 'expirada';

/** Dias de antecedência a partir dos quais a garantia aparece em destaque. */
export const DIAS_AVISO_GARANTIA = 60;

const dia = (y: number, m: number, d: number) => Date.UTC(y, m, d);

/** Dias entre hoje (data local) e uma data AAAA-MM-DD. Negativo = já passou. */
export function diasAte(data: string, hoje = new Date()): number {
  const [y, m, d] = data.split('-').map(Number);
  return Math.round((dia(y, m - 1, d) - dia(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) / 86_400_000);
}

export function estadoGarantia(fim: string | null, hoje = new Date()): { estado: EstadoGarantia; dias: number | null } {
  if (!fim) return { estado: 'sem', dias: null };
  const dias = diasAte(fim, hoje);
  if (dias < 0) return { estado: 'expirada', dias };
  return { estado: dias <= DIAS_AVISO_GARANTIA ? 'a_terminar' : 'ativa', dias };
}
