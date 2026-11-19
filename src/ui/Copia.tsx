import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { estadoCopia, exportarCopia, lerCopia, restaurarCopia, ErroCopia, type Manifesto } from '../backup/backup';
import { partilharOuDescarregar } from '../backup/partilha';
import { dataPt, ROTULOS } from './comuns';

export function Copia() {
  const estado = useLiveQuery(() => estadoCopia(db), []);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pendente, setPendente] = useState<{ ficheiro: File; manifesto: Manifesto } | null>(null);
  const [descarregado, setDescarregado] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function exportar() {
    setOcupado(true);
    setMsg(null);
    setDescarregado(null);
    try {
      const { blob, nome } = await exportarCopia(db);
      const r = await partilharOuDescarregar(blob, nome);
      if (r === 'descarregado') setDescarregado(nome);
      setMsg({
        tipo: 'ok',
        texto: r === 'cancelado'
          ? 'Cópia criada, mas a partilha foi cancelada. Volta a tocar para a enviar.'
          : r === 'partilhado'
            ? `Cópia enviada: ${nome}.`
            : `Cópia guardada em Transferências: ${nome}. Falta enviá-la para fora do telemóvel.`
      });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Falhou: ${(e as Error).message}` });
    } finally {
      setOcupado(false);
    }
  }

  async function escolher(f: File | undefined) {
    if (!f) return;
    setMsg(null);
    try {
      const { manifesto } = await lerCopia(f);
      setPendente({ ficheiro: f, manifesto });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof ErroCopia ? e.message : 'Não consegui ler o ficheiro.' });
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  async function confirmarRestauro() {
    if (!pendente) return;
    setOcupado(true);
    try {
      await restaurarCopia(db, pendente.ficheiro);
      setMsg({ tipo: 'ok', texto: 'Restauro concluído.' });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Restauro falhou; os dados atuais não foram alterados. ${(e as Error).message}` });
    } finally {
      setPendente(null);
      setOcupado(false);
    }
  }

  return (
    <>
      <div className="cartao space-y-1 text-sm">
        <p><span className="text-slate-500">Última cópia:</span> {dataPt(estado?.ultima ?? null)}</p>
        <p><span className="text-slate-500">Registos alterados desde então:</span> {estado?.alteracoesDesde ?? '—'}</p>
      </div>

      <button className="btn-primario w-full" disabled={ocupado} onClick={exportar}>
        Criar cópia de segurança (ZIP)
      </button>
      <p className="text-xs text-slate-500">Inclui todos os registos e fotografias. Fica em Transferências; depois envia-a para o teu e-mail.</p>

      <div className="cartao space-y-3">
        <p className="font-semibold">Restaurar de uma cópia</p>
        <p className="text-sm text-slate-600">Substitui <b>todos</b> os dados deste telemóvel pelos da cópia.</p>
        <input ref={input} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => escolher(e.target.files?.[0])} />
        <button className="btn-secundario w-full" disabled={ocupado} onClick={() => input.current?.click()}>Escolher ficheiro…</button>
      </div>

      {pendente && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-20 flex items-end bg-black/40 p-4">
          <div className="cartao mx-auto w-full max-w-xl space-y-3">
            <p className="font-semibold">Substituir todos os dados?</p>
            <p className="text-sm text-slate-600">
              Cópia de {dataPt(pendente.manifesto.exportadoEm)} —{' '}
              {Object.entries(pendente.manifesto.contagens).filter(([k]) => k !== 'meta' && k !== 'contadores').map(([k, v]) => `${v} ${(ROTULOS[k] ?? k).toLowerCase()}`).join(', ')}.
            </p>
            <p className="text-sm text-red-700">Os dados atuais deste telemóvel serão perdidos. Faz primeiro uma cópia se tiveres dúvidas.</p>
            <div className="grid grid-cols-2 gap-3">
              <button className="btn-secundario" onClick={() => setPendente(null)}>Cancelar</button>
              <button className="btn-perigo" disabled={ocupado} onClick={confirmarRestauro}>Substituir</button>
            </div>
          </div>
        </div>
      )}

      {descarregado && (
        <div className="cartao space-y-3 border-teal-300">
          <p className="font-semibold">Enviar a cópia para o teu e-mail</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Toca em <b>Abrir e-mail</b> e escreve o teu endereço em «Para».</li>
            <li>Toca no clipe 📎 → <b>Anexar ficheiro</b> → <b>Transferências</b>.</li>
            <li>Escolhe <b className="break-all">{descarregado}</b> e envia.</li>
          </ol>
          <a
            className="btn-primario w-full"
            href={`mailto:?subject=${encodeURIComponent(`Cópia Office Manager ${descarregado.slice(21, 31)}`)}&body=${encodeURIComponent(`Anexar: ${descarregado}`)}`}
          >
            Abrir e-mail
          </a>
          <p className="text-xs text-slate-500">O Android não deixa as apps web anexar ZIP automaticamente; por isso este passo é manual.</p>
        </div>
      )}

      {msg && (
        <p role="status" className={`rounded-xl p-3 text-sm ${msg.tipo === 'ok' ? 'bg-teal-50 text-teal-900' : 'bg-red-50 text-red-800'}`}>
          {msg.texto}
        </p>
      )}
    </>
  );
}
