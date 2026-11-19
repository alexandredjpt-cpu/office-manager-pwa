import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { CAMPOS, MODELOS_BASE } from '../db/emails';
import { guardarModelo, removerModelo } from '../db/modelos';
import { voltar } from './router';
import { Aviso, Campo } from './comuns';
import { EmailLivre } from './EmailLivre';

export function Modelos() {
  const modelos = useLiveQuery(() => db.modelosEmail.filter((m) => !m.deletedAt).toArray(), []);
  const [form, setForm] = useState<{ id: string | null; nome: string; assunto: string; corpo: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  if (!modelos) return null;
  const set = (k: 'nome' | 'assunto' | 'corpo') => (e: { target: { value: string } }) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/mais')}>← Mais</button>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Modelos de e-mail</h2>
        <button className="btn-primario px-5" aria-label="Novo modelo" onClick={() => { setErro(null); setForm({ id: null, nome: '', assunto: '', corpo: '' }); }}>+</button>
      </div>
      <p className="text-xs text-slate-500">Campos automáticos: {CAMPOS.map((c) => `{{${c}}}`).join(' ')}. Os e-mails abrem na tua app de e-mail; a app nunca envia nada.</p>
      <EmailLivre />
      {form && (
        <div className="cartao space-y-3">
          <Campo rotulo="Nome *"><input className="campo" value={form.nome} onChange={set('nome')} autoComplete="off" /></Campo>
          <Campo rotulo="Assunto"><input className="campo" value={form.assunto} onChange={set('assunto')} autoComplete="off" /></Campo>
          <Campo rotulo="Texto"><textarea className="campo min-h-40" value={form.corpo} onChange={set('corpo')} /></Campo>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-secundario" onClick={() => setForm(null)}>Fechar</button>
            <button className="btn-primario" onClick={async () => { try { await guardarModelo(db, form.id, form); setForm(null); setErro(null); } catch (e) { setErro((e as Error).message); } }}>Guardar</button>
          </div>
        </div>
      )}
      <section className="cartao space-y-2">
        <h3 className="font-semibold">Os teus modelos</h3>
        {modelos.length === 0 && <p className="text-sm text-slate-500">Ainda não tens modelos próprios. Duplica um dos modelos da app.</p>}
        <ul className="divide-y divide-slate-100 text-sm">
          {modelos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2">
              <span>{m.nome}</span>
              <span className="flex gap-4 text-xs">
                <button className="text-teal-700 underline" onClick={() => { setErro(null); setForm({ id: m.id, nome: m.nome, assunto: m.assunto, corpo: m.corpo }); }}>Editar</button>
                <button className="text-red-700 underline" onClick={() => void removerModelo(db, m.id)}>Remover</button>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="cartao space-y-2">
        <h3 className="font-semibold">Modelos da app</h3>
        <ul className="divide-y divide-slate-100 text-sm">
          {MODELOS_BASE.map((m) => (
            <li key={m.nome} className="flex items-center justify-between gap-2 py-2">
              <span>{m.nome}</span>
              <button className="text-xs text-teal-700 underline" onClick={() => { setErro(null); setForm({ id: null, nome: `${m.nome} (meu)`, assunto: m.assunto, corpo: m.corpo }); }}>Duplicar</button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
