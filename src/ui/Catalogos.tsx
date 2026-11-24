import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Catalogo, type PedidoHavi, type ProdutoHavi } from '../db/schema';
import {
  DIAS_SEMANA, MODELO_AVISO_PADRAO, MODELO_FALTA_PADRAO, MODELO_PADRAO, conferirPedido, criarCatalogo, diaDeEntrega, diaDeIso, emailValido, faltasDe,
  guardarCatalogo, guardarHabituais, guardarProduto, habitosDePedido, habituaisDe, importarTabela, isoDia, migrarParaCatalogos,
  montarEmail, montarEmailConferencia, montarEmailFalta, montarMailto, moverProduto, ordenarCatalogos, ordenarProdutos, proximaEntrega, registarPedido,
  removerCatalogo, removerProduto
} from '../db/catalogos';
import { LIMITE_MAILTO } from '../db/emails';
import { ir, voltar } from './router';
import { Aviso, Campo, SePodeEscrever } from './comuns';

type Msg = { tipo: 'ok' | 'erro'; texto: string } | null;
const semAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const diaLongo = (d: Date) => d.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });

/** Caixas de encomenda (HAVI, Nespresso, Delta, ...): catálogo próprio, fora do stock. */
export function Catalogos({ id }: { id: string | null }) {
  const [migrado, setMigrado] = useState(false);
  // Na primeira abertura passa a antiga caixa única da HAVI para a lista e cria as caixas pedidas.
  useEffect(() => { void migrarParaCatalogos(db, ['Nespresso', 'Delta']).catch(() => undefined).finally(() => setMigrado(true)); }, []);
  const caixas = useLiveQuery(() => db.catalogos.toArray(), []);
  if (!migrado || !caixas) return null;
  const lista = ordenarCatalogos(caixas);
  const atual = id ? lista.find((c) => c.id === id) : null;
  if (id && !atual) {
    return (
      <>
        <button className="text-sm text-teal-700" onClick={() => ir('/catalogos')}>← Caixas de encomenda</button>
        <Aviso tipo="erro">Esta caixa já não existe.</Aviso>
      </>
    );
  }
  return atual ? <Caixa key={atual.id} cat={atual} /> : <Lista lista={lista} />;
}

function Lista({ lista }: { lista: Catalogo[] }) {
  const contagens = useLiveQuery(async () => {
    const produtos = (await db.produtosHavi.toArray()).filter((p) => !p.deletedAt);
    return produtos.reduce<Record<string, number>>((a, p) => ({ ...a, [p.catalogoId]: (a[p.catalogoId] ?? 0) + 1 }), {});
  }, []);
  const [nome, setNome] = useState('');
  const [aCriar, setACriar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    try {
      const c = await criarCatalogo(db, nome);
      setNome(''); setACriar(false); setErro(null);
      ir(`/catalogos/${c.id}`);
    } catch (e) { setErro((e as Error).message); }
  }

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/encomendas')}>← Encomendas</button>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Caixas de encomenda</h2>
        <SePodeEscrever><button className="btn-primario px-5" aria-label="Nova caixa" onClick={() => { setErro(null); setACriar(true); }}>+</button></SePodeEscrever>
      </div>
      <p className="text-xs text-slate-500">Uma caixa por fornecedor, com o catálogo e o e-mail dele. Nada disto entra no stock.</p>
      {aCriar && (
        <div className="cartao space-y-3">
          <Campo rotulo="Nome da caixa *"><input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Nespresso" autoComplete="off" /></Campo>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-secundario" onClick={() => { setACriar(false); setErro(null); }}>Cancelar</button>
            <button className="btn-primario" disabled={!nome.trim()} onClick={() => void criar()}>Criar</button>
          </div>
        </div>
      )}
      {lista.length === 0 && !aCriar && <p className="text-sm text-slate-500">Ainda não tens caixas. Toca em + para criar a primeira.</p>}
      {lista.map((c) => (
        <button key={c.id} className="cartao w-full text-left active:bg-slate-50" onClick={() => ir(`/catalogos/${c.id}`)}>
          <p className="font-semibold">{c.nome}</p>
          <p className="text-sm text-slate-500">
            {contagens?.[c.id] ?? 0} produto(s)
            {c.diasEntrega.length > 0 && ` · entrega ${c.diasEntrega.map((d) => DIAS_SEMANA[d].toLowerCase()).join(' e ')}`}
          </p>
        </button>
      ))}
    </>
  );
}

