import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Lembrete } from '../db/schema';
import {
  adiarLembrete, atualizarLembrete, cancelarLembrete, concluirLembrete, criarLembrete, eventosAgenda, grupoDe, hojeIso, type Evento, type Grupo
} from '../db/agenda';
import { diasAte } from '../db/garantia';
import { ir, substituir, voltar } from './router';
import { Aviso, Campo, diaPt } from './comuns';

export function useEventos() {
  const equips = useLiveQuery(() => db.equipamentos.toArray(), []);
  const lembretes = useLiveQuery(() => db.lembretes.toArray(), []);
  if (!equips || !lembretes) return undefined;
  const nomeEquip = (id: string | null) => (id ? equips.find((e) => e.id === id)?.nome ?? '' : '');
  return { equips, lembretes, eventos: eventosAgenda(equips, lembretes, nomeEquip) };
}

const GRUPOS: [Grupo, string][] = [['atrasado', 'Atrasados'], ['semana', 'Próximos 7 dias'], ['mes', 'Este mês'], ['depois', 'Mais tarde']];
const ROTULO = { garantia: 'Garantia', lembrete: 'Lembrete', manutencao: 'Manutenção' } as const;

export function EventoLinha({ e }: { e: Evento }) {
  const d = diasAte(e.data);
  return (
    <button className="flex w-full items-start justify-between gap-3 py-2.5 text-left" onClick={() => ir(e.rota)}>
      <span>
        <span className="block text-sm font-medium">{e.titulo}</span>
        <span className="text-xs text-slate-500">{ROTULO[e.tipo]}{e.detalhe ? ` · ${e.detalhe}` : ''}</span>
      </span>
      <span className={`shrink-0 text-xs ${d < 0 ? 'font-medium text-red-700' : 'text-slate-500'}`}>
        {diaPt(e.data)}<br />{d < 0 ? `há ${-d} d` : d === 0 ? 'hoje' : `em ${d} d`}
      </span>
    </button>
  );
}

export function Agenda() {
  const dados = useEventos();
  const [tipo, setTipo] = useState<'todos' | 'garantia' | 'lembrete' | 'manutencao'>('todos');
  if (!dados) return null;
  const lista = dados.eventos.filter((e) => tipo === 'todos' || e.tipo === tipo);

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/mais')}>← Mais</button>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Agenda</h2>
        <button className="btn-primario px-5" onClick={() => ir('/agenda/novo')} aria-label="Novo lembrete">+</button>
      </div>
      <select className="campo" aria-label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
        <option value="todos">Tudo</option>
        <option value="lembrete">Lembretes</option>
        <option value="garantia">Garantias</option>
        <option value="manutencao">Manutenções</option>
      </select>
      <p className="text-xs text-slate-500">Os avisos aparecem no Início quando abres a app. As datas e a antecedência escolhes tu.</p>
      {lista.length === 0 && <p className="cartao text-center text-sm text-slate-500">Nada agendado. Toca em + para criar um lembrete.</p>}
      {GRUPOS.map(([g, titulo]) => {
        const itens = lista.filter((e) => grupoDe(e.data) === g);
        if (!itens.length) return null;
        return (
          <section key={g} className="cartao">
            <h3 className="font-semibold">{titulo} ({itens.length})</h3>
            <ul className="divide-y divide-slate-100">{itens.map((e) => <li key={e.chave}><EventoLinha e={e} /></li>)}</ul>
          </section>
        );
      })}
    </>
  );
}

interface Form { titulo: string; data: string; antecedenciaDias: string; equipamentoId: string; notas: string }

export function FichaLembrete({ id }: { id: string }) {
  const novo = id === 'novo';
  const l = useLiveQuery(async (): Promise<Lembrete | null | false> => (novo ? null : ((await db.lembretes.get(id)) ?? false)), [id]);
  const equips = useLiveQuery(() => db.equipamentos.filter((e) => !e.deletedAt && e.estado !== 'abatido').toArray(), []);
  if (l === undefined || !equips) return null;
  if (l === false) return (<><p className="cartao">Este lembrete não existe.</p><button className="btn-secundario w-full" onClick={() => voltar('/agenda')}>Voltar</button></>);
  return <FormLembrete key={l?.id ?? 'novo'} l={l} equips={equips.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))} />;
}

function FormLembrete({ l, equips }: { l: Lembrete | null; equips: { id: string; nome: string; codigo: string }[] }) {
  const [f, setF] = useState<Form>({ titulo: l?.titulo ?? '', data: l?.data ?? hojeIso(), antecedenciaDias: String(l?.antecedenciaDias ?? 0), equipamentoId: l?.equipamentoId ?? '', notas: l?.notas ?? '' });
  const [nova, setNova] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const fechado = l !== null && l.estado !== 'pendente';
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function exec(fn: () => Promise<unknown>, ok?: string, depois?: () => void) {
    setAviso(null);
    try {
      await fn();
      if (ok) setAviso({ tipo: 'ok', texto: ok });
      depois?.();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  const guardar = () => exec(async () => {
    if (!l) {
      await criarLembrete(db, f);
    } else {
      await atualizarLembrete(db, l.id, f);
    }
  }, l ? 'Guardado.' : undefined, () => { if (!l) substituir('/agenda'); });

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/agenda')}>← Agenda</button>
      <h2 className="text-xl font-semibold">{l ? 'Lembrete' : 'Novo lembrete'}</h2>
      {fechado && <Aviso tipo="ok">Lembrete {l?.estado === 'feito' ? 'concluído' : 'cancelado'}.</Aviso>}
      <div className="cartao space-y-3">
        <Campo rotulo="Título *"><input className="campo" disabled={fechado} value={f.titulo} onChange={set('titulo')} autoComplete="off" /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Data"><input className="campo" type="date" disabled={fechado} value={f.data} onChange={set('data')} /></Campo>
          <Campo rotulo="Avisar com (dias)" dica="0 = só no próprio dia"><input className="campo" inputMode="numeric" disabled={fechado} value={f.antecedenciaDias} onChange={set('antecedenciaDias')} /></Campo>
        </div>
        <Campo rotulo="Equipamento (opcional)">
          <select className="campo" disabled={fechado} value={f.equipamentoId} onChange={set('equipamentoId')}>
            <option value="">Nenhum</option>
            {equips.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Notas"><textarea className="campo min-h-20" disabled={fechado} value={f.notas} onChange={set('notas')} /></Campo>
        {!fechado && <button className="btn-primario w-full" onClick={guardar}>{l ? 'Guardar alterações' : 'Criar lembrete'}</button>}
      </div>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {l && !fechado && (
        <div className="cartao space-y-3">
          <button className="btn-primario w-full" onClick={() => exec(() => concluirLembrete(db, l.id), undefined, () => voltar('/agenda'))}>Marcar como feito</button>
          <div className="flex items-end gap-2">
            <Campo rotulo="Adiar para"><input className="campo" type="date" value={nova} onChange={(e) => setNova(e.target.value)} /></Campo>
            <button className="btn-secundario" disabled={!nova} onClick={() => exec(() => adiarLembrete(db, l.id, nova), 'Adiado.', () => { setF((x) => ({ ...x, data: nova })); setNova(''); })}>Adiar</button>
          </div>
          <button className="btn-perigo w-full" onClick={() => exec(() => cancelarLembrete(db, l.id), undefined, () => voltar('/agenda'))}>Cancelar lembrete</button>
        </div>
      )}
    </>
  );
}
