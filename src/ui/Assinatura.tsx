import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { guardarAssinatura } from '../db/inspecoes';
import { lerResponsavel } from '../export/gerar';
import { Aviso, Campo, dataPt, useUrlDoBlob } from './comuns';
import type { Fotografia } from '../db/schema';

/** Quadro para assinar com o dedo. Fundo sempre branco (também no modo escuro), traço preto. */
function Quadro({ aoMudar, limpar }: { aoMudar: (vazio: boolean) => void; limpar: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    const k = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * k); c.height = Math.round(r.height * k);
    const ctx = c.getContext('2d')!;
    ctx.scale(k, k);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height);
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0f172a';
    aoMudar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limpar]);
  const ponto = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  return (
    <canvas
      ref={ref}
      aria-label="Quadro de assinatura"
      className="h-40 w-full touch-none rounded-xl border border-slate-300"
      style={{ background: '#fff' }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); desenhando.current = true; const ctx = e.currentTarget.getContext('2d')!; const [x, y] = ponto(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke(); aoMudar(false); }}
      onPointerMove={(e) => { if (!desenhando.current) return; const ctx = e.currentTarget.getContext('2d')!; const [x, y] = ponto(e); ctx.lineTo(x, y); ctx.stroke(); }}
      onPointerUp={() => { desenhando.current = false; }}
      onPointerCancel={() => { desenhando.current = false; }}
    />
  );
}

function ImagemAssinatura({ f }: { f: Fotografia }) {
  const url = useUrlDoBlob(f.id, f.blob);
  return url ? <img src={url} alt={`Assinatura de ${f.legenda ?? ''}`} className="h-28 w-full rounded-xl border border-slate-300 object-contain" style={{ background: '#fff' }} /> : null;
}

/** Assinatura opcional no fim da inspeção (aparece no PDF). */
export function AssinaturaInspecao({ inspecaoId, editavel }: { inspecaoId: string; editavel: boolean }) {
  const atual = useLiveQuery(async () => (await db.fotografias.where('[entidade+entidadeId]').equals(['inspecao', inspecaoId]).toArray()).filter((f) => f.fase === 'assinatura' && !f.deletedAt).pop() ?? null, [inspecaoId]);
  const resp = useLiveQuery(() => lerResponsavel(db), []);
  const [nome, setNome] = useState<string | null>(null);
  const [vazio, setVazio] = useState(true);
  const [limpar, setLimpar] = useState(0);
  const [aAssinar, setAAssinar] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  if (atual === undefined) return null;
  if (!editavel && !atual) return null;

  async function guardar() {
    setMsg(null);
    const c = canvas.current?.querySelector('canvas');
    if (!c) return;
    try {
      const blob = await new Promise<Blob>((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('Não consegui guardar a assinatura.'))), 'image/png'));
      await guardarAssinatura(db, inspecaoId, blob, nome ?? resp ?? '');
      setAAssinar(false);
      setMsg({ tipo: 'ok', texto: 'Assinatura guardada. Aparece no PDF.' });
    } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }); }
  }

  return (
    <div className="cartao space-y-3">
      <h3 className="font-semibold">Assinatura{editavel ? ' (opcional)' : ''}</h3>
      {atual && !aAssinar && (
        <>
          <ImagemAssinatura f={atual} />
          <p className="text-sm text-slate-600">{atual.legenda} · {dataPt(atual.createdAt)}</p>
        </>
      )}
      {editavel && !aAssinar && <button className="btn-secundario w-full" onClick={() => { setAAssinar(true); setMsg(null); }}>✍ {atual ? 'Assinar outra vez' : 'Assinar'}</button>}
      {editavel && aAssinar && (
        <>
          <Campo rotulo="Nome de quem assina *"><input className="campo" value={nome ?? resp ?? ''} onChange={(e) => setNome(e.target.value)} autoComplete="name" /></Campo>
          <div ref={canvas}><Quadro limpar={limpar} aoMudar={setVazio} /></div>
          <p className="text-xs text-slate-500">Assina com o dedo dentro do quadro.</p>
          <div className="grid grid-cols-3 gap-2">
            <button className="btn-secundario px-2" onClick={() => setAAssinar(false)}>Cancelar</button>
            <button className="btn-secundario px-2" onClick={() => setLimpar((n) => n + 1)}>Limpar</button>
            <button className="btn-primario px-2" disabled={vazio || !(nome ?? resp ?? '').trim()} onClick={guardar}>Guardar</button>
          </div>
        </>
      )}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </div>
  );
}
