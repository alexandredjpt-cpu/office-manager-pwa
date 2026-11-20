import { useEffect, useRef, useState } from 'react';

/** Reconhecimento de voz do Chrome (Web Speech API). Sem bibliotecas. */
interface Resultado { isFinal: boolean; 0: { transcript: string } }
interface EventoVoz { resultIndex: number; results: ArrayLike<Resultado> }
interface Reconhecedor {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: EventoVoz) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type Construtor = new () => Reconhecedor;
const g = globalThis as unknown as { SpeechRecognition?: Construtor; webkitSpeechRecognition?: Construtor };
const API = g.SpeechRecognition ?? g.webkitSpeechRecognition;

export const ditadoSuportado = () => !!API;

const ERROS: Record<string, string> = {
  'not-allowed': 'Sem permissão para o microfone. Permite-o nas definições do site e tenta outra vez.',
  'service-not-allowed': 'O ditado não está disponível neste telemóvel.',
  'no-speech': 'Não ouvi nada. Toca outra vez e fala.',
  network: 'O ditado precisa de rede (o Chrome transcreve no serviço de voz da Google).',
  'audio-capture': 'Não encontrei microfone.'
};

/**
 * Botão 🎤: fala e devolve o texto (português de Portugal). Mostra o que vai ouvindo.
 * Nota: no Chrome o áudio é transcrito pelo serviço de voz da Google; a app não guarda áudio.
 */
export function BotaoDitar({ aoTexto, rotulo = '🎤 Ditar', className = 'btn-secundario' }: { aoTexto: (t: string) => void; rotulo?: string; className?: string }) {
  const [aOuvir, setAOuvir] = useState(false);
  const [parcial, setParcial] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const rec = useRef<Reconhecedor | null>(null);
  const cb = useRef(aoTexto);
  cb.current = aoTexto;
  useEffect(() => () => rec.current?.abort(), []);
  if (!API) return null;

  function comecar() {
    setErro(null); setParcial('');
    const r = new API!();
    r.lang = 'pt-PT'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let final = '';
    r.onresult = (e) => {
      let interino = '';
      for (let k = e.resultIndex; k < e.results.length; k++) {
        const x = e.results[k];
        if (x.isFinal) final += x[0].transcript; else interino += x[0].transcript;
      }
      setParcial((final + interino).trim());
    };
    r.onerror = (e) => { if (e.error !== 'aborted') setErro(ERROS[e.error] ?? 'O ditado falhou. Tenta outra vez.'); };
    r.onend = () => { setAOuvir(false); setParcial(''); rec.current = null; const t = final.trim(); if (t) cb.current(t); };
    rec.current = r;
    try { r.start(); setAOuvir(true); } catch { setErro('Não consegui começar o ditado.'); }
  }

  return (
    <div className="space-y-2">
      <button type="button" className={aOuvir ? 'btn-perigo w-full' : `${className} w-full`} onClick={() => (aOuvir ? rec.current?.stop() : comecar())}>
        {aOuvir ? '⏹ Parar (a ouvir…)' : rotulo}
      </button>
      {aOuvir && <p className="rounded-xl bg-slate-100 p-3 text-sm italic text-slate-700" aria-live="polite">{parcial || 'Fala agora…'}</p>}
      {erro && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
    </div>
  );
}
