import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { LIMITE_MAILTO, MODELOS_BASE, montarMailto, preencher, registarPreparado, type Campo as CampoEmail } from '../db/emails';
import type { EmailPreparado } from '../db/schema';
import { Aviso, Campo } from './comuns';

/**
 * Preparar um e-mail a partir de um registo (anomalia, inspeção, relatório). Destinatário: fornecedor,
 * contacto ou nenhum (escolhe-se na app de e-mail). Nunca envia: abre o rascunho.
 */
export function EmailPreparar({ titulo, campos, modeloInicial, aoAbrir, origem, refId = '' }: {
  origem: EmailPreparado['origem'];
  refId?: string;
  titulo: string;
  /** Campos já preenchidos do registo; «contacto» e «fornecedor» vêm do destinatário. */
  campos: Record<CampoEmail, string>;
  modeloInicial: string;
  aoAbrir?: (resumo: string) => Promise<void> | void;
}) {
  const forn = useLiveQuery(() => db.fornecedores.filter((f) => !f.deletedAt).toArray(), []);
  const contactos = useLiveQuery(() => db.contactos.filter((c) => !c.deletedAt).toArray(), []);
  const custom = useLiveQuery(() => db.modelosEmail.filter((m) => !m.deletedAt).toArray(), []);
  const [aberto, setAberto] = useState(false);
  const [dest, setDest] = useState('');
  const [escolha, setEscolha] = useState('');
  const [assunto, setAssunto] = useState('');
  const [corpo, setCorpo] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const modelos = useMemo(() => [...MODELOS_BASE.map((m) => ({ chave: `b:${m.nome}`, ...m })), ...(custom ?? []).map((m) => ({ chave: m.id, nome: m.nome, assunto: m.assunto, corpo: m.corpo }))], [custom]);
  const modelo = modelos.find((m) => m.chave === escolha) ?? modelos.find((m) => m.nome === modeloInicial) ?? modelos[0];
  const [tipo, id] = dest.split(':');
  const f = tipo === 'f' ? forn?.find((x) => x.id === id) : undefined;
  const c = tipo === 'c' ? contactos?.find((x) => x.id === id) : undefined;
  const para = f?.email ?? c?.email ?? '';
  const nomeDest = f?.nome ?? c?.nome ?? '';
  const todos: Record<CampoEmail, string> = { ...campos, fornecedor: f?.nome ?? campos.fornecedor, contacto: f?.contacto || c?.nome || 'Exmos. Senhores' };
  const prev = useMemo(() => preencher(modelo, todos), [modelo, JSON.stringify(todos)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAssunto(prev.assunto); setCorpo(prev.corpo); }, [prev]);
  if (!forn || !contactos) return null;

  const url = montarMailto(para, assunto, corpo);
  const longo = url.length > LIMITE_MAILTO;
  async function abrir() {
    setMsg(null);
    try {
      await registarPreparado(db, { canal: 'email', modelo: modelo.nome, paraNome: nomeDest, paraEmail: para, assunto, origem, refId });
      await aoAbrir?.(`E-mail preparado com o modelo «${modelo.nome}»${nomeDest ? ` para ${nomeDest}` : ''} (a app não envia).`);
      window.location.href = url;
    } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }); }
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(`${assunto}\n\n${corpo}`); setMsg({ tipo: 'ok', texto: 'Texto copiado.' }); } catch { setMsg({ tipo: 'erro', texto: 'Não consegui copiar.' }); }
  }

  return (
    <div className="cartao space-y-3">
      <button className="flex w-full items-center justify-between" aria-expanded={aberto} onClick={() => setAberto((x) => !x)}>
        <h3 className="font-semibold">{titulo}</h3>
        <span className="text-sm text-teal-700">{aberto ? 'Fechar' : 'Abrir'}</span>
      </button>
      {aberto && (
        <>
          <Campo rotulo="Para">
            <select className="campo" value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="">Escolho na app de e-mail</option>
              {forn.length > 0 && <optgroup label="Fornecedores">{[...forn].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((x) => <option key={x.id} value={`f:${x.id}`}>{x.nome}</option>)}</optgroup>}
              {contactos.length > 0 && <optgroup label="Contactos">{[...contactos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((x) => <option key={x.id} value={`c:${x.id}`}>{x.nome}</option>)}</optgroup>}
            </select>
          </Campo>
          {dest && !para && <p className="text-xs text-amber-800">Sem e-mail na ficha: escolhes o endereço na app de e-mail.</p>}
          <Campo rotulo="Modelo">
            <select className="campo" value={modelo.chave} onChange={(e) => setEscolha(e.target.value)}>
              {modelos.map((m) => <option key={m.chave} value={m.chave}>{m.nome}</option>)}
            </select>
          </Campo>
          {prev.emBranco.length > 0 && <Aviso tipo="erro">Campos em branco: {prev.emBranco.join(', ')}. Escreve-os abaixo ou escolhe outro modelo.</Aviso>}
          <Campo rotulo="Assunto"><input className="campo" value={assunto} onChange={(e) => setAssunto(e.target.value)} /></Campo>
          <Campo rotulo="Texto"><textarea className="campo min-h-48" value={corpo} onChange={(e) => setCorpo(e.target.value)} /></Campo>
          {longo && <Aviso tipo="erro">Texto muito longo para abrir direto. Usa «Copiar texto».</Aviso>}
          <button className="btn-primario w-full" disabled={longo} onClick={() => void abrir()}>Abrir na app de e-mail</button>
          <button className="btn-secundario w-full" onClick={() => void copiar()}>Copiar texto</button>
          <p className="text-xs text-slate-500">A app só prepara o rascunho. Anexos (PDF) juntas tu na app de e-mail.</p>
        </>
      )}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </div>
  );
}
