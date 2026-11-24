-- Passa de dois papéis (gestor, consulta) para três (gestor, registo, consulta).
-- O SQLite não altera um CHECK em sítio, por isso as tabelas são reconstruídas com os dados.
-- Correr uma vez na base de dados remota:
--   npx wrangler d1 execute office-manager --remote --file=migracoes/0002-tres-papeis.sql

ALTER TABLE utilizadores RENAME TO utilizadores_antigo;
CREATE TABLE utilizadores (
  id         TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  papel      TEXT NOT NULL CHECK (papel IN ('gestor', 'registo', 'consulta')),
  criadoEm   TEXT NOT NULL,
  removidoEm TEXT
);
INSERT INTO utilizadores (id, nome, papel, criadoEm, removidoEm)
  SELECT id, nome, papel, criadoEm, removidoEm FROM utilizadores_antigo;
DROP TABLE utilizadores_antigo;

ALTER TABLE convites RENAME TO convites_antigos;
CREATE TABLE convites (
  codigoHash TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  papel      TEXT NOT NULL CHECK (papel IN ('gestor', 'registo', 'consulta')),
  criadoEm   TEXT NOT NULL,
  expiraEm   TEXT NOT NULL,
  usadoEm    TEXT
);
INSERT INTO convites (codigoHash, nome, papel, criadoEm, expiraEm, usadoEm)
  SELECT codigoHash, nome, papel, criadoEm, expiraEm, usadoEm FROM convites_antigos;
DROP TABLE convites_antigos;
