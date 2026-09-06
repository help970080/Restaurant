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

// Corre una función dentro del contexto de un tenant SIN auth (para el menú QR público).
function runPublic(row, fn) {
  return als.run({ row: Number(row), rol: 'public', username: 'qr', sucursalId: null }, fn);
}

// ---- Acceso al estado del tenant del request -------------------------------
function readState() {
  const c = ctx();
  return db.loadState(c.row);
}

// ---- Serializacion de escrituras por tenant --------------------------------
//  withState es load -> mutar en RAM -> guardar el documento COMPLETO. Dos
//  peticiones simultaneas del mismo restaurante cargan copias distintas y la
//  segunda en guardar pisa a la primera: el pedido, el cobro o la liquidacion
//  de la primera desaparece sin error. Con varias motos, el KDS y la caja
//  escribiendo a la vez eso deja de ser hipotetico, asi que toda mutacion de
//  un mismo row pasa por una cola. Lecturas no: no pisan nada.
const colas = new Map();
function enCola(row, fn) {
  const previa = colas.get(row) || Promise.resolve();
  const siguiente = previa.then(fn, fn); // un error no debe atorar la cola
  const cola = siguiente.then(() => {}, () => {});
  colas.set(row, cola);
  cola.then(() => { if (colas.get(row) === cola) colas.delete(row); });
  return siguiente;
}

// Mutación: carga, aplica fn(estado, ctx), guarda. Si fn lanza, NO guarda.
//  OJO: nunca llames withState dentro del callback de otro withState del mismo
//  tenant — la cola es secuencial y se quedaria esperandose a si misma.
function withState(fn) {
  const c = ctx();
  return enCola(c.row, async () => {
    const st = await db.loadState(c.row);
    if (!st) throw new Error('Tenant sin estado');
    const result = await fn(st, c);
    await db.saveState(c.row, st);
    return result;
  });
}

module.exports = { als, firmarToken, auth, ctx, readState, withState, runPublic };
