import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { ROTA_ORIGEM, ROTULO_ORIGEM } from '../db/emails';
import { normalizar } from '../db/consultas';
import { ir, voltar } from './router';
import { dataPt } from './comuns';

/** Histórico do que a app preparou. A app não sabe se foi enviado. */
export function EmailsPreparados() {
  const lista = useLiveQuery(() => db.emailsPreparados.orderBy('createdAt').reverse().filter((e) => !e.deletedAt).toArray(), []);
  const [q, setQ] = useState('');
  if (!lista) return null;
  const t = normalizar(q).trim();
  const vis = t ? lista.filter((e) => normalizar(`${e.paraNome} ${e.paraEmail} ${e.assunto} ${e.modelo}`).includes(t)) : lista;
  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/mais')}>← Mais</button>
      <h2 className="text-xl font-semibold">E-mails preparados</h2>
      <p className="text-xs text-slate-500">Tudo o que a app abriu na app de e-mail ou no WhatsApp. É «preparado», não «enviado»: o envio é sempre teu.</p>
      <input className="campo" type="search" placeholder="Procurar por destinatário, assunto ou modelo" value={q} onChange={(e) => setQ(e.target.value)} />
      {vis.length === 0 && <p className="cartao text-center text-sm text-slate-500">{lista.length === 0 ? 'Ainda não preparaste nenhum e-mail.' : 'Nada encontrado.'}</p>}
      <ul className="space-y-2">
        {vis.map((e) => (
          <li key={e.id}>
            <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir(ROTA_ORIGEM[e.origem](e.refId))}>
              <span className="block text-xs text-slate-500">{dataPt(e.createdAt)} · {e.canal === 'whatsapp' ? 'WhatsApp' : 'E-mail'} · {ROTULO_ORIGEM[e.origem]}</span>
              <span className="block font-medium">{e.assunto || e.modelo}</span>
              <span className="block text-sm text-slate-600">Para: {e.paraNome || e.paraEmail || 'escolhido na app de e-mail'} · {e.modelo}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
