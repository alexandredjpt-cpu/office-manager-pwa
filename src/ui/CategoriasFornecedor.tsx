import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { arquivarCategoria, criarCategoria, listarCategorias, renomearCategoria, separarCategorias, juntarCategorias } from '../db/categorias';
import { Aviso, Modal } from './comuns';

const chip = (ativo: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${ativo ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`;

/** Escolha de categorias de um fornecedor: toca para marcar; cria uma nova no fim. */
export function EscolhaCategorias({ valor, aoMudar }: { valor: string; aoMudar: (v: string) => void }) {
  const cats = useLiveQuery(() => listarCategorias(db), []);
  const [nova, setNova] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  if (!cats) return null;
  const escolhidas = separarCategorias(valor);
  const marcadas = new Set(escolhidas.map((x) => x.toLowerCase()));

  function alternar(nome: string) {
    const lista = marcadas.has(nome.toLowerCase()) ? escolhidas.filter((x) => x.toLowerCase() !== nome.toLowerCase()) : [...escolhidas, nome];
    aoMudar(juntarCategorias(lista));
  }

  async function adicionar() {
    setErro(null);
    try {
      const c = await criarCategoria(db, nova);
      aoMudar(juntarCategorias([...escolhidas, c.nome]));
      setNova('');
    } catch (e) { setErro((e as Error).message); }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {cats.map((c) => <button key={c.id} type="button" className={chip(marcadas.has(c.nome.toLowerCase()))} aria-pressed={marcadas.has(c.nome.toLowerCase())} onClick={() => alternar(c.nome)}>{c.nome}</button>)}
        {cats.length === 0 && <p className="text-sm text-slate-500">Ainda não há categorias. Cria a primeira abaixo.</p>}
      </div>
      <div className="flex gap-2">
        <input className="campo flex-1" value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Nova categoria" autoComplete="off" aria-label="Nova categoria" />
        <button type="button" className="btn-secundario px-3" onClick={() => void adicionar()} disabled={!nova.trim()}>Adicionar</button>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </div>
  );
}

/** Filtro da lista de fornecedores: seleção múltipla (basta uma categoria em comum). */
export function FiltroCategorias({ selecionadas, aoMudar }: { selecionadas: string[]; aoMudar: (v: string[]) => void }) {
  const cats = useLiveQuery(() => listarCategorias(db), []);
  if (!cats || cats.length === 0) return null;
  const marcadas = new Set(selecionadas.map((x) => x.toLowerCase()));
  const alternar = (nome: string) => aoMudar(marcadas.has(nome.toLowerCase()) ? selecionadas.filter((x) => x.toLowerCase() !== nome.toLowerCase()) : [...selecionadas, nome]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {cats.map((c) => <button key={c.id} type="button" className={chip(marcadas.has(c.nome.toLowerCase()))} aria-pressed={marcadas.has(c.nome.toLowerCase())} onClick={() => alternar(c.nome)}>{c.nome}</button>)}
      {selecionadas.length > 0 && <button type="button" className="text-sm text-teal-700 underline" onClick={() => aoMudar([])}>Limpar</button>}
    </div>
  );
}

/** Gerir o catálogo: renomear (funde se o nome já existe) e arquivar. */
export function GerirCategorias({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const cats = useLiveQuery(() => listarCategorias(db), []);
  const [nova, setNova] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  if (!aberto || !cats) return null;

  async function executar(acao: () => Promise<unknown>, ok?: string) {
    setMsg(null);
    try { await acao(); if (ok) setMsg({ tipo: 'ok', texto: ok }); }
    catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }); }
  }

  return (
    <Modal aberto={aberto} onFechar={onFechar}>
      <h3 className="font-semibold">Categorias de fornecedores</h3>
      <p className="text-xs text-slate-500">Renomear uma categoria muda-a em todos os fornecedores. Se o novo nome já existir, as duas ficam uma só. Arquivar tira a categoria de todos os fornecedores.</p>
      <ul className="space-y-2">
        {cats.map((c) => (
          <li key={c.id} className="flex gap-2">
            <input className="campo flex-1" defaultValue={c.nome} aria-label={`Renomear ${c.nome}`} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== c.nome) void executar(() => renomearCategoria(db, c.id, e.target.value), 'Categoria atualizada.'); }} />
            <button type="button" className="text-sm text-red-700 underline" onClick={() => void executar(() => arquivarCategoria(db, c.id), 'Categoria arquivada.')}>Arquivar</button>
          </li>
        ))}
        {cats.length === 0 && <li className="text-sm text-slate-500">Sem categorias.</li>}
      </ul>
      <div className="flex gap-2">
        <input className="campo flex-1" value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Nova categoria" aria-label="Nova categoria" />
        <button type="button" className="btn-primario px-4" disabled={!nova.trim()} onClick={() => void executar(async () => { await criarCategoria(db, nova); setNova(''); }, 'Categoria criada.')}>Criar</button>
      </div>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      <button type="button" className="btn-secundario w-full" onClick={onFechar}>Fechar</button>
    </Modal>
  );
}
