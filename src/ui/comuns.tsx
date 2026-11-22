import { useEffect, useState, type ReactNode } from 'react';
import type { EstadoEquipamento } from '../db/schema';
import { estadoGarantia } from '../db/garantia';
import { ORDENS, guardarOrdem, lerOrdem, type ListaOrdenavel, type Ordem } from '../db/ordenar';

export const ROTULOS: Record<string, string> = {
  localizacoes: 'Localizações',
  equipamentos: 'Equipamentos',
  artigos: 'Artigos',
  anomalias: 'Anomalias',
  atividades: 'Registos de histórico',
  contagensStock: 'Contagens de stock',
  movimentosStock: 'Movimentos de stock',
  manutencoes: 'Manutenções',
  execucoes: 'Execuções de manutenção',
  fornecedores: 'Fornecedores',
  encomendas: 'Encomendas',
  encomendaLinhas: 'Linhas de encomenda',
  encomendaEventos: 'Histórico de encomendas',
  rececoes: 'Receções',
  documentos: 'Documentos',
  modelosEmail: 'Modelos de mensagem',
  contactos: 'Contactos',
  marcadores: 'Marcadores de planta',
  zonas: 'Zonas de planta',
  documentoLigacoes: 'Ligações de documentos',
  kits: 'Kits',
  kitLocais: 'Kits nos locais',
  emailsPreparados: 'E-mails preparados',
  notas: 'Notas rápidas',
  lembretes: 'Lembretes',
  fotografias: 'Fotografias'
};

export const dataPt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const diaPt = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('pt-PT') : '—');

export function Campo({ rotulo, children, dica }: { rotulo: string; children: ReactNode; dica?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{rotulo}</span>
      {children}
      {dica && <span className="block text-xs text-slate-500">{dica}</span>}
    </label>
  );
}

export function Modal({ aberto, onFechar, children }: { aberto: boolean; onFechar: () => void; children: ReactNode }) {
  if (!aberto) return null;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-end bg-black/40 p-4" onClick={onFechar}>
      <div className="cartao mx-auto max-h-[90dvh] w-full max-w-xl space-y-3 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function Aviso({ tipo, children }: { tipo: 'ok' | 'erro'; children: ReactNode }) {
  return (
    <p role={tipo === 'erro' ? 'alert' : 'status'} className={`rounded-xl p-3 text-sm ${tipo === 'ok' ? 'bg-teal-50 text-teal-900' : 'bg-red-50 text-red-800'}`}>
      {children}
    </p>
  );
}

const ESTADOS: Record<EstadoEquipamento, [string, string]> = {
  ativo: ['Ativo', 'bg-teal-100 text-teal-800'],
  desativado: ['Desativado', 'bg-slate-200 text-slate-700'],
  abatido: ['Abatido', 'bg-red-100 text-red-800']
};

export function EstadoBadge({ estado }: { estado: EstadoEquipamento }) {
  const [texto, cor] = ESTADOS[estado];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cor}`}>{texto}</span>;
}

/** Só mostra algo quando a garantia está a terminar ou já terminou. */
export function GarantiaBadge({ fim }: { fim: string | null }) {
  const { estado, dias } = estadoGarantia(fim);
  if (estado === 'a_terminar') {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
        {dias === 0 ? 'Garantia termina hoje' : `Garantia termina em ${dias} d`}
      </span>
    );
  }
  if (estado === 'expirada') {
    return <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">Sem garantia</span>;
  }
  return null;
}

/** URL temporário para mostrar um Blob; é libertado quando o componente sai. */
export function useUrlDoBlob(id: string, blob: Blob): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
    // As fotografias não mudam depois de criadas: o id basta como chave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return url;
}

/** Texto livre com as opções já existentes sempre visíveis (sem a seta enganadora do datalist). */
export function EntradaComSugestoes({ valor, aoMudar, sugestoes, placeholder, desativado = false }: {
  valor: string; aoMudar: (v: string) => void; sugestoes: string[]; placeholder?: string; desativado?: boolean;
}) {
  const unicas = [...new Set(sugestoes.map((s) => s.trim()).filter(Boolean))];
  return (
    <div className="space-y-2">
      <input className="campo" value={valor} disabled={desativado} onChange={(e) => aoMudar(e.target.value)} autoComplete="off" placeholder={placeholder} />
      {!desativado && unicas.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Opções existentes">
          {unicas.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => aoMudar(s)}
              className={`rounded-full border px-3 py-1 text-sm ${s.toLowerCase() === valor.trim().toLowerCase() ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ordem de uma lista, lembrada neste telemóvel. */
export function useOrdem<L extends ListaOrdenavel>(lista: L): [Ordem<L>, (o: Ordem<L>) => void] {
  const [ordem, setOrdem] = useState<Ordem<L>>(() => lerOrdem(lista));
  return [ordem, (o) => { guardarOrdem(lista, o); setOrdem(o); }];
}

export function SeletorOrdem<L extends ListaOrdenavel>({ lista, ordem, aoMudar, className = '' }: { lista: L; ordem: Ordem<L>; aoMudar: (o: Ordem<L>) => void; className?: string }) {
  return (
    <label className={`flex items-center gap-2 text-sm text-slate-500 ${className}`}>
      <span className="shrink-0">Ordenar por</span>
      <select className="campo px-2 py-2 text-sm text-slate-900" aria-label="Ordenar por" value={String(ordem)} onChange={(e) => aoMudar(e.target.value as Ordem<L>)}>
        {Object.entries(ORDENS[lista]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
  );
}
