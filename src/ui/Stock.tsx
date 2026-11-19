import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Artigo } from '../db/schema';
import { normalizar } from '../db/consultas';
import {
  arquivarArtigo, atualizarArtigo, criarArtigo, definirEstadoCompra, definirQtdSugerida, listaCompras,
  registarContagem, anularContagem, situacao, stockPorArtigo, type StockArtigo
} from '../db/stock';
import { exportarComprasXlsx, exportarInventarioXlsx } from '../export/stock';
import { partilharOuDescarregar } from '../backup/partilha';
import { ir, substituir, voltar } from './router';
import { Aviso, Campo, Modal, dataPt } from './comuns';

/** Artigos + contagens + locais em dados simples (sem funções dentro da consulta). */
function useStock() {
  const artigos = useLiveQuery(() => db.artigos.filter((a) => !a.deletedAt).toArray(), []);
  const contagens = useLiveQuery(() => db.contagensStock.toArray(), []);
  const locais = useLiveQuery(() => db.localizacoes.toArray(), []);
  if (!artigos || !contagens || !locais) return undefined;
  const nomeLocal = (id: string) => {
    const l = locais.find((x) => x.id === id);
    return l ? (l.deletedAt ? `${l.nome} (eliminada)` : l.nome) : '?';
  };
  return {
    stocks: stockPorArtigo(artigos, contagens),
    contagens,
    locaisAtivos: locais.filter((l) => !l.deletedAt).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')),
    nomeLocal
  };
}

const fmt = (n: number) => n.toLocaleString('pt-PT', { maximumFractionDigits: 3 });
const euro = (n: number) => n.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });

function BadgeSituacao({ s }: { s: StockArtigo }) {
  const sit = situacao(s);
  if (sit === 'abaixo') return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Abaixo do mínimo</span>;
  if (sit === 'ok') return <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-800">OK</span>;
  return null;
}

