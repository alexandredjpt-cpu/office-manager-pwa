import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Equipamento, type EstadoEquipamento } from '../db/schema';
import {
  abaterEquipamento, atualizarEquipamento, criarEquipamento, desativarEquipamento, reativarEquipamento
} from '../db/repo';
import { FILTROS_INICIAIS, categoriasDe, filtrarEquipamentos, type Filtros } from '../db/consultas';
import { exportarEquipamentosXlsx } from '../export/equipamentos';
import { partilharOuDescarregar } from '../backup/partilha';
import { ir, substituir, voltar } from './router';
import { Aviso, Campo, EstadoBadge, GarantiaBadge, Modal, diaPt } from './comuns';
import { Fotos } from './Fotos';
import { ManutencaoEquip } from './Manutencao';

/** Os filtros sobrevivem a abrir uma ficha e voltar à lista. */
let filtrosGuardados: Filtros = { ...FILTROS_INICIAIS };

interface Locais {
  ativas: { id: string; nome: string }[];
  nome: (id: string | null) => string;
}

/** A consulta devolve só dados simples; a função `nome` é montada fora dela. */
const useLocais = (): Locais | undefined => {
  const todas = useLiveQuery(() => db.localizacoes.toArray(), []);
  if (!todas) return undefined;
  return {
    ativas: todas.filter((l) => !l.deletedAt).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')),
    nome: (id) => {
      if (!id) return '';
      const l = todas.find((x) => x.id === id);
      return l ? (l.deletedAt ? `${l.nome} (eliminada)` : l.nome) : '';
    }
  };
};

