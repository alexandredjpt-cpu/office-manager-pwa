import { useEffect, useRef, useState } from 'react';
import { Modal } from './comuns';
import { comPreferida, guardarCamaraPreferida, lerCamaraPreferida, ordenarCamaras, type Camara } from '../fotos/camera';

/** API nativa do Chrome (Android): lê códigos de barras e QR sem bibliotecas. */
interface Detetado { rawValue: string; format: string }
interface Detetor { detect(fonte: CanvasImageSource): Promise<Detetado[]> }
interface ConstrutorDetetor { new (o?: { formats?: string[] }): Detetor; getSupportedFormats(): Promise<string[]> }
const API = (globalThis as unknown as { BarcodeDetector?: ConstrutorDetetor }).BarcodeDetector;

/** Formatos usuais em etiquetas de imobilizado e equipamentos. */
const FORMATOS = ['code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'ean_8', 'itf', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'];

export const leituraSuportada = (): boolean => !!API && !!navigator.mediaDevices?.getUserMedia;

/** Botão + janela com a câmara. Ao ler, devolve o texto e fecha. Nunca guarda imagens. */
export function BotaoLerCodigo({ aoLer, rotulo = '📷 Ler código', className = 'btn-secundario' }: { aoLer: (v: string) => void; rotulo?: string; className?: string }) {
  const [aberto, setAberto] = useState(false);
  if (!leituraSuportada()) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setAberto(true)}>{rotulo}</button>
      {aberto && <JanelaLeitor aoLer={(v) => { setAberto(false); aoLer(v); }} aoFechar={() => setAberto(false)} />}
    </>
  );
}

/** Capacidades extra da câmara (Chrome Android); não estão nos tipos do TypeScript. */
interface Capacidades { focusMode?: string[]; zoom?: { min: number; max: number }; torch?: boolean }
type Restricao = MediaTrackConstraintSet & { focusMode?: string; zoom?: number; torch?: boolean; pointsOfInterest?: { x: number; y: number }[] };

async function criarDetetor(): Promise<Detetor> {
  const suportados = await API!.getSupportedFormats();
  return new API!({ formats: FORMATOS.filter((f) => suportados.includes(f)) });
}

/** Lê o código numa fotografia tirada com a câmara do telemóvel (foca sempre). */
async function lerDeFicheiro(f: File): Promise<string | null> {
  const detetor = await criarDetetor();
  const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
  try {
    return (await detetor.detect(bmp)).map((x) => x.rawValue.trim()).find(Boolean) ?? null;
  } finally { bmp.close(); }
}

