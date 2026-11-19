import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type EstadoEncomenda } from '../db/schema';
import {
  ESTADOS_ENCOMENDA, TRANSICOES, adicionarNota, arquivarFornecedor, atualizarFornecedor, criarEncomenda, criarFornecedor, definirLinha, emFalta,
  linhasAtivas, mudarEstadoEncomenda, registarRececao, removerLinha
} from '../db/encomendas';
import { listaCompras, stockPorArtigo } from '../db/stock';
import { hojeIso } from '../db/agenda';
import { lerResponsavel } from '../export/gerar';
import { ir, substituir, voltar } from './router';
import { Aviso, Campo, Modal, dataPt, diaPt } from './comuns';

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

export function ListaEncomendas() {
  const encs = useLiveQuery(() => db.encomendas.filter((e) => !e.deletedAt).toArray(), []);
  const forn = useLiveQuery(() => db.fornecedores.toArray(), []);
  const [ver, setVer] = useState<'abertas' | 'todas'>('abertas');
  const [novo, setNovo] = useState(false);
  const [fid, setFid] = useState('');
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
        <button className="btn-primario px-5" onClick={() => setNovo(true)} aria-label="Nova encomenda">+</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button className={ver === 'abertas' ? 'btn-primario' : 'btn-secundario'} onClick={() => setVer('abertas')}>Em curso</button>
        <button className={ver === 'todas' ? 'btn-primario' : 'btn-secundario'} onClick={() => setVer('todas')}>Todas</button>
      </div>
      <button className="btn-secundario w-full" onClick={() => ir('/fornecedores')}>Fornecedores ({ativos.length})</button>
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
        {ativos.length === 0 ? (
          <>
            <p className="text-sm text-slate-600">Cria primeiro um fornecedor.</p>
            <button className="btn-primario w-full" onClick={() => ir('/fornecedores/novo')}>Novo fornecedor</button>
          </>
        ) : (
          <>
            <Campo rotulo="Fornecedor">
              <select className="campo" value={fid} onChange={(e) => setFid(e.target.value)}>
                <option value="">Escolhe…</option>
                {ativos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </Campo>
            <button className="btn-primario w-full" disabled={!fid} onClick={() => exec(async () => { const e = await criarEncomenda(db, fid); setNovo(false); ir(`/encomendas/${e.id}`); })}>Criar rascunho</button>
          </>
        )}
        {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      </Modal>
    </>
  );
}

export function FichaEncomenda({ id }: { id: string }) {
  const e = useLiveQuery(() => db.encomendas.get(id), [id]);
  const forn = useLiveQuery(() => db.fornecedores.toArray(), []);
  const linhas = useLiveQuery(() => db.encomendaLinhas.where('encomendaId').equals(id).toArray(), [id]);
  const eventos = useLiveQuery(() => db.encomendaEventos.where('encomendaId').equals(id).toArray(), [id]);
  const artigos = useLiveQuery(() => db.artigos.toArray(), []);
  const contagens = useLiveQuery(() => db.contagensStock.toArray(), []);
  const locais = useLiveQuery(() => db.localizacoes.filter((l) => !l.deletedAt).toArray(), []);
  const { aviso, exec, setAviso } = useAviso();
  const [artigoId, setArtigoId] = useState('');
  const [qtd, setQtd] = useState('');
  const [nota, setNota] = useState('');
  const [fechar, setFechar] = useState(false);
  const [rec, setRec] = useState<Record<string, { aceite: string; danificada: string; rejeitada: string }>>({});
  const [local, setLocal] = useState('');
  const [dataRec, setDataRec] = useState(hojeIso());
  const [resp, setResp] = useState('');
  const [notasRec, setNotasRec] = useState('');
  useEffect(() => { void lerResponsavel(db).then(setResp); }, []);

  if (e === undefined || !forn || !linhas || !eventos || !artigos || !contagens || !locais) return null;
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
            {compras.length > 0 && (
              <button className="btn-secundario w-full" onClick={() => exec(async () => { for (const c of compras) await definirLinha(db, id, c.artigo.id, c.sugerida); }, `Juntei ${compras.length} artigo(s) da lista de compras. Ajusta as quantidades se quiseres.`)}>
                Juntar da lista de compras ({compras.length})
              </button>
            )}
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
            <button key={s} className={s === 'cancelada' ? 'btn-perigo w-full' : 'btn-primario w-full'} onClick={() => exec(() => mudarEstadoEncomenda(db, id, s))}>
              {s === 'pendente' ? 'Submeter para aprovação' : s === 'rascunho' ? 'Voltar a rascunho' : s === 'aprovada' ? 'Aprovar' : s === 'encomendada' ? 'Marcar como encomendada (já fiz o pedido)' : 'Cancelar encomenda'}
            </button>
          ))}
          {e.estado === 'parcial' && <button className="btn-secundario w-full" onClick={() => setFechar(true)}>Fechar como entregue (o resto não vem)</button>}
          {e.estado === 'aprovada' && <p className="text-xs text-slate-500">A app não envia o pedido. Faz a encomenda ao fornecedor por ti e depois marca-a.</p>}
        </div>
      )}
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

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
  if (!forn) return null;
  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/encomendas')}>← Encomendas</button>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Fornecedores</h2>
        <button className="btn-primario px-5" onClick={() => ir('/fornecedores/novo')} aria-label="Novo fornecedor">+</button>
      </div>
      {forn.length === 0 && <p className="cartao text-center text-sm text-slate-500">Sem fornecedores.</p>}
      <ul className="space-y-2">
        {forn.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((f) => (
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
  const [form, setForm] = useState<{ nome: string; contacto: string; telefone: string; email: string; notas: string } | null>(null);
  const { aviso, exec } = useAviso();
  if (f === undefined || !encs) return null;
  if (f === false || (f && f.deletedAt)) return (<><p className="cartao">Este fornecedor não existe.</p><button className="btn-secundario w-full" onClick={() => voltar('/fornecedores')}>Voltar</button></>);
  const v = form ?? { nome: f?.nome ?? '', contacto: f?.contacto ?? '', telefone: f?.telefone ?? '', email: f?.email ?? '', notas: f?.notas ?? '' };
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
        <Campo rotulo="Notas"><textarea className="campo min-h-16" value={v.notas} onChange={set('notas')} /></Campo>
        <button className="btn-primario w-full" onClick={() => exec(async () => { if (f) await atualizarFornecedor(db, f.id, v); else await criarFornecedor(db, v); }, f ? 'Guardado.' : undefined, () => { if (!f) substituir('/fornecedores'); setForm(null); })}>{f ? 'Guardar alterações' : 'Criar fornecedor'}</button>
      </div>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
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
