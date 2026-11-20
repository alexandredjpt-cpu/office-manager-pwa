import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Artigo, type Encomenda, type EncomendaLinha, type Fornecedor } from '../db/schema';
import { camposEncomenda } from '../db/emails';
import { adicionarNota } from '../db/encomendas';
import { hojeIso } from '../db/agenda';
import { lerResponsavel } from '../export/gerar';
import { diaPt } from './comuns';
import { EmailPreparar } from './EmailPreparar';

interface Props { encomenda: Encomenda; fornecedor: Fornecedor | undefined; linhas: EncomendaLinha[]; artigos: Artigo[] }

/** E-mail ao fornecedor a partir da encomenda (modelos com {{encomenda}}, {{artigos}}…). */
export function EmailEncomenda({ encomenda, fornecedor, linhas, artigos }: Props) {
  const resp = useLiveQuery(() => lerResponsavel(db), []) ?? '';
  return (
    <EmailPreparar
      titulo="Preparar e-mail"
      origem="encomenda"
      refId={encomenda.id}
      modeloInicial="Pedido de encomenda"
      para={{ nome: fornecedor?.nome ?? '', email: fornecedor?.email ?? '', contacto: fornecedor?.contacto }}
      campos={camposEncomenda(encomenda, fornecedor, linhas, artigos, resp, diaPt(hojeIso()))}
      aoAbrir={async (resumo) => { await adicionarNota(db, encomenda.id, resumo); }}
    />
  );
}