function JanelaLeitor({ aoLer, aoFechar }: { aoLer: (v: string) => void; aoFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const foto = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [camaras, setCamaras] = useState<Camara[]>([]);
  // `pedido` reabre a câmara; `idx` é só o que se mostra. -1 = 1.ª abertura (pede só «traseira»).
  const [pedido, setPedido] = useState(-1);
  const [idx, setIdx] = useState(0);
  const [zoom, setZoom] = useState<{ min: number; max: number } | null>(null);
  const [ampliado, setAmpliado] = useState(false);
  const [luz, setLuz] = useState<boolean | null>(null);
  const [aLerFoto, setALerFoto] = useState(false);
  const lido = useRef(false);
  const callback = useRef(aoLer);
  callback.current = aoLer;
  const faixa = useRef<MediaStreamTrack | null>(null);
  const atual = useRef<string>('');

  const terminar = (v: string) => {
    if (lido.current) return;
    lido.current = true;
    navigator.vibrate?.(80);
    if (atual.current) guardarCamaraPreferida(atual.current);
    callback.current(v);
  };

  useEffect(() => {
    let fluxo: MediaStream | null = null;
    let parar = false;
    let temporizador = 0;
    (async () => {
      try {
        const detetor = await criarDetetor();
        const escolhida = pedido >= 0 ? camaras[pedido]?.deviceId : lerCamaraPreferida();
        const video_: Restricao = { width: { ideal: 1920 }, height: { ideal: 1080 }, ...(escolhida ? { deviceId: { exact: escolhida } } : { facingMode: { ideal: 'environment' } }) };
        try {
          fluxo = await navigator.mediaDevices.getUserMedia({ video: video_, audio: false });
        } catch (e) {
          if (!escolhida || (e as Error).name === 'NotAllowedError') throw e;
          fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); // a preferida desapareceu
        }
        if (parar) { fluxo.getTracks().forEach((t) => t.stop()); return; }
        const t = fluxo.getVideoTracks()[0];
        faixa.current = t;
        atual.current = t.getSettings().deviceId ?? '';
        // Depois da permissão, os nomes das câmaras ficam visíveis: escolhe a principal traseira.
        if (pedido < 0) {
          const lista = ordenarCamaras((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label })));
          const ordenada = comPreferida(lista, lerCamaraPreferida());
          if (!parar) setCamaras(ordenada);
          const melhor = ordenada[0]?.deviceId;
          if (melhor && melhor !== atual.current && !parar) { fluxo.getTracks().forEach((x) => x.stop()); setIdx(0); setPedido(0); return; } // reabre já na principal
          if (!parar) setIdx(Math.max(0, ordenada.findIndex((c) => c.deviceId === atual.current)));
        }
        const cap = (t.getCapabilities?.() ?? {}) as Capacidades;
        const extra: Restricao = {};
        if (cap.focusMode?.includes('continuous')) extra.focusMode = 'continuous';
        if (Object.keys(extra).length) await t.applyConstraints({ advanced: [extra] } as MediaTrackConstraints).catch(() => undefined);
        if (!parar) { setZoom(cap.zoom && cap.zoom.max >= 1.5 ? cap.zoom : null); setAmpliado(false); setLuz(cap.torch ? false : null); }
        const v = video.current!;
        v.srcObject = fluxo;
        await v.play();
        const ciclo = async () => {
          if (parar || lido.current) return;
          try {
            if (v.readyState >= 2) {
              const r = (await detetor.detect(v)).find((x) => x.rawValue.trim());
              if (r) { terminar(r.rawValue.trim()); return; }
            }
          } catch { /* frame inválido: tenta no seguinte */ }
          temporizador = window.setTimeout(ciclo, 150);
        };
        void ciclo();
      } catch (e) {
        const n = (e as Error).name;
        if (!parar) setErro(n === 'NotAllowedError' ? 'Sem permissão para a câmara. Permite o acesso nas definições do site e tenta outra vez.' : n === 'NotFoundError' ? 'Não encontrei nenhuma câmara.' : 'Não consegui abrir a câmara. Usa «Ler de uma fotografia».');
      }
    })();
    return () => { parar = true; window.clearTimeout(temporizador); fluxo?.getTracks().forEach((t) => t.stop()); faixa.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido]);

  const aplicar = (c: Restricao) => faixa.current?.applyConstraints({ advanced: [c] } as MediaTrackConstraints).catch(() => undefined);

  /** Tocar no vídeo: foca nesse ponto (quando o telemóvel deixa) e volta à focagem contínua. */
  async function focarAqui(e: React.PointerEvent<HTMLVideoElement>) {
    const t = faixa.current; if (!t) return;
    const cap = (t.getCapabilities?.() ?? {}) as Capacidades;
    const r = e.currentTarget.getBoundingClientRect();
    const ponto = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    if (cap.focusMode?.includes('single-shot')) await aplicar({ focusMode: 'single-shot', pointsOfInterest: [ponto] });
    if (cap.focusMode?.includes('continuous')) window.setTimeout(() => void aplicar({ focusMode: 'continuous' }), 1200);
  }

  async function deFoto(lista: FileList | null) {
    const f = lista?.[0]; if (!f) return;
    setALerFoto(true); setErro(null);
    try {
      const v = await lerDeFicheiro(f);
      if (v) terminar(v); else setErro('Não encontrei nenhum código nessa fotografia. Tira outra com o código direito, a encher o centro da imagem.');
    } catch { setErro('Não consegui ler essa fotografia.'); }
    finally { setALerFoto(false); if (foto.current) foto.current.value = ''; }
  }

  return (
    <Modal aberto onFechar={aoFechar}>
      <p className="font-semibold">Aponta para o código de barras</p>
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={video} className="block aspect-[4/3] w-full object-cover" muted playsInline onPointerDown={(e) => void focarAqui(e)} />
        <div className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
      </div>
      <p className="text-xs text-slate-500">Mantém a uns 15–20 cm. Toca no vídeo para focar. A imagem não é guardada.</p>
      <div className="grid grid-cols-2 gap-2">
        {camaras.length > 1 && <button className="btn-secundario px-2 text-sm" onClick={() => { const n = (idx + 1) % camaras.length; setIdx(n); setPedido(n); }}>🔄 Outra câmara ({idx + 1}/{camaras.length})</button>}
        {zoom && <button className="btn-secundario px-2 text-sm" aria-pressed={ampliado} onClick={() => { const n = !ampliado; setAmpliado(n); void aplicar({ zoom: n ? Math.min(2, zoom.max) : Math.max(1, zoom.min) }); }}>{ampliado ? '🔍 Normal' : '🔍 Aproximar 2×'}</button>}
        {luz !== null && <button className="btn-secundario px-2 text-sm" aria-pressed={luz} onClick={() => { const n = !luz; setLuz(n); void aplicar({ torch: n }); }}>{luz ? '🔦 Desligar luz' : '🔦 Luz'}</button>}
      </div>
      <input ref={foto} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void deFoto(e.target.files)} />
      <button className="btn-secundario w-full" disabled={aLerFoto} onClick={() => foto.current?.click()}>{aLerFoto ? 'A ler a fotografia…' : '📸 Ler de uma fotografia (se não focar)'}</button>
      {erro && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
      <button className="btn-secundario w-full" onClick={aoFechar}>Cancelar</button>
    </Modal>
  );
}
