import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Artigo, type Encomenda, type EncomendaLinha, type Fornecedor } from '../db/schema';
import { LIMITE_MAILTO, MODELOS_BASE, camposEncomenda, montarMailto, preencher } from '../db/emails';
import { adicionarNota } from '../db/encomendas';
import { hojeIso } from '../db/agenda';
import { lerResponsavel } from '../export/gerar';
import { Aviso, Campo, diaPt } from './comuns';

interface Props { encomenda: Encomenda; fornecedor: Fornecedor | undefined; linhas: EncomendaLinha[]; artigos: Artigo[] }

/** Prepara um e-mail a partir de um modelo e abre-o na app de e-mail. Nunca envia. */
export function EmailEncomenda({ encomenda, fornecedor, linhas, artigos }: Props) {
  const custom = useLiveQuery(() => db.modelosEmail.filter((m) => !m.deletedAt).toArray(), []);
  const [escolha, setEscolha] = useState('b0');
  const [resp, setResp] = useState('');
  const [assunto, setAssunto] = useState('');
  const [corpo, setCorpo] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [aberto, setAberto] = useState(false);
  useEffect(() => { void lerResponsavel(db).then(setResp); }, []);

  const todos = useMemo(() => [...MODELOS_BASE.map((m, i) => ({ chave: `b${i}`, ...m })), ...(custom ?? []).map((m) => ({ chave: m.id, nome: m.nome, assunto: m.assunto, corpo: m.corpo }))], [custom]);
  const modelo = todos.find((m) => m.chave === escolha) ?? todos[0];
  const campos = camposEncomenda(encomenda, fornecedor, linhas, artigos, resp, diaPt(hojeIso()));
  const prev = useMemo(() => preencher(modelo, campos), [modelo, campos.artigos, campos.contacto, campos.fornecedor, campos.responsavel, campos.encomenda]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAssunto(prev.assunto); setCorpo(prev.corpo); }, [prev]);

  const url = montarMailto(fornecedor?.email ?? '', assunto, corpo);
  const longo = url.length > LIMITE_MAILTO;

  async function abrirEmail() {
    await adicionarNota(db, encomenda.id, `E-mail preparado com o modelo «${modelo.nome}» (a app não envia).`);
    window.location.href = url;
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(`${assunto}\n\n${corpo}`); setMsg({ tipo: 'ok', texto: 'Texto copiado.' }); } catch { setMsg({ tipo: 'erro', texto: 'Não consegui copiar. Seleciona o texto à mão.' }); }
  }

  return (
    <div className="cartao space-y-3">
      <button className="flex w-full items-center justify-between" onClick={() => setAberto((x) => !x)}>
        <h3 className="font-semibold">Preparar e-mail</h3>
        <span className="text-sm text-teal-700">{aberto ? 'Fechar' : 'Abrir'}</span>
      </button>
      {aberto && (
        <>
          <Campo rotulo="Modelo">
            <select className="campo" value={modelo.chave} onChange={(e) => setEscolha(e.target.value)}>
              {todos.map((m) => <option key={m.chave} value={m.chave}>{m.nome}</option>)}
            </select>
          </Campo>
          <p className="text-xs text-slate-500">Para: {fornecedor?.email || 'sem e-mail na ficha do fornecedor (escolhes na app de e-mail)'}</p>
          {prev.emBranco.length > 0 && <Aviso tipo="erro">Campos em branco: {prev.emBranco.join(', ')}. Podes escrevê-los abaixo.</Aviso>}
          {prev.desconhecidos.length > 0 && <Aviso tipo="erro">Campos que não existem: {prev.desconhecidos.join(', ')}.</Aviso>}
          <Campo rotulo="Assunto"><input className="campo" value={assunto} onChange={(e) => setAssunto(e.target.value)} /></Campo>
          <Campo rotulo="Texto"><textarea className="campo min-h-48" value={corpo} onChange={(e) => setCorpo(e.target.value)} /></Campo>
          {longo && <Aviso tipo="erro">Texto muito longo para abrir direto na app de e-mail. Usa «Copiar texto» e cola lá.</Aviso>}
          <button className="btn-primario w-full" disabled={longo} onClick={() => void abrirEmail()}>Abrir na app de e-mail</button>
          <button className="btn-secundario w-full" onClick={() => void copiar()}>Copiar texto</button>
          <p className="text-xs text-slate-500">A app só prepara o rascunho. O envio é feito por ti.</p>
          {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        </>
      )}
    </div>
  );
}