export function EcraStock({ vista }: { vista: string }) {
  const dados = useStock();
  const [texto, setTexto] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  if (!dados) return null;

  const compras = listaCompras(dados.stocks);
  const emCompras = vista === 'compras';
  const termos = normalizar(texto).split(/\s+/).filter(Boolean);
  const lista = dados.stocks
    .filter((s) => termos.every((t) => normalizar([s.artigo.codigo, s.artigo.nome, s.artigo.categoria, s.artigo.fornecedor].join(' ')).includes(t)))
    .sort((a, b) => a.artigo.nome.localeCompare(b.artigo.nome, 'pt'));

  async function exportar(fazer: () => Promise<{ blob: Blob; nome: string }>) {
    setMsg(null);
    try {
      const { blob, nome } = await fazer();
      const r = await partilharOuDescarregar(blob, nome);
      if (r !== 'cancelado') setMsg({ tipo: 'ok', texto: `Guardado em Transferências: ${nome}.` });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Falhou: ${(e as Error).message}` });
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <button className={emCompras ? 'btn-secundario' : 'btn-primario'} onClick={() => ir('/stock')}>Artigos ({dados.stocks.length})</button>
        <button className={emCompras ? 'btn-primario' : 'btn-secundario'} onClick={() => ir('/stock?ver=compras')}>A comprar ({compras.length})</button>
      </div>

      {!emCompras ? (
        <>
          <div className="flex gap-2">
            <input className="campo" type="search" placeholder="Pesquisar artigo, categoria, fornecedor…" value={texto} onChange={(e) => setTexto(e.target.value)} />
            <button className="btn-primario shrink-0 px-5" onClick={() => ir('/stock/novo')} aria-label="Novo artigo">+</button>
          </div>
          {lista.length === 0 ? (
            <p className="cartao text-center text-sm text-slate-500">
              {dados.stocks.length === 0 ? 'Ainda não há artigos. Toca em + para criar o primeiro.' : 'Nenhum artigo com esta pesquisa.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {lista.map((s) => (
                <li key={s.artigo.id}>
                  <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir(`/stock/${s.artigo.id}`)}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold">{s.artigo.nome}</p>
                      <p className="shrink-0 font-semibold">{fmt(s.total)} <span className="text-sm font-normal text-slate-500">{s.artigo.unidade}</span></p>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {[s.artigo.codigo, s.artigo.categoria, s.artigo.stockMinimo !== null ? `mín. ${fmt(s.artigo.stockMinimo)}` : ''].filter(Boolean).join(' · ')}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5"><BadgeSituacao s={s} />{!s.ultimaContagem && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">Sem contagem</span>}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lista.length > 0 && (
            <button className="btn-secundario w-full" onClick={() => exportar(() => exportarInventarioXlsx(lista, dados.nomeLocal))}>Exportar inventário para Excel</button>
          )}
        </>
      ) : (
        <Compras linhas={compras} aoExportar={() => exportar(() => exportarComprasXlsx(compras))} />
      )}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </>
  );
}

function Compras({ linhas, aoExportar }: { linhas: ReturnType<typeof listaCompras>; aoExportar: () => void }) {
  const [erro, setErro] = useState<string | null>(null);
  const total = linhas.reduce((s, l) => s + (l.valor ?? 0), 0);
  const semPreco = linhas.some((l) => l.valor === null);

  async function guardarSugerida(id: string, valor: string) {
    setErro(null);
    try {
      await definirQtdSugerida(db, id, valor.trim() === '' ? null : valor);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (linhas.length === 0) return <p className="cartao text-center text-sm text-slate-500">Nada abaixo do mínimo. Define o stock mínimo nos artigos e faz contagens.</p>;
  return (
    <>
      <p className="text-sm text-slate-500">Isto é só uma lista: a app não faz encomendas. Ajusta a quantidade e marca como comprado quando comprares.</p>
      <ul className="space-y-2">
        {linhas.map((l) => {
          const comprado = l.artigo.estadoCompra === 'comprado';
          return (
            <li key={l.artigo.id} className={`cartao space-y-2 ${comprado ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <button className="text-left font-semibold" onClick={() => ir(`/stock/${l.artigo.id}`)}>{l.artigo.nome}</button>
                <span className="shrink-0 text-sm text-slate-500">{fmt(l.atual)} / mín. {fmt(l.minimo)} {l.artigo.unidade}</span>
              </div>
              <div className="flex items-end gap-2">
                <Campo rotulo={`Comprar (${l.artigo.unidade})`}>
                  <input className="campo" inputMode="decimal" key={`${l.artigo.id}-${l.sugerida}`} defaultValue={String(l.sugerida).replace('.', ',')} onBlur={(e) => guardarSugerida(l.artigo.id, e.target.value)} />
                </Campo>
                <button className={comprado ? 'btn-secundario' : 'btn-primario'} onClick={() => definirEstadoCompra(db, l.artigo.id, comprado ? 'por_comprar' : 'comprado')}>
                  {comprado ? 'Desfazer' : 'Comprado'}
                </button>
              </div>
              {(l.artigo.fornecedor || l.valor !== null) && (
                <p className="text-xs text-slate-500">{[l.artigo.fornecedor, l.valor !== null ? `≈ ${euro(l.valor)}` : ''].filter(Boolean).join(' · ')}</p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-sm font-medium">Total estimado: {euro(total)}{semPreco && <span className="font-normal text-slate-500"> (há artigos sem preço)</span>}</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <button className="btn-secundario w-full" onClick={aoExportar}>Exportar lista de compras para Excel</button>
    </>
  );
}

interface Form { nome: string; categoria: string; unidade: string; stockMinimo: string; qtdSugerida: string; fornecedor: string; preco: string; notas: string }
const txt = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));
const formDe = (a: Artigo | null): Form => ({
  nome: a?.nome ?? '', categoria: a?.categoria ?? '', unidade: a?.unidade ?? 'un', stockMinimo: txt(a?.stockMinimo ?? null),
  qtdSugerida: txt(a?.qtdSugerida ?? null), fornecedor: a?.fornecedor ?? '', preco: txt(a?.preco ?? null), notas: a?.notas ?? ''
});

export function FichaArtigo({ id }: { id: string }) {
  const novo = id === 'novo';
  const artigo = useLiveQuery(async (): Promise<Artigo | null | false> => {
    if (novo) return null;
    const a = await db.artigos.get(id);
    return a && !a.deletedAt ? a : false;
  }, [id]);
  const dados = useStock();
  if (artigo === undefined || !dados) return null;
  if (artigo === false) {
    return (<><p className="cartao">Este artigo não existe.</p><button className="btn-secundario w-full" onClick={() => voltar('/stock')}>Voltar</button></>);
  }
  const categorias = [...new Set(dados.stocks.map((s) => s.artigo.categoria).filter(Boolean))].sort();
  return <FormArtigo key={artigo?.id ?? 'novo'} artigo={artigo} dados={dados} categorias={categorias} />;
}

function FormArtigo({ artigo, dados, categorias }: { artigo: Artigo | null; dados: NonNullable<ReturnType<typeof useStock>>; categorias: string[] }) {
  const [f, setF] = useState<Form>(() => formDe(artigo));
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [arquivar, setArquivar] = useState(false);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const stock = artigo ? dados.stocks.find((s) => s.artigo.id === artigo.id) : undefined;

  async function guardar() {
    setAviso(null);
    try {
      if (!artigo) {
        const criado = await criarArtigo(db, f);
        substituir(`/stock/${criado.id}`);
      } else {
        await atualizarArtigo(db, artigo.id, f);
        setAviso({ tipo: 'ok', texto: 'Guardado.' });
      }
    } catch (e) {
      setAviso({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  async function confirmarArquivar() {
    if (!artigo) return;
    await arquivarArtigo(db, artigo.id);
    substituir('/stock');
  }

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/stock')}>← Stock</button>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{artigo ? artigo.codigo : 'Novo artigo'}</h2>
        {stock && <BadgeSituacao s={stock} />}
      </div>

      <div className="cartao space-y-3">
        <Campo rotulo="Nome *"><input className="campo" value={f.nome} onChange={set('nome')} autoComplete="off" /></Campo>
        <Campo rotulo="Categoria">
          <input className="campo" list="cat-artigos" value={f.categoria} onChange={set('categoria')} autoComplete="off" />
          <datalist id="cat-artigos">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Unidade"><input className="campo" value={f.unidade} onChange={set('unidade')} placeholder="un, kg, L…" autoComplete="off" /></Campo>
          <Campo rotulo="Stock mínimo" dica="Vazio = sem aviso"><input className="campo" inputMode="decimal" value={f.stockMinimo} onChange={set('stockMinimo')} /></Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Comprar de cada vez" dica="Vazio = mínimo − atual"><input className="campo" inputMode="decimal" value={f.qtdSugerida} onChange={set('qtdSugerida')} /></Campo>
          <Campo rotulo="Preço unitário (€)"><input className="campo" inputMode="decimal" value={f.preco} onChange={set('preco')} /></Campo>
        </div>
        <Campo rotulo="Fornecedor habitual"><input className="campo" value={f.fornecedor} onChange={set('fornecedor')} autoComplete="off" /></Campo>
        <Campo rotulo="Notas"><textarea className="campo min-h-20" value={f.notas} onChange={set('notas')} /></Campo>
        <button className="btn-primario w-full" onClick={guardar}>{artigo ? 'Guardar alterações' : 'Criar artigo'}</button>
      </div>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {artigo && stock && <Contar artigo={artigo} stock={stock} dados={dados} />}

      {artigo && <button className="btn-perigo w-full" onClick={() => setArquivar(true)}>Arquivar artigo</button>}
      <Modal aberto={arquivar} onFechar={() => setArquivar(false)}>
        <p className="font-semibold">Arquivar «{artigo?.nome}»?</p>
        <p className="text-sm text-slate-600">Deixa de aparecer nas listas. As contagens ficam guardadas na cópia de segurança.</p>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secundario" onClick={() => setArquivar(false)}>Cancelar</button>
          <button className="btn-perigo" onClick={confirmarArquivar}>Arquivar</button>
        </div>
      </Modal>
    </>
  );
}

function Contar({ artigo, stock, dados }: { artigo: Artigo; stock: StockArtigo; dados: NonNullable<ReturnType<typeof useStock>> }) {
  const [local, setLocal] = useState(stock.porLocal[0]?.localizacaoId ?? dados.locaisAtivos[0]?.id ?? '');
  const [qtd, setQtd] = useState('');
  const [obs, setObs] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const atualNoLocal = stock.porLocal.find((l) => l.localizacaoId === local)?.quantidade ?? null;
  const doArtigo = dados.contagens.filter((c) => c.artigoId === artigo.id && !c.deletedAt);
  const ultimaPorLocal = new Map<string, string>();
  for (const c of [...doArtigo].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) ultimaPorLocal.set(c.localizacaoId, c.id);
  const historico = doArtigo
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 15);

  async function registar() {
    setAviso(null);
    try {
      await registarContagem(db, artigo.id, local, qtd, obs);
      setQtd('');
      setObs('');
      setAviso({ tipo: 'ok', texto: 'Contagem registada.' });
    } catch (e) {
      setAviso({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  return (
    <>
      <div className="cartao space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="font-semibold">Stock</h3>
          <p className="font-semibold">{fmt(stock.total)} {artigo.unidade}</p>
        </div>
        {stock.porLocal.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {stock.porLocal.map((l) => (
              <li key={l.localizacaoId} className="flex justify-between py-1.5"><span>{dados.nomeLocal(l.localizacaoId)}</span><span>{fmt(l.quantidade)}</span></li>
            ))}
          </ul>
        )}
        {dados.locaisAtivos.length === 0 ? (
          <Aviso tipo="erro">Cria primeiro um local (separador Locais) para poderes contar.</Aviso>
        ) : (
          <>
            <Campo rotulo="Contar em">
              <select className="campo" value={local} onChange={(e) => setLocal(e.target.value)}>
                {dados.locaisAtivos.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
              </select>
            </Campo>
            <Campo rotulo={`Quantidade encontrada (${artigo.unidade})`} dica={atualNoLocal !== null ? `Última contagem aqui: ${fmt(atualNoLocal)}` : 'Ainda sem contagem neste local'}>
              <input className="campo" inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} />
            </Campo>
            <Campo rotulo="Observações"><input className="campo" value={obs} onChange={(e) => setObs(e.target.value)} autoComplete="off" /></Campo>
            <button className="btn-primario w-full" disabled={qtd.trim() === '' || !local} onClick={registar}>Registar contagem</button>
            <p className="text-xs text-slate-500">Conta o que encontras. A diferença para a contagem anterior é só uma variação: a app não a trata como consumo nem perda.</p>
          </>
        )}
        {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      </div>

      {historico.length > 0 && (
        <div className="cartao space-y-2">
          <h3 className="font-semibold">Histórico de contagens</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {historico.map((c) => (
              <li key={c.id} className="py-2">
                <div className="flex justify-between gap-2">
                  <span>{dados.nomeLocal(c.localizacaoId)}</span>
                  <span className="font-medium">{fmt(c.quantidade)}{c.diferenca !== null && c.diferenca !== 0 && <span className="ml-1 text-xs text-slate-500">({c.diferenca > 0 ? '+' : ''}{fmt(c.diferenca)})</span>}</span>
                </div>
                <p className="text-xs text-slate-500">{dataPt(c.createdAt)}{c.observacoes ? ` · ${c.observacoes}` : ''}</p>
                {ultimaPorLocal.get(c.localizacaoId) === c.id && (
                  <button className="mt-1 text-xs text-red-700 underline" onClick={async () => { try { await anularContagem(db, c.id); } catch (e) { setAviso({ tipo: 'erro', texto: (e as Error).message }); } }}>Anular esta contagem (engano)</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
