import { useEffect, useRef, useState } from 'react';
import { Modal } from './comuns';

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

function JanelaLeitor({ aoLer, aoFechar }: { aoLer: (v: string) => void; aoFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const lido = useRef(false);
  const callback = useRef(aoLer);
  callback.current = aoLer;

  useEffect(() => {
    let fluxo: MediaStream | null = null;
    let parar = false;
    let temporizador = 0;
    (async () => {
      try {
        const suportados = await API!.getSupportedFormats();
        const detetor = new API!({ formats: FORMATOS.filter((f) => suportados.includes(f)) });
        fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (parar) return;
        const v = video.current!;
        v.srcObject = fluxo;
        await v.play();
        const ciclo = async () => {
          if (parar || lido.current) return;
          try {
            if (v.readyState >= 2) {
              const r = (await detetor.detect(v)).find((x) => x.rawValue.trim());
              if (r && !lido.current) {
                lido.current = true;
                navigator.vibrate?.(80);
                callback.current(r.rawValue.trim());
                return;
              }
            }
          } catch { /* frame inválido: tenta no seguinte */ }
          temporizador = window.setTimeout(ciclo, 200);
        };
        void ciclo();
      } catch (e) {
        const n = (e as Error).name;
        setErro(n === 'NotAllowedError' ? 'Sem permissão para a câmara. Permite o acesso nas definições do site e tenta outra vez.' : n === 'NotFoundError' ? 'Não encontrei nenhuma câmara.' : 'Não consegui abrir a câmara.');
      }
    })();
    return () => { parar = true; window.clearTimeout(temporizador); fluxo?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <Modal aberto onFechar={aoFechar}>
      <p className="font-semibold">Aponta para o código de barras</p>
      {erro ? (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{erro}</p>
      ) : (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={video} className="block aspect-[4/3] w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
        </div>
      )}
      <p className="text-xs text-slate-500">Lê códigos de barras e QR. A imagem não é guardada.</p>
      <button className="btn-secundario w-full" onClick={aoFechar}>Cancelar</button>
    </Modal>
  );
}
