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

// ---- Caché del documento en memoria ----------------------------------------
//  El documento del tenant se guarda COMPLETO en un JSONB. Sin caché, cada
//  petición —incluidos los sondeos del KDS, el tablero y los avisos— lo baja
//  entero de Postgres, y cada escritura lo baja y lo vuelve a subir. Con unos
//  miles de pedidos el documento pasa de varios MB y eso es el lag que se
//  siente en cada movimiento.
//
//  Como TODA mutación pasa por la cola de withState dentro de este proceso, la
//  copia en memoria es la autoridad y basta con escribir. Esto asume UN SOLO
//  proceso de servidor: si algún día se corre con varias instancias, hay que
//  apagarlo con ESTADO_EN_MEMORIA=0.
const CACHE_ON = process.env.ESTADO_EN_MEMORIA !== '0';
const CACHE_MAX = Math.max(1, parseInt(process.env.ESTADO_CACHE_MAX || '20', 10));
const cache = new Map(); // Map conserva orden de inserción: sirve de LRU simple

function recordar(row, doc) {
  cache.delete(row);
  cache.set(row, doc);
  // Con muchos restaurantes en el mismo servidor, se suelta el menos usado.
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}
async function cargarEstado(row) {
  if (CACHE_ON && cache.has(row)) {
    const doc = cache.get(row);
    recordar(row, doc); // marcarlo como recién usado
    return doc;
  }
  const doc = await db.loadState(row);
  if (CACHE_ON && doc) recordar(row, doc);
  return doc;
}
// Para cuando el estado se escribe por fuera (alta o reseteo de un tenant).
function invalidarCache(row) {
  if (row == null) cache.clear();
  else cache.delete(Number(row));
}

// ---- Acceso al estado del tenant del request -------------------------------
//  OJO: con la caché encendida esto devuelve el MISMO objeto que mutan las
//  escrituras. Un handler de solo lectura nunca debe modificarlo.
function readState() {
  const c = ctx();
  return cargarEstado(c.row);
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
    const st = await cargarEstado(c.row);
    if (!st) throw new Error('Tenant sin estado');
    const result = await fn(st, c);
    try {
      await db.saveState(c.row, st);
    } catch (err) {
      // Si no se pudo guardar, la copia en memoria ya trae el cambio pero la
      // base no: se descarta para que la siguiente lectura venga de Postgres.
      invalidarCache(c.row);
      throw err;
    }
    if (CACHE_ON) recordar(c.row, st);
    return result;
  });
}

module.exports = { als, firmarToken, auth, ctx, readState, withState, runPublic, invalidarCache };
