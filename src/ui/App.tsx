import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { db } from '../db/schema';
import { criarDadosExemplo } from '../db/exemplo';
import { estadoCopia, exportarCopia, lerCopia, restaurarCopia, ErroCopia, type Manifesto } from '../backup/backup';
import { partilharOuDescarregar, pedirPersistencia } from '../backup/partilha';
import { useInstalar } from './useInstalar';

type Ecra = 'inicio' | 'copia';

const ROTULOS: Record<string, string> = { localizacoes: 'Localizações', equipamentos: 'Equipamentos', fotografias: 'Fotografias' };

const dataPt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function App() {
  const [ecra, setEcra] = useState<Ecra>('inicio');
  const [persistente, setPersistente] = useState<boolean | null>(null);
  const { needRefresh: [atualizar], updateServiceWorker } = useRegisterSW();

  useEffect(() => {
    pedirPersistencia().then(setPersistente).catch(() => setPersistente(null));
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-10 bg-teal-700 px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)] text-white">
        <h1 className="text-lg font-semibold">Office Manager</h1>
        <p className="text-xs text-teal-100">Pessoal · offline · sem servidor</p>
      </header>

      {atualizar && (
        <div className="m-4 flex items-center justify-between gap-3 rounded-xl bg-amber-100 p-3 text-sm">
          Nova versão disponível.
          <button className="btn-primario py-2" onClick={() => updateServiceWorker(true)}>Atualizar</button>
        </div>
      )}

      <main className="flex-1 space-y-4 p-4 pb-28">
        {ecra === 'inicio' ? <Inicio persistente={persistente} irCopia={() => setEcra('copia')} /> : <Copia />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-xl grid-cols-2">
          {(['inicio', 'copia'] as const).map((e) => (
            <button
              key={e}
              onClick={() => setEcra(e)}
              className={`py-4 text-sm font-medium ${ecra === e ? 'text-teal-700' : 'text-slate-500'}`}
              aria-current={ecra === e ? 'page' : undefined}
            >
              {e === 'inicio' ? 'Início' : 'Cópia de segurança'}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function AvisoCopia({ irCopia }: { irCopia: () => void }) {
  const estado = useLiveQuery(() => estadoCopia(db), []);
  if (!estado?.emFalta) return null;
  return (
    <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <p className="font-semibold text-amber-900">Faz uma cópia de segurança</p>
      <p className="mt-1 text-sm text-amber-900">{estado.motivo} Os dados só existem neste telemóvel.</p>
      <button className="btn-primario mt-3 w-full" onClick={irCopia}>Fazer cópia agora</button>
    </div>
  );
}

function Inicio({ persistente, irCopia }: { persistente: boolean | null; irCopia: () => void }) {
  const { instalada, instalar } = useInstalar();
  const contagens = useLiveQuery(async () => ({
    localizacoes: await db.localizacoes.filter((r) => !r.deletedAt).count(),
    equipamentos: await db.equipamentos.filter((r) => !r.deletedAt).count(),
    fotografias: await db.fotografias.filter((r) => !r.deletedAt).count()
  }), []);
  const vazio = contagens && contagens.localizacoes + contagens.equipamentos === 0;

  return (
    <>
      <AvisoCopia irCopia={irCopia} />

      {!instalada && (
        <div className="cartao">
          <p className="font-semibold">Instala a app no ecrã principal</p>
          <p className="mt-1 text-sm text-slate-600">Abre sem rede e protege melhor os dados guardados.</p>
          {instalar ? (
            <button className="btn-primario mt-3 w-full" onClick={instalar}>Instalar</button>
          ) : (
            <p className="mt-2 text-sm text-slate-600">No Chrome: menu ⋮ → <b>Instalar app</b>.</p>
          )}
        </div>
      )}

      <div className="cartao grid grid-cols-3 text-center">
        {contagens &&
          (Object.entries(contagens) as [string, number][]).map(([k, v]) => (
            <div key={k}>
              <p className="text-2xl font-semibold">{v}</p>
              <p className="text-xs text-slate-500">{ROTULOS[k]}</p>
            </div>
          ))}
      </div>

      <div className="cartao text-sm">
        <p className="font-semibold">Armazenamento</p>
        <p className="mt-1 text-slate-600">
          {persistente === true && '✅ Persistente: o Android não apaga estes dados para libertar espaço.'}
          {persistente === false && '⚠️ Não persistente. Instala a app e volta a abri-la; até lá, faz cópias com frequência.'}
          {persistente === null && 'A verificar…'}
        </p>
      </div>

      {vazio && (
        <button className="btn-secundario w-full" onClick={() => criarDadosExemplo(db)}>
          Criar dados de exemplo (fictícios)
        </button>
      )}

      <p className="text-center text-xs text-slate-400">Próximo bloco: localizações e equipamentos.</p>
    </>
  );
}

function Copia() {
  const estado = useLiveQuery(() => estadoCopia(db), []);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pendente, setPendente] = useState<{ ficheiro: File; manifesto: Manifesto } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function exportar() {
    setOcupado(true);
    setMsg(null);
    try {
      const { blob, nome } = await exportarCopia(db);
      const r = await partilharOuDescarregar(blob, nome);
      setMsg({
        tipo: 'ok',
        texto: r === 'cancelado'
          ? 'Cópia criada, mas a partilha foi cancelada. Volta a tocar para a enviar.'
          : `Cópia ${r === 'partilhado' ? 'enviada' : 'descarregada'}: ${nome}. Guarda-a fora deste telemóvel (e-mail ou Drive).`
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
        Criar e enviar cópia (ZIP)
      </button>
      <p className="text-xs text-slate-500">Inclui todos os registos e fotografias. Envia-a para o teu e-mail ou Drive.</p>

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

      {msg && (
        <p role="status" className={`rounded-xl p-3 text-sm ${msg.tipo === 'ok' ? 'bg-teal-50 text-teal-900' : 'bg-red-50 text-red-800'}`}>
          {msg.texto}
        </p>
      )}
    </>
  );
}
