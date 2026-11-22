import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ProdutoHavi } from '../db/schema';
import { guardarEmailHavi, guardarProdutoHavi, importarTabelaHavi, lerEmailHavi, moverProdutoHavi, montarEmailHavi, ordenarProdutos, proximaEntrega, removerProdutoHavi } from '../db/havi';
import { LIMITE_MAILTO, montarMailto } from '../db/emails';
import { voltar } from './router';
import { Aviso, Campo } from './comuns';

type Msg = { tipo: 'ok' | 'erro'; texto: string } | null;
const semAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Encomendas à HAVI: catálogo separado do stock, pesquisa por nome e e-mail preparado. */
export function Havi() {
  const produtos = useLiveQuery(() => db.produtosHavi.filter((p) => !p.deletedAt).toArray(), []);
  const [aba, setAba] = useState<'encomendar' | 'catalogo'>('encomendar');
  const [msg, setMsg] = useState<Msg>(null);
  if (!produtos) return null;
  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/mais')}>← Mais</button>
      <h2 className="text-xl font-semibold">Encomendas HAVI</h2>
      <p className="text-xs text-slate-500">Catálogo separado do stock. Entregas às terças e sextas, na abóboda. A app não envia nada: abre a tua app de e-mail.</p>
      <div className="grid grid-cols-2 gap-2">
        <button className={aba === 'encomendar' ? 'btn-primario' : 'btn-secundario'} onClick={() => setAba('encomendar')}>Encomendar</button>
        <button className={aba === 'catalogo' ? 'btn-primario' : 'btn-secundario'} onClick={() => setAba('catalogo')}>Catálogo ({produtos.length})</button>
      </div>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {aba === 'encomendar' ? <Encomendar produtos={produtos} /> : <Catalogo produtos={produtos} setMsg={setMsg} />}
    </>
  );
}

function Encomendar({ produtos }: { produtos: ProdutoHavi[] }) {
  const [busca, setBusca] = useState('');
  const [qtd, setQtd] = useState<Record<string, number>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [email, setEmail] = useState(lerEmailHavi);
  const termo = semAcentos(busca.trim());
  const ordenados = useMemo(() => ordenarProdutos(produtos), [produtos]);
  const lista = useMemo(
    () => ordenados.filter((p) => !termo || semAcentos(p.nome).includes(termo) || p.codigo.includes(termo)).slice(0, 60),
    [ordenados, termo]
  );
  const linhas = ordenados.filter((p) => (qtd[p.id] ?? 0) > 0).map((p) => ({ codigo: p.codigo, nome: p.nome, quantidade: qtd[p.id] }));
  const entrega = proximaEntrega(new Date()).toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: '2-digit' });

  function abrirEmail() {
    setErro(null);
    const env = montarEmailHavi(linhas, new Date());
    if (!email) { setErro('Falta o e-mail da HAVI (campo acima).'); return; }
    const url = montarMailto(email, env.assunto, env.corpo);
    if (url.length > LIMITE_MAILTO) { setErro('Pedido demasiado longo para o e-mail. Divide-o em dois pedidos.'); return; }
    window.location.href = url;
  }

  return (
    <div className="cartao space-y-3">
      <Campo rotulo="E-mail da HAVI (guardado neste telemóvel)">
        <input className="campo" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => guardarEmailHavi(email)} autoComplete="off" />
      </Campo>
      <p className="text-sm text-slate-600">Entrega prevista se enviares hoje: <strong>{entrega}</strong></p>
      <Campo rotulo="Pesquisar pelo nome">
        <input className="campo" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="ex.: pera, chá, copo" autoComplete="off" />
      </Campo>
      {produtos.length === 0 && <p className="text-sm text-slate-500">O catálogo está vazio. Cola a tabela no separador Catálogo.</p>}
      <ul className="divide-y divide-slate-100">
        {lista.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span><span className="text-xs text-slate-500">{p.codigo}</span> {p.nome}</span>
            <input type="number" min={0} inputMode="numeric" aria-label={`Quantidade de ${p.nome}`} className="campo w-20" value={qtd[p.id] ?? ''}
              onChange={(e) => setQtd((q) => ({ ...q, [p.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} />
          </li>
        ))}
      </ul>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <button className="btn-primario w-full" disabled={linhas.length === 0 || !email} onClick={abrirEmail}>
        Preparar e-mail ({linhas.length} produto{linhas.length === 1 ? '' : 's'})
      </button>
    </div>
  );
}

