import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { LIMITE_MAILTO, MODELOS_BASE, camposEncomenda, montarMailto, preencher, type Campo as CampoEmail } from '../db/emails';
import { adicionarNota, criarFornecedor, linhasAtivas } from '../db/encomendas';
import { hojeIso } from '../db/agenda';
import { lerResponsavel } from '../export/gerar';
import { Aviso, Campo, diaPt } from './comuns';

const NOVO = '__novo__';

/** Escrever um e-mail a um fornecedor (existente ou novo), com ou sem encomenda. Nunca envia. */
export function EmailLivre() {
  const forn = useLiveQuery(() => db.fornecedores.filter((f) => !f.deletedAt).toArray(), []);
  const encs = useLiveQuery(() => db.encomendas.filter((e) => !e.deletedAt && e.estado !== 'cancelada').toArray(), []);
  const linhas = useLiveQuery(() => db.encomendaLinhas.toArray(), []);
  const artigos = useLiveQuery(() => db.artigos.toArray(), []);
  const custom = useLiveQuery(() => db.modelosEmail.filter((m) => !m.deletedAt).toArray(), []);
  const [aberto, setAberto] = useState(false);
  const [fid, setFid] = useState('');
  const [novo, setNovo] = useState({ nome: '', contacto: '', email: '' });
  const [eid, setEid] = useState('');
  const [escolha, setEscolha] = useState('b0');
  const [resp, setResp] = useState('');
  const [assunto, setAssunto] = useState('');
  const [corpo, setCorpo] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  useEffect(() => { void lerResponsavel(db).then(setResp); }, []);

  const modelos = useMemo(() => [...MODELOS_BASE.map((m, i) => ({ chave: `b${i}`, ...m })), ...(custom ?? []).map((m) => ({ chave: m.id, nome: m.nome, assunto: m.assunto, corpo: m.corpo }))], [custom]);
  const modelo = modelos.find((m) => m.chave === escolha) ?? modelos[0];
  const f = forn?.find((x) => x.id === fid);
  const nomeTemp = fid === NOVO ? { id: 'novo', createdAt: '', updatedAt: '', deletedAt: null, nome: novo.nome, contacto: novo.contacto, email: novo.email, telefone: '', notas: '' } : f;
  const enc = encs?.find((e) => e.id === eid && e.fornecedorId === fid);

  const campos: Record<CampoEmail, string> = enc
    ? camposEncomenda(enc, nomeTemp, linhasAtivas((linhas ?? []).filter((l) => l.encomendaId === enc.id)), artigos ?? [], resp, diaPt(hojeIso()))
    : { fornecedor: nomeTemp?.nome ?? '', contacto: nomeTemp?.contacto || 'Exmos. Senhores', encomenda: '', artigos: '', responsavel: resp, data: diaPt(hojeIso()) };
  const prev = useMemo(() => preencher(modelo, campos), [modelo, JSON.stringify(campos)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAssunto(prev.assunto); setCorpo(prev.corpo); }, [prev]);

  if (!forn || !encs || !linhas || !artigos) return null;
  const email = nomeTemp?.email ?? '';
  const url = montarMailto(email, assunto, corpo);
  const longo = url.length > LIMITE_MAILTO;
  const pronto = fid !== '' && (fid !== NOVO || novo.nome.trim() !== '');

  async function abrir() {
    setMsg(null);
    try {
      if (fid === NOVO) {
        const criado = await criarFornecedor(db, novo);
        setFid(criado.id); setNovo({ nome: '', contacto: '', email: '' });
      }
      if (enc) await adicionarNota(db, enc.id, `E-mail preparado com o modelo «${modelo.nome}» (a app não envia).`);
      window.location.href = url;
    } catch (e) {
      setMsg({ tipo: 'erro', texto: (e as Error).message });
    }
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(`${assunto}\n\n${corpo}`); setMsg({ tipo: 'ok', texto: 'Texto copiado.' }); } catch { setMsg({ tipo: 'erro', texto: 'Não consegui copiar.' }); }
  }

  return (
    <div className="cartao space-y-3">
      <button className="flex w-full items-center justify-between" onClick={() => setAberto((x) => !x)}>
        <h3 className="font-semibold">Escrever e-mail a um fornecedor</h3>
        <span className="text-sm text-teal-700">{aberto ? 'Fechar' : 'Abrir'}</span>
      </button>
      {aberto && (
        <>
          <Campo rotulo="Fornecedor">
            <select className="campo" value={fid} onChange={(e) => { setFid(e.target.value); setEid(''); }}>
              <option value="">Escolhe…</option>
              {forn.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
              <option value={NOVO}>+ Novo fornecedor…</option>
            </select>
          </Campo>
          {fid === NOVO && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-3">
              <Campo rotulo="Nome *"><input className="campo" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} autoComplete="off" /></Campo>
              <Campo rotulo="Pessoa de contacto"><input className="campo" value={novo.contacto} onChange={(e) => setNovo({ ...novo, contacto: e.target.value })} autoComplete="off" /></Campo>
              <Campo rotulo="E-mail"><input className="campo" inputMode="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} autoComplete="off" /></Campo>
              <p className="text-xs text-slate-500">O fornecedor fica guardado quando abrires o e-mail.</p>
            </div>
          )}
          {pronto && fid !== NOVO && (
            <Campo rotulo="Encomenda (opcional)" dica="Preenche automaticamente o número e a lista de artigos.">
              <select className="campo" value={eid} onChange={(e) => setEid(e.target.value)}>
                <option value="">Nenhuma</option>
                {encs.filter((e) => e.fornecedorId === fid).map((e) => <option key={e.id} value={e.id}>{e.codigo}</option>)}
              </select>
            </Campo>
          )}
          {pronto && (
            <>
              <Campo rotulo="Modelo">
                <select className="campo" value={modelo.chave} onChange={(e) => setEscolha(e.target.value)}>
                  {modelos.map((m) => <option key={m.chave} value={m.chave}>{m.nome}</option>)}
                </select>
              </Campo>
              <p className="text-xs text-slate-500">Para: {email || 'sem e-mail na ficha (escolhes na app de e-mail)'}</p>
              {prev.emBranco.length > 0 && <Aviso tipo="erro">Campos em branco: {prev.emBranco.join(', ')}. Escreve-os abaixo.</Aviso>}
              <Campo rotulo="Assunto"><input className="campo" value={assunto} onChange={(e) => setAssunto(e.target.value)} /></Campo>
              <Campo rotulo="Texto"><textarea className="campo min-h-48" value={corpo} onChange={(e) => setCorpo(e.target.value)} /></Campo>
              {longo && <Aviso tipo="erro">Texto muito longo para abrir direto. Usa «Copiar texto».</Aviso>}
              <button className="btn-primario w-full" disabled={longo} onClick={() => void abrir()}>Abrir na app de e-mail</button>
              <button className="btn-secundario w-full" onClick={() => void copiar()}>Copiar texto</button>
              <p className="text-xs text-slate-500">A app só prepara o rascunho. O envio é feito por ti.</p>
            </>
          )}
          {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        </>
      )}
    </div>
  );
}
