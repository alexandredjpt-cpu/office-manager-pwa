import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type PedidoHavi, type ProdutoHavi } from '../db/schema';
import {
  MODELO_HAVI_PADRAO, diaDeEntregaHavi, diaDeIso, emailValido, guardarDestinatariosHavi, guardarHabituaisHavi, guardarModeloHavi, guardarProdutoHavi, guardarRascunhoHavi, habituaisDe,
  importarTabelaHavi, isoDia, lerDefinicoesHavi, migrarDefinicoesHavi, moverProdutoHavi, montarEmailHavi, montarMailtoHavi, ordenarProdutos,
  proximaEntrega, registarPedidoHavi, removerProdutoHavi, type DefinicoesHavi
} from '../db/havi';
import { LIMITE_MAILTO } from '../db/emails';
import { voltar } from './router';
import { Aviso, Campo } from './comuns';

type Msg = { tipo: 'ok' | 'erro'; texto: string } | null;
const semAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const diaLongo = (d: Date) => d.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });

/** Encomendas à HAVI: catálogo separado do stock, pesquisa por nome e e-mail preparado. */
export function Havi() {
  const produtos = useLiveQuery(() => db.produtosHavi.filter((p) => !p.deletedAt).toArray(), []);
  const pedidos = useLiveQuery(() => db.pedidosHavi.orderBy('createdAt').reverse().filter((p) => !p.deletedAt).limit(10).toArray(), []);
  const [defs, setDefs] = useState<DefinicoesHavi | null>(null);
  const [aba, setAba] = useState<'encomendar' | 'catalogo'>('encomendar');
  const [msg, setMsg] = useState<Msg>(null);
  // As definições leem-se uma vez (depois de migrar as da versão anterior); o ecrã guarda as alterações à medida.
  useEffect(() => { void migrarDefinicoesHavi(db).catch(() => undefined).then(() => lerDefinicoesHavi(db)).then(setDefs); }, []);
  if (!produtos || !pedidos || !defs) return null;
  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/encomendas')}>← Encomendas</button>
      <h2 className="text-xl font-semibold">Encomendas HAVI</h2>
      <p className="text-xs text-slate-500">Catálogo separado do stock. Entregas às terças e sextas. A app não envia nada: abre a tua app de e-mail.</p>
      <div className="grid grid-cols-2 gap-2">
        <button className={aba === 'encomendar' ? 'btn-primario' : 'btn-secundario'} onClick={() => { setMsg(null); setAba('encomendar'); }}>Encomendar</button>
        <button className={aba === 'catalogo' ? 'btn-primario' : 'btn-secundario'} onClick={() => { setMsg(null); setAba('catalogo'); }}>Catálogo ({produtos.length})</button>
      </div>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {aba === 'encomendar' ? <Encomendar produtos={produtos} pedidos={pedidos} inicial={defs} aoMudar={setDefs} /> : <Catalogo produtos={produtos} setMsg={setMsg} />}
    </>
  );
}

