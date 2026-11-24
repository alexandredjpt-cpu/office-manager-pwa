import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Lembrete } from '../db/schema';
import {
  adiarLembrete, atualizarLembrete, cancelarLembrete, concluirLembrete, criarLembrete, diasDaSemana, eventosAgenda, grelhaMes, grupoDe, hojeIso, somarDias, type Evento, type Grupo
} from '../db/agenda';
import { diasAte } from '../db/garantia';
import { marcarNotaTratada } from '../db/notas';
import { ir, substituir, voltar } from './router';
import { lembretesCatalogo, ordenarCatalogos } from '../db/catalogos';
import { Aviso, Campo, SePodeEscrever, diaPt } from './comuns';

export function useEventos() {
  const equips = useLiveQuery(() => db.equipamentos.toArray(), []);
  const lembretes = useLiveQuery(() => db.lembretes.toArray(), []);
  const manutencoes = useLiveQuery(() => db.manutencoes.toArray(), []);
  const caixas = useLiveQuery(async () => ({ catalogos: ordenarCatalogos(await db.catalogos.toArray()), pedidos: await db.pedidosHavi.toArray() }), []);
  if (!equips || !lembretes || !manutencoes || !caixas) return undefined;
  const nomeEquip = (id: string | null) => (id ? equips.find((e) => e.id === id)?.nome ?? '' : '');
  const eventos = [...eventosAgenda(equips, lembretes, nomeEquip, manutencoes), ...caixas.catalogos.flatMap((c) => lembretesCatalogo(c, new Date(), caixas.pedidos))].sort((a, b) => a.data.localeCompare(b.data));
  return { equips, lembretes, eventos };
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

const COR_TIPO = { garantia: 'bg-sky-600', lembrete: 'bg-teal-700', manutencao: 'bg-amber-600' } as const;
const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
type Vista = 'lista' | 'mes' | 'semana';

function lerVista(): Vista { try { const v = localStorage.getItem('om.agendaVista'); return v === 'mes' || v === 'semana' ? v : 'lista'; } catch { return 'lista'; } }

export function Agenda() {
  const dados = useEventos();
  const [tipo, setTipo] = useState<'todos' | 'garantia' | 'lembrete' | 'manutencao'>('todos');
  const [equip, setEquip] = useState('');
  const [vista, setVistaEstado] = useState<Vista>(lerVista);
  const hoje = hojeIso();
  const [foco, setFoco] = useState(hoje);
  const [dia, setDia] = useState<string>(hoje);
  if (!dados) return null;
  const setVista = (v: Vista) => { setVistaEstado(v); try { localStorage.setItem('om.agendaVista', v); } catch { /* só nesta sessão */ } };
  const lista = dados.eventos.filter((e) => (tipo === 'todos' || e.tipo === tipo) && (!equip || e.equipamentoId === equip));
  const doDia = (d: string) => lista.filter((e) => e.data === d);
  const equipsComEventos = dados.equips.filter((e) => dados.eventos.some((x) => x.equipamentoId === e.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const [ano, mes] = foco.split('-').map(Number);
  const mudarMes = (n: number) => { const d = new Date(Date.UTC(ano, mes - 1 + n, 1)); setFoco(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`); };

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/mais')}>← Mais</button>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Agenda</h2>
        <SePodeEscrever><button className="btn-primario px-5" onClick={() => ir('/agenda/novo')} aria-label="Novo lembrete">+</button></SePodeEscrever>
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-sm" role="tablist">
        {([['lista', 'Lista'], ['mes', 'Mês'], ['semana', 'Semana']] as const).map(([v, r]) => (
          <button key={v} role="tab" aria-selected={vista === v} className={`rounded-lg py-1.5 ${vista === v ? 'bg-white font-semibold shadow' : 'text-slate-600'}`} onClick={() => setVista(v)}>{r}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select className="campo" aria-label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
          <option value="todos">Tudo</option>
          <option value="lembrete">Lembretes</option>
          <option value="garantia">Garantias</option>
          <option value="manutencao">Manutenções</option>
        </select>
        <select className="campo" aria-label="Equipamento" value={equip} onChange={(e) => setEquip(e.target.value)}>
          <option value="">Todos os equipamentos</option>
          {equipsComEventos.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </div>

      {vista === 'lista' && (
        <>
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
      )}

      {vista === 'mes' && (
        <>
          <div className="cartao space-y-2">
            <div className="flex items-center justify-between">
              <button className="btn-secundario px-4 py-1" aria-label="Mês anterior" onClick={() => mudarMes(-1)}>‹</button>
              <p className="font-semibold capitalize">{MESES[mes - 1]} {ano}</p>
              <button className="btn-secundario px-4 py-1" aria-label="Mês seguinte" onClick={() => mudarMes(1)}>›</button>
            </div>
            <div className="grid grid-cols-7 text-center text-xs text-slate-500">{DIAS_SEMANA.map((d) => <span key={d}>{d}</span>)}</div>
            <div className="grid grid-cols-7 gap-1">
              {grelhaMes(ano, mes).flat().map((c) => {
                const evs = doDia(c.data);
                return (
                  <button key={c.data} aria-label={`Dia ${c.data}`} onClick={() => setDia(c.data)}
                    className={`flex h-12 flex-col items-center justify-start rounded-lg pt-1 text-sm ${c.doMes ? '' : 'text-slate-300'} ${c.data === dia ? 'bg-teal-700 text-white' : c.data === hoje ? 'bg-teal-50 font-semibold' : ''}`}>
                    {Number(c.data.slice(8))}
                    <span className="mt-0.5 flex gap-0.5">{evs.slice(0, 3).map((e) => <span key={e.chave} className={`h-1.5 w-1.5 rounded-full ${c.data === dia ? 'bg-white' : COR_TIPO[e.tipo]}`} />)}</span>
                  </button>
                );
              })}
            </div>
            <button className="text-xs text-teal-700 underline" onClick={() => { setFoco(hoje); setDia(hoje); }}>Hoje</button>
          </div>
          <section className="cartao">
            <h3 className="font-semibold">{diaPt(dia)}</h3>
            {doDia(dia).length === 0 ? <p className="text-sm text-slate-500">Nada neste dia.</p> : <ul className="divide-y divide-slate-100">{doDia(dia).map((e) => <li key={e.chave}><EventoLinha e={e} /></li>)}</ul>}
            <button className="mt-2 text-sm text-teal-700 underline" onClick={() => ir(`/agenda/novo?data=${dia}`)}>+ Lembrete neste dia</button>
          </section>
        </>
      )}

      {vista === 'semana' && (
        <>
          <div className="flex items-center justify-between">
            <button className="btn-secundario px-4 py-1" aria-label="Semana anterior" onClick={() => setDia(somarDias(dia, -7))}>‹</button>
            <p className="text-sm font-semibold">{diaPt(diasDaSemana(dia)[0])} – {diaPt(diasDaSemana(dia)[6])}</p>
            <button className="btn-secundario px-4 py-1" aria-label="Semana seguinte" onClick={() => setDia(somarDias(dia, 7))}>›</button>
          </div>
          {diasDaSemana(dia).map((d, i) => (
            <section key={d} className={`cartao ${d === hoje ? 'border-teal-400' : ''}`}>
              <h3 className="text-sm font-semibold">{DIAS_SEMANA[i]} · {diaPt(d)}{d === hoje ? ' (hoje)' : ''}</h3>
              {doDia(d).length === 0 ? <p className="text-xs text-slate-400">—</p> : <ul className="divide-y divide-slate-100">{doDia(d).map((e) => <li key={e.chave}><EventoLinha e={e} /></li>)}</ul>}
            </section>
          ))}
        </>
      )}
    </>
  );
}

interface Form { titulo: string; data: string; antecedenciaDias: string; equipamentoId: string; notas: string }

export function FichaLembrete({ id, dataInicial = '', titulo = '', notas = '', nota = '' }: { id: string; dataInicial?: string; titulo?: string; notas?: string; nota?: string }) {
  const novo = id === 'novo';
  const l = useLiveQuery(async (): Promise<Lembrete | null | false> => (novo ? null : ((await db.lembretes.get(id)) ?? false)), [id]);
  const equips = useLiveQuery(() => db.equipamentos.filter((e) => !e.deletedAt && e.estado !== 'abatido').toArray(), []);
  if (l === undefined || !equips) return null;
  if (l === false) return (<><p className="cartao">Este lembrete não existe.</p><button className="btn-secundario w-full" onClick={() => voltar('/agenda')}>Voltar</button></>);
  return <FormLembrete key={l?.id ?? 'novo'} l={l} dataInicial={dataInicial} tituloInicial={titulo} notasIniciais={notas} nota={l ? '' : nota} equips={equips.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))} />;
}

function FormLembrete({ l, equips, dataInicial = '', tituloInicial = '', notasIniciais = '', nota = '' }: { l: Lembrete | null; equips: { id: string; nome: string; codigo: string }[]; dataInicial?: string; tituloInicial?: string; notasIniciais?: string; nota?: string }) {
  const [f, setF] = useState<Form>({ titulo: l?.titulo ?? tituloInicial, data: l?.data ?? (/^\d{4}-\d{2}-\d{2}$/.test(dataInicial) ? dataInicial : hojeIso()), antecedenciaDias: String(l?.antecedenciaDias ?? 0), equipamentoId: l?.equipamentoId ?? '', notas: l?.notas ?? notasIniciais });
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
      const criado = await criarLembrete(db, f);
      if (nota) { try { await marcarNotaTratada(db, nota, 'lembrete', criado.id); } catch { /* nota já tratada */ } }
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
