import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Anomalia } from '../db/schema';
import { destinosContacto, telHref, textoAnomalia } from '../db/contactar';
import { camposVazios, montarWhatsApp, preencher, registarPreparado } from '../db/emails';
import { adicionarAtividade } from '../db/anomalias';
import { Aviso, Campo } from './comuns';
import { ir } from './router';

/**
 * Ligar ou mandar WhatsApp ao fornecedor/técnico a partir da anomalia.
 * A app só abre o telefone ou o WhatsApp; fica uma nota no histórico (não sabe se a chamada aconteceu).
 */
export function ContactarAnomalia({ anomalia, local, equipamento, responsavel }: { anomalia: Anomalia; local: string; equipamento: string; responsavel: string }) {
  const contactos = useLiveQuery(() => db.contactos.toArray(), []);
  const fornecedores = useLiveQuery(() => db.fornecedores.toArray(), []);
  const destinos = useMemo(() => destinosContacto(contactos ?? [], fornecedores ?? []), [contactos, fornecedores]);
  const [chave, setChave] = useState('');
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const modelosWa = useLiveQuery(() => db.modelosEmail.filter((m) => !m.deletedAt && m.canal === 'whatsapp').toArray(), []);
  const d = destinos.find((x) => x.chave === chave);
  useEffect(() => { setTexto(textoAnomalia(anomalia, d?.nome ?? '', local, equipamento, responsavel)); }, [d?.nome, anomalia.codigo, anomalia.titulo, local, equipamento, responsavel]);
  if (!contactos || !fornecedores || !modelosWa) return null;

  function aplicarModelo(id: string) {
    const m = modelosWa?.find((x) => x.id === id);
    if (!m || !d) return;
    const campos = { ...camposVazios(), anomalia: `${anomalia.codigo} · ${anomalia.titulo}`, local, equipamento, responsavel, fornecedor: d.nome, contacto: d.nome, data: new Date().toLocaleDateString('pt-PT') };
    setTexto(preencher(m, campos).corpo);
  }

  const tel = d ? telHref(d.telefone) : null;
  const wa = d ? montarWhatsApp(d.telefone, texto) : null;

  async function abrir(url: string, nota: string, canalWa: boolean) {
    setErro(null);
    try {
      await adicionarAtividade(db, anomalia.id, 'contacto', nota);
      if (canalWa) await registarPreparado(db, { canal: 'whatsapp', modelo: 'Mensagem sobre anomalia', paraNome: d?.nome ?? '', paraEmail: '', assunto: texto.split('\n')[0], origem: 'anomalia', refId: anomalia.id });
      window.location.href = url;
    } catch (e) { setErro((e as Error).message); }
  }

  return (
    <div className="cartao space-y-3">
      <h3 className="font-semibold">Contactar fornecedor ou técnico</h3>
      {destinos.length === 0 ? (
        <>
          <p className="text-sm text-slate-600">Ainda não tens contactos nem fornecedores com telefone ou e-mail.</p>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secundario" onClick={() => ir('/contactos/novo')}>+ Contacto</button>
            <button className="btn-secundario" onClick={() => ir('/fornecedores/novo')}>+ Fornecedor</button>
          </div>
        </>
      ) : (
        <>
          <Campo rotulo="A quem">
            <select className="campo" value={chave} onChange={(e) => setChave(e.target.value)}>
              <option value="">Escolher…</option>
              {destinos.map((x) => <option key={x.chave} value={x.chave}>{x.nome} — {x.detalhe}</option>)}
            </select>
          </Campo>
          {d && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-primario" disabled={!tel} onClick={() => tel && abrir(tel, `Chamada para ${d.nome} (aberta na app).`, false)}>📞 Ligar</button>
                <button className="btn-secundario" disabled={!wa} onClick={() => wa && abrir(wa, `WhatsApp preparado para ${d.nome} (a app não envia).`, true)}>💬 WhatsApp</button>
              </div>
              {!tel && <p className="text-xs text-slate-500">{d.nome} não tem telefone válido{d.email ? '; usa o e-mail abaixo.' : '.'}</p>}
              {wa && modelosWa.length > 0 && (
                <Campo rotulo="Modelo">
                  <select className="campo" defaultValue="" onChange={(e) => aplicarModelo(e.target.value)}>
                    <option value="">Sem modelo (texto padrão)</option>
                    {modelosWa.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
                </Campo>
              )}
              {wa && <Campo rotulo="Mensagem do WhatsApp"><textarea className="campo min-h-20" value={texto} onChange={(e) => setTexto(e.target.value)} /></Campo>}
              <p className="text-xs text-slate-500">Fica uma nota no histórico desta anomalia. A app não sabe se a chamada ou a mensagem chegaram a acontecer.</p>
            </>
          )}
        </>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </div>
  );
}