function Caixa({ cat }: { cat: Catalogo }) {
  const produtos = useLiveQuery(() => db.produtosHavi.where('catalogoId').equals(cat.id).filter((p) => !p.deletedAt).toArray(), [cat.id]);
  const pedidos = useLiveQuery(
    async () => (await db.pedidosHavi.where('catalogoId').equals(cat.id).filter((p) => !p.deletedAt).toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20),
    [cat.id]
  );
  const [aba, setAba] = useState<'encomendar' | 'catalogo' | 'definicoes'>('encomendar');
  const [msg, setMsg] = useState<Msg>(null);
  if (!produtos || !pedidos) return null;
  const abas = [['encomendar', 'Encomendar'], ['catalogo', `Catálogo (${produtos.length})`], ['definicoes', 'Definições']] as const;
  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => ir('/catalogos')}>← Caixas de encomenda</button>
      <h2 className="text-xl font-semibold">{cat.nome}</h2>
      <p className="text-xs text-slate-500">Catálogo separado do stock. A app não envia nada: abre a tua app de e-mail.</p>
      <div className="grid grid-cols-3 gap-2">
        {abas.map(([chave, rotulo]) => (
          <button key={chave} className={aba === chave ? 'btn-primario' : 'btn-secundario'} onClick={() => { setMsg(null); setAba(chave); }}>{rotulo}</button>
        ))}
      </div>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {aba === 'encomendar' && <Encomendar cat={cat} produtos={produtos} pedidos={pedidos} />}
      {aba === 'catalogo' && <CatalogoProdutos cat={cat} produtos={produtos} setMsg={setMsg} />}
      {aba === 'definicoes' && <Definicoes cat={cat} setMsg={setMsg} />}
    </>
  );
}

