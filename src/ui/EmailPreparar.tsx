import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type EmailPreparado } from '../db/schema';
import { LIMITE_MAILTO, MODELOS_BASE, montarMailto, preencher, registarPreparado, type Campo as CampoEmail } from '../db/emails';
import { Aviso, Campo } from './comuns';

interface Props {
  titulo: string;
  /** Campos do registo; «contacto» e «fornecedor» vêm do destinatário quando há. */
  campos: Record<CampoEmail, string>;
  modeloInicial: string;
  origem: EmailPreparado['origem'];
  refId?: string;
  /** Destinatário fixo (encomenda → fornecedor; aprovação → aprovador). Sem ele, escolhe-se na lista. */
  para?: { nome: string; email: string; contacto?: string } | null;
  /** Só o modelo inicial (sem escolher outro). */
  modeloFixo?: boolean;
  /** Sem cartão nem botão Abrir/Fechar (para usar dentro de outro cartão). */
  semCartao?: boolean;
  rotuloAbrir?: string;
  /** Campos que podem ficar vazios sem aviso (ex.: total sem preços). */
  opcionais?: CampoEmail[];
  /** Corre antes de abrir (ex.: nota no histórico, criar fornecedor). Pode devolver o refId a registar. */
  aoAbrir?: (resumo: string) => Promise<string | void> | string | void;
}

/** Único compositor de e-mails da app: modelo, campos automáticos, rascunho editável, registo. Nunca envia. */
export function EmailPreparar({ titulo, campos, modeloInicial, origem, refId = '', para, modeloFixo = false, semCartao = false, rotuloAbrir = 'Abrir na app de e-mail', aoAbrir, opcionais = [] }: Props) {
  const forn = useLiveQuery(() => db.fornecedores.filter((f) => !f.deletedAt).toArray(), []);
  const contactos = useLiveQuery(() => db.contactos.filter((c) => !c.deletedAt).toArray(), []);
  const custom = useLiveQuery(() => db.modelosEmail.filter((m) => !m.deletedAt).toArray(), []);
  const [aberto, setAberto] = useState(semCartao);
  const [dest, setDest] = useState('');
  const [escolha, setEscolha] = useState('');
  const [assunto, setAssunto] = useState('');
  const [corpo, setCorpo] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const modelos = useMemo(() => [...MODELOS_BASE.map((m) => ({ chave: `b:${m.nome}`, ...m })), ...(custom ?? []).map((m) => ({ chave: m.id, nome: m.nome, assunto: m.assunto, corpo: m.corpo }))], [custom]);
  const modelo = (modeloFixo ? undefined : modelos.find((m) => m.chave === escolha)) ?? modelos.find((m) => m.nome === modeloInicial) ?? modelos[0];
  const [tipo, id] = dest.split(':');
  const f = !para && tipo === 'f' ? forn?.find((x) => x.id === id) : undefined;
  const c = !para && tipo === 'c' ? contactos?.find((x) => x.id === id) : undefined;
  const paraEmail = para ? para.email : f?.email ?? c?.email ?? '';
  const nomeDest = para ? para.nome : f?.nome ?? c?.nome ?? '';
  const todos: Record<CampoEmail, string> = para
    ? { ...campos, contacto: campos.contacto || para.contacto || 'Exmos. Senhores' }
    : { ...campos, fornecedor: f?.nome ?? campos.fornecedor, contacto: f?.contacto || c?.nome || campos.contacto || 'Exmos. Senhores' };
  const prev = useMemo(() => preencher(modelo, todos), [modelo, JSON.stringify(todos)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAssunto(prev.assunto); setCorpo(prev.corpo); }, [prev]);
  if (!forn || !contactos) return null;

  const url = montarMailto(paraEmail, assunto, corpo);
  const longo = url.length > LIMITE_MAILTO;
  async function abrir() {
    setMsg(null);
    try {
      const resumo = `E-mail preparado com o modelo «${modelo.nome}»${nomeDest ? ` para ${nomeDest}` : ''} (a app não envia).`;
      const outroRef = await aoAbrir?.(resumo);
      await registarPreparado(db, { canal: 'email', modelo: modelo.nome, paraNome: nomeDest, paraEmail, assunto, origem, refId: outroRef || refId });
      window.location.href = url;
    } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }); }
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(`${assunto}\n\n${corpo}`); setMsg({ tipo: 'ok', texto: 'Texto copiado.' }); } catch { setMsg({ tipo: 'erro', texto: 'Não consegui copiar. Seleciona o texto à mão.' }); }
  }

  const conteudo = (
    <>
      {!para && (
        <Campo rotulo="Para">
          <select className="campo" value={dest} onChange={(e) => setDest(e.target.value)}>
            <option value="">Escolho na app de e-mail</option>
            {forn.length > 0 && <optgroup label="Fornecedores">{[...forn].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((x) => <option key={x.id} value={`f:${x.id}`}>{x.nome}</option>)}</optgroup>}
            {contactos.length > 0 && <optgroup label="Contactos">{[...contactos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((x) => <option key={x.id} value={`c:${x.id}`}>{x.nome}</option>)}</optgroup>}
          </select>
        </Campo>
      )}
      {para && <p className="text-xs text-slate-500">Para: {para.email ? `${para.nome} <${para.email}>` : `${para.nome || '—'} (sem e-mail na ficha: escolhes na app de e-mail)`}</p>}
      {!para && dest && !paraEmail && <p className="text-xs text-amber-800">Sem e-mail na ficha: escolhes o endereço na app de e-mail.</p>}
      {!modeloFixo && (
        <Campo rotulo="Modelo">
          <select className="campo" value={modelo.chave} onChange={(e) => setEscolha(e.target.value)}>
            {modelos.map((m) => <option key={m.chave} value={m.chave}>{m.nome}</option>)}
          </select>
        </Campo>
      )}
      {prev.emBranco.filter((x) => !opcionais.includes(x)).length > 0 && <Aviso tipo="erro">Campos em branco: {prev.emBranco.filter((x) => !opcionais.includes(x)).join(', ')}. Escreve-os abaixo ou escolhe outro modelo.</Aviso>}
      {prev.desconhecidos.length > 0 && <Aviso tipo="erro">Campos que não existem: {prev.desconhecidos.join(', ')}.</Aviso>}
      <Campo rotulo="Assunto"><input className="campo" value={assunto} onChange={(e) => setAssunto(e.target.value)} /></Campo>
      <Campo rotulo="Texto"><textarea className="campo min-h-48" value={corpo} onChange={(e) => setCorpo(e.target.value)} /></Campo>
      {longo && <Aviso tipo="erro">Texto muito longo para abrir direto. Usa «Copiar texto».</Aviso>}
      <button className="btn-primario w-full" disabled={longo} onClick={() => void abrir()}>{rotuloAbrir}</button>
      <button className="btn-secundario w-full" onClick={() => void copiar()}>Copiar texto</button>
      <p className="text-xs text-slate-500">A app só prepara o rascunho. Anexos (PDF) juntas tu na app de e-mail.</p>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </>
  );

  if (semCartao) return conteudo;
  return (
    <div className="cartao space-y-3">
      <button className="flex w-full items-center justify-between" aria-expanded={aberto} onClick={() => setAberto((x) => !x)}>
        <h3 className="font-semibold">{titulo}</h3>
        <span className="text-sm text-teal-700">{aberto ? 'Fechar' : 'Abrir'}</span>
      </button>
      {aberto && conteudo}
    </div>
  );
}
