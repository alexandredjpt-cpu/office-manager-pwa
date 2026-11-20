import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { alertasAtivos } from '../db/agenda';
import { atividadeRecente } from '../db/atividade';
import { EventoLinha, useEventos } from './Agenda';
import { apagarDadosExemplo, criarDadosExemplo, soTemDadosExemplo } from '../db/exemplo';
import { estadoCopia } from '../backup/backup';
import { useInstalar } from './useInstalar';
import { ir } from './router';
import { Aviso, Modal, ROTULOS, dataPt } from './comuns';
import { listaCompras, stockPorArtigo } from '../db/stock';

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

function Alertas() {
  const dados = useEventos();
  if (!dados) return null;
  const lista = alertasAtivos(dados.eventos);
  if (lista.length === 0) return null;
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <p className="font-semibold text-amber-900">Alertas ({lista.length})</p>
      <ul className="mt-1 divide-y divide-amber-200">
        {lista.slice(0, 6).map((e) => <li key={e.chave}><EventoLinha e={e} /></li>)}
      </ul>
      {lista.length > 6 && <button className="mt-2 text-sm text-amber-900 underline" onClick={() => ir('/agenda')}>Ver todos na agenda</button>}
    </div>
  );
}

function AComprar() {
  const n = useLiveQuery(async () => {
    const artigos = await db.artigos.filter((a) => !a.deletedAt).toArray();
    return listaCompras(stockPorArtigo(artigos, await db.contagensStock.toArray())).filter((l) => l.artigo.estadoCompra === 'por_comprar').length;
  }, []);
  if (!n) return null;
  return (
    <button className="w-full rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left" onClick={() => ir('/stock?ver=compras')}>
      <p className="font-semibold text-amber-900">A comprar ({n})</p>
      <p className="text-sm text-amber-900">Artigos abaixo do stock mínimo.</p>
    </button>
  );
}

function AnomaliasAbertas() {
  const r = useLiveQuery(async () => {
    const abertas = (await db.anomalias.filter((a) => !a.deletedAt && a.estado !== 'resolvida').toArray());
    return { n: abertas.length, altas: abertas.filter((a) => a.prioridade === 'alta').length };
  }, []);
  if (!r?.n) return null;
  return (
    <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir('/anomalias')}>
      <p className="font-semibold">Anomalias abertas ({r.n})</p>
      <p className="text-sm text-slate-600">{r.altas > 0 ? `${r.altas} de prioridade alta.` : 'Nenhuma de prioridade alta.'}</p>
    </button>
  );
}

function InspecoesEmCurso() {
  const n = useLiveQuery(() => db.inspecoes.filter((i) => i.estado === 'em_curso').count(), []);
  if (!n) return null;
  return (
    <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir('/inspecoes')}>
      <p className="font-semibold">Inspeções em curso ({n})</p>
      <p className="text-sm text-slate-600">Por concluir.</p>
    </button>
  );
}

function AtividadeRecente() {
  const itens = useLiveQuery(async () => atividadeRecente({
    anomalias: await db.anomalias.toArray(), atividades: await db.atividades.toArray(), contagens: await db.contagensStock.toArray(), movimentos: await db.movimentosStock.toArray(),
    encomendas: await db.encomendas.toArray(), encomendaEventos: await db.encomendaEventos.toArray(), execucoes: await db.execucoes.toArray(), inspecoes: await db.inspecoes.toArray(),
    artigos: await db.artigos.toArray(), locais: await db.localizacoes.toArray(), manutencoes: await db.manutencoes.toArray()
  }), []);
  if (!itens || itens.length === 0) return null;
  return (
    <div className="cartao">
      <p className="font-semibold">Atividade recente</p>
      <ul className="mt-1 divide-y divide-slate-100">
        {itens.map((x, i) => (
          <li key={`${x.quando}-${i}`}>
            <button className="w-full py-2 text-left" onClick={() => ir(x.rota)}>
              <span className="block text-sm">{x.texto}</span>
              <span className="text-xs text-slate-500">{dataPt(x.quando)}</span>
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
    artigos: await db.artigos.filter((r) => !r.deletedAt).count(),
    anomalias: await db.anomalias.filter((r) => !r.deletedAt).count(),
    fotografias: await db.fotografias.filter((r) => !r.deletedAt).count()
  }), []);
  const soExemplo = useLiveQuery(() => soTemDadosExemplo(db), []);
  const vazio = contagens && contagens.localizacoes + contagens.equipamentos + contagens.artigos + contagens.anomalias === 0;

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
      <Alertas />
      <InspecoesEmCurso />
      <AnomaliasAbertas />
      <AComprar />
      <AtividadeRecente />

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

      <div className="cartao grid grid-cols-3 gap-y-3 text-center">
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
        <button className="btn-primario" onClick={() => ir('/stock')}>Stock</button>
        <button className="btn-primario" onClick={() => ir('/anomalias')}>Anomalias</button>
        <button className="btn-secundario" onClick={() => ir('/agenda')}>Agenda</button>
        <button className="btn-secundario" onClick={() => ir('/encomendas')}>Encomendas</button>
        <button className="btn-secundario" onClick={() => ir('/inspecoes')}>Inspeções</button>
        <button className="btn-secundario" onClick={() => ir('/plantas')}>Plantas</button>
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
