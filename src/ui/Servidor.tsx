import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type SincConflito } from '../db/schema';
import { ROTULO_PAPEL, lerPapel, type Papel } from '../db/papel';
import { criarConvite, cortarAcesso, listarPessoas, mudarPapel, type Convite, type Pessoa } from '../sync/cliente';
import { desligar, ligarComConvite, lerEstado, manterMinha, sincronizar, usarDoServidor } from '../sync/motor';

const PAPEIS_CONVITE: Papel[] = ['registo', 'consulta', 'gestor'];
const LEGENDA: Record<Papel, string> = {
  gestor: 'Gere pessoas e escreve',
  registo: 'Escreve, não gere pessoas',
  consulta: 'Só consulta'
};

const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca');
const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : 'Algo correu mal.');

type Aviso = { tipo: 'ok' | 'erro'; texto: string } | null;

export function Servidor() {
  const estado = useLiveQuery(() => lerEstado(db), []);
  const papel = useLiveQuery(() => lerPapel(db), []);
  const conflitos = useLiveQuery(() => db.sincConflitos.toArray(), []);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [ocupado, setOcupado] = useState(false);
  const [codigo, setCodigo] = useState('');

  if (!estado) return <p className="py-8 text-center text-sm text-slate-400">A abrir…</p>;

  async function fazer(acao: () => Promise<unknown>, ok: string | null) {
    setOcupado(true);
    setAviso(null);
    try {
      await acao();
      if (ok !== null) setAviso({ tipo: 'ok', texto: ok });
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemDe(e) });
    } finally {
      setOcupado(false);
    }
  }

  if (!estado.ligado) {
    return (
      <>
        <h2 className="text-xl font-semibold">Servidor</h2>
        {estado.aviso && <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900">{estado.aviso}</p>}
        <div className="cartao space-y-3">
          <p className="font-semibold">Ligar este telemóvel</p>
          <p className="text-sm text-slate-600">Pede ao gestor um código de convite. Vale uma vez e expira em 48 horas.</p>
          <input className="campo" placeholder="Código, por exemplo ABCD-2345" value={codigo} onChange={(e) => setCodigo(e.target.value)} autoCapitalize="characters" />
          <button className="btn-primario w-full" disabled={ocupado || !codigo.trim()}
            onClick={() => void fazer(async () => { await ligarComConvite(db, codigo); setCodigo(''); }, 'Ligado. Os dados estão sincronizados.')}>
            {ocupado ? 'A ligar…' : 'Ligar'}
          </button>
          {aviso && <p className={aviso.tipo === 'ok' ? 'text-sm text-teal-700' : 'text-sm text-red-700'}>{aviso.texto}</p>}
        </div>
        <p className="text-xs text-slate-500">Sem ligação, a app continua a funcionar só neste telemóvel.</p>
      </>
    );
  }

  const meuPapel = papel ?? 'gestor';
  return (
    <>
      <h2 className="text-xl font-semibold">Servidor</h2>
      {estado.aviso && <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900">{estado.aviso}</p>}

      <div className="cartao space-y-2">
        <p className="font-semibold">{estado.nome ?? 'Sem nome'}</p>
        <p className="text-sm text-slate-600">{ROTULO_PAPEL[meuPapel]} · {LEGENDA[meuPapel]}</p>
        <p className="text-sm text-slate-600">Última sincronização: {dataCurta(estado.ultimaSincronizacao)}</p>
        <button className="btn-primario w-full" disabled={ocupado}
          onClick={() => void fazer(async () => {
            const r = await sincronizar(db);
            setAviso({ tipo: 'ok', texto: `Enviados ${r.enviados}, recebidos ${r.recebidos}${r.conflitos ? `, em conflito ${r.conflitos}` : ''}${r.saltados ? `, saltados ${r.saltados} (grandes de mais)` : ''}.` });
          }, null)}>
          {ocupado ? 'A sincronizar…' : 'Sincronizar agora'}
        </button>
        <button className="btn-perigo w-full" disabled={ocupado}
          onClick={() => { if (confirm('Desligar este telemóvel? Os dados ficam aqui, mas deixam de ser enviados e recebidos.')) void fazer(() => desligar(db), 'Telemóvel desligado.'); }}>
          Desligar este telemóvel
        </button>
        {aviso && <p className={aviso.tipo === 'ok' ? 'text-sm text-teal-700' : 'text-sm text-red-700'}>{aviso.texto}</p>}
      </div>

      {conflitos && conflitos.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Alterações em conflito</p>
          <p className="px-1 text-sm text-slate-600">Alguém mudou o mesmo registo ao mesmo tempo. Escolhe qual fica.</p>
          {conflitos.map((c) => (
            <ConflitoCard key={c.chave} conflito={c} ocupado={ocupado} onEscolher={(acao, ok) => void fazer(acao, ok)} />
          ))}
        </div>
      )}

      {meuPapel === 'gestor' && <GestaoEquipa ocupado={ocupado} fazer={fazer} />}
    </>
  );
}

