/**
 * Office Manager — servidor (Cloudflare Worker + D1).
 *
 * Guarda uma cópia do que a equipa publica e serve-a a quem tem convite. Quem escreve
 * e quem gere pessoas é decidido aqui, não na app: esconder botões no telemóvel não
 * protege nada.
 */
import {
  LIMITE_ENTRADAS_POR_MINUTO, VALIDADE_CONVITE_HORAS, conviteUtilizavel, desdeDe, gerarCodigo, gerarToken,
  normalizarCodigo, papelValido, podeEscrever, podeGerir, resumo, validarEnvio, type Papel
} from './logica';

/** Limitação de pedidos do Cloudflare (binding `LIMITE_ENTRAR` no wrangler.toml). */
export interface LimitadorPedidos {
  limit(opcoes: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  BD: D1Database;
  SEGREDO_ARRANQUE?: string;
  ORIGEM_PERMITIDA?: string;
  LIMITE_ENTRAR?: LimitadorPedidos;
}

interface Quem { utilizadorId: string; nome: string; papel: Papel; dispositivoId: string; ultimoAcesso: string | null }

const json = (dados: unknown, estado = 200, env?: Env) =>
  new Response(JSON.stringify(dados), { status: estado, headers: { 'content-type': 'application/json; charset=utf-8', ...cabecalhosCors(env) } });
const erro = (mensagem: string, estado: number, env?: Env) => json({ erro: mensagem }, estado, env);

function cabecalhosCors(env?: Env): Record<string, string> {
  return {
    // Sem a variável, fecha-se na app conhecida; nunca se abre a toda a gente.
    'access-control-allow-origin': env?.ORIGEM_PERMITIDA ?? 'https://office-manager-pwa.pages.dev',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-max-age': '86400'
  };
}

const agora = () => new Date().toISOString();
const novoId = () => crypto.randomUUID();

/** Lê um registo da base; um JSON estragado não derruba a leitura dos outros. */
function lerRegisto(r: { tabela: string; id: string; dados: string; atualizado: string; seq: number }) {
  try { return { ...r, dados: JSON.parse(r.dados) as unknown }; } catch { return { ...r, dados: null }; }
}

/** Reserva um bloco do relógio do servidor, para cada registo ficar com o seu número. */
async function reservarSeq(bd: D1Database, quantos: number): Promise<number> {
  await bd.prepare("INSERT OR IGNORE INTO contador (nome, valor) VALUES ('seq', 0)").run();
  const r = await bd.prepare("UPDATE contador SET valor = valor + ? WHERE nome = 'seq' RETURNING valor").bind(quantos).first<{ valor: number }>();
  return (r?.valor ?? quantos) - quantos;
}

async function identificar(pedido: Request, env: Env): Promise<Quem | null> {
  const cabecalho = pedido.headers.get('authorization') ?? '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
  if (!token) return null;
  const linha = await env.BD.prepare(
    `SELECT d.id AS dispositivoId, d.ultimoAcesso, u.id AS utilizadorId, u.nome, u.papel
       FROM dispositivos d JOIN utilizadores u ON u.id = d.utilizadorId
      WHERE d.tokenHash = ? AND d.removidoEm IS NULL AND u.removidoEm IS NULL`
  ).bind(await resumo(token)).first<Quem>();
  if (!linha) return null;
  // A marca de último acesso só se grava uma vez por hora, para não gastar escritas à toa.
  const antiga = !linha.ultimoAcesso || Date.now() - new Date(linha.ultimoAcesso).getTime() > 3600_000;
  if (antiga) await env.BD.prepare('UPDATE dispositivos SET ultimoAcesso = ? WHERE id = ?').bind(agora(), linha.dispositivoId).run();
  return linha;
}

/** Explica porque é que uma alteração a um utilizador não passou. */
async function motivoFalhou(id: string, env: Env): Promise<Response> {
  const existe = await env.BD.prepare('SELECT id FROM utilizadores WHERE id = ? AND removidoEm IS NULL').bind(id).first();
  if (!existe) return erro('Não existe.', 404, env);
  return erro('Tem de ficar pelo menos um gestor.', 409, env);
}

async function corpoJson(pedido: Request): Promise<unknown> {
  try { return await pedido.json(); } catch { return null; }
}

export default {
  async fetch(pedido: Request, env: Env): Promise<Response> {
    const url = new URL(pedido.url);
    const rota = url.pathname.replace(/\/+$/, '');
    const metodo = pedido.method;

    if (metodo === 'OPTIONS') return new Response(null, { status: 204, headers: cabecalhosCors(env) });

    // --- primeiro gestor: uma só vez, com o segredo, e só enquanto não houver ninguém ---
    if (metodo === 'POST' && rota === '/api/arranque') {
      const corpo = (await corpoJson(pedido)) as { segredo?: string; nome?: string; dispositivo?: string } | null;
      // Comparam-se resumos, não os textos: o tempo da comparação deixa de dizer seja o que for.
      if (!env.SEGREDO_ARRANQUE || (await resumo(String(corpo?.segredo ?? ''))) !== (await resumo(env.SEGREDO_ARRANQUE))) return erro('Segredo inválido.', 403, env);
      const token = gerarToken();
      const utilizadorId = novoId();
      // A própria base de dados garante que só o primeiro arranque cria alguém: dois pedidos
      // ao mesmo tempo não podem criar dois gestores.
      const criado = await env.BD.prepare(
        `INSERT INTO utilizadores (id, nome, papel, criadoEm)
         SELECT ?, ?, 'gestor', ? WHERE NOT EXISTS (SELECT 1 FROM utilizadores WHERE removidoEm IS NULL)`
      ).bind(utilizadorId, corpo?.nome?.trim() || 'Gestor', agora()).run();
      if ((criado.meta?.changes ?? 0) === 0) return erro('O arranque já foi feito.', 409, env);
      await env.BD.prepare('INSERT INTO dispositivos (id, utilizadorId, tokenHash, descricao, criadoEm) VALUES (?, ?, ?, ?, ?)')
        .bind(novoId(), utilizadorId, await resumo(token), corpo?.dispositivo?.slice(0, 80) ?? '', agora()).run();
      return json({ token, papel: 'gestor' }, 201, env);
    }

    // --- entrar com um convite ---
    if (metodo === 'POST' && rota === '/api/entrar') {
      // Adivinhar um código tem de ser lento: cinco tentativas por minuto e por endereço.
      if (env.LIMITE_ENTRAR) {
        const { success } = await env.LIMITE_ENTRAR.limit({ key: pedido.headers.get('cf-connecting-ip') ?? 'desconhecido' });
        if (!success) return erro(`Demasiadas tentativas. Espera um minuto. (máximo ${LIMITE_ENTRADAS_POR_MINUTO} por minuto)`, 429, env);
      }
      const corpo = (await corpoJson(pedido)) as { codigo?: string; dispositivo?: string } | null;
      const codigo = normalizarCodigo(String(corpo?.codigo ?? ''));
      if (!codigo) return erro('Falta o código.', 400, env);
      const hash = await resumo(codigo);
      const convite = await env.BD.prepare('SELECT nome, papel, expiraEm, usadoEm FROM convites WHERE codigoHash = ?')
        .bind(hash).first<{ nome: string; papel: Papel; expiraEm: string; usadoEm: string | null }>();
      const pode = conviteUtilizavel(convite, new Date());
      if (!pode.ok) return erro(pode.erro, 403, env);
      // Primeiro marca-se o convite como usado; só quem o marcou é que entra. Dois telemóveis
      // com o mesmo código no mesmo instante: entra um, o outro ouve «já foi usado».
      const marcado = await env.BD.prepare('UPDATE convites SET usadoEm = ? WHERE codigoHash = ? AND usadoEm IS NULL').bind(agora(), hash).run();
      if ((marcado.meta?.changes ?? 0) === 0) return erro('Este código já foi usado.', 403, env);
      const token = gerarToken();
      const utilizadorId = novoId();
      await env.BD.batch([
        env.BD.prepare('INSERT INTO utilizadores (id, nome, papel, criadoEm) VALUES (?, ?, ?, ?)').bind(utilizadorId, convite!.nome, convite!.papel, agora()),
        env.BD.prepare('INSERT INTO dispositivos (id, utilizadorId, tokenHash, descricao, criadoEm) VALUES (?, ?, ?, ?, ?)')
          .bind(novoId(), utilizadorId, await resumo(token), String(corpo?.dispositivo ?? '').slice(0, 80), agora())
      ]);
      return json({ token, nome: convite!.nome, papel: convite!.papel }, 201, env);
    }

    // --- daqui para baixo é preciso estar identificado ---
    const quem = await identificar(pedido, env);
    if (!quem) return erro('Sem acesso. Pede um convite novo.', 401, env);

    if (metodo === 'GET' && rota === '/api/eu') return json({ nome: quem.nome, papel: quem.papel }, 200, env);

    if (metodo === 'GET' && rota === '/api/puxar') {
      const desde = desdeDe(url.searchParams.get('desde'));
      const limite = Math.min(Math.max(desdeDe(url.searchParams.get('limite')) || 500, 1), 1000);
      const { results } = await env.BD.prepare(
        'SELECT tabela, id, dados, atualizado, seq FROM registos WHERE seq > ? ORDER BY seq LIMIT ?'
      ).bind(desde, limite).all<{ tabela: string; id: string; dados: string; atualizado: string; seq: number }>();
      const registos = results.map((r) => {
        // Um registo corrompido na base não pode derrubar a leitura de todos os outros.
        try { return { ...r, dados: JSON.parse(r.dados) as unknown }; } catch { return { ...r, dados: null }; }
      });
      return json({ registos, seq: registos.length ? registos[registos.length - 1].seq : desde, fim: registos.length < limite }, 200, env);
    }

    if (metodo === 'POST' && rota === '/api/enviar') {
      if (!podeEscrever(quem.papel)) return erro('Esta conta é só de consulta.', 403, env);
      const validado = validarEnvio(await corpoJson(pedido));
      if (!validado.ok) return erro(validado.erro, 400, env);
      const { registos } = validado;
      if (registos.length === 0) return json({ gravados: 0, seq: 0, conflitos: [] }, 200, env);
      const base = await reservarSeq(env.BD, registos.length);
      // Cada registo só entra se a versão que a app conhece ainda for a do servidor. Um registo
      // novo só entra se ninguém o criou entretanto. Quem perde recebe a versão atual de volta.
      const operacoes = registos.map((r, i) => {
        const seq = base + i + 1;
        const dados = JSON.stringify(r.dados ?? null);
        return r.base === null
          ? env.BD.prepare(
              'INSERT INTO registos (tabela, id, dados, atualizado, seq) VALUES (?, ?, ?, ?, ?) ON CONFLICT (tabela, id) DO NOTHING'
            ).bind(r.tabela, r.id, dados, r.atualizado, seq)
          : env.BD.prepare(
              'UPDATE registos SET dados = ?, atualizado = ?, seq = ? WHERE tabela = ? AND id = ? AND seq = ?'
            ).bind(dados, r.atualizado, seq, r.tabela, r.id, r.base);
      });
      const resultados = await env.BD.batch(operacoes);
      const recusados = registos.filter((_, i) => (resultados[i]?.meta?.changes ?? 0) === 0);
      const conflitos = [];
      for (const r of recusados) {
        const atual = await env.BD.prepare('SELECT tabela, id, dados, atualizado, seq FROM registos WHERE tabela = ? AND id = ?')
          .bind(r.tabela, r.id).first<{ tabela: string; id: string; dados: string; atualizado: string; seq: number }>();
        conflitos.push({ tabela: r.tabela, id: r.id, atual: atual ? lerRegisto(atual) : null });
      }
      return json({ gravados: registos.length - recusados.length, seq: base + registos.length, conflitos }, 200, env);
    }

    // --- utilizadores e convites: só o gestor ---
    if (rota === '/api/convites' && metodo === 'POST') {
      if (!podeGerir(quem.papel)) return erro('Só o gestor convida pessoas.', 403, env);
      const corpo = (await corpoJson(pedido)) as { nome?: string; papel?: unknown } | null;
      const nome = String(corpo?.nome ?? '').trim();
      if (corpo?.papel !== undefined && !papelValido(corpo.papel)) return erro('Papel inválido.', 400, env);
      const papel: Papel = papelValido(corpo?.papel) ? corpo.papel : 'consulta';
      if (!nome) return erro('Dá um nome a quem vais convidar.', 400, env);
      const codigo = gerarCodigo();
      const expiraEm = new Date(Date.now() + VALIDADE_CONVITE_HORAS * 3600_000).toISOString();
      await env.BD.prepare('INSERT INTO convites (codigoHash, nome, papel, criadoEm, expiraEm) VALUES (?, ?, ?, ?, ?)')
        .bind(await resumo(normalizarCodigo(codigo)), nome, papel, agora(), expiraEm).run();
      // O código só aparece aqui: no servidor fica apenas o resumo.
      return json({ codigo, nome, papel, expiraEm }, 201, env);
    }

    if (rota === '/api/utilizadores' && metodo === 'GET') {
      if (!podeGerir(quem.papel)) return erro('Só o gestor vê a lista de pessoas.', 403, env);
      const { results } = await env.BD.prepare(
        `SELECT u.id, u.nome, u.papel, u.criadoEm, MAX(d.ultimoAcesso) AS ultimoAcesso, COUNT(d.id) AS telemoveis
           FROM utilizadores u LEFT JOIN dispositivos d ON d.utilizadorId = u.id AND d.removidoEm IS NULL
          WHERE u.removidoEm IS NULL GROUP BY u.id ORDER BY u.criadoEm`
      ).all();
      return json({ utilizadores: results }, 200, env);
    }

    const alvo = rota.match(/^\/api\/utilizadores\/([0-9a-f-]{36})$/);
    if (alvo && (metodo === 'DELETE' || metodo === 'PATCH')) {
      if (!podeGerir(quem.papel)) return erro('Só o gestor gere pessoas.', 403, env);
      const id = alvo[1];

      if (metodo === 'DELETE') {
        if (id === quem.utilizadorId) return erro('Não te podes remover a ti próprio.', 400, env);
        // Num só passo: não sai um gestor se for o último. Falha → vê-se porquê a seguir.
        const saiu = await env.BD.prepare(
          `UPDATE utilizadores SET removidoEm = ? WHERE id = ? AND removidoEm IS NULL
             AND (papel <> 'gestor' OR EXISTS (SELECT 1 FROM utilizadores o WHERE o.papel = 'gestor' AND o.removidoEm IS NULL AND o.id <> ?))`
        ).bind(agora(), id, id).run();
        if ((saiu.meta?.changes ?? 0) === 0) return motivoFalhou(id, env);
        await env.BD.prepare('UPDATE dispositivos SET removidoEm = ? WHERE utilizadorId = ? AND removidoEm IS NULL').bind(agora(), id).run();
        return json({ removido: id }, 200, env);
      }

      const corpo = (await corpoJson(pedido)) as { papel?: unknown } | null;
      if (!papelValido(corpo?.papel)) return erro('Papel inválido.', 400, env);
      const novo = corpo.papel;
      const mudou = await env.BD.prepare(
        `UPDATE utilizadores SET papel = ? WHERE id = ? AND removidoEm IS NULL
           AND (? = 'gestor' OR papel <> 'gestor' OR EXISTS (SELECT 1 FROM utilizadores o WHERE o.papel = 'gestor' AND o.removidoEm IS NULL AND o.id <> ?))`
      ).bind(novo, id, novo, id).run();
      if ((mudou.meta?.changes ?? 0) === 0) return motivoFalhou(id, env);
      return json({ id, papel: novo }, 200, env);
    }

    return erro('Não existe.', 404, env);
  }
} satisfies ExportedHandler<Env>;