function Encomendar({ cat, produtos, pedidos }: { cat: Catalogo; produtos: ProdutoHavi[]; pedidos: PedidoHavi[] }) {
  const [busca, setBusca] = useState('');
  const [qtd, setQtd] = useState<Record<string, number>>(cat.rascunho ?? {});
  const [entregaIso, setEntregaIso] = useState(() => isoDia(proximaEntrega(new Date(), cat.diasEntrega, cat.antecedencia)));
  const [msg, setMsg] = useState<Msg>(null);

  const termo = semAcentos(busca.trim());
  const ordenados = useMemo(() => ordenarProdutos(produtos), [produtos]);
  const lista = useMemo(
    () => ordenados.filter((p) => !termo || semAcentos(p.nome).includes(termo) || p.codigo.includes(termo)).slice(0, 60),
    [ordenados, termo]
  );
  const habituais = useMemo(() => habituaisDe(produtos), [produtos]);
  const habitos = useMemo(() => habitosDePedido(pedidos), [pedidos]);
  const linhas = ordenados.filter((p) => (qtd[p.id] ?? 0) > 0).map((p) => ({ codigo: p.codigo, nome: p.nome, quantidade: qtd[p.id] }));
  const entrega = diaDeIso(entregaIso);
  const email = entrega ? montarEmail(linhas, entrega, cat.modelo) : null;
  const pronto = linhas.length > 0 && !!email;

  function mudarQtd(novas: Record<string, number>) {
    setQtd(novas);
    void guardarCatalogo(db, cat.id, { rascunho: Object.fromEntries(Object.entries(novas).filter(([, q]) => q > 0)) }).catch(() => undefined);
  }

  async function copiar(texto: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(texto); return true; } catch { return false; }
  }

  async function prepararEmail() {
    if (!email) return;
    setMsg(null);
    if (cat.destinatarios.length === 0) { setMsg({ tipo: 'erro', texto: 'Falta o destinatário. Põe-no no separador Definições.' }); return; }
    await registarPedido(db, cat.id, entregaIso, linhas).catch(() => undefined);
    let url = montarMailto(cat.destinatarios, email.assunto, email.corpo);
    if (url.length > LIMITE_MAILTO) {
      // Pedido grande: o endereço do e-mail não aguenta o texto todo. Vai copiado e cola-se no corpo.
      const ok = await copiar(email.corpo);
      if (!ok) { setMsg({ tipo: 'erro', texto: 'O pedido é grande e não consegui copiá-lo. Abre «Ver o e-mail», copia o texto à mão e cola-o no e-mail.' }); return; }
      setMsg({ tipo: 'ok', texto: 'Pedido grande: o texto ficou copiado. No e-mail, toca no corpo da mensagem e escolhe «Colar».' });
      url = montarMailto(cat.destinatarios, email.assunto, '');
    }
    window.location.href = url;
  }

  async function copiarPedido() {
    if (!email) return;
    await registarPedido(db, cat.id, entregaIso, linhas).catch(() => undefined);
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
        <Campo rotulo="Dia de entrega">
          <input className="campo" type="date" value={entregaIso} onChange={(e) => setEntregaIso(e.target.value)} />
        </Campo>
        {entrega
          ? <p className="text-sm text-slate-600">{diaLongo(entrega)}{!diaDeEntrega(entrega, cat.diasEntrega) && <span className="text-amber-800"> — atenção: a {cat.nome} só entrega {cat.diasEntrega.map((d) => DIAS_SEMANA[d].toLowerCase()).join(' e ')}.</span>}</p>
          : <p className="text-sm text-red-700">Escolhe o dia de entrega.</p>}
        {cat.diasEntrega.length > 0 && <p className="text-xs text-slate-500">A app propõe a próxima entrega possível. Se for feriado, muda o dia aqui.</p>}

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
              <span>
                <span className="text-xs text-slate-500">{p.codigo}</span> {p.nome}
                {p.habitual ? <span className="text-xs text-slate-500"> · habitual {p.habitual}</span> : null}
                {habitos[p.codigo] && <span className="block text-xs text-slate-500">pedido {habitos[p.codigo].vezes}× · costumas pedir {habitos[p.codigo].normal}</span>}
              </span>
              <input type="number" min={0} inputMode="numeric" aria-label={`Quantidade de ${p.nome}`} className="campo w-20" value={qtd[p.id] || ''}
                onChange={(e) => mudarQtd({ ...qtd, [p.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
            </li>
          ))}
        </ul>

        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        <button className="btn-primario w-full" disabled={!pronto} onClick={() => void prepararEmail()}>
          Preparar e-mail ({linhas.length} produto{linhas.length === 1 ? '' : 's'})
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-secundario" disabled={!pronto} onClick={() => void copiarPedido()}>Copiar pedido</button>
          <button className="btn-secundario" disabled={linhas.length === 0} onClick={() => { mudarQtd({}); setMsg(null); }}>Limpar quantidades</button>
        </div>
        <button className="btn-secundario w-full" disabled={linhas.length === 0} onClick={() => void guardarHabituais(db, cat.id, qtd).then((n) => setMsg({ tipo: 'ok', texto: `Guardado: ${n} produto(s) com quantidade habitual.` })).catch((e: Error) => setMsg({ tipo: 'erro', texto: e.message }))}>Guardar estas quantidades como habituais</button>
        <p className="text-xs text-slate-500">As quantidades ficam guardadas até as limpares, mesmo que saias deste ecrã. «Pedido 4×» conta os últimos {pedidos.length} pedidos.</p>
        {email && linhas.length > 0 && (
          <details className="text-xs text-slate-600">
            <summary>Ver o e-mail</summary>
            <p className="mt-1 font-medium">{email.assunto}</p>
            <p className="mt-1 whitespace-pre-wrap break-words font-mono">{email.corpo}</p>
          </details>
        )}
      </div>

      <section className="cartao space-y-2">
        <h3 className="font-semibold">Últimos pedidos</h3>
        {pedidos.length === 0 && <p className="text-sm text-slate-500">Ainda não preparaste nenhum pedido.</p>}
        <ul className="divide-y divide-slate-100 text-sm">
          {pedidos.slice(0, 8).map((p) => <Pedido key={p.id} cat={cat} pedido={p} aoRepetir={() => repetir(p)} />)}
        </ul>
        <p className="text-xs text-slate-500">Fica registado o que preparaste. A app não sabe se o e-mail chegou a ser enviado.</p>
      </section>
    </>
  );
}

