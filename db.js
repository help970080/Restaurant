'use strict';
// ============================================================================
//  db.js — Postgres + tabla única JSONB (patrón CobraPro)
//    comandapro_state(id INT PK, data JSONB)
//      id = 0  -> fila SYS  { tenants:{}, usuarios:{}, nextRow }
//      id = N  -> documento de estado del tenant N
// ============================================================================

let _pool = null;

// Permite inyectar un pool (tests con pg-mem). En producción se crea de DATABASE_URL.
function setPool(p) { _pool = p; }
function getPool() {
  if (_pool) return _pool;
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL');
  const ssl = /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false };
  _pool = new Pool({ connectionString: url, ssl });
  return _pool;
}
const query = (text, params) => getPool().query(text, params);

async function initDB() {
  await query(`CREATE TABLE IF NOT EXISTS comandapro_state (
    id INTEGER PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`);
  // Asegurar fila SYS
  const { rows } = await query('SELECT 1 FROM comandapro_state WHERE id = 0');
  if (!rows.length) {
    await query('INSERT INTO comandapro_state (id, data) VALUES (0, $1)', [{ tenants: {}, usuarios: {}, nextRow: 1 }]);
  }
}

// ---- Estado por fila --------------------------------------------------------
async function loadState(row) {
  const { rows } = await query('SELECT data FROM comandapro_state WHERE id = $1', [row]);
  return rows.length ? rows[0].data : null;
}
async function saveState(row, data) {
  await query('UPDATE comandapro_state SET data = $2, updated_at = now() WHERE id = $1', [row, data]);
}
async function insertState(row, data) {
  await query('INSERT INTO comandapro_state (id, data) VALUES ($1, $2)', [row, data]);
}

// SYS helpers
const loadSys = () => loadState(0);
const saveSys = (data) => saveState(0, data);

module.exports = { setPool, getPool, query, initDB, loadState, saveState, insertState, loadSys, saveSys };