export function ListaEquipamentos() {
  const dados = useLiveQuery(() => db.equipamentos.toArray(), []);
  const locais = useLocais();
  const [filtros, setFiltros] = useState<Filtros>(filtrosGuardados);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const mudar = (p: Partial<Filtros>) => {
    filtrosGuardados = { ...filtros, ...p };
    setFiltros(filtrosGuardados);
  };

  if (!dados || !locais) return null;
  const lista = filtrarEquipamentos(dados, filtros, locais.nome);
  const categorias = categoriasDe(dados);
  const total = dados.filter((e) => !e.deletedAt).length;
  const filtrado = JSON.stringify(filtros) !== JSON.stringify(FILTROS_INICIAIS);

  async function exportar() {
    setMsg(null);
    try {
      const { blob, nome } = await exportarEquipamentosXlsx(lista, locais!.nome);
      const r = await partilharOuDescarregar(blob, nome);
      if (r !== 'cancelado') setMsg({ tipo: 'ok', texto: `Guardado em Transferências: ${nome}. Anexa-o ao e-mail a partir daí.` });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Falhou: ${(e as Error).message}` });
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <input
          className="campo"
          type="search"
          placeholder="Pesquisar nome, código, marca, série…"
          value={filtros.texto}
          onChange={(e) => mudar({ texto: e.target.value })}
        />
        <button className="btn-primario shrink-0 px-5" onClick={() => ir('/equipamentos/novo')} aria-label="Novo equipamento">+</button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <select className="campo px-2 text-sm" aria-label="Estado" value={filtros.estado} onChange={(e) => mudar({ estado: e.target.value as Filtros['estado'] })}>
          <option value="ativo">Ativos</option>
          <option value="desativado">Desativados</option>
          <option value="abatido">Abatidos</option>
          <option value="todos">Todos</option>
        </select>
        <select className="campo px-2 text-sm" aria-label="Categoria" value={filtros.categoria} onChange={(e) => mudar({ categoria: e.target.value })}>
          <option value="">Categorias</option>
          {categorias.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="campo px-2 text-sm" aria-label="Localização" value={filtros.localizacaoId} onChange={(e) => mudar({ localizacaoId: e.target.value })}>
          <option value="">Locais</option>
          <option value="-">Sem local</option>
          {locais.ativas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </select>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{lista.length} de {total}</span>
        {filtrado && <button className="text-teal-700 underline" onClick={() => mudar({ ...FILTROS_INICIAIS })}>Limpar filtros</button>}
      </div>

      {lista.length === 0 ? (
        <p className="cartao text-center text-sm text-slate-500">
          {total === 0 ? 'Ainda não há equipamentos. Toca em + para criar o primeiro.' : 'Nenhum equipamento com estes filtros.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {lista.map((e) => (
            <li key={e.id}>
              <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir(`/equipamentos/${e.id}`)}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{e.nome}</p>
                  <span className="shrink-0 font-mono text-xs text-slate-500">{e.codigo}</span>
                </div>
                <p className="mt-0.5 text-sm text-slate-500">
                  {[e.categoria, locais.nome(e.localizacaoId) || 'Sem local'].filter(Boolean).join(' · ')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <EstadoBadge estado={e.estado} />
                  {e.estado !== 'abatido' && <GarantiaBadge fim={e.fimGarantia} />}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lista.length > 0 && (
        <button className="btn-secundario w-full" onClick={exportar}>Exportar {lista.length} para Excel</button>
      )}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </>
  );
}

interface Form {
  nome: string; categoria: string; marca: string; modelo: string; numeroSerie: string;
  localizacaoId: string; dataAquisicao: string; fimGarantia: string; notas: string;
}

const formDe = (e: Equipamento | null, localizacaoId = ''): Form => ({
  nome: e?.nome ?? '', categoria: e?.categoria ?? '', marca: e?.marca ?? '', modelo: e?.modelo ?? '',
  numeroSerie: e?.numeroSerie ?? '', localizacaoId: e?.localizacaoId ?? localizacaoId,
  dataAquisicao: e?.dataAquisicao ?? '', fimGarantia: e?.fimGarantia ?? '', notas: e?.notas ?? ''
});

export function FichaEquipamento({ id, localizacaoInicial }: { id: string; localizacaoInicial: string }) {
  const novo = id === 'novo';
  const eq = useLiveQuery(async (): Promise<Equipamento | null | false> => (novo ? null : ((await db.equipamentos.get(id)) ?? false)), [id]);
  const locais = useLocais();
  const todos = useLiveQuery(() => db.equipamentos.toArray(), []);

  if (eq === undefined || !locais) return null;
  if (eq === false) {
    return (
      <>
        <p className="cartao">Este equipamento não existe.</p>
        <button className="btn-secundario w-full" onClick={() => voltar('/equipamentos')}>Voltar</button>
      </>
    );
  }
  // `key` repõe o formulário quando se muda de equipamento
  return <FormEquipamento key={eq?.id ?? 'novo'} eq={eq} locais={locais} categorias={categoriasDe(todos ?? [])} localizacaoInicial={localizacaoInicial} />;
}

function FormEquipamento({ eq, locais, categorias, localizacaoInicial }: {
  eq: Equipamento | null;
  locais: Locais;
  categorias: string[];
  localizacaoInicial: string;
}) {
  const [f, setF] = useState<Form>(() => formDe(eq, localizacaoInicial));
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [abater, setAbater] = useState(false);
  const [motivo, setMotivo] = useState('');
  const abatido = eq?.estado === 'abatido';
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function guardar() {
    setAviso(null);
    try {
      if (!eq) {
        const criado = await criarEquipamento(db, { ...f, localizacaoId: f.localizacaoId || null, dataAquisicao: f.dataAquisicao || null, fimGarantia: f.fimGarantia || null });
        substituir(`/equipamentos/${criado.id}`);
      } else {
        await atualizarEquipamento(db, eq.id, f);
        setAviso({ tipo: 'ok', texto: 'Guardado.' });
      }
    } catch (e) {
      setAviso({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  async function mudar(acao: () => Promise<void>, texto: string) {
    setAviso(null);
    try {
      await acao();
      setAviso({ tipo: 'ok', texto });
    } catch (e) {
      setAviso({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  async function confirmarAbate() {
    if (!eq) return;
    try {
      await abaterEquipamento(db, eq.id, motivo);
      setAbater(false);
      setMotivo('');
    } catch (e) {
      setAviso({ tipo: 'erro', texto: (e as Error).message });
      setAbater(false);
    }
  }

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/equipamentos')}>← Equipamentos</button>

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{eq ? eq.codigo : 'Novo equipamento'}</h2>
        {eq && <EstadoBadge estado={eq.estado} />}
      </div>
      {eq && !abatido && <GarantiaBadge fim={eq.fimGarantia} />}

      {abatido && eq && (
        <Aviso tipo="erro">
          Abatido em {diaPt(eq.dataAbate)}. Motivo: {eq.motivoAbate}. Um equipamento abatido não pode ser alterado nem reativado.
        </Aviso>
      )}

      <div className="cartao space-y-3">
        <Campo rotulo="Nome *"><input className="campo" disabled={abatido} value={f.nome} onChange={set('nome')} autoComplete="off" /></Campo>
        <Campo rotulo="Categoria">
          <input className="campo" list="categorias" disabled={abatido} value={f.categoria} onChange={set('categoria')} autoComplete="off" />
          <datalist id="categorias">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Marca"><input className="campo" disabled={abatido} value={f.marca} onChange={set('marca')} autoComplete="off" /></Campo>
          <Campo rotulo="Modelo"><input className="campo" disabled={abatido} value={f.modelo} onChange={set('modelo')} autoComplete="off" /></Campo>
        </div>
        <Campo rotulo="Nº de série"><input className="campo" disabled={abatido} value={f.numeroSerie} onChange={set('numeroSerie')} autoComplete="off" /></Campo>
        <Campo rotulo="Localização">
          <select className="campo" disabled={abatido} value={f.localizacaoId} onChange={set('localizacaoId')}>
            <option value="">Sem localização</option>
            {locais.ativas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            {eq?.localizacaoId && !locais.ativas.some((l) => l.id === eq.localizacaoId) && (
              <option value={eq.localizacaoId}>{locais.nome(eq.localizacaoId)}</option>
            )}
          </select>
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Aquisição"><input className="campo" type="date" disabled={abatido} value={f.dataAquisicao} onChange={set('dataAquisicao')} /></Campo>
          <Campo rotulo="Fim da garantia"><input className="campo" type="date" disabled={abatido} value={f.fimGarantia} onChange={set('fimGarantia')} /></Campo>
        </div>
        <Campo rotulo="Notas"><textarea className="campo min-h-24" disabled={abatido} value={f.notas} onChange={set('notas')} /></Campo>
        {!abatido && <button className="btn-primario w-full" onClick={guardar}>{eq ? 'Guardar alterações' : 'Criar equipamento'}</button>}
      </div>

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {eq && !abatido && (
        <button className="btn-secundario w-full" onClick={() => ir(`/anomalias/nova?equip=${eq.id}`)}>Registar anomalia deste equipamento</button>
      )}

      {eq && <ManutencaoEquip equipamentoId={eq.id} editavel={!abatido} />}
      {eq && <div className="cartao"><Fotos entidade="equipamento" entidadeId={eq.id} editavel={!abatido} /></div>}

      {eq && !abatido && (
        <div className="cartao space-y-3">
          <h3 className="font-semibold">Estado</h3>
          {eq.estado === 'ativo' && (
            <button className="btn-secundario w-full" onClick={() => mudar(() => desativarEquipamento(db, eq.id), 'Equipamento desativado.')}>
              Desativar (guardado, fora de uso)
            </button>
          )}
          {eq.estado === 'desativado' && (
            <button className="btn-secundario w-full" onClick={() => mudar(() => reativarEquipamento(db, eq.id), 'Equipamento reativado.')}>
              Reativar
            </button>
          )}
          <button className="btn-perigo w-full" onClick={() => setAbater(true)}>Abater (definitivo)</button>
          <p className="text-xs text-slate-500">Os equipamentos nunca são apagados: o abate fica registado com data e motivo.</p>
        </div>
      )}

      <Modal aberto={abater} onFechar={() => setAbater(false)}>
        <p className="font-semibold">Abater {eq?.codigo}?</p>
        <p className="text-sm text-slate-600">Depois de abatido, o equipamento deixa de poder ser alterado ou reativado.</p>
        <Campo rotulo="Motivo do abate *">
          <textarea className="campo min-h-20" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: avariado sem reparação" />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secundario" onClick={() => setAbater(false)}>Cancelar</button>
          <button className="btn-perigo" disabled={!motivo.trim()} onClick={confirmarAbate}>Abater</button>
        </div>
      </Modal>
    </>
  );
}

export type { EstadoEquipamento };