function ConflitoCard({ conflito, ocupado, onEscolher }: { conflito: SincConflito; ocupado: boolean; onEscolher: (acao: () => Promise<void>, ok: string) => void }) {
  const local = useLiveQuery(() => db.table(conflito.tabela).get(conflito.id) as Promise<{ nome?: string } | undefined>, [conflito.tabela, conflito.id]);
  const doServidor = (conflito.atual?.dados ?? {}) as { nome?: string };
  return (
    <div className="cartao space-y-2">
      <p className="text-sm text-slate-500">{conflito.tabela}</p>
      <p className="text-sm"><span className="font-semibold">Este telemóvel:</span> {local?.nome ?? '(sem nome)'}</p>
      <p className="text-sm"><span className="font-semibold">Servidor:</span> {doServidor.nome ?? '(sem nome)'}</p>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-secundario" disabled={ocupado} onClick={() => onEscolher(() => manterMinha(db, conflito), 'Fica a versão deste telemóvel. Sincroniza para a enviar.')}>Ficar com a minha</button>
        <button className="btn-primario" disabled={ocupado} onClick={() => onEscolher(() => usarDoServidor(db, conflito), 'Fica a versão do servidor.')}>Ficar com a do servidor</button>
      </div>
    </div>
  );
}

function GestaoEquipa({ ocupado, fazer }: { ocupado: boolean; fazer: (acao: () => Promise<unknown>, ok: string | null) => Promise<void> }) {
  const token = useLiveQuery(async () => (await db.meta.get('servidor.token'))?.valor ?? null, []);
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [papelNovo, setPapelNovo] = useState<Papel>('registo');
  const [convite, setConvite] = useState<Convite | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function carregar() {
    if (!token) return;
    try {
      setPessoas((await listarPessoas(token)).utilizadores);
      setErro(null);
    } catch (e) {
      setErro(mensagemDe(e));
    }
  }

  const texto = (c: Convite) =>
    `Olá${c.nome ? ` ${c.nome}` : ''}. Para usares o Office Manager do escritório, abre ${location.origin} e, em Mais → Servidor, introduz este código:\n\n${c.codigo}\n\nVale uma vez e expira em 48 horas.`;

  async function partilhar(c: Convite) {
    const t = texto(c);
    try {
      if (navigator.share) await navigator.share({ text: t });
      else { await navigator.clipboard.writeText(t); setCopiado(true); }
    } catch {
      /* o utilizador cancelou a partilha */
    }
  }

  if (!token) return null;

  return (
    <>
      <p className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Convidar</p>
      <div className="cartao space-y-3">
        <input className="campo" placeholder="Nome de quem vais convidar" value={nome} onChange={(e) => setNome(e.target.value)} />
        <div className="grid grid-cols-3 gap-2">
          {PAPEIS_CONVITE.map((p) => (
            <button key={p} className={papelNovo === p ? 'btn-primario' : 'btn-secundario'} onClick={() => setPapelNovo(p)}>{ROTULO_PAPEL[p]}</button>
          ))}
        </div>
        <p className="text-xs text-slate-500">{LEGENDA[papelNovo]}.</p>
        <button className="btn-primario w-full" disabled={ocupado || !nome.trim()}
          onClick={async () => {
            try {
              setConvite(await criarConvite(token, nome.trim(), papelNovo));
              setCopiado(false);
              setNome('');
            } catch (e) {
              setErro(mensagemDe(e));
            }
          }}>
          Criar convite
        </button>
        {convite && (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <p className="text-sm">Código para {convite.nome} ({ROTULO_PAPEL[convite.papel]}): <span className="font-mono text-lg font-semibold">{convite.codigo}</span></p>
            <p className="text-xs text-slate-500">Expira {dataCurta(convite.expiraEm)}.</p>
            <button className="btn-secundario w-full" onClick={() => void partilhar(convite)}>
              {copiado ? 'Mensagem copiada' : 'Enviar mensagem (WhatsApp)'}
            </button>
          </div>
        )}
      </div>

      <p className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Pessoas com acesso</p>
      {!pessoas && <button className="btn-secundario w-full" onClick={() => void carregar()}>Ver pessoas</button>}
      {erro && <p className="text-sm text-red-700">{erro}</p>}
      {pessoas?.map((p) => (
        <div key={p.id} className="cartao space-y-2">
          <p className="font-semibold">{p.nome}</p>
          <p className="text-xs text-slate-500">Entrou {dataCurta(p.criadoEm)} · último acesso {dataCurta(p.ultimoAcesso)} · {p.telemoveis} telemóvel(eis)</p>
          <div className="grid grid-cols-3 gap-2">
            {PAPEIS_CONVITE.map((np) => (
              <button key={np} className={p.papel === np ? 'btn-primario' : 'btn-secundario'} disabled={ocupado || p.papel === np}
                onClick={() => void fazer(async () => { await mudarPapel(token, p.id, np); await carregar(); }, `${p.nome} passa a ${ROTULO_PAPEL[np]}.`)}>
                {ROTULO_PAPEL[np]}
              </button>
            ))}
          </div>
          <button className="btn-perigo w-full" disabled={ocupado}
            onClick={() => { if (confirm(`Cortar o acesso a ${p.nome}? Deixa de conseguir sincronizar na hora.`)) void fazer(async () => { await cortarAcesso(token, p.id); await carregar(); }, `Acesso de ${p.nome} cortado.`); }}>
            Cortar acesso
          </button>
        </div>
      ))}
    </>
  );
}
