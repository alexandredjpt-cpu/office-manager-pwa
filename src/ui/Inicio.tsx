import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { estadoGarantia } from '../db/garantia';
import { apagarDadosExemplo, criarDadosExemplo, soTemDadosExemplo } from '../db/exemplo';
import { estadoCopia } from '../backup/backup';
import { useInstalar } from './useInstalar';
import { ir } from './router';
import { Aviso, Modal, ROTULOS } from './comuns';

function AvisoCopia() {
  const estado = useLiveQuery(() => estadoCopia(db), []);
  if (!estado?.emFalta) return null;
  return (
    <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <p className="font-semibold text-amber-900">Faz uma cópia de segurança</p>
      <p className="mt-1 text-sm text-amber-900">{estado.motivo} Os dados só existem neste telemóvel.</p>
      <button className="btn-primario mt-3 w-full" onClick={() => ir('/copia')}>Fazer cópia agora</button>
    </div>
  );
}

function GarantiasATerminar() {
  const lista = useLiveQuery(async () => {
    const todas = await db.equipamentos.filter((e) => !e.deletedAt && e.estado !== 'abatido').toArray();
    return todas
      .map((e) => ({ e, g: estadoGarantia(e.fimGarantia) }))
      .filter((x) => x.g.estado === 'a_terminar')
      .sort((a, b) => a.g.dias! - b.g.dias!);
  }, []);
  if (!lista?.length) return null;
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <p className="font-semibold text-amber-900">Garantias a terminar ({lista.length})</p>
      <ul className="mt-2 space-y-1">
        {lista.map(({ e, g }) => (
          <li key={e.id}>
            <button className="flex w-full justify-between gap-2 text-left text-sm text-amber-900" onClick={() => ir(`/equipamentos/${e.id}`)}>
              <span>{e.nome}</span>
              <span className="shrink-0">{g.dias === 0 ? 'hoje' : `${g.dias} d`}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Inicio({ persistente }: { persistente: boolean | null }) {
  const { instalada, instalar } = useInstalar();
  const [aApagar, setAApagar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const contagens = useLiveQuery(async () => ({
    localizacoes: await db.localizacoes.filter((r) => !r.deletedAt).count(),
    equipamentos: await db.equipamentos.filter((r) => !r.deletedAt).count(),
    fotografias: await db.fotografias.filter((r) => !r.deletedAt).count()
  }), []);
  const soExemplo = useLiveQuery(() => soTemDadosExemplo(db), []);
  const vazio = contagens && contagens.localizacoes + contagens.equipamentos === 0;

  async function apagar() {
    try {
      await apagarDadosExemplo(db);
      setAApagar(false);
    } catch (e) {
      setErro((e as Error).message);
      setAApagar(false);
    }
  }

  return (
    <>
      <AvisoCopia />
      <GarantiasATerminar />

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

      <div className="grid grid-cols-2 gap-3">
        <button className="btn-primario" onClick={() => ir('/equipamentos')}>Equipamentos</button>
        <button className="btn-secundario" onClick={() => ir('/locais')}>Locais</button>
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
      {soExemplo && (
        <div className="cartao space-y-2 border-dashed">
          <p className="text-sm text-slate-600">Só tens dados de exemplo. Apaga-os para os teus registos começarem em <b>EQ-000001</b>.</p>
          <button className="btn-perigo w-full" onClick={() => setAApagar(true)}>Apagar dados de exemplo e começar do zero</button>
        </div>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Modal aberto={aApagar} onFechar={() => setAApagar(false)}>
        <p className="font-semibold">Apagar os dados de exemplo?</p>
        <p className="text-sm text-slate-600">Remove os locais e equipamentos fictícios e repõe os códigos. Só é possível porque ainda não tens nenhum registo real.</p>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secundario" onClick={() => setAApagar(false)}>Cancelar</button>
          <button className="btn-perigo" onClick={apagar}>Apagar</button>
        </div>
      </Modal>
    </>
  );
}
