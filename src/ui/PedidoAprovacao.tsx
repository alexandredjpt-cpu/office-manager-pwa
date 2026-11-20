import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Artigo, type Encomenda, type EncomendaLinha, type Fornecedor } from '../db/schema';
import { MODELOS_BASE, LIMITE_MAILTO, camposEncomenda, montarMailto, montarWhatsApp, preencher, textoAvisoAprovacao, registarPreparado } from '../db/emails';
import { adicionarNota, mudarAprovador } from '../db/encomendas';
import { hojeIso } from '../db/agenda';
import { lerResponsavel } from '../export/gerar';
import { Aviso, Campo, diaPt } from './comuns';

interface Props { encomenda: Encomenda; fornecedor: Fornecedor | undefined; linhas: EncomendaLinha[]; artigos: Artigo[] }
const MODELO = MODELOS_BASE.find((m) => m.nome === 'Pedido de aprovação')!;

/** Em «Pendente de aprovação»: e-mail com os detalhes e/ou aviso curto por WhatsApp. A app nunca envia. */
export function PedidoAprovacao({ encomenda, fornecedor, linhas, artigos }: Props) {
  const contactos = useLiveQuery(() => db.contactos.filter((c) => !c.deletedAt).toArray(), []);
  const [resp, setResp] = useState('');
  const [assunto, setAssunto] = useState('');
  const [corpo, setCorpo] = useState('');
  const [wa, setWa] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  useEffect(() => { void lerResponsavel(db).then(setResp); }, []);

  const ap = contactos?.find((c) => c.id === encomenda.aprovadorId);
  const campos = camposEncomenda(encomenda, fornecedor, linhas, artigos, resp, diaPt(hojeIso()), ap?.nome ?? '');
  const prev = useMemo(() => preencher(MODELO, campos), [JSON.stringify(campos)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAssunto(prev.assunto); setCorpo(prev.corpo); }, [prev]);
  const textoWa = useMemo(() => textoAvisoAprovacao(ap?.nome ?? '', encomenda.codigo, fornecedor?.nome ?? '', resp), [ap?.nome, encomenda.codigo, fornecedor?.nome, resp]);
  useEffect(() => { setWa(textoWa); }, [textoWa]);

  if (!contactos) return null;
  const url = montarMailto(ap?.email ?? '', assunto, corpo);
  const urlWa = ap ? montarWhatsApp(ap.telefone, wa) : null;

  async function emailPreparado() {
    await adicionarNota(db, encomenda.id, `E-mail de pedido de aprovação preparado${ap ? ` para ${ap.nome}` : ''} (a app não envia).`);
    await registarPreparado(db, { canal: 'email', modelo: MODELO.nome, paraNome: ap?.nome ?? '', paraEmail: ap?.email ?? '', assunto, origem: 'encomenda', refId: encomenda.id });
    window.location.href = url;
  }
  async function whatsappPreparado() {
    if (!urlWa) return;
    await adicionarNota(db, encomenda.id, `Aviso por WhatsApp preparado${ap ? ` para ${ap.nome}` : ''} (a app não envia).`);
    await registarPreparado(db, { canal: 'whatsapp', modelo: 'Aviso de aprovação', paraNome: ap?.nome ?? '', paraEmail: '', assunto: wa.split('\n')[0], origem: 'encomenda', refId: encomenda.id });
    window.location.href = urlWa;
  }

  return (
    <div className="cartao space-y-3">
      <h3 className="font-semibold">Pedido de aprovação</h3>
      <Campo rotulo="Aprovador">
        <select className="campo" value={encomenda.aprovadorId ?? ''} onChange={async (e) => { try { await mudarAprovador(db, encomenda.id, e.target.value || null); } catch (x) { setMsg({ tipo: 'erro', texto: (x as Error).message }); } }}>
          <option value="">Nenhum</option>
          {[...contactos].sort((a, b) => Number(b.aprovador) - Number(a.aprovador) || a.nome.localeCompare(b.nome, 'pt')).map((c) => <option key={c.id} value={c.id}>{c.nome}{c.aprovador ? ' (aprovador)' : ''}</option>)}
        </select>
      </Campo>
      <p className="text-xs text-slate-500">1.º o e-mail com os detalhes; 2.º, se quiseres, o aviso curto por WhatsApp. São dois toques: a app não envia nada sozinha.</p>
      {prev.emBranco.filter((c) => c !== 'total').length > 0 && <Aviso tipo="erro">Campos em branco: {prev.emBranco.join(', ')}.</Aviso>}
      <Campo rotulo="Assunto"><input className="campo" value={assunto} onChange={(e) => setAssunto(e.target.value)} /></Campo>
      <Campo rotulo="E-mail"><textarea className="campo min-h-40" value={corpo} onChange={(e) => setCorpo(e.target.value)} /></Campo>
      {url.length > LIMITE_MAILTO && <Aviso tipo="erro">Texto longo demais para abrir direto. Encurta-o ou copia-o.</Aviso>}
      <button className="btn-primario w-full" disabled={url.length > LIMITE_MAILTO} onClick={() => void emailPreparado()}>1. Preparar e-mail{ap?.email ? '' : ' (sem e-mail no contacto)'}</button>
      <Campo rotulo="Aviso por WhatsApp"><textarea className="campo min-h-20" value={wa} onChange={(e) => setWa(e.target.value)} /></Campo>
      <button className="btn-secundario w-full" disabled={!urlWa} onClick={() => void whatsappPreparado()}>2. Avisar por WhatsApp</button>
      {!urlWa && <p className="text-xs text-slate-500">{ap ? 'Este contacto não tem telefone válido.' : 'Escolhe um aprovador com telefone para usar o WhatsApp.'}</p>}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </div>
  );
}
