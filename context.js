'use strict';
// ============================================================================
//  context.js — Aislamiento por tenant (AsyncLocalStorage) + auth JWT
// ============================================================================

const { AsyncLocalStorage } = require('async_hooks');
const jwt = require('jsonwebtoken');
const db = require('./db');

const als = new AsyncLocalStorage();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('Falta JWT_SECRET (no se permiten defaults inseguros)');

function firmarToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

// Middleware: valida el token y corre el resto del request dentro del contexto del tenant.
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Falta token' });
  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Token inválido o expirado' }); }
  // payload: { row, rol, username, sucursalId }
  als.run(payload, () => next());
}

const ctx = () => als.getStore();

// ---- Acceso al estado del tenant del request -------------------------------
function readState() {
  const c = ctx();
  return db.loadState(c.row);
}

// Mutación: carga, aplica fn(estado, ctx), guarda. Si fn lanza, NO guarda.
async function withState(fn) {
  const c = ctx();
  const st = await db.loadState(c.row);
  if (!st) throw new Error('Tenant sin estado');
  const result = await fn(st, c);
  await db.saveState(c.row, st);
  return result;
}

module.exports = { als, firmarToken, auth, ctx, readState, withState };
