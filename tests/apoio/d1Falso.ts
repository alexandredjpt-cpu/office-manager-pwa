import { DatabaseSync } from 'node:sqlite';

/**
 * D1 de mentira, por cima do SQLite que vem no Node. Serve para correr o servidor
 * de verdade nos testes — com o esquema real e SQL real — sem publicar nada na Cloudflare.
 * Cobre só o que o servidor usa: prepare/bind/run/first/all e batch.
 */
export function d1Falso(esquema: string) {
  const bd = new DatabaseSync(':memory:');
  bd.exec(esquema);

  const limpar = <T>(linha: unknown): T => (linha ? ({ ...(linha as object) } as T) : (linha as T));

  function statement(sql: string, args: unknown[] = []) {
    let mudancas = 0;
    const correr = () => {
      const s = bd.prepare(sql);
      const valores = args as never[];
      if (/^\s*(select|.*returning)/is.test(sql)) return s.all(...valores);
      mudancas = Number(s.run(...valores).changes);
      return [];
    };
    return {
      sql,
      args,
      bind: (...novos: unknown[]) => statement(sql, novos),
      run: async () => { correr(); return { success: true, meta: { changes: mudancas } }; },
      first: async <T>() => limpar<T>(correr()[0] ?? null),
      all: async <T>() => ({ results: correr().map((l) => limpar<T>(l)) })
    };
  }

  return {
    prepare: (sql: string) => statement(sql),
    // O batch do D1 é atómico; aqui basta correr tudo dentro de uma transação.
    batch: async (stmts: { sql: string; args: unknown[] }[]) => {
      bd.exec('BEGIN');
      try {
        for (const s of stmts) bd.prepare(s.sql).run(...(s.args as never[]));
        bd.exec('COMMIT');
      } catch (e) { bd.exec('ROLLBACK'); throw e; }
      return stmts.map(() => ({ success: true }));
    },
    fechar: () => bd.close()
  };
}
