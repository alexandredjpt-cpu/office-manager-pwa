import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type EstadoEncomenda } from '../db/schema';
import {
  ESTADOS_ENCOMENDA, TRANSICOES, adicionarNota, arquivarFornecedor, resumoCompras, atualizarFornecedor, criarEncomenda, criarFornecedor, definirLinha, emFalta,
  linhasAtivas, mudarEstadoEncomenda, registarAprovacao, registarRececao, removerLinha, submeterParaAprovacao, lerUltimoAprovador
} from '../db/encomendas';
import { listaCompras, stockPorArtigo } from '../db/stock';
import { criarContacto } from '../db/contactos';
import { hojeIso } from '../db/agenda';
import { lerResponsavel } from '../export/gerar';
import { ir, substituir, voltar } from './router';
import { Aviso, Campo, Modal, SePodeEscrever, dataPt, diaPt } from './comuns';
import { Documentos } from './Documentos';
import { EscolhaCategorias, FiltroCategorias, GerirCategorias } from './CategoriasFornecedor';
import { temCategoria } from '../db/categorias';
import { EmailEncomenda } from './EmailEncomenda';
import { PedidoAprovacao } from './PedidoAprovacao';

const fmt = (n: number) => n.toLocaleString('pt-PT', { maximumFractionDigits: 3 });
type Msg = { tipo: 'ok' | 'erro'; texto: string } | null;

function useAviso() {
  const [aviso, setAviso] = useState<Msg>(null);
  async function exec(fn: () => Promise<unknown>, ok?: string, depois?: () => void) {
    setAviso(null);
    try { await fn(); if (ok) setAviso({ tipo: 'ok', texto: ok }); depois?.(); } catch (e) { setAviso({ tipo: 'erro', texto: (e as Error).message }); }
  }
  return { aviso, exec, setAviso };
}

