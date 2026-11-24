-- Office Manager — base de dados do servidor (Cloudflare D1).
-- Os registos são guardados como JSON: a app continua a ser a dona do formato,
-- e o servidor só precisa de saber a tabela, o id e quando mudou.

CREATE TABLE IF NOT EXISTS registos (
  tabela     TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  dados      TEXT    NOT NULL,          -- o registo em JSON, tal como está na app
  atualizado TEXT    NOT NULL,          -- updatedAt do registo (para recusar versões velhas)
  seq        INTEGER NOT NULL,          -- relógio do servidor, usado para ir buscar só o que mudou
  PRIMARY KEY (tabela, id)
);
CREATE INDEX IF NOT EXISTS idx_registos_seq ON registos (seq);

-- Relógio do servidor. Não se usam datas para isto: dois telemóveis com a hora
-- trocada partiriam a sincronização.
CREATE TABLE IF NOT EXISTS contador (
  nome  TEXT    PRIMARY KEY,
  valor INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS utilizadores (
  id        TEXT PRIMARY KEY,
  nome      TEXT NOT NULL,
  papel     TEXT NOT NULL CHECK (papel IN ('gestor', 'consulta')),
  criadoEm  TEXT NOT NULL,
  removidoEm TEXT
);

-- Um registo por telemóvel. O token nunca é guardado: só o seu resumo.
CREATE TABLE IF NOT EXISTS dispositivos (
  id            TEXT PRIMARY KEY,
  utilizadorId  TEXT NOT NULL,
  tokenHash     TEXT NOT NULL UNIQUE,
  descricao     TEXT NOT NULL DEFAULT '',
  criadoEm      TEXT NOT NULL,
  ultimoAcesso  TEXT,
  removidoEm    TEXT
);
CREATE INDEX IF NOT EXISTS idx_dispositivos_utilizador ON dispositivos (utilizadorId);

-- Convites de uso único. Também só se guarda o resumo do código.
CREATE TABLE IF NOT EXISTS convites (
  codigoHash TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  papel      TEXT NOT NULL CHECK (papel IN ('gestor', 'consulta')),
  criadoEm   TEXT NOT NULL,
  expiraEm   TEXT NOT NULL,
  usadoEm    TEXT
);
