import { useEffect, useRef, useState } from 'react';
import { db, type Fotografia } from '../db/schema';
import { guardarFotoAnotada } from '../db/repo';
import { desenharFormas, type Forma, type Ferramenta } from '../fotos/anotar';

const CORES = [['#ef4444', 'Vermelho'], ['#facc15', 'Amarelo'], ['#ffffff', 'Branco']] as const;
const FERRAMENTAS: [Ferramenta, string][] = [['circulo', '◯ Círculo'], ['seta', '➚ Seta'], ['livre', '✎ Livre']];

/**
 * Desenhar por cima de uma fotografia (círculo, seta ou traço livre) com o dedo.
 * Ecrã cheio, acima das janelas. Ao guardar, a versão anotada substitui a original (que fica guardada).
 */
export function AnotarFoto({ foto, aoFechar, aoGuardar }: { foto: Fotografia; aoFechar: () => void; aoGuardar: (nova: Fotografia) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const [formas, setFormas] = useState<Forma[]>([]);
  const [atual, setAtual] = useState<Forma | null>(null);
  const [ferr, setFerr] = useState<Ferramenta>('circulo');
  const [cor, setCor] = useState<string>(CORES[0][0]);
  const [pronta, setPronta] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aGuardar, setAGuardar] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(foto.blob);
    const i = new Image();
    i.onload = () => {
      img.current = i;
      const c = canvas.current!;
      c.width = i.naturalWidth; c.height = i.naturalHeight;
      setPronta(true);
    };
    i.onerror = () => setErro('Não consegui abrir a fotografia.');
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  useEffect(() => {
    const c = canvas.current, i = img.current;
    if (!c || !i || !pronta) return;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(i, 0, 0);
    desenharFormas(ctx, atual ? [...formas, atual] : formas, c.width);
  }, [formas, atual, pronta]);

  const ponto = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * e.currentTarget.width, ((e.clientY - r.top) / r.height) * e.currentTarget.height];
  };

  async function guardar() {
    const c = canvas.current; if (!c) return;
    setAGuardar(true); setErro(null);
    try {
      const blob = await new Promise<Blob>((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('Não consegui guardar.'))), 'image/jpeg', 0.85));
      aoGuardar(await guardarFotoAnotada(db, foto.id, blob));
    } catch (e) { setErro((e as Error).message); setAGuardar(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Desenhar na fotografia" className="fixed inset-0 z-40 flex flex-col bg-black/95 pb-[env(safe-area-inset-bottom)] pt-[max(env(safe-area-inset-top),8px)] text-white">
      <div className="flex flex-wrap items-center justify-center gap-2 p-2">
        {FERRAMENTAS.map(([k, t]) => (
          <button key={k} aria-pressed={ferr === k} onClick={() => setFerr(k)} className={`rounded-full px-3 py-2 text-sm font-medium ${ferr === k ? 'bg-[#fff] text-black' : 'bg-white/15'}`}>{t}</button>
        ))}
        {CORES.map(([c, nome]) => (
          <button key={c} aria-label={nome} aria-pressed={cor === c} onClick={() => setCor(c)} className={`h-9 w-9 rounded-full border-2 ${cor === c ? 'border-white' : 'border-transparent'}`} style={{ background: c }} />
        ))}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2">
        <canvas
          ref={canvas}
          aria-label="Fotografia para desenhar"
          className="max-h-full max-w-full touch-none object-contain"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = ponto(e); setAtual({ tipo: ferr, cor, pontos: [p, p] }); }}
          onPointerMove={(e) => { if (!atual) return; const p = ponto(e); setAtual({ ...atual, pontos: atual.tipo === 'livre' ? [...atual.pontos, p] : [atual.pontos[0], p] }); }}
          onPointerUp={() => { if (atual) setFormas((f) => [...f, atual]); setAtual(null); }}
          onPointerCancel={() => setAtual(null)}
        />
      </div>
      {erro && <p role="alert" className="mx-4 rounded-xl bg-red-600 p-2 text-center text-sm">{erro}</p>}
      <p className="px-4 text-center text-xs text-white/70">Desenha com o dedo. A original fica guardada e pode repor-se.</p>
      <div className="grid grid-cols-3 gap-2 p-3">
        <button className="rounded-xl bg-white/15 py-3 font-medium" onClick={aoFechar}>Cancelar</button>
        <button className="rounded-xl bg-white/15 py-3 font-medium disabled:opacity-40" disabled={formas.length === 0} onClick={() => setFormas((f) => f.slice(0, -1))}>↶ Desfazer</button>
        <button className="rounded-xl bg-teal-600 py-3 font-semibold disabled:opacity-40" disabled={formas.length === 0 || aGuardar} onClick={guardar}>{aGuardar ? 'A guardar…' : 'Guardar'}</button>
      </div>
    </div>
  );
}