const COR: Record<EstadoEncomenda, string> = {
  rascunho: 'bg-slate-100 text-slate-700', pendente: 'bg-amber-100 text-amber-800', aprovada: 'bg-sky-100 text-sky-800', encomendada: 'bg-indigo-100 text-indigo-800',
  parcial: 'bg-orange-100 text-orange-800', entregue: 'bg-emerald-100 text-emerald-800', cancelada: 'bg-red-100 text-red-800'
};
const BadgeEnc = ({ e }: { e: EstadoEncomenda }) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COR[e]}`}>{ESTADOS_ENCOMENDA[e]}</span>;

// ───────────── Encomendas ─────────────

export function ListaEncomendas({ anomalia = null }: { anomalia?: string | null }) {
  const encs = useLiveQuery(() => db.encomendas.filter((e) => !e.deletedAt).toArray(), []);
  const forn = useLiveQuery(() => db.fornecedores.toArray(), []);
  // Veio de uma anomalia («Criar encomenda para isto»): a encomenda nova fica ligada a ela.
  const origem = useLiveQuery(async () => (anomalia ? (await db.anomalias.get(anomalia)) ?? null : null), [anomalia]);
  const [ver, setVer] = useState<'abertas' | 'todas'>('abertas');
  const [novo, setNovo] = useState(!!anomalia);
  const [fid, setFid] = useState('');
  const [nomeNovo, setNomeNovo] = useState('');
  const { aviso, exec } = useAviso();
  if (!encs || !forn) return null;
  const ativos = forn.filter((f) => !f.deletedAt).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const nome = (id: string) => forn.find((f) => f.id === id)?.nome ?? '?';
  const lista = encs.filter((e) => ver === 'todas' || !['entregue', 'cancelada'].includes(e.estado)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/mais')}>← Mais</button>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Encomendas</h2>
        <SePodeEscrever><button className="btn-primario px-5" onClick={() => setNovo(true)} aria-label="Nova encomenda">+</button></SePodeEscrever>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button className={ver === 'abertas' ? 'btn-primario' : 'btn-secundario'} onClick={() => setVer('abertas')}>Em curso</button>
        <button className={ver === 'todas' ? 'btn-primario' : 'btn-secundario'} onClick={() => setVer('todas')}>Todas</button>
      </div>
      <button className="btn-secundario w-full" onClick={() => ir('/fornecedores')}>Fornecedores ({ativos.length})</button>
      <button className="btn-secundario w-full" onClick={() => ir('/catalogos')}>Caixas de encomenda (HAVI, Nespresso…)</button>
      <button className="btn-secundario w-full" onClick={() => ir('/modelos')}>Modelos de mensagem</button>
      {lista.length === 0 && <p className="cartao text-center text-sm text-slate-500">Sem encomendas. A app nunca envia nada: isto é só o teu registo.</p>}
      <ul className="space-y-2">
        {lista.map((e) => (
          <li key={e.id}>
            <button className="cartao flex w-full items-center justify-between text-left active:bg-slate-50" onClick={() => ir(`/encomendas/${e.id}`)}>
              <span><span className="block text-sm font-semibold">{e.codigo}</span><span className="text-xs text-slate-500">{nome(e.fornecedorId)} · {dataPt(e.createdAt)}</span></span>
              <BadgeEnc e={e.estado} />
            </button>
          </li>
        ))}
      </ul>
      <Modal aberto={novo} onFechar={() => setNovo(false)}>
        <p className="font-semibold">Nova encomenda</p>
        {origem && !origem.deletedAt && <p className="text-sm text-slate-600">Para a anomalia <strong>{origem.codigo}</strong>: {origem.titulo}</p>}
        <Campo rotulo="Fornecedor">
          <select className="campo" value={fid} onChange={(e) => setFid(e.target.value)}>
            <option value="">Escolhe…</option>
            {ativos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            <option value="__novo__">+ Novo fornecedor…</option>
          </select>
        </Campo>
        {fid === '__novo__' && <Campo rotulo="Nome do novo fornecedor *"><input className="campo" value={nomeNovo} onChange={(e) => setNomeNovo(e.target.value)} autoComplete="off" /></Campo>}
        <button className="btn-primario w-full" disabled={!fid || (fid === '__novo__' && !nomeNovo.trim())} onClick={() => exec(async () => {
          const f = fid === '__novo__' ? await criarFornecedor(db, { nome: nomeNovo }) : { id: fid };
          const ligada = origem && !origem.deletedAt ? origem : null;
          const e = await criarEncomenda(db, f.id, ligada ? `Para a anomalia ${ligada.codigo}: ${ligada.titulo}` : '', ligada?.id ?? null);
          setNovo(false); setFid(''); setNomeNovo(''); ir(`/encomendas/${e.id}`);
        })}>Criar rascunho</button>
        {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      </Modal>
    </>
  );
}

export function FichaEncomenda({ id }: { id: string }) {
  const e = useLiveQuery(() => db.encomendas.get(id), [id]);
  const forn = useLiveQuery(() => db.fornecedores.toArray(), []);
  const linhas = useLiveQuery(() => db.encomendaLinhas.where('encomendaId').equals(id).toArray(), [id]);
  const origemAn = useLiveQuery(async () => { const x = await db.encomendas.get(id); return x?.anomaliaId ? (await db.anomalias.get(x.anomaliaId)) ?? null : null; }, [id]);
  const eventos = useLiveQuery(() => db.encomendaEventos.where('encomendaId').equals(id).toArray(), [id]);
  const artigos = useLiveQuery(() => db.artigos.toArray(), []);
  const contagens = useLiveQuery(() => db.contagensStock.toArray(), []);
  const locais = useLiveQuery(() => db.localizacoes.filter((l) => !l.deletedAt).toArray(), []);
  const { aviso, exec, setAviso } = useAviso();
  const [artigoId, setArtigoId] = useState('');
  const [qtd, setQtd] = useState('');
  const [nota, setNota] = useState('');
  const [fechar, setFechar] = useState(false);
  const [submeter, setSubmeter] = useState(false);
  const [aprovadorSel, setAprovadorSel] = useState('');
  const [novoAp, setNovoAp] = useState({ nome: '', email: '', telefone: '' });
  const [aprovar, setAprovar] = useState(false);
  const [quem, setQuem] = useState('');
  const [notaAp, setNotaAp] = useState('');
  const contactos = useLiveQuery(() => db.contactos.filter((c) => !c.deletedAt).toArray(), []);
  const [rec, setRec] = useState<Record<string, { aceite: string; danificada: string; rejeitada: string }>>({});
  const [local, setLocal] = useState('');
  const [dataRec, setDataRec] = useState(hojeIso());
  const [resp, setResp] = useState('');
  const [notasRec, setNotasRec] = useState('');
  useEffect(() => { void lerResponsavel(db).then(setResp); }, []);

  if (e === undefined || !forn || !linhas || !eventos || !artigos || !contagens || !locais || !contactos) return null;
  if (!e || e.deletedAt) return (<><p className="cartao">Esta encomenda não existe.</p><button className="btn-secundario w-full" onClick={() => voltar('/encomendas')}>Voltar</button></>);

  const nomeArtigo = (aid: string) => artigos.find((a) => a.id === aid)?.nome ?? '?';
  const ls = linhasAtivas(linhas).sort((a, b) => nomeArtigo(a.artigoId).localeCompare(nomeArtigo(b.artigoId), 'pt'));
  const rascunho = e.estado === 'rascunho';
  const recebivel = e.estado === 'encomendada' || e.estado === 'parcial';
  const disponiveis = artigos.filter((a) => !a.deletedAt && !ls.some((l) => l.artigoId === a.id));
  const compras = listaCompras(stockPorArtigo(artigos.filter((a) => !a.deletedAt), contagens)).filter((c) => !ls.some((l) => l.artigoId === c.artigo.id));
  const campoRec = (aid: string) => rec[aid] ?? { aceite: '', danificada: '', rejeitada: '' };
  const setRecCampo = (aid: string, k: 'aceite' | 'danificada' | 'rejeitada', v: string) => setRec((r) => ({ ...r, [aid]: { ...campoRec(aid), [k]: v } }));
  const destinos = TRANSICOES[e.estado].filter((s) => s !== 'entregue');

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/encomendas')}>← Encomendas</button>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{e.codigo}</h2>
          <button className="text-sm text-teal-700 underline" onClick={() => ir(`/fornecedores/${e.fornecedorId}`)}>{forn.find((f) => f.id === e.fornecedorId)?.nome ?? '?'}</button>
        </div>
        <BadgeEnc e={e.estado} />
      </div>
      {origemAn && (
        <button className="cartao w-full text-left text-sm active:bg-slate-50" onClick={() => ir(`/anomalias/${origemAn.id}`)}>
          <span className="text-xs text-slate-500">Compra para a anomalia</span>
          <span className="block font-medium text-teal-700 underline">{origemAn.codigo} · {origemAn.titulo}</span>
        </button>
      )}

      <div className="cartao space-y-2">
        <h3 className="font-semibold">Artigos</h3>
        {ls.length === 0 && <p className="text-sm text-slate-500">Sem artigos.</p>}
        <ul className="divide-y divide-slate-100 text-sm">
          {ls.map((l) => {
            const a = artigos.find((x) => x.id === l.artigoId);
            return (
              <li key={l.id} className="flex items-start justify-between gap-2 py-2">
                <div>
                  <p className="font-medium">{nomeArtigo(l.artigoId)}</p>
                  {!rascunho && <p className="text-xs text-slate-500">aceite {fmt(l.aceite)}{l.danificada ? ` · danificada ${fmt(l.danificada)}` : ''}{l.rejeitada ? ` · rejeitada ${fmt(l.rejeitada)}` : ''}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p>{fmt(l.quantidade)} {a?.unidade}</p>
                  {rascunho && <button className="text-xs text-red-700 underline" onClick={() => exec(() => removerLinha(db, l.id))}>Remover</button>}
                </div>
              </li>
            );
          })}
        </ul>
        {rascunho && (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <div className="grid grid-cols-3 gap-2">
              <select className="campo col-span-2" aria-label="Artigo" value={artigoId} onChange={(x) => setArtigoId(x.target.value)}>
                <option value="">Artigo…</option>
                {disponiveis.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </select>
              <input className="campo" aria-label="Quantidade" placeholder="Qtd" inputMode="decimal" value={qtd} onChange={(x) => setQtd(x.target.value)} />
            </div>
            <button className="btn-secundario w-full" disabled={!artigoId || !qtd} onClick={() => exec(() => definirLinha(db, id, artigoId, qtd), undefined, () => { setArtigoId(''); setQtd(''); })}>Adicionar artigo</button>
            {([
              ['Juntar da lista de compras deste fornecedor', compras.filter((c) => c.artigo.fornecedorId === e.fornecedorId)],
              ['Juntar da lista de compras sem fornecedor associado', compras.filter((c) => !c.artigo.fornecedorId)]
            ] as const).map(([rotulo, itens]) => itens.length > 0 && (
              <button key={rotulo} className="btn-secundario w-full" onClick={() => exec(async () => { for (const c of itens) await definirLinha(db, id, c.artigo.id, c.sugerida); }, `Juntei ${itens.length} artigo(s) da lista de compras. Ajusta as quantidades se quiseres.`)}>
                {rotulo} ({itens.length})
              </button>
            ))}
          </div>
        )}
      </div>

      {recebivel && (
        <div className="cartao space-y-3">
          <h3 className="font-semibold">Registar receção</h3>
          <p className="text-xs text-slate-500">Só a quantidade aceite entra no stock. Danificadas e rejeitadas ficam registadas, mas não entram.</p>
          {ls.map((l) => (
            <div key={l.id} className="space-y-1">
              <p className="text-sm font-medium">{nomeArtigo(l.artigoId)} <span className="text-xs font-normal text-slate-500">(faltam {fmt(emFalta(l))})</span></p>
              <div className="grid grid-cols-3 gap-2">
                {(['aceite', 'danificada', 'rejeitada'] as const).map((k) => (
                  <input key={k} className="campo" aria-label={`${k} ${nomeArtigo(l.artigoId)}`} placeholder={k === 'aceite' ? 'Aceite' : k === 'danificada' ? 'Danif.' : 'Rejeit.'} inputMode="decimal" value={campoRec(l.artigoId)[k]} onChange={(x) => setRecCampo(l.artigoId, k, x.target.value)} />
                ))}
              </div>
            </div>
          ))}
          <Campo rotulo="Local onde entra o stock aceite">
            <select className="campo" value={local} onChange={(x) => setLocal(x.target.value)}>
              <option value="">Escolhe…</option>
              {locais.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Data"><input className="campo" type="date" value={dataRec} onChange={(x) => setDataRec(x.target.value)} /></Campo>
            <Campo rotulo="Responsável"><input className="campo" value={resp} onChange={(x) => setResp(x.target.value)} autoComplete="off" /></Campo>
          </div>
          <Campo rotulo="Notas"><input className="campo" value={notasRec} onChange={(x) => setNotasRec(x.target.value)} autoComplete="off" /></Campo>
          <button className="btn-primario w-full" onClick={() => exec(async () => {
            await registarRececao(db, id, { data: dataRec, localizacaoId: local, responsavel: resp, notas: notasRec, linhas: ls.map((l) => ({ artigoId: l.artigoId, ...campoRec(l.artigoId) })) });
            setRec({}); setNotasRec('');
          }, 'Receção registada.')}>Registar receção</button>
        </div>
      )}

      {(destinos.length > 0 || e.estado === 'parcial') && (
        <div className="cartao space-y-2">
          <h3 className="font-semibold">Estado</h3>
          {destinos.map((s) => (
            <button key={s} className={s === 'cancelada' ? 'btn-perigo w-full' : 'btn-primario w-full'} onClick={() => {
              if (s === 'pendente') { void lerUltimoAprovador(db).then((u) => setAprovadorSel(contactos.some((c) => c.id === u) ? u : '')); setSubmeter(true); }
              else if (s === 'aprovada') { const ap = contactos.find((c) => c.id === e.aprovadorId); setQuem(ap?.nome ?? ''); setNotaAp(''); setAprovar(true); }
              else void exec(() => mudarEstadoEncomenda(db, id, s));
            }}>
              {s === 'pendente' ? 'Submeter para aprovação' : s === 'rascunho' ? 'Voltar a rascunho' : s === 'aprovada' ? 'Registar aprovação' : s === 'encomendada' ? 'Marcar como encomendada (já fiz o pedido)' : 'Cancelar encomenda'}
            </button>
          ))}
          {e.estado === 'parcial' && <button className="btn-secundario w-full" onClick={() => setFechar(true)}>Fechar como entregue (o resto não vem)</button>}
          {e.estado === 'aprovada' && <p className="text-xs text-slate-500">A app não envia o pedido. Faz a encomenda ao fornecedor por ti e depois marca-a.</p>}
        </div>
      )}
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {e.estado === 'pendente' && <PedidoAprovacao encomenda={e} fornecedor={forn.find((f) => f.id === e.fornecedorId)} linhas={ls} artigos={artigos} />}
      <EmailEncomenda encomenda={e} fornecedor={forn.find((f) => f.id === e.fornecedorId)} linhas={ls} artigos={artigos} />
      <Documentos entidade="encomenda" entidadeId={id} />

      <div className="cartao space-y-2">
        <h3 className="font-semibold">Histórico</h3>
        <ul className="divide-y divide-slate-100 text-sm">
          {[...eventos].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((x) => (
            <li key={x.id} className="py-1.5"><p>{x.texto}</p><p className="text-xs text-slate-500">{dataPt(x.createdAt)}</p></li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input className="campo" placeholder="Adicionar nota…" value={nota} onChange={(x) => setNota(x.target.value)} />
          <button className="btn-secundario" disabled={!nota.trim()} onClick={() => exec(() => adicionarNota(db, id, nota), undefined, () => setNota(''))}>Nota</button>
        </div>
      </div>

      <Modal aberto={submeter} onFechar={() => setSubmeter(false)}>
        <p className="font-semibold">Submeter {e.codigo} para aprovação</p>
        <Campo rotulo="Quem aprova? (opcional)">
          <select className="campo" value={aprovadorSel} onChange={(x) => setAprovadorSel(x.target.value)}>
            <option value="">Ninguém em especial</option>
            {[...contactos].sort((a, b) => Number(b.aprovador) - Number(a.aprovador) || a.nome.localeCompare(b.nome, 'pt')).map((c) => <option key={c.id} value={c.id}>{c.nome}{c.aprovador ? ' (aprovador)' : ''}</option>)}
            <option value="__novo__">+ Novo contacto…</option>
          </select>
        </Campo>
        {aprovadorSel === '__novo__' && (
          <div className="space-y-3 rounded-xl border border-slate-200 p-3">
            <Campo rotulo="Nome *"><input className="campo" value={novoAp.nome} onChange={(x) => setNovoAp({ ...novoAp, nome: x.target.value })} autoComplete="off" /></Campo>
            <Campo rotulo="E-mail"><input className="campo" inputMode="email" value={novoAp.email} onChange={(x) => setNovoAp({ ...novoAp, email: x.target.value })} autoComplete="off" /></Campo>
            <Campo rotulo="Telefone / WhatsApp"><input className="campo" inputMode="tel" value={novoAp.telefone} onChange={(x) => setNovoAp({ ...novoAp, telefone: x.target.value })} /></Campo>
          </div>
        )}
        <button className="btn-primario w-full" disabled={aprovadorSel === '__novo__' && !novoAp.nome.trim()} onClick={() => exec(async () => {
          let apId: string | null = aprovadorSel || null;
          if (aprovadorSel === '__novo__') apId = (await criarContacto(db, { ...novoAp, aprovador: true })).id;
          await submeterParaAprovacao(db, id, apId);
          setNovoAp({ nome: '', email: '', telefone: '' });
        }, undefined, () => setSubmeter(false))}>Submeter</button>
        <p className="text-xs text-slate-500">Depois podes preparar o e-mail e o aviso por WhatsApp. A app não envia nada.</p>
        <button className="w-full text-sm text-slate-500" onClick={() => setSubmeter(false)}>Voltar</button>
      </Modal>
      <Modal aberto={aprovar} onFechar={() => setAprovar(false)}>
        <p className="font-semibold">Registar aprovação de {e.codigo}</p>
        <p className="text-xs text-slate-500">A app não verifica a aprovação: regista que já a recebeste.</p>
        <Campo rotulo="Aprovado por *"><input className="campo" value={quem} onChange={(x) => setQuem(x.target.value)} autoComplete="off" /></Campo>
        <Campo rotulo="Nota (ex.: confirmou por e-mail)"><input className="campo" value={notaAp} onChange={(x) => setNotaAp(x.target.value)} autoComplete="off" /></Campo>
        <button className="btn-primario w-full" disabled={!quem.trim()} onClick={() => exec(() => registarAprovacao(db, id, quem, notaAp), undefined, () => setAprovar(false))}>Registar aprovação</button>
        <button className="w-full text-sm text-slate-500" onClick={() => setAprovar(false)}>Voltar</button>
      </Modal>
      <Modal aberto={fechar} onFechar={() => setFechar(false)}>
        <p className="font-semibold">Fechar {e.codigo} como entregue?</p>
        <p className="text-sm text-slate-600">O que falta receber deixa de ser esperado. O stock já recebido mantém-se.</p>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secundario" onClick={() => setFechar(false)}>Voltar</button>
          <button className="btn-primario" onClick={() => exec(() => mudarEstadoEncomenda(db, id, 'entregue', 'Fechada com entrega parcial.'), undefined, () => { setFechar(false); setAviso(null); })}>Fechar</button>
        </div>
      </Modal>
    </>
  );
}

// ───────────── Fornecedores ─────────────

export function ListaFornecedores() {
  const forn = useLiveQuery(() => db.fornecedores.filter((f) => !f.deletedAt).toArray(), []);
  const [filtro, setFiltro] = useState<string[]>([]);
  const [gerir, setGerir] = useState(false);
  if (!forn) return null;
  const visiveis = forn.filter((f) => temCategoria(f.categorias, filtro));
  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/encomendas')}>← Encomendas</button>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Fornecedores</h2>
        <div className="flex items-center gap-2">
          <SePodeEscrever><button className="btn-secundario px-3 text-sm" onClick={() => setGerir(true)}>Categorias</button></SePodeEscrever>
          <SePodeEscrever><button className="btn-primario px-5" onClick={() => ir('/fornecedores/novo')} aria-label="Novo fornecedor">+</button></SePodeEscrever>
        </div>
      </div>
      <GerirCategorias aberto={gerir} onFechar={() => setGerir(false)} />
      <FiltroCategorias selecionadas={filtro} aoMudar={setFiltro} />
      {forn.length === 0 && <p className="cartao text-center text-sm text-slate-500">Sem fornecedores.</p>}
      {forn.length > 0 && visiveis.length === 0 && <p className="cartao text-center text-sm text-slate-500">Nenhum fornecedor nestas categorias.</p>}
      <ul className="space-y-2">
        {visiveis.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((f) => (
          <li key={f.id}>
            <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir(`/fornecedores/${f.id}`)}>
              <span className="block text-sm font-semibold">{f.nome}</span>
              <span className="text-xs text-slate-500">{[f.contacto, f.telefone, f.email].filter(Boolean).join(' · ') || 'Sem contactos'}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function FichaFornecedor({ id }: { id: string }) {
  const novo = id === 'novo';
  const f = useLiveQuery(async () => (novo ? null : ((await db.fornecedores.get(id)) ?? false)), [id]);
  const encs = useLiveQuery(() => db.encomendas.where('fornecedorId').equals(id).toArray(), [id]);
  const [form, setForm] = useState<{ nome: string; contacto: string; telefone: string; email: string; notas: string; nif: string; morada: string; categorias: string; condicoes: string; prazoPagamento: string } | null>(null);
  const linhasEnc = useLiveQuery(() => db.encomendaLinhas.toArray(), []);
  const artigosTodos = useLiveQuery(() => db.artigos.toArray(), []);
  const pessoas = useLiveQuery(() => db.contactos.filter((c) => !c.deletedAt && c.fornecedorId === id).toArray(), [id]);
  const { aviso, exec } = useAviso();
  if (f === undefined || !encs || !linhasEnc || !artigosTodos || !pessoas) return null;
  if (f === false || (f && f.deletedAt)) return (<><p className="cartao">Este fornecedor não existe.</p><button className="btn-secundario w-full" onClick={() => voltar('/fornecedores')}>Voltar</button></>);
  const v = form ?? { nome: f?.nome ?? '', contacto: f?.contacto ?? '', telefone: f?.telefone ?? '', email: f?.email ?? '', notas: f?.notas ?? '', nif: f?.nif ?? '', morada: f?.morada ?? '', categorias: f?.categorias ?? '', condicoes: f?.condicoes ?? '', prazoPagamento: f?.prazoPagamento ?? '' };
  const resumo = f ? resumoCompras(encs, linhasEnc, new Map(artigosTodos.map((a) => [a.id, a.preco ?? null]))) : null;
  const associados = f ? artigosTodos.filter((a) => !a.deletedAt && a.fornecedorId === f.id).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')) : [];
  const set = (k: keyof typeof v) => (x: { target: { value: string } }) => setForm({ ...v, [k]: x.target.value });

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/fornecedores')}>← Fornecedores</button>
      <h2 className="text-xl font-semibold">{f ? f.nome : 'Novo fornecedor'}</h2>
      <div className="cartao space-y-3">
        <Campo rotulo="Nome *"><input className="campo" value={v.nome} onChange={set('nome')} autoComplete="off" /></Campo>
        <Campo rotulo="Pessoa de contacto"><input className="campo" value={v.contacto} onChange={set('contacto')} autoComplete="off" /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Telefone"><input className="campo" inputMode="tel" value={v.telefone} onChange={set('telefone')} /></Campo>
          <Campo rotulo="E-mail"><input className="campo" inputMode="email" value={v.email} onChange={set('email')} autoComplete="off" /></Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="NIF"><input className="campo" inputMode="text" value={v.nif} onChange={set('nif')} autoComplete="off" placeholder="9 dígitos" /></Campo>
          <Campo rotulo="Prazo de pagamento"><input className="campo" value={v.prazoPagamento} onChange={set('prazoPagamento')} autoComplete="off" placeholder="Ex.: 30 dias" /></Campo>
        </div>
        <Campo rotulo="Morada"><textarea className="campo min-h-16" value={v.morada} onChange={set('morada')} /></Campo>
        <Campo rotulo="Categorias de produtos"><EscolhaCategorias valor={v.categorias} aoMudar={(x) => setForm({ ...v, categorias: x })} /></Campo>
        <Campo rotulo="Condições comerciais"><textarea className="campo min-h-16" value={v.condicoes} onChange={set('condicoes')} placeholder="Descontos, portes, encomenda mínima…" /></Campo>
        <Campo rotulo="Notas"><textarea className="campo min-h-16" value={v.notas} onChange={set('notas')} /></Campo>
        <button className="btn-primario w-full" onClick={() => exec(async () => { if (f) await atualizarFornecedor(db, f.id, v); else await criarFornecedor(db, v); }, f ? 'Guardado.' : undefined, () => { if (!f) substituir('/fornecedores'); setForm(null); })}>{f ? 'Guardar alterações' : 'Criar fornecedor'}</button>
      </div>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {f && <Documentos entidade="fornecedor" entidadeId={f.id} />}
      {f && (
        <div className="cartao space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Pessoas de contacto ({pessoas.length})</h3>
            <SePodeEscrever><button className="btn-secundario px-3 text-sm" onClick={() => ir('/contactos/novo')}>+ Pessoa</button></SePodeEscrever>
          </div>
          {pessoas.length === 0 && <p className="text-sm text-slate-500">Sem pessoas associadas. Cria uma em Mais → Contactos e escolhe esta empresa.</p>}
          <ul className="divide-y divide-slate-100 text-sm">
            {pessoas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((p) => (
              <li key={p.id}><button className="w-full py-2 text-left" onClick={() => ir(`/contactos/${p.id}`)}><span className="block font-medium">{p.nome}{p.funcao ? ` · ${p.funcao}` : ''}</span><span className="text-xs text-slate-500">{[p.telefone, p.email].filter(Boolean).join(' · ') || 'Sem telefone nem e-mail'}</span></button></li>
            ))}
          </ul>
        </div>
      )}
      {f && resumo && (
        <div className="cartao space-y-1 text-sm">
          <h3 className="font-semibold">Histórico de compras</h3>
          <p>{resumo.encomendas} encomenda(s) feitas · {resumo.entregues} entregue(s)</p>
          {resumo.valorEstimado > 0 && <p>Valor estimado: {resumo.valorEstimado.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })}{resumo.linhasSemPreco ? ` (sem preço em ${resumo.linhasSemPreco} linha(s))` : ''}</p>}
          <p className="text-xs text-slate-500">Estimativa com o preço atual de cada artigo; não é o valor faturado. Rascunhos e canceladas não contam.</p>
        </div>
      )}
      {f && associados.length > 0 && (
        <div className="cartao">
          <h3 className="font-semibold">Artigos deste fornecedor ({associados.length})</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {associados.map((a) => <li key={a.id}><button className="w-full py-2 text-left" onClick={() => ir(`/stock/${a.id}`)}>{a.codigo} · {a.nome}</button></li>)}
          </ul>
        </div>
      )}
      {f && encs.length > 0 && (
        <div className="cartao">
          <h3 className="font-semibold">Encomendas</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {encs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((e) => (
              <li key={e.id}><button className="flex w-full justify-between py-2" onClick={() => ir(`/encomendas/${e.id}`)}><span>{e.codigo} · {diaPt(e.createdAt.slice(0, 10))}</span><BadgeEnc e={e.estado} /></button></li>
            ))}
          </ul>
        </div>
      )}
      {f && <button className="text-center text-sm text-red-700 underline" onClick={() => exec(async () => { await arquivarFornecedor(db, f.id); substituir('/fornecedores'); })}>Arquivar fornecedor</button>}
    </>
  );
}
