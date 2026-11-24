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
import { resumoHoje } from '../db/resumo';
import { BotaoDitar } from './Ditar';
import { MAX_NOTA, arquivarNota, criarNota, notasAbertas, rotaConverter } from '../db/notas';
import type { Nota } from '../db/schema';

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

function ResumoHoje() {
  const dados = useEventos();
  const r = useLiveQuery(async () => {
    const artigos = await db.artigos.filter((a) => !a.deletedAt).toArray();
    return {
      anomalias: await db.anomalias.filter((a) => !a.deletedAt && a.estado !== 'resolvida').toArray(),
      inspecoes: await db.inspecoes.where('estado').equals('em_curso').toArray(),
      aComprar: listaCompras(stockPorArtigo(artigos, await db.contagensStock.toArray())).filter((l) => l.artigo.estadoCompra === 'por_comprar').length,
      notas: (await notasAbertas(db)).length
    };
  }, []);
  if (!dados || !r) return null;
  const linhas = resumoHoje({ eventos: dados.eventos, ...r });
  const hoje = new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <section className="cartao" aria-label="Resumo de hoje">
      <p className="font-semibold">Hoje <span className="font-normal text-slate-500">· {hoje}</span></p>
      {linhas.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">✓ Nada pendente.</p>
      ) : (
        <ul className="mt-1 divide-y divide-slate-100">
          {linhas.map((l) => (
            <li key={l.chave}>
              <button className="flex w-full items-start gap-3 py-2.5 text-left" onClick={() => (l.rota ? ir(l.rota) : document.getElementById('notas')?.scrollIntoView({ behavior: 'smooth' }))}>
                <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${l.urgente ? 'bg-red-500' : 'bg-teal-600'}`} />
                <span className="flex-1">
                  <span className={`block text-sm font-medium ${l.urgente ? 'text-red-700' : ''}`}>{l.texto}</span>
                  <span className="text-xs text-slate-500">{l.detalhe}</span>
                </span>
                <span aria-hidden="true" className="text-slate-400">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NotasRapidas() {
  const notas = useLiveQuery(() => notasAbertas(db), []);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aArquivar, setAArquivar] = useState<Nota | null>(null);
  if (!notas) return null;

  async function guardar() {
    setErro(null);
    try { await criarNota(db, texto); setTexto(''); } catch (e) { setErro((e as Error).message); }
  }
  async function arquivar() {
    if (!aArquivar) return;
    try { await arquivarNota(db, aArquivar.id); } catch (e) { setErro((e as Error).message); }
    setAArquivar(null);
  }

  return (
    <section id="notas" className="cartao space-y-3" aria-label="Notas rápidas">
      <p className="font-semibold">Notas rápidas{notas.length ? ` (${notas.length})` : ''}</p>
      <textarea className="campo min-h-20" aria-label="Nova nota" maxLength={MAX_NOTA} placeholder="Ex.: estore da sala 2 a fazer barulho" value={texto} onChange={(e) => setTexto(e.target.value)} />
      <BotaoDitar rotulo="🎤 Ditar nota" aoTexto={(t) => setTexto((x) => (x.trim() ? `${x.trim()}\n${t}` : t))} />
      <button className="btn-primario w-full" disabled={!texto.trim()} onClick={guardar}>Guardar nota</button>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {notas.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {notas.map((n) => (
            <li key={n.id} className="space-y-2 py-3">
              <p className="whitespace-pre-wrap text-sm">{n.texto}</p>
              <p className="text-xs text-slate-500">{dataPt(n.createdAt)}</p>
              <div className="grid grid-cols-3 gap-2">
                <button className="btn-secundario px-2 py-2 text-sm" onClick={() => ir(rotaConverter(n, 'anomalia'))}>→ Anomalia</button>
                <button className="btn-secundario px-2 py-2 text-sm" onClick={() => ir(rotaConverter(n, 'lembrete'))}>→ Lembrete</button>
                <button className="btn-secundario px-2 py-2 text-sm" onClick={() => setAArquivar(n)}>Arquivar</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal aberto={aArquivar !== null} onFechar={() => setAArquivar(null)}>
        <p className="font-semibold">Arquivar esta nota?</p>
        <p className="text-sm text-slate-600">Sai do Início, mas fica guardada nos dados e na cópia de segurança.</p>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secundario" onClick={() => setAArquivar(null)}>Cancelar</button>
          <button className="btn-primario" onClick={arquivar}>Arquivar</button>
        </div>
      </Modal>
    </section>
  );
}

function AtividadeRecente() {
  const itens = useLiveQuery(async () => atividadeRecente({
    anomalias: await db.anomalias.toArray(), atividades: await db.atividades.toArray(), contagens: await db.contagensStock.toArray(), movimentos: await db.movimentosStock.toArray(),
    encomendas: await db.encomendas.toArray(), encomendaEventos: await db.encomendaEventos.toArray(), execucoes: await db.execucoes.toArray(), inspecoes: await db.inspecoes.toArray(),
    artigos: await db.artigos.toArray(), locais: await db.localizacoes.toArray(), manutencoes: await db.manutencoes.toArray()
  }), []);
  const [aberta, setAbertaEstado] = useState(() => { try { return localStorage.getItem('om.atividadeAberta') === '1'; } catch { return false; } });
  const setAberta = (f: (v: boolean) => boolean) => setAbertaEstado((v) => { const n = f(v); try { localStorage.setItem('om.atividadeAberta', n ? '1' : '0'); } catch { /* sem armazenamento: só nesta sessão */ } return n; });
  if (!itens || itens.length === 0) return null;
  return (
    <div className="cartao">
      <button className="flex w-full items-center justify-between text-left" aria-expanded={aberta} onClick={() => setAberta((v) => !v)}>
        <span className="font-semibold">Atividade recente</span>
        <span className="text-slate-500" aria-hidden="true">{aberta ? '▲' : '▼'}</span>
      </button>
      {aberta && <ul className="mt-1 divide-y divide-slate-100">
        {itens.map((x, i) => (
          <li key={`${x.quando}-${i}`}>
            <button className="w-full py-2 text-left" onClick={() => ir(x.rota)}>
              <span className="block text-sm">{x.texto}</span>
              <span className="text-xs text-slate-500">{dataPt(x.quando)}</span>
            </button>
          </li>
        ))}
      </ul>}
    </div>
  );
}

function PisosNoInicio() {
  const pisos = useLiveQuery(async () => {
    const locais = await db.localizacoes.filter((l) => !l.deletedAt).toArray();
    const cont = new Map<string, number>();
    for (const l of locais) {
      const p = (l.piso ?? '').trim();
      if (p) cont.set(p, (cont.get(p) ?? 0) + 1);
    }
    return [...cont.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt', { numeric: true }));
  }, []);
  if (!pisos || pisos.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Pisos">
      <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Pisos</p>
      <div className="grid grid-cols-2 gap-3">
        {pisos.map(([piso, n]) => (
          <button key={piso} className="btn-secundario" onClick={() => ir(`/locais?piso=${encodeURIComponent(piso)}`)}>
            Piso {piso} <span className="block text-xs font-normal text-slate-500">{n} {n === 1 ? 'local' : 'locais'}</span>
          </button>
        ))}
      </div>
    </section>
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
      <PisosNoInicio />
      {/* Atalhos, todos com o mesmo aspeto (a cor não quer dizer nada). */}
      <div className="grid grid-cols-2 gap-3">
        <button className="btn-secundario" onClick={() => ir('/equipamentos')}>Equipamentos</button>
        <button className="btn-secundario" onClick={() => ir('/anomalias')}>Anomalias</button>
        <button className="btn-secundario" onClick={() => ir('/plantas')}>Plantas</button>
        <button className="btn-secundario" onClick={() => ir('/agenda')}>Agenda</button>
        <button className="btn-secundario" onClick={() => ir('/inspecoes')}>Inspeções</button>
        <button className="btn-secundario" onClick={() => ir('/stock')}>Stock</button>
        <button className="btn-secundario col-span-2" onClick={() => ir('/encomendas')}>Encomendas</button>
      </div>
      <ResumoHoje />
      <Alertas />

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

      <div className="cartao text-sm">
        <p className="font-semibold">Armazenamento</p>
        <p className="mt-1 text-slate-600">
          {persistente === true && '✅ Persistente: o Android não apaga estes dados para libertar espaço.'}
          {persistente === false && '⚠️ Não persistente. Instala a app e volta a abri-la; até lá, faz cópias com frequência.'}
          {persistente === null && 'A verificar…'}
        </p>
      </div>

      <NotasRapidas />
      <AtividadeRecente />

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
