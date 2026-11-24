import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { arquivarContacto, atualizarContacto, criarContacto } from '../db/contactos';
import { ir, substituir, voltar } from './router';
import { Aviso, Campo, SePodeEscrever } from './comuns';

export function ListaContactos() {
  const cs = useLiveQuery(() => db.contactos.filter((c) => !c.deletedAt).toArray(), []);
  const fs = useLiveQuery(() => db.fornecedores.filter((f) => !f.deletedAt).toArray(), []);
  if (!cs || !fs) return null;
  const empresa = (id: string | null | undefined) => fs.find((f) => f.id === id)?.nome;
  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/mais')}>← Mais</button>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Contactos</h2>
        <SePodeEscrever><button className="btn-primario px-5" aria-label="Novo contacto" onClick={() => ir('/contactos/novo')}>+</button></SePodeEscrever>
      </div>
      <p className="text-xs text-slate-500">Pessoas a quem pedes aprovações ou escreves. Ficam só neste telemóvel. Guarda o mínimo necessário.</p>
      {cs.length === 0 && <p className="cartao text-center text-sm text-slate-500">Sem contactos.</p>}
      <ul className="space-y-2">
        {cs.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((c) => (
          <li key={c.id}>
            <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir(`/contactos/${c.id}`)}>
              <span className="block text-sm font-semibold">{c.nome}{c.aprovador ? ' · aprovador' : ''}</span>
              <span className="text-xs text-slate-500">{[empresa(c.fornecedorId), c.funcao, c.email, c.telefone].filter(Boolean).join(' · ') || 'Sem dados'}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function FichaContacto({ id }: { id: string }) {
  const novo = id === 'novo';
  const c = useLiveQuery(async () => (novo ? null : ((await db.contactos.get(id)) ?? false)), [id]);
  const fs = useLiveQuery(() => db.fornecedores.filter((f) => !f.deletedAt).toArray(), []);
  const [form, setForm] = useState<{ nome: string; funcao: string; email: string; telefone: string; email2: string; telefone2: string; aprovador: boolean; fornecedorId: string } | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  if (c === undefined || !fs) return null;
  if (c === false || (c && c.deletedAt)) return (<><p className="cartao">Este contacto não existe.</p><button className="btn-secundario w-full" onClick={() => voltar('/contactos')}>Voltar</button></>);
  const v = form ?? { nome: c?.nome ?? '', funcao: c?.funcao ?? '', email: c?.email ?? '', telefone: c?.telefone ?? '', email2: c?.email2 ?? '', telefone2: c?.telefone2 ?? '', aprovador: c?.aprovador ?? false, fornecedorId: c?.fornecedorId ?? '' };
  const set = (k: 'nome' | 'funcao' | 'email' | 'telefone' | 'email2' | 'telefone2') => (e: { target: { value: string } }) => setForm({ ...v, [k]: e.target.value });

  async function guardar() {
    setMsg(null);
    try {
      if (c) { await atualizarContacto(db, c.id, v); setMsg({ tipo: 'ok', texto: 'Guardado.' }); setForm(null); }
      else { await criarContacto(db, v); substituir('/contactos'); }
    } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }); }
  }

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/contactos')}>← Contactos</button>
      <h2 className="text-xl font-semibold">{c ? c.nome : 'Novo contacto'}</h2>
      <div className="cartao space-y-3">
        <Campo rotulo="Nome *"><input className="campo" value={v.nome} onChange={set('nome')} autoComplete="off" /></Campo>
        <Campo rotulo="Empresa (fornecedor)"><select className="campo" value={v.fornecedorId} onChange={(e) => setForm({ ...v, fornecedorId: e.target.value })}><option value="">Sem empresa</option>{fs.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></Campo>
        <Campo rotulo="Função" dica="Ex.: Comercial, Técnico, Faturação"><input className="campo" value={v.funcao} onChange={set('funcao')} autoComplete="off" /></Campo>
        <Campo rotulo="E-mail"><input className="campo" inputMode="email" value={v.email} onChange={set('email')} autoComplete="off" /></Campo>
        <Campo rotulo="Telefone / WhatsApp" dica="9 dígitos (Portugal) ou +indicativo"><input className="campo" inputMode="tel" value={v.telefone} onChange={set('telefone')} /></Campo>
        <Campo rotulo="Segundo e-mail (opcional)"><input className="campo" inputMode="email" value={v.email2} onChange={set('email2')} autoComplete="off" /></Campo>
        <Campo rotulo="Segundo telefone (opcional)" dica="Ex.: telemóvel e fixo"><input className="campo" inputMode="tel" value={v.telefone2} onChange={set('telefone2')} /></Campo>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={v.aprovador} onChange={(e) => setForm({ ...v, aprovador: e.target.checked })} /> Pode aprovar encomendas (aparece primeiro na lista)</label>
        <button className="btn-primario w-full" onClick={() => void guardar()}>{c ? 'Guardar alterações' : 'Criar contacto'}</button>
      </div>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      {c && <button className="text-center text-sm text-red-700 underline" onClick={async () => { await arquivarContacto(db, c.id); substituir('/contactos'); }}>Arquivar contacto</button>}
    </>
  );
}
