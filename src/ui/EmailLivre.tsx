import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { camposEncomenda, camposVazios } from '../db/emails';
import { adicionarNota, criarFornecedor, linhasAtivas } from '../db/encomendas';
import { hojeIso } from '../db/agenda';
import { lerResponsavel } from '../export/gerar';
import { Campo, diaPt } from './comuns';
import { EmailPreparar } from './EmailPreparar';

const NOVO = '__novo__';

/** Escrever um e-mail a um fornecedor (existente ou novo), com ou sem encomenda. Nunca envia. */
export function EmailLivre() {
  const forn = useLiveQuery(() => db.fornecedores.filter((f) => !f.deletedAt).toArray(), []);
  const encs = useLiveQuery(() => db.encomendas.filter((e) => !e.deletedAt && e.estado !== 'cancelada').toArray(), []);
  const linhas = useLiveQuery(() => db.encomendaLinhas.toArray(), []);
  const artigos = useLiveQuery(() => db.artigos.toArray(), []);
  const resp = useLiveQuery(() => lerResponsavel(db), []) ?? '';
  const [aberto, setAberto] = useState(false);
  const [fid, setFid] = useState('');
  const [novo, setNovo] = useState({ nome: '', contacto: '', email: '' });
  const [eid, setEid] = useState('');
  if (!forn || !encs || !linhas || !artigos) return null;

  const f = forn.find((x) => x.id === fid);
  const dest = fid === NOVO ? novo : f ? { nome: f.nome, contacto: f.contacto, email: f.email } : null;
  const enc = encs.find((e) => e.id === eid && e.fornecedorId === fid);
  const pronto = fid !== '' && (fid !== NOVO || novo.nome.trim() !== '');
  const hoje = diaPt(hojeIso());
  const campos = enc && f
    ? camposEncomenda(enc, f, linhasAtivas(linhas.filter((l) => l.encomendaId === enc.id)), artigos, resp, hoje)
    : { ...camposVazios(), fornecedor: dest?.nome ?? '', contacto: dest?.contacto ?? '', responsavel: resp, data: hoje };

  async function antesDeAbrir(resumo: string): Promise<string> {
    let fornId = fid;
    if (fid === NOVO) {
      const criado = await criarFornecedor(db, novo);
      fornId = criado.id;
      setFid(criado.id); setNovo({ nome: '', contacto: '', email: '' });
    }
    if (enc) { await adicionarNota(db, enc.id, resumo); return enc.id; }
    return fornId;
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
              {[...forn].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
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
          {pronto && dest && (
            <EmailPreparar
              semCartao
              titulo="Escrever e-mail a um fornecedor"
              modeloInicial="Pedido de encomenda"
              origem={enc ? 'encomenda' : 'fornecedor'}
              refId={enc?.id ?? fid}
              para={{ nome: dest.nome, email: dest.email, contacto: dest.contacto }}
              campos={campos}
              aoAbrir={antesDeAbrir}
            />
          )}
        </>
      )}
    </div>
  );
}
