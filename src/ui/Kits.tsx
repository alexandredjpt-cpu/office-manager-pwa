import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import {
  adicionarArtigoAoKit, arquivarKit, atualizarKit, criarKit, definirAlvoKit, definirLocaisDoKit,
  linhasKitNoLocal, removerArtigoDoKit
} from '../db/kits';
import { registarContagem } from '../db/stock';
import { ir, substituir, voltar } from './router';
import { Aviso, Campo } from './comuns';

const fmt = (n: number) => n.toLocaleString('pt-PT', { maximumFractionDigits: 3 });

export function ListaKits() {
  const dados = useLiveQuery(async () => ({
    kits: (await db.kits.toArray()).filter((k) => !k.deletedAt),
    ligacoes: (await db.kitLocais.toArray()).filter((x) => !x.deletedAt)
  }), []);
  if (!dados) return null;
  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/mais')}>← Mais</button>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Kits</h2>
        <button className="btn-primario px-5" aria-label="Novo kit" onClick={() => ir('/kits/novo')}>+</button>
      </div>
      <p className="text-xs text-slate-500">Uma lista-modelo (ex.: Economato) que aplicas a vários locais de uma vez. Em cada local aparece uma caixa com a lista, pronta a contar.</p>
      {dados.kits.length === 0 && <p className="cartao text-center text-sm text-slate-500">Ainda não tens kits. Toca em + para criar o primeiro.</p>}
      <ul className="space-y-2">
        {dados.kits.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((k) => (
          <li key={k.id}>
            <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir(`/kits/${k.id}`)}>
              <span className="block font-semibold">{k.nome}</span>
              <span className="text-xs text-slate-500">{k.artigos.length} artigos · {dados.ligacoes.filter((x) => x.kitId === k.id).length} locais</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function FichaKit({ id }: { id: string }) {
  const novo = id === 'novo';
  const dados = useLiveQuery(async () => ({
    kit: novo ? null : ((await db.kits.get(id)) ?? null),
    artigos: (await db.artigos.toArray()).filter((a) => !a.deletedAt),
    locais: (await db.localizacoes.toArray()).filter((l) => !l.deletedAt),
    ligados: novo ? [] : (await db.kitLocais.where('kitId').equals(id).toArray()).filter((x) => !x.deletedAt).map((x) => x.localizacaoId)
  }), [id]);
  const [form, setForm] = useState<{ nome: string; notas: string } | null>(null);
  const [escolha, setEscolha] = useState('');
  const [sel, setSel] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  if (!dados) return null;
  const { kit, artigos, locais } = dados;
  if (!novo && (!kit || kit.deletedAt)) return (<><p className="cartao">Este kit não existe.</p><button className="btn-secundario w-full" onClick={() => voltar('/kits')}>Voltar</button></>);

  const v = form ?? { nome: kit?.nome ?? '', notas: kit?.notas ?? '' };
  const marcados = sel ?? dados.ligados;
  const nomeArtigo = (aid: string) => artigos.find((a) => a.id === aid);
  const disponiveis = artigos.filter((a) => !kit?.artigos.some((x) => x.artigoId === a.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));

  async function exec(fazer: () => Promise<unknown>, ok?: string) {
    setMsg(null);
    try { await fazer(); if (ok) setMsg({ tipo: 'ok', texto: ok }); } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }); }
  }
  async function guardar() {
    if (kit) await exec(async () => { await atualizarKit(db, kit.id, v); setForm(null); }, 'Guardado.');
    else await exec(async () => { const k = await criarKit(db, v); substituir(`/kits/${k.id}`); });
  }

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/kits')}>← Kits</button>
      <h2 className="text-xl font-semibold">{kit ? kit.nome : 'Novo kit'}</h2>
      <div className="cartao space-y-3">
        <Campo rotulo="Nome *"><input className="campo" value={v.nome} onChange={(e) => setForm({ ...v, nome: e.target.value })} autoComplete="off" placeholder="Ex.: Economato" /></Campo>
        <Campo rotulo="Notas"><textarea className="campo min-h-20" value={v.notas} onChange={(e) => setForm({ ...v, notas: e.target.value })} /></Campo>
        <button className="btn-primario w-full" onClick={() => void guardar()}>{kit ? 'Guardar alterações' : 'Criar kit'}</button>
      </div>

      {kit && (
        <>
          <div className="cartao space-y-3">
            <p className="font-semibold">Artigos do kit</p>
            <p className="text-xs text-slate-500">A quantidade-alvo por local é só uma referência: mostra «tens 3 de 5». Os alertas de compra continuam a depender só do stock mínimo geral de cada artigo.</p>
            {kit.artigos.length === 0 && <p className="text-sm text-slate-500">Sem artigos. Acrescenta abaixo.</p>}
            <ul className="space-y-2">
              {kit.artigos.map((ka) => {
                const a = nomeArtigo(ka.artigoId);
                return (
                  <li key={ka.artigoId} className="flex items-end gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{a ? a.nome : 'Artigo arquivado'}</p>
                      <input
                        aria-label={`Alvo por local de ${a?.nome ?? 'artigo'}`} className="campo mt-1" inputMode="decimal" placeholder={`Alvo por local${a ? ` (${a.unidade})` : ''}`}
                        key={`${ka.artigoId}-${ka.alvo}`} defaultValue={ka.alvo === null ? '' : String(ka.alvo).replace('.', ',')}
                        onBlur={(e) => void exec(() => definirAlvoKit(db, kit.id, ka.artigoId, e.target.value))}
                      />
                    </div>
                    <button className="btn-secundario" aria-label={`Tirar ${a?.nome ?? 'artigo'} do kit`} onClick={() => void exec(() => removerArtigoDoKit(db, kit.id, ka.artigoId))}>Tirar</button>
                  </li>
                );
              })}
            </ul>
            <Campo rotulo="Acrescentar artigo">
              <select className="campo" value={escolha} onChange={(e) => setEscolha(e.target.value)}>
                <option value="">Escolhe um artigo…</option>
                {disponiveis.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </select>
            </Campo>
            <button className="btn-secundario w-full" disabled={!escolha} onClick={() => void exec(async () => { await adicionarArtigoAoKit(db, kit.id, escolha); setEscolha(''); })}>Acrescentar ao kit</button>
            {artigos.length === 0 && <p className="text-xs text-slate-500">Ainda não há artigos. Cria-os primeiro em Stock.</p>}
            <button className="text-sm text-teal-700 underline" onClick={() => ir('/stock')}>Criar um artigo novo em Stock</button>
          </div>

          <div className="cartao space-y-3">
            <p className="font-semibold">Locais com este kit</p>
            <p className="text-xs text-slate-500">Marca os locais e guarda. Em cada um aparece a caixa «{kit.nome}». Não cria contagens: os artigos ficam «por contar» até os contares.</p>
            {locais.length === 0 && <p className="text-sm text-slate-500">Ainda não há locais.</p>}
            <ul className="space-y-1">
              {locais.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((l) => (
                <li key={l.id}>
                  <label className="flex items-center gap-3 py-1 text-sm">
                    <input type="checkbox" className="h-5 w-5" checked={marcados.includes(l.id)} onChange={(e) => setSel(e.target.checked ? [...marcados, l.id] : marcados.filter((x) => x !== l.id))} />
                    {l.nome}
                  </label>
                </li>
              ))}
            </ul>
            <button className="btn-primario w-full" disabled={sel === null} onClick={() => void exec(async () => { await definirLocaisDoKit(db, kit.id, marcados); setSel(null); }, 'Locais guardados.')}>Guardar locais</button>
          </div>
        </>
      )}

      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {kit && <button className="text-center text-sm text-red-700 underline" onClick={() => void exec(async () => { await arquivarKit(db, kit.id); substituir('/kits'); })}>Arquivar kit (as contagens mantêm-se)</button>}
    </>
  );
}