/** Uma linha do histórico: ver, repetir e conferir o que chegou. */
function Pedido({ cat, pedido, aoRepetir }: { cat: Catalogo; pedido: PedidoHavi; aoRepetir: () => void }) {
  const [recebido, setRecebido] = useState<Record<string, number> | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const faltas = faltasDe(pedido);
  const entrega = diaDeIso(pedido.entrega);

  function emailFalta() {
    if (!entrega) return;
    if (cat.destinatarios.length === 0) { setMsg({ tipo: 'erro', texto: 'Falta o destinatário. Põe-no no separador Definições.' }); return; }
    const e = montarEmailFalta(faltas, entrega, cat.modeloFalta);
    window.location.href = montarMailto(cat.destinatarios, e.assunto, e.corpo);
  }

  function emailAviso() {
    if (!entrega) return;
    const para = cat.avisoDestinatarios ?? [];
    if (para.length === 0) { setMsg({ tipo: 'erro', texto: 'Falta quem avisar. Põe os endereços em Definições → Avisar a entrega.' }); return; }
    const e = montarEmailConferencia(pedido, entrega, cat.modeloAviso);
    window.location.href = montarMailto(para, e.assunto, e.corpo);
  }

  return (
    <li className="space-y-1 py-2">
      <div className="flex items-center justify-between gap-2">
        <span>
          Preparado a {new Date(pedido.createdAt).toLocaleDateString('pt-PT')} · entrega {entrega?.toLocaleDateString('pt-PT') ?? pedido.entrega} · {pedido.linhas.length} produto(s)
          {pedido.conferidoEm && (
            <span className={`block text-xs ${faltas.length ? 'text-amber-800' : 'text-slate-500'}`}>
              {faltas.length ? `Faltaram ${faltas.length} produto(s).` : 'Conferido: chegou tudo.'}
            </span>
          )}
        </span>
        <button className="shrink-0 text-xs text-teal-700 underline" onClick={aoRepetir}>Repetir</button>
      </div>
      <details className="text-xs text-slate-500"><summary>Ver produtos</summary><p className="mt-1 whitespace-pre-wrap">{pedido.linhas.map((l) => `${l.quantidade} × ${l.nome}`).join('\n')}</p></details>

      {recebido ? (
        <div className="space-y-2 rounded-lg bg-slate-50 p-2">
          <p className="text-xs text-slate-600">Escreve o que chegou de cada produto. Já vem preenchido com o que pediste.</p>
          <ul className="divide-y divide-slate-200">
            {pedido.linhas.map((l) => (
              <li key={l.codigo} className="flex items-center justify-between gap-2 py-1">
                <span>{l.nome} <span className="text-xs text-slate-500">(pedi {l.quantidade})</span></span>
                <input type="number" min={0} max={l.quantidade} inputMode="numeric" aria-label={`Chegaram de ${l.nome}`} className="campo w-20"
                  value={recebido[l.codigo] ?? 0} onChange={(e) => setRecebido({ ...recebido, [l.codigo]: Math.max(0, Math.min(l.quantidade, Math.floor(Number(e.target.value) || 0))) })} />
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secundario" onClick={() => setRecebido(null)}>Cancelar</button>
            <button className="btn-primario" onClick={() => void conferirPedido(db, pedido.id, recebido).then(() => setRecebido(null)).catch((e: Error) => setMsg({ tipo: 'erro', texto: e.message }))}>Guardar</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3 text-xs">
          <button className="text-teal-700 underline" onClick={() => setRecebido(Object.fromEntries(pedido.linhas.map((l) => [l.codigo, pedido.recebido?.[l.codigo] ?? l.quantidade])))}>
            {pedido.conferidoEm ? 'Corrigir a conferência' : 'Conferir a entrega'}
          </button>
          {faltas.length > 0 && <button className="text-teal-700 underline" onClick={emailFalta}>E-mail a reclamar o que faltou</button>}
          {pedido.conferidoEm && <button className="text-teal-700 underline" onClick={emailAviso}>{faltas.length === 0 ? 'Avisar que está tudo certo' : 'Avisar o que chegou'}</button>}
        </div>
      )}
      {faltas.length > 0 && !recebido && <p className="text-xs text-slate-500">Em falta: {faltas.map((l) => `${l.quantidade} × ${l.nome}`).join(', ')}.</p>}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </li>
  );
}

function CatalogoProdutos({ cat, produtos, setMsg }: { cat: Catalogo; produtos: ProdutoHavi[]; setMsg: (m: Msg) => void }) {
  const [cola, setCola] = useState('');
  const [editar, setEditar] = useState<{ id: string | null; codigo: string; nome: string; habitual: string } | null>(null);
  const [aRemover, setARemover] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function importar() {
    try {
      const r = await importarTabela(db, cat.id, cola);
      setCola('');
      setMsg({ tipo: 'ok', texto: `Importados ${r.novos} produto(s) novo(s); ${r.atualizados} nome(s) atualizado(s).` });
    } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }); }
  }

  async function guardar() {
    if (!editar) return;
    try {
      await guardarProduto(db, cat.id, editar.id, editar.codigo, editar.nome, Number(editar.habitual) || 0);
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
          <SePodeEscrever><button className="btn-primario px-5" aria-label="Novo produto" onClick={() => { setErro(null); setEditar({ id: null, codigo: '', nome: '', habitual: '' }); }}>+</button></SePodeEscrever>
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
                  <button className="font-semibold text-red-700 underline" onClick={() => { setARemover(null); void removerProduto(db, p.id); }}>Remover mesmo</button>
                  <button className="text-slate-600 underline" onClick={() => setARemover(null)}>Não</button>
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-3 text-xs">
                  <button aria-label={`Subir ${p.nome}`} className="px-2 text-base text-slate-600 disabled:opacity-30" disabled={i === 0} onClick={() => void moverProduto(db, cat.id, p.id, -1)}>▲</button>
                  <button aria-label={`Descer ${p.nome}`} className="px-2 text-base text-slate-600 disabled:opacity-30" disabled={i === arr.length - 1} onClick={() => void moverProduto(db, cat.id, p.id, 1)}>▼</button>
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

/** Lista de endereços com «Para» e «Cópia», usada nos destinatários da encomenda e no aviso. */
function ListaEmails({ etiqueta, emails, aoMudar }: { etiqueta: string; emails: string[]; aoMudar: (l: string[]) => void }) {
  const [novo, setNovo] = useState('');
  return (
    <>
      <ul className="divide-y divide-slate-100 text-sm">
        {emails.map((d, i) => (
          <li key={d} className="flex items-center justify-between gap-2 py-1">
            <span className="break-all"><span className="text-xs text-slate-500">{i === 0 ? 'Para' : 'Cópia'}</span> {d}</span>
            <button className="text-xs text-red-700 underline" onClick={() => aoMudar(emails.filter((x) => x !== d))}>Remover</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className="campo flex-1" type="email" inputMode="email" aria-label={etiqueta} placeholder="novo@endereco" value={novo} onChange={(e) => setNovo(e.target.value)} autoComplete="off" />
        <button className="btn-secundario px-4" disabled={!emailValido(novo) || emails.includes(novo.trim())} onClick={() => { aoMudar([...emails, novo.trim()]); setNovo(''); }}>Adicionar</button>
      </div>
      {novo && !emailValido(novo) && <p className="text-xs text-red-700">Endereço inválido.</p>}
    </>
  );
}

function Definicoes({ cat, setMsg }: { cat: Catalogo; setMsg: (m: Msg) => void }) {
  const [nome, setNome] = useState(cat.nome);
  const [modelo, setModelo] = useState(cat.modelo);
  const [modeloFalta, setModeloFalta] = useState(cat.modeloFalta ?? MODELO_FALTA_PADRAO);
  const [modeloAviso, setModeloAviso] = useState(cat.modeloAviso ?? MODELO_AVISO_PADRAO);
  const [apagar, setApagar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function guardar(campos: Partial<Catalogo>, ok?: string) {
    void guardarCatalogo(db, cat.id, campos).then(() => { setErro(null); if (ok) setMsg({ tipo: 'ok', texto: ok }); }).catch((e: Error) => setErro(e.message));
  }

  return (
    <>
      <section className="cartao space-y-3">
        <h3 className="font-semibold">Nome</h3>
        <input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} onBlur={() => nome.trim() !== cat.nome && guardar({ nome })} aria-label="Nome da caixa" />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
      </section>

      <section className="cartao space-y-2">
        <h3 className="font-semibold">Destinatários</h3>
        <ListaEmails etiqueta="Novo destinatário" emails={cat.destinatarios} aoMudar={(destinatarios) => guardar({ destinatarios })} />
        <p className="text-xs text-slate-500">Para onde vai a encomenda e a reclamação. O primeiro é o «Para»; os outros vão em «Cópia». Ficam neste telemóvel e entram na cópia de segurança.</p>
      </section>

      <section className="cartao space-y-2">
        <h3 className="font-semibold">Avisar a entrega</h3>
        <p className="text-xs text-slate-500">Quem é avisado depois de conferires a entrega — normalmente gente de dentro, não o fornecedor. Sem endereços aqui, o botão de aviso não faz nada.</p>
        <ListaEmails etiqueta="Novo endereço a avisar" emails={cat.avisoDestinatarios ?? []} aoMudar={(avisoDestinatarios) => guardar({ avisoDestinatarios })} />
        <textarea className="campo min-h-32" aria-label="Texto do aviso de entrega" value={modeloAviso} onChange={(e) => setModeloAviso(e.target.value)} onBlur={() => modeloAviso !== (cat.modeloAviso ?? MODELO_AVISO_PADRAO) && guardar({ modeloAviso: modeloAviso.trim() || MODELO_AVISO_PADRAO })} />
        <p className="text-xs text-slate-500">{'{{data}}'} é o dia da entrega, {'{{produtos}}'} o que chegou e {'{{faltas}}'} diz se faltou alguma coisa.</p>
        <button className="btn-secundario w-full" onClick={() => { setModeloAviso(MODELO_AVISO_PADRAO); guardar({ modeloAviso: MODELO_AVISO_PADRAO }); }}>Repor texto padrão</button>
      </section>

      <section className="cartao space-y-2">
        <h3 className="font-semibold">Dias de entrega</h3>
        <div className="flex flex-wrap gap-2">
          {DIAS_SEMANA.map((d, i) => {
            const ativo = cat.diasEntrega.includes(i);
            return (
              <button key={d} aria-pressed={ativo} className={`rounded-full px-3 py-1 text-sm ${ativo ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-700'}`}
                onClick={() => guardar({ diasEntrega: (ativo ? cat.diasEntrega.filter((x) => x !== i) : [...cat.diasEntrega, i]).sort((a, b) => a - b) })}>
                {d.slice(0, 3)}
              </button>
            );
          })}
        </div>
        <Campo rotulo="Dias que o fornecedor precisa para preparar">
          <input className="campo" type="number" min={0} max={30} inputMode="numeric" value={cat.antecedencia}
            onChange={(e) => guardar({ antecedencia: Math.max(0, Math.min(30, Math.floor(Number(e.target.value) || 0))) })} />
        </Campo>
        <p className="text-xs text-slate-500">
          {cat.diasEntrega.length === 0
            ? 'Sem dias fixos: escolhes a data em cada pedido.'
            : `Hoje, o pedido chegaria ${diaLongo(proximaEntrega(new Date(), cat.diasEntrega, cat.antecedencia))}.`}
        </p>
      </section>

      <section className="cartao space-y-3">
        <h3 className="font-semibold">Texto do e-mail</h3>
        <p className="text-xs text-slate-500">{'{{data}}'} é trocado pelo dia de entrega e {'{{produtos}}'} pela lista.</p>
        <textarea className="campo min-h-40" aria-label="Texto do e-mail" value={modelo} onChange={(e) => setModelo(e.target.value)} onBlur={() => modelo !== cat.modelo && guardar({ modelo: modelo.trim() || MODELO_PADRAO })} />
        <button className="btn-secundario w-full" onClick={() => { setModelo(MODELO_PADRAO); guardar({ modelo: MODELO_PADRAO }); }}>Repor texto padrão</button>
      </section>

      <section className="cartao space-y-3">
        <h3 className="font-semibold">Texto do e-mail de falta</h3>
        <p className="text-xs text-slate-500">Usado quando conferes a entrega e algo não chegou. {'{{data}}'} é o dia da entrega e {'{{produtos}}'} o que faltou.</p>
        <textarea className="campo min-h-32" aria-label="Texto do e-mail de falta" value={modeloFalta} onChange={(e) => setModeloFalta(e.target.value)} onBlur={() => modeloFalta !== (cat.modeloFalta ?? MODELO_FALTA_PADRAO) && guardar({ modeloFalta: modeloFalta.trim() || MODELO_FALTA_PADRAO })} />
        <button className="btn-secundario w-full" onClick={() => { setModeloFalta(MODELO_FALTA_PADRAO); guardar({ modeloFalta: MODELO_FALTA_PADRAO }); }}>Repor texto padrão</button>
      </section>

      <section className="cartao space-y-2">
        <h3 className="font-semibold">Apagar a caixa</h3>
        {apagar ? (
          <>
            <p className="text-sm text-slate-600">Apaga a caixa <strong>{cat.nome}</strong>, o catálogo e os pedidos. Os dados ficam na cópia de segurança.</p>
            <div className="grid grid-cols-2 gap-3">
              <button className="btn-secundario" onClick={() => setApagar(false)}>Cancelar</button>
              <button className="btn-primario" onClick={() => void removerCatalogo(db, cat.id).then(() => ir('/catalogos'))}>Apagar mesmo</button>
            </div>
          </>
        ) : (
          <button className="btn-secundario w-full" onClick={() => setApagar(true)}>Apagar esta caixa</button>
        )}
      </section>
    </>
  );
}
