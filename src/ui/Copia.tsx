import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { estadoCopia, exportarCopia, lerCopia, restaurarCopia, ErroCopia, ErroPalavraPasse, type Manifesto } from '../backup/backup';
import { MIN_PALAVRA_PASSE, validarPalavraPasse } from '../backup/cifra';
import { partilharOuDescarregar } from '../backup/partilha';
import { dataPt, Modal, ROTULOS } from './comuns';
import { apagarTudo } from '../db/exemplo';
import { substituir } from './router';

export function Copia() {
  const estado = useLiveQuery(() => estadoCopia(db), []);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pendente, setPendente] = useState<{ ficheiro: File; manifesto: Manifesto; palavraPasse?: string } | null>(null);
  const [proteger, setProteger] = useState(false);
  const [pp, setPp] = useState({ a: '', b: '' });
  const [pedirPp, setPedirPp] = useState<File | null>(null);
  const [ppRestauro, setPpRestauro] = useState('');
  const [descarregado, setDescarregado] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [reset, setReset] = useState(false);
  const [palavra, setPalavra] = useState('');

  async function exportar(semDocumentos = false) {
    setOcupado(true);
    setMsg(null);
    setDescarregado(null);
    try {
      if (proteger) validarPalavraPasse(pp.a, pp.b);
      const { blob, nome } = await exportarCopia(db, { semDocumentos, palavraPasse: proteger ? pp.a : undefined });
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
      setMsg({ tipo: 'erro', texto: e instanceof ErroPalavraPasse ? e.message : `Falhou: ${(e as Error).message}` });
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
      if (e instanceof ErroPalavraPasse) { setPpRestauro(''); setPedirPp(f); return; }
      setMsg({ tipo: 'erro', texto: e instanceof ErroCopia ? e.message : 'Não consegui ler o ficheiro.' });
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  async function abrirCifrada() {
    if (!pedirPp) return;
    setOcupado(true);
    try {
      const { manifesto } = await lerCopia(pedirPp, ppRestauro);
      setPendente({ ficheiro: pedirPp, manifesto, palavraPasse: ppRestauro });
      setPedirPp(null);
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof ErroCopia || e instanceof ErroPalavraPasse ? e.message : 'Não consegui ler o ficheiro.' });
      if (!(e instanceof ErroPalavraPasse)) setPedirPp(null);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarRestauro() {
    if (!pendente) return;
    setOcupado(true);
    try {
      await restaurarCopia(db, pendente.ficheiro, pendente.palavraPasse);
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

      <div className="cartao space-y-3">
        <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" className="h-5 w-5" checked={proteger} onChange={(e) => setProteger(e.target.checked)} /> Proteger a cópia com palavra-passe (recomendado)</label>
        {proteger && (
          <>
            <input className="campo" type="password" autoComplete="new-password" aria-label="Palavra-passe" placeholder={`Palavra-passe (mín. ${MIN_PALAVRA_PASSE})`} value={pp.a} onChange={(e) => setPp({ ...pp, a: e.target.value })} />
            <input className="campo" type="password" autoComplete="new-password" aria-label="Repetir palavra-passe" placeholder="Repetir palavra-passe" value={pp.b} onChange={(e) => setPp({ ...pp, b: e.target.value })} />
            <p className="text-xs text-slate-500">A cópia fica cifrada (AES-256): quem a apanhar no e-mail ou no Drive não a lê. A app não guarda a palavra-passe. <b>Se a esqueceres, a cópia não se recupera.</b></p>
          </>
        )}
      </div>
      <button className="btn-primario w-full" disabled={ocupado} onClick={() => exportar(false)}>
        Cópia completa (ZIP)
      </button>
      <p className="text-xs text-slate-500">Inclui registos, fotografias e documentos anexos. Fica em Transferências; depois envia-a para o teu e-mail.</p>
      <button className="btn-secundario w-full" disabled={ocupado} onClick={() => exportar(true)}>
        Cópia leve (sem documentos)
      </button>
      <p className="text-xs text-slate-500">Mais pequena. Ao restaurá-la, os documentos que tens no telemóvel mantêm-se.</p>

      <div className="cartao space-y-3">
        <p className="font-semibold">Restaurar de uma cópia</p>
        <p className="text-sm text-slate-600">Substitui <b>todos</b> os dados deste telemóvel pelos da cópia.</p>
        <input ref={input} type="file" accept=".zip,.omc,application/zip,application/octet-stream" className="hidden" onChange={(e) => escolher(e.target.files?.[0])} />
        <button className="btn-secundario w-full" disabled={ocupado} onClick={() => input.current?.click()}>Escolher ficheiro…</button>
      </div>

      {pedirPp && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-20 flex items-end bg-black/40 p-4">
          <div className="cartao mx-auto w-full max-w-xl space-y-3">
            <p className="font-semibold">Cópia protegida</p>
            <input className="campo" type="password" autoComplete="current-password" aria-label="Palavra-passe da cópia" placeholder="Palavra-passe" value={ppRestauro} onChange={(e) => setPpRestauro(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <button className="btn-secundario" onClick={() => setPedirPp(null)}>Cancelar</button>
              <button className="btn-primario" disabled={!ppRestauro || ocupado} onClick={() => void abrirCifrada()}>{ocupado ? 'A abrir…' : 'Abrir'}</button>
            </div>
          </div>
        </div>
      )}

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

      <div className="cartao space-y-3 border-red-200">
        <p className="font-semibold text-red-800">Começar do zero</p>
        <p className="text-sm text-slate-600">Apaga <b>todos</b> os dados deste telemóvel: locais, equipamentos, stock, anomalias, encomendas, contactos, kits, plantas, fotos e documentos. Os códigos voltam a começar em 000001. Não se pode desfazer.</p>
        <button className="btn-perigo w-full" onClick={() => { setPalavra(''); setReset(true); }}>Apagar todos os dados…</button>
      </div>

      <Modal aberto={reset} onFechar={() => setReset(false)}>
        <p className="font-semibold text-red-800">Apagar todos os dados?</p>
        <p className="text-sm text-slate-600">Se houver alguma coisa a guardar, faz primeiro a <b>Cópia completa</b> (acima). Uma cópia antiga continua a poder ser restaurada depois.</p>
        <label className="block text-sm">Escreve <b>APAGAR</b> para confirmar
          <input className="campo mt-1" value={palavra} onChange={(e) => setPalavra(e.target.value)} autoComplete="off" autoCapitalize="characters" aria-label="Confirmação" />
        </label>
        <button
          className="btn-perigo w-full"
          disabled={palavra.trim().toUpperCase() !== 'APAGAR' || ocupado}
          onClick={async () => {
            setOcupado(true);
            try { await apagarTudo(db, palavra); setReset(false); substituir('/'); }
            catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }); setReset(false); }
            finally { setOcupado(false); }
          }}
        >Apagar tudo</button>
        <button className="btn-secundario w-full" onClick={() => setReset(false)}>Cancelar</button>
      </Modal>
    </>
  );
}