/** Caixas dos kits aplicados a um local, com contagem rápida. */
export function KitsNoLocal({ localId }: { localId: string }) {
  const dados = useLiveQuery(async () => {
    const lig = (await db.kitLocais.where('localizacaoId').equals(localId).toArray()).filter((x) => !x.deletedAt);
    const kits = (await db.kits.bulkGet(lig.map((x) => x.kitId))).filter((k) => k && !k.deletedAt);
    return { kits: kits as NonNullable<(typeof kits)[number]>[], artigos: await db.artigos.toArray(), contagens: await db.contagensStock.where('localizacaoId').equals(localId).toArray() };
  }, [localId]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  if (!dados || dados.kits.length === 0) return null;

  async function registar(chaves: string[]) {
    setMsg(null);
    let n = 0;
    try {
      for (const aid of chaves) {
        const t = (valores[aid] ?? '').trim();
        if (t === '') continue;
        await registarContagem(db, aid, localId, t);
        n++;
      }
      setValores((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !chaves.includes(k))));
      if (n > 0) setMsg({ tipo: 'ok', texto: `${n} contagem(ns) registada(s).` });
    } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }); }
  }

  return (
    <>
      {dados.kits.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((k) => {
        const linhas = linhasKitNoLocal(k, dados.artigos, dados.contagens, localId);
        const porContar = linhas.filter((l) => l.quantidade === null).length;
        return (
          <div key={k.id} className="cartao space-y-3">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{k.nome}</p>
              <button className="text-xs text-teal-700 underline" onClick={() => ir(`/kits/${k.id}`)}>Editar kit</button>
            </div>
            {porContar > 0 && <p className="text-xs text-amber-800">{porContar} por contar neste local.</p>}
            {linhas.length === 0 && <p className="text-sm text-slate-500">Kit sem artigos.</p>}
            <ul className="space-y-2">
              {linhas.map((l) => (
                <li key={l.artigo.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{l.artigo.nome}</p>
                    <p className={`text-xs ${l.abaixoAlvo ? 'text-amber-800' : 'text-slate-500'}`}>
                      {l.quantidade === null ? 'Por contar' : `Aqui: ${fmt(l.quantidade)} ${l.artigo.unidade}`}{l.alvo !== null ? ` · alvo ${fmt(l.alvo)}` : ''}{l.abaixoAlvo ? ' · abaixo do alvo' : ''}
                    </p>
                  </div>
                  <input
                    aria-label={`Contar ${l.artigo.nome}`} className="campo w-24 shrink-0" inputMode="decimal" placeholder="Contar"
                    value={valores[l.artigo.id] ?? ''} onChange={(e) => setValores((x) => ({ ...x, [l.artigo.id]: e.target.value }))}
                  />
                </li>
              ))}
            </ul>
            {linhas.length > 0 && <button className="btn-primario w-full" onClick={() => void registar(linhas.map((l) => l.artigo.id))}>Registar contagens preenchidas</button>}
          </div>
        );
      })}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </>
  );
}