function Catalogo({ produtos, setMsg }: { produtos: ProdutoHavi[]; setMsg: (m: Msg) => void }) {
  const [cola, setCola] = useState('');
  const [editar, setEditar] = useState<{ id: string | null; codigo: string; nome: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function importar() {
    try {
      const r = await importarTabelaHavi(db, cola);
      setCola('');
      setMsg({ tipo: 'ok', texto: `Importados ${r.novos} produto(s) novo(s); ${r.atualizados} nome(s) atualizado(s).` });
    } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }); }
  }

  async function guardar() {
    if (!editar) return;
    try {
      await guardarProdutoHavi(db, editar.id, editar.codigo, editar.nome);
      setEditar(null); setErro(null);
    } catch (e) { setErro((e as Error).message); }
  }

  return (
    <>
      <section className="cartao space-y-3">
        <h3 className="font-semibold">Colar tabela</h3>
        <p className="text-xs text-slate-500">Uma linha por produto: código e nome. A quantidade e a unidade, se vierem, são ignoradas.</p>
        <textarea className="campo min-h-32 font-mono text-xs" value={cola} onChange={(e) => setCola(e.target.value)} placeholder={'10325001 COMPAL PERA\n13379001 COMPAL ML'} />
        <button className="btn-secundario w-full" disabled={!cola.trim()} onClick={() => void importar()}>Importar</button>
      </section>

      <section className="cartao space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Produtos</h3>
          <button className="btn-primario px-5" aria-label="Novo produto" onClick={() => { setErro(null); setEditar({ id: null, codigo: '', nome: '' }); }}>+</button>
        </div>
        {editar && (
          <div className="space-y-3">
            <Campo rotulo="Código *"><input className="campo" inputMode="numeric" value={editar.codigo} onChange={(e) => setEditar({ ...editar, codigo: e.target.value })} /></Campo>
            <Campo rotulo="Nome *"><input className="campo" value={editar.nome} onChange={(e) => setEditar({ ...editar, nome: e.target.value })} /></Campo>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <div className="grid grid-cols-2 gap-3">
              <button className="btn-secundario" onClick={() => setEditar(null)}>Cancelar</button>
              <button className="btn-primario" onClick={() => void guardar()}>Guardar</button>
            </div>
          </div>
        )}
        <ul className="divide-y divide-slate-100 text-sm">
          {ordenarProdutos(produtos).map((p, i, arr) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              <span><span className="text-xs text-slate-500">{p.codigo}</span> {p.nome}</span>
              <span className="flex items-center gap-3 text-xs">
                <button aria-label={`Subir ${p.nome}`} className="px-2 text-base text-slate-600 disabled:opacity-30" disabled={i === 0} onClick={() => void moverProdutoHavi(db, p.id, -1)}>▲</button>
                <button aria-label={`Descer ${p.nome}`} className="px-2 text-base text-slate-600 disabled:opacity-30" disabled={i === arr.length - 1} onClick={() => void moverProdutoHavi(db, p.id, 1)}>▼</button>
                <button className="text-teal-700 underline" onClick={() => { setErro(null); setEditar({ id: p.id, codigo: p.codigo, nome: p.nome }); }}>Editar</button>
                <button className="text-red-700 underline" onClick={() => void removerProdutoHavi(db, p.id)}>Remover</button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
