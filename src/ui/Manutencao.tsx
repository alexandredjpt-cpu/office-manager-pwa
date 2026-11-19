import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Manutencao } from '../db/schema';
import { atualizarManutencao, cancelarManutencao, concluirManutencao, criarManutencao, type DadosManutencao } from '../db/manutencao';
import { diasAte } from '../db/garantia';
import { hojeIso } from '../db/agenda';
import { Aviso, Campo, Modal, diaPt } from './comuns';

interface Form { titulo: string; descricao: string; responsavel: string; proximaData: string; antecedenciaDias: string; frequenciaDias: string }
const vazio = (): Form => ({ titulo: '', descricao: '', responsavel: '', proximaData: '', antecedenciaDias: '7', frequenciaDias: '' });

export function ManutencaoEquip({ equipamentoId, editavel }: { equipamentoId: string; editavel: boolean }) {
  const tarefas = useLiveQuery(() => db.manutencoes.where('equipamentoId').equals(equipamentoId).filter((m) => !m.deletedAt).toArray(), [equipamentoId]);
  const execucoes = useLiveQuery(() => db.execucoes.where('equipamentoId').equals(equipamentoId).filter((x) => !x.deletedAt).toArray(), [equipamentoId]);
  const [form, setForm] = useState<{ id: string | null; f: Form } | null>(null);
  const [concluir, setConcluir] = useState<Manutencao | null>(null);
  const [dataEx, setDataEx] = useState(hojeIso());
  const [notas, setNotas] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  if (!tarefas || !execucoes) return null;

  const nomeTarefa = (id: string) => tarefas.find((t) => t.id === id)?.titulo ?? '?';
  const ativas = tarefas.filter((t) => t.estado === 'ativa').sort((a, b) => a.proximaData.localeCompare(b.proximaData));
  const hist = [...execucoes].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : a.createdAt < b.createdAt ? 1 : -1)).slice(0, 10);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((x) => (x ? { ...x, f: { ...x.f, [k]: e.target.value } } : x));

  async function exec(fn: () => Promise<unknown>, ok: string, depois?: () => void) {
    setAviso(null);
    try { await fn(); if (ok) setAviso({ tipo: 'ok', texto: ok }); depois?.(); } catch (e) { setAviso({ tipo: 'erro', texto: (e as Error).message }); }
  }
  const guardar = () => form && exec(async () => {
    const d: DadosManutencao = { equipamentoId, ...form.f, frequenciaDias: form.f.frequenciaDias };
    if (form.id) await atualizarManutencao(db, form.id, d); else await criarManutencao(db, d);
  }, 'Guardado.', () => setForm(null));
  const concluirComo = (reagendar: boolean) => concluir && exec(async () => {
    const r = await concluirManutencao(db, concluir.id, { data: dataEx, notas, reagendar });
    setAviso({ tipo: 'ok', texto: r.proximaData ? `Registada. Próxima: ${diaPt(r.proximaData)}.` : 'Registada e tarefa terminada.' });
  }, '', () => { setConcluir(null); setNotas(''); });

  return (
    <div className="cartao space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Manutenção preventiva</h3>
        {editavel && <button className="btn-secundario px-4" onClick={() => setForm({ id: null, f: vazio() })}>+ Tarefa</button>}
      </div>
      {ativas.length === 0 && !form && <p className="text-sm text-slate-500">Sem tarefas agendadas.</p>}
      <ul className="divide-y divide-slate-100">
        {ativas.map((t) => {
          const d = diasAte(t.proximaData);
          return (
            <li key={t.id} className="space-y-1 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{t.titulo}</p>
                  <p className="text-xs text-slate-500">{t.responsavel ? `${t.responsavel} · ` : ''}{t.frequenciaDias ? `repete a cada ${t.frequenciaDias} d` : 'sem repetição'}</p>
                </div>
                <p className={`shrink-0 text-right text-xs ${d < 0 ? 'font-medium text-red-700' : 'text-slate-500'}`}>{diaPt(t.proximaData)}<br />{d < 0 ? `há ${-d} d` : d === 0 ? 'hoje' : `em ${d} d`}</p>
              </div>
              {t.descricao && <p className="text-xs text-slate-600">{t.descricao}</p>}
              {editavel && (
                <div className="flex gap-4 text-xs">
                  <button className="text-teal-700 underline" onClick={() => { setDataEx(hojeIso()); setConcluir(t); }}>Concluir</button>
                  <button className="text-slate-600 underline" onClick={() => setForm({ id: t.id, f: { titulo: t.titulo, descricao: t.descricao, responsavel: t.responsavel, proximaData: t.proximaData, antecedenciaDias: String(t.antecedenciaDias), frequenciaDias: t.frequenciaDias ? String(t.frequenciaDias) : '' } })}>Editar</button>
                  <button className="text-red-700 underline" onClick={() => exec(() => cancelarManutencao(db, t.id), 'Tarefa cancelada.')}>Cancelar</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {form && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-3">
          <Campo rotulo="Tarefa *"><input className="campo" value={form.f.titulo} onChange={set('titulo')} autoComplete="off" /></Campo>
          <Campo rotulo="Descrição"><textarea className="campo min-h-16" value={form.f.descricao} onChange={set('descricao')} /></Campo>
          <Campo rotulo="Responsável"><input className="campo" value={form.f.responsavel} onChange={set('responsavel')} autoComplete="off" /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Próxima data *"><input className="campo" type="date" value={form.f.proximaData} onChange={set('proximaData')} /></Campo>
            <Campo rotulo="Avisar com (dias)"><input className="campo" inputMode="numeric" value={form.f.antecedenciaDias} onChange={set('antecedenciaDias')} /></Campo>
          </div>
          <Campo rotulo="Repetir a cada (dias)" dica="Opcional. Só se aplica se confirmares ao concluir."><input className="campo" inputMode="numeric" value={form.f.frequenciaDias} onChange={set('frequenciaDias')} /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-secundario" onClick={() => setForm(null)}>Fechar</button>
            <button className="btn-primario" onClick={guardar}>Guardar</button>
          </div>
        </div>
      )}
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {hist.length > 0 && (
        <div>
          <p className="text-sm font-medium">Histórico de execuções</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {hist.map((x) => <li key={x.id} className="py-1.5"><span>{nomeTarefa(x.manutencaoId)}</span> <span className="text-xs text-slate-500">· {diaPt(x.data)}{x.responsavel ? ` · ${x.responsavel}` : ''}{x.notas ? ` · ${x.notas}` : ''}</span></li>)}
          </ul>
        </div>
      )}
      <Modal aberto={concluir !== null} onFechar={() => setConcluir(null)}>
        <p className="font-semibold">Concluir «{concluir?.titulo}»</p>
        <Campo rotulo="Data da execução"><input className="campo" type="date" value={dataEx} onChange={(e) => setDataEx(e.target.value)} /></Campo>
        <Campo rotulo="Notas"><input className="campo" value={notas} onChange={(e) => setNotas(e.target.value)} autoComplete="off" /></Campo>
        {concluir?.frequenciaDias ? (
          <>
            <p className="text-sm text-slate-600">Agendar a próxima daqui a {concluir.frequenciaDias} dias? Só muda a data se confirmares.</p>
            <button className="btn-primario w-full" onClick={() => concluirComo(true)}>Concluir e agendar a próxima</button>
            <button className="btn-secundario w-full" onClick={() => concluirComo(false)}>Concluir sem agendar</button>
          </>
        ) : <button className="btn-primario w-full" onClick={() => concluirComo(false)}>Concluir</button>}
        <button className="w-full text-sm text-slate-500" onClick={() => setConcluir(null)}>Voltar</button>
      </Modal>
    </div>
  );
}