function Encomendar({ produtos, pedidos, inicial, aoMudar }: { produtos: ProdutoHavi[]; pedidos: PedidoHavi[]; inicial: DefinicoesHavi; aoMudar: (d: DefinicoesHavi) => void }) {
  const [busca, setBusca] = useState('');
  const [qtd, setQtd] = useState<Record<string, number>>(inicial.rascunho);
  const [destinatarios, setDestinatarios] = useState<string[]>(inicial.destinatarios);
  const [modelo, setModelo] = useState(inicial.modelo);
  const [novo, setNovo] = useState('');
  const [entregaIso, setEntregaIso] = useState(() => isoDia(proximaEntrega(new Date())));
  const [msg, setMsg] = useState<Msg>(null);
  // Ao mudar de separador e voltar, o ecrã recomeça do que está guardado.
  useEffect(() => { aoMudar({ destinatarios, modelo, rascunho: qtd }); }, [destinatarios, modelo, qtd, aoMudar]);

  const termo = semAcentos(busca.trim());
  const ordenados = useMemo(() => ordenarProdutos(produtos), [produtos]);
  const lista = useMemo(
    () => ordenados.filter((p) => !termo || semAcentos(p.nome).includes(termo) || p.codigo.includes(termo)).slice(0, 60),
    [ordenados, termo]
  );
  const linhas = ordenados.filter((p) => (qtd[p.id] ?? 0) > 0).map((p) => ({ codigo: p.codigo, nome: p.nome, quantidade: qtd[p.id] }));
  const entrega = diaDeIso(entregaIso);
  const email = entrega ? montarEmailHavi(linhas, entrega, modelo) : null;
  const pronto = linhas.length > 0 && !!email;
  const habituais = useMemo(() => habituaisDe(produtos), [produtos]);

  function mudarQtd(novas: Record<string, number>) {
    setQtd(novas);
    void guardarRascunhoHavi(db, novas).catch(() => undefined);
  }
  function mudarDestinatarios(l: string[]) {
    setDestinatarios(l);
    void guardarDestinatariosHavi(db, l).catch((e: Error) => setMsg({ tipo: 'erro', texto: e.message }));
  }

  async function copiar(texto: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(texto); return true; } catch { return false; }
  }

  async function prepararEmail() {
    if (!email) return;
    setMsg(null);
    if (destinatarios.length === 0) { setMsg({ tipo: 'erro', texto: 'Adiciona pelo menos um destinatário.' }); return; }
    await registarPedidoHavi(db, entregaIso, linhas).catch(() => undefined);
    let url = montarMailtoHavi(destinatarios, email.assunto, email.corpo);
    if (url.length > LIMITE_MAILTO) {
      // Pedido grande: o endereço do e-mail não aguenta o texto todo. Vai copiado e cola-se no corpo.
      const ok = await copiar(email.corpo);
      if (!ok) { setMsg({ tipo: 'erro', texto: 'O pedido é grande e não consegui copiá-lo. Abre «Ver o e-mail», copia o texto à mão e cola-o no e-mail.' }); return; }
      setMsg({ tipo: 'ok', texto: 'Pedido grande: o texto ficou copiado. No e-mail, toca no corpo da mensagem e escolhe «Colar».' });
      url = montarMailtoHavi(destinatarios, email.assunto, '');
    }
    window.location.href = url;
  }

  async function copiarPedido() {
    if (!email) return;
    await registarPedidoHavi(db, entregaIso, linhas).catch(() => undefined);
    setMsg((await copiar(email.corpo)) ? { tipo: 'ok', texto: 'Texto do pedido copiado.' } : { tipo: 'erro', texto: 'Não consegui copiar. Abre «Ver o e-mail» e copia à mão.' });
  }

  function repetir(p: PedidoHavi) {
    const novas: Record<string, number> = {};
    let fora = 0;
    for (const l of p.linhas) {
      const prod = produtos.find((x) => x.codigo === l.codigo);
      if (prod) novas[prod.id] = l.quantidade; else fora++;
    }
    mudarQtd(novas);
    setMsg({ tipo: 'ok', texto: `Quantidades do pedido de ${new Date(p.createdAt).toLocaleDateString('pt-PT')} repostas.${fora ? ` ${fora} produto(s) já não estão no catálogo.` : ''}` });
  }

  return (
    <>
      <div className="cartao space-y-3">
        <div className="space-y-2">
          <p className="text-sm font-medium">Destinatários</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {destinatarios.map((d, i) => (
              <li key={d} className="flex items-center justify-between gap-2 py-1">
                <span className="break-all"><span className="text-xs text-slate-500">{i === 0 ? 'Para' : 'Cópia'}</span> {d}</span>
                <button className="text-xs text-red-700 underline" onClick={() => mudarDestinatarios(destinatarios.filter((x) => x !== d))}>Remover</button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input className="campo flex-1" type="email" inputMode="email" aria-label="Novo destinatário" placeholder="novo@endereco" value={novo} onChange={(e) => setNovo(e.target.value)} autoComplete="off" />
            <button className="btn-secundario px-4" disabled={!emailValido(novo) || destinatarios.includes(novo.trim())} onClick={() => { mudarDestinatarios([...destinatarios, novo.trim()]); setNovo(''); }}>Adicionar</button>
          </div>
          {novo && !emailValido(novo) && <p className="text-xs text-red-700">Endereço inválido.</p>}
          <p className="text-xs text-slate-500">Ficam neste telemóvel e entram na cópia de segurança.</p>
        </div>

        <Campo rotulo="Dia de entrega">
          <input className="campo" type="date" value={entregaIso} onChange={(e) => setEntregaIso(e.target.value)} />
        </Campo>
        {entrega
          ? <p className="text-sm text-slate-600">{diaLongo(entrega)}{!diaDeEntregaHavi(entrega) && <span className="text-amber-800"> — atenção: a HAVI só entrega à terça e à sexta.</span>}</p>
          : <p className="text-sm text-red-700">Escolhe o dia de entrega.</p>}
        <p className="text-xs text-slate-500">A app propõe a próxima terça ou sexta. Se for feriado, muda o dia aqui.</p>

        <div className="grid grid-cols-2 gap-2">
          <button className="btn-secundario" disabled={pedidos.length === 0} onClick={() => pedidos[0] && repetir(pedidos[0])}>Repetir o último pedido</button>
          <button className="btn-secundario" disabled={Object.keys(habituais).length === 0} onClick={() => { mudarQtd(habituais); setMsg({ tipo: 'ok', texto: 'Pedido preenchido com as quantidades habituais. Ajusta o que for preciso.' }); }}>Quantidades habituais</button>
        </div>
        <Campo rotulo="Pesquisar pelo nome">
          <input className="campo" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="ex.: pera, chá, copo" autoComplete="off" />
        </Campo>
        {produtos.length === 0 && <p className="text-sm text-slate-500">O catálogo está vazio. Cola a tabela no separador Catálogo.</p>}
        <ul className="divide-y divide-slate-100">
          {lista.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span><span className="text-xs text-slate-500">{p.codigo}</span> {p.nome}{p.habitual ? <span className="text-xs text-slate-500"> · habitual {p.habitual}</span> : null}</span>
              <input type="number" min={0} inputMode="numeric" aria-label={`Quantidade de ${p.nome}`} className="campo w-20" value={qtd[p.id] || ''}
                onChange={(e) => mudarQtd({ ...qtd, [p.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
            </li>
          ))}
        </ul>

        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        <button className="btn-primario w-full" disabled={!pronto || destinatarios.length === 0} onClick={() => void prepararEmail()}>
          Preparar e-mail ({linhas.length} produto{linhas.length === 1 ? '' : 's'})
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-secundario" disabled={!pronto} onClick={() => void copiarPedido()}>Copiar pedido</button>
          <button className="btn-secundario" disabled={linhas.length === 0} onClick={() => { mudarQtd({}); setMsg(null); }}>Limpar quantidades</button>
        </div>
        <button className="btn-secundario w-full" disabled={linhas.length === 0} onClick={() => void guardarHabituaisHavi(db, qtd).then((n) => setMsg({ tipo: 'ok', texto: `Guardado: ${n} produto(s) com quantidade habitual.` })).catch((e: Error) => setMsg({ tipo: 'erro', texto: e.message }))}>Guardar estas quantidades como habituais</button>
        <p className="text-xs text-slate-500">As quantidades ficam guardadas até as limpares, mesmo que saias deste ecrã.</p>
        {email && linhas.length > 0 && (
          <details className="text-xs text-slate-600">
            <summary>Ver o e-mail</summary>
            <p className="mt-1 font-medium">{email.assunto}</p>
            <p className="mt-1 whitespace-pre-wrap break-words font-mono">{email.corpo}</p>
          </details>
        )}
      </div>

      <details className="cartao space-y-3">
        <summary className="font-semibold">Texto do e-mail</summary>
        <p className="text-xs text-slate-500">Escreve o teu texto. {'{{data}}'} é trocado pelo dia de entrega e {'{{produtos}}'} pela lista. Fica neste telemóvel e na cópia de segurança.</p>
        <textarea className="campo min-h-40" aria-label="Texto do e-mail" value={modelo} onChange={(e) => setModelo(e.target.value)} onBlur={() => void guardarModeloHavi(db, modelo).catch(() => undefined)} />
        <button className="btn-secundario w-full" onClick={() => { setModelo(MODELO_HAVI_PADRAO); void guardarModeloHavi(db, MODELO_HAVI_PADRAO).catch(() => undefined); }}>Repor texto padrão</button>
      </details>

      <section className="cartao space-y-2">
        <h3 className="font-semibold">Últimos pedidos</h3>
        {pedidos.length === 0 && <p className="text-sm text-slate-500">Ainda não preparaste nenhum pedido.</p>}
        <ul className="divide-y divide-slate-100 text-sm">
          {pedidos.map((p) => (
            <li key={p.id} className="space-y-1 py-2">
              <div className="flex items-center justify-between gap-2">
                <span>Preparado a {new Date(p.createdAt).toLocaleDateString('pt-PT')} · entrega {diaDeIso(p.entrega)?.toLocaleDateString('pt-PT') ?? p.entrega} · {p.linhas.length} produto(s)</span>
                <button className="shrink-0 text-xs text-teal-700 underline" onClick={() => repetir(p)}>Repetir</button>
              </div>
              <details className="text-xs text-slate-500"><summary>Ver produtos</summary><p className="mt-1 whitespace-pre-wrap">{p.linhas.map((l) => `${l.quantidade} × ${l.nome}`).join('\n')}</p></details>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-500">Fica registado o que preparaste. A app não sabe se o e-mail chegou a ser enviado.</p>
      </section>
    </>
  );
}

function Catalogo({ produtos, setMsg }: { produtos: ProdutoHavi[]; setMsg: (m: Msg) => void }) {
  const [cola, setCola] = useState('');
  const [editar, setEditar] = useState<{ id: string | null; codigo: string; nome: string; habitual: string } | null>(null);
  const [aRemover, setARemover] = useState<string | null>(null);
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
      await guardarProdutoHavi(db, editar.id, editar.codigo, editar.nome, Number(editar.habitual) || 0);
      setEditar(null); setErro(null);
    } catch (e) { setErro((e as Error).message); }
  }

  return (
    <>
      <section className="cartao space-y-3">
        <h3 className="font-semibold">Colar tabela</h3>
        <p className="text-xs text-slate-500">Uma linha por produto: código e nome. A quantidade e a unidade, se vierem, são ignoradas.</p>
        <textarea className="campo min-h-32 font-mono text-xs" aria-label="Tabela para importar" value={cola} onChange={(e) => setCola(e.target.value)} placeholder={'10325001 COMPAL PERA\n13379001 COMPAL ML'} />
        <button className="btn-secundario w-full" disabled={!cola.trim()} onClick={() => void importar()}>Importar</button>
      </section>

      <section className="cartao space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Produtos</h3>
          <button className="btn-primario px-5" aria-label="Novo produto" onClick={() => { setErro(null); setEditar({ id: null, codigo: '', nome: '', habitual: '' }); }}>+</button>
        </div>
        {editar && (
          <div className="space-y-3">
            <Campo rotulo="Código *"><input className="campo" inputMode="numeric" value={editar.codigo} onChange={(e) => setEditar({ ...editar, codigo: e.target.value })} /></Campo>
            <Campo rotulo="Nome *"><input className="campo" value={editar.nome} onChange={(e) => setEditar({ ...editar, nome: e.target.value })} /></Campo>
            <Campo rotulo="Quantidade habitual (opcional)"><input className="campo" type="number" min={0} inputMode="numeric" value={editar.habitual} onChange={(e) => setEditar({ ...editar, habitual: e.target.value })} /></Campo>
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
              <span><span className="text-xs text-slate-500">{p.codigo}</span> {p.nome}{p.habitual ? <span className="text-xs text-slate-500"> · habitual {p.habitual}</span> : null}</span>
              {aRemover === p.id ? (
                <span className="flex shrink-0 items-center gap-3 text-xs">
                  <button className="font-semibold text-red-700 underline" onClick={() => { setARemover(null); void removerProdutoHavi(db, p.id); }}>Remover mesmo</button>
                  <button className="text-slate-600 underline" onClick={() => setARemover(null)}>Não</button>
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-3 text-xs">
                  <button aria-label={`Subir ${p.nome}`} className="px-2 text-base text-slate-600 disabled:opacity-30" disabled={i === 0} onClick={() => void moverProdutoHavi(db, p.id, -1)}>▲</button>
                  <button aria-label={`Descer ${p.nome}`} className="px-2 text-base text-slate-600 disabled:opacity-30" disabled={i === arr.length - 1} onClick={() => void moverProdutoHavi(db, p.id, 1)}>▼</button>
                  <button className="text-teal-700 underline" onClick={() => { setErro(null); setEditar({ id: p.id, codigo: p.codigo, nome: p.nome, habitual: p.habitual ? String(p.habitual) : '' }); }}>Editar</button>
                  <button className="text-red-700 underline" onClick={() => setARemover(p.id)}>Remover</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
