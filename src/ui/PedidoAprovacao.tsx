import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Artigo, type Encomenda, type EncomendaLinha, type Fornecedor } from '../db/schema';
import { camposEncomenda, montarWhatsApp, preencher, registarPreparado, textoAvisoAprovacao } from '../db/emails';
import { adicionarNota, mudarAprovador } from '../db/encomendas';
import { hojeIso } from '../db/agenda';
import { lerResponsavel } from '../export/gerar';
import { Aviso, Campo, diaPt } from './comuns';
import { EmailPreparar } from './EmailPreparar';

interface Props { encomenda: Encomenda; fornecedor: Fornecedor | undefined; linhas: EncomendaLinha[]; artigos: Artigo[] }

/** Em «Pendente de aprovação»: e-mail com os detalhes e/ou aviso curto por WhatsApp. A app nunca envia. */
export function PedidoAprovacao({ encomenda, fornecedor, linhas, artigos }: Props) {
  const contactos = useLiveQuery(() => db.contactos.filter((c) => !c.deletedAt).toArray(), []);
  const resp = useLiveQuery(() => lerResponsavel(db), []) ?? '';
  const [wa, setWa] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const modelosWa = useLiveQuery(() => db.modelosEmail.filter((m) => !m.deletedAt && m.canal === 'whatsapp').toArray(), []);
  const ap = contactos?.find((c) => c.id === encomenda.aprovadorId);
  const textoWa = useMemo(() => textoAvisoAprovacao(ap?.nome ?? '', encomenda.codigo, fornecedor?.nome ?? '', resp), [ap?.nome, encomenda.codigo, fornecedor?.nome, resp]);
  const [modeloId, setModeloId] = useState('');
  const modeloWa = modelosWa?.find((x) => x.id === modeloId);
  // O aviso segue o modelo escolhido (ou o texto padrão) e acompanha a troca de aprovador.
  useEffect(() => {
    setWa(modeloWa ? preencher(modeloWa, camposEncomenda(encomenda, fornecedor, linhas, artigos, resp, diaPt(hojeIso()), ap?.nome ?? '')).corpo : textoWa);
  }, [modeloWa, textoWa, ap?.nome]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!contactos || !modelosWa) return null;
  const urlWa = ap ? montarWhatsApp(ap.telefone, wa) : null;

  async function whatsappPreparado() {
    if (!urlWa) return;
    await adicionarNota(db, encomenda.id, `WhatsApp aberto${ap ? ` para ${ap.nome}` : ''} com o aviso de aprovação.`);
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
      <EmailPreparar
        key={ap?.id ?? 'sem'}
        semCartao
        modeloFixo
        opcionais={['total']}
        titulo="Pedido de aprovação"
        modeloInicial="Pedido de aprovação"
        origem="encomenda"
        refId={encomenda.id}
        para={{ nome: ap?.nome ?? '', email: ap?.email ?? '', contacto: ap?.nome }}
        campos={camposEncomenda(encomenda, fornecedor, linhas, artigos, resp, diaPt(hojeIso()), ap?.nome ?? '')}
        rotuloAbrir={`1. Preparar e-mail${ap?.email ? '' : ' (sem e-mail no contacto)'}`}
        aoAbrir={async () => { await adicionarNota(db, encomenda.id, `E-mail de pedido de aprovação preparado${ap ? ` para ${ap.nome}` : ''} (a app não envia).`); }}
      />
      {modelosWa.length > 0 && (
        <Campo rotulo="Modelo de WhatsApp">
          <select className="campo" value={modeloId} onChange={(e) => setModeloId(e.target.value)}>
            <option value="">Texto padrão</option>
            {modelosWa.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </Campo>
      )}
      <Campo rotulo="Aviso por WhatsApp"><textarea className="campo min-h-20" value={wa} onChange={(e) => setWa(e.target.value)} /></Campo>
      <button className="btn-secundario w-full" disabled={!urlWa} onClick={() => void whatsappPreparado()}>2. Avisar por WhatsApp</button>
      {!urlWa && <p className="text-xs text-slate-500">{ap ? 'Este contacto não tem telefone válido.' : 'Escolhe um aprovador com telefone para usar o WhatsApp.'}</p>}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </div>
  );
}
