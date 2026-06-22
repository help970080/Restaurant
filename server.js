'use strict';
// ============================================================================
//  server.js — API de ComandaPro
// ============================================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');
const M = require('./model');
const { firmarToken, auth, ctx, readState, withState } = require('./context');
const { buildTenantDoc } = require('./seed');

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});
const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------------------------------------------------------------------------
//  AUTH
// ---------------------------------------------------------------------------
app.post('/api/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw bad('Faltan credenciales');
  const sys = await db.loadSys();
  const u = sys.usuarios[username];
  if (!u || !bcrypt.compareSync(password, u.passHash)) throw bad('Usuario o contraseña incorrectos', 401);
  const token = firmarToken({ row: u.row, rol: u.rol, username, sucursalId: u.sucursalId || null });
  const tenant = sys.tenants[u.row];
  res.json({ token, tenant: { nombre: tenant ? tenant.nombre : '', rol: u.rol } });
}));

// ---------------------------------------------------------------------------
//  PROVISIÓN DE TENANT  (protegido por SETUP_TOKEN, no por JWT)
// ---------------------------------------------------------------------------
app.post('/api/admin/provision', wrap(async (req, res) => {
  const setup = process.env.SETUP_TOKEN;
  if (!setup) throw bad('SETUP_TOKEN no configurado', 500);
  if (req.headers['x-setup-token'] !== setup) throw bad('No autorizado', 401);
  const { nombre = 'Jefe Burgers', adminUser, adminPass } = req.body || {};
  if (!adminUser || !adminPass) throw bad('Falta adminUser/adminPass');
  const sys = await db.loadSys();
  if (sys.usuarios[adminUser]) throw bad('Ese usuario ya existe', 409);
  const row = sys.nextRow || 1;
  const doc = buildTenantDoc(nombre);
  await db.insertState(row, doc);
  sys.tenants[row] = { nombre };
  sys.usuarios[adminUser] = { row, rol: 'admin', passHash: bcrypt.hashSync(adminPass, 10) };
  sys.nextRow = row + 1;
  await db.saveSys(sys);
  res.json({ ok: true, row, nombre, sucursales: Object.values(doc.sucursales).map((s) => ({ id: s.id, nombre: s.nombre, codigo: s.codigo })) });
}));

// A partir de aquí, todo requiere JWT y corre dentro del contexto del tenant
app.use('/api', auth);

// ---------------------------------------------------------------------------
//  MENÚ
// ---------------------------------------------------------------------------
app.get('/api/menu', wrap(async (req, res) => {
  const e = await readState();
  res.json({ categorias: e.menu.categorias, gruposModificadores: e.menu.gruposModificadores, productos: e.menu.productos });
}));
app.post('/api/menu/categorias', wrap(async (req, res) => {
  const { nombre, orden = 0 } = req.body || {};
  if (!nombre) throw bad('Falta nombre');
  const c = await withState((e) => { const c = M.crearCategoria({ nombre, orden }); e.menu.categorias[c.id] = c; return c; });
  res.json(c);
}));
app.post('/api/menu/grupos', wrap(async (req, res) => {
  const { nombre, tipo, obligatorio, max, opciones = [] } = req.body || {};
  if (!nombre) throw bad('Falta nombre');
  const g = await withState((e) => {
    const grp = M.crearGrupo({ nombre, tipo, obligatorio, max, opciones: opciones.map((o) => M.crearOpcion(o)) });
    e.menu.gruposModificadores[grp.id] = grp; return grp;
  });
  res.json(g);
}));
app.post('/api/menu/productos', wrap(async (req, res) => {
  const { categoriaId, nombre, precioBase, gruposIds = [], destino = 'cocina', receta = [] } = req.body || {};
  if (!categoriaId || !nombre || precioBase == null) throw bad('Faltan datos del producto');
  const p = await withState((e) => {
    if (!e.menu.categorias[categoriaId]) throw bad('Categoría inexistente');
    const prod = M.crearProducto({ categoriaId, nombre, precioBase, gruposIds, destino, receta });
    e.menu.productos[prod.id] = prod; return prod;
  });
  res.json(p);
}));
app.patch('/api/menu/productos/:id', wrap(async (req, res) => {
  const { id } = req.params;
  const patch = req.body || {};
  const p = await withState((e) => {
    const prod = e.menu.productos[id];
    if (!prod) throw bad('Producto inexistente', 404);
    for (const k of ['nombre', 'precioBase', 'destino', 'gruposIds', 'receta', 'activo', 'categoriaId']) if (k in patch) prod[k] = patch[k];
    return prod;
  });
  res.json(p);
}));

app.get('/api/sucursales', wrap(async (req, res) => { const e = await readState(); res.json(Object.values(e.sucursales)); }));

// ---------------------------------------------------------------------------
//  CAJA
// ---------------------------------------------------------------------------
app.post('/api/caja/abrir', wrap(async (req, res) => {
  const { sucursalId, fondoInicial = 0 } = req.body || {};
  if (!sucursalId) throw bad('Falta sucursalId');
  const t = await withState((e, c) => {
    if (!e.sucursales[sucursalId]) throw bad('Sucursal inexistente');
    if (M.turnoAbierto(e, sucursalId)) throw bad('Ya hay un turno abierto en esa sucursal', 409);
    return M.abrirTurno(e, { sucursalId, usuario: c.username, fondoInicial });
  });
  res.json(t);
}));
app.get('/api/caja/turno-actual', wrap(async (req, res) => {
  const e = await readState();
  const sucursalId = req.query.sucursalId;
  res.json(M.turnoAbierto(e, sucursalId) || null);
}));
app.post('/api/caja/movimiento', wrap(async (req, res) => {
  const { sucursalId, tipo, monto, motivo } = req.body || {};
  if (!['entrada', 'salida'].includes(tipo)) throw bad('tipo debe ser entrada o salida');
  const t = await withState((e, c) => {
    const turno = M.turnoAbierto(e, sucursalId);
    if (!turno) throw bad('No hay turno abierto');
    return M.registrarMovimiento(turno, { tipo, monto, motivo, usuario: c.username });
  });
  res.json(t);
}));
app.post('/api/caja/cerrar', wrap(async (req, res) => {
  const { turnoId, conteoEfectivo } = req.body || {};
  if (turnoId == null || conteoEfectivo == null) throw bad('Falta turnoId o conteoEfectivo');
  const t = await withState((e, c) => {
    const turno = e.caja.turnos[turnoId];
    if (!turno) throw bad('Turno inexistente', 404);
    if (turno.estado === 'cerrado') throw bad('El turno ya está cerrado', 409);
    return M.cerrarTurno(turno, { usuario: c.username, conteoEfectivo });
  });
  res.json(t);
}));
app.get('/api/caja/cortes', wrap(async (req, res) => {
  const e = await readState();
  const { sucursalId } = req.query;
  const arr = Object.values(e.caja.turnos).filter((t) => t.estado === 'cerrado' && (!sucursalId || t.sucursalId === sucursalId))
    .sort((a, b) => new Date(b.cerrado) - new Date(a.cerrado))
    .map((t) => ({ id: t.id, cerrado: t.cerrado, esperado: t.esperado, conteo: t.conteo, diferencia: t.diferencia, resultado: t.resultado }));
  res.json(arr);
}));

// ---------------------------------------------------------------------------
//  PEDIDOS
// ---------------------------------------------------------------------------
app.post('/api/pedidos', wrap(async (req, res) => {
  const { sucursalId, tipoServicio = 'mostrador', mesaId = null, cliente = null } = req.body || {};
  if (!sucursalId) throw bad('Falta sucursalId');
  const ped = await withState((e, c) => {
    const suc = e.sucursales[sucursalId];
    if (!suc) throw bad('Sucursal inexistente');
    if (tipoServicio === 'mesa') {
      const mesa = e.mesas[mesaId];
      if (!mesa) throw bad('Mesa inexistente');
      if (mesa.pedidoFolio && e.pedidos[mesa.pedidoFolio] && e.pedidos[mesa.pedidoFolio].estado === 'abierto')
        return e.pedidos[mesa.pedidoFolio]; // ya tiene cuenta abierta
      const p = M.crearPedido(e, { sucursalId, codigo: suc.codigo, tipoServicio, mesaId, cliente, usuario: c.username });
      mesa.estado = 'ocupada'; mesa.pedidoFolio = p.folio;
      return p;
    }
    return M.crearPedido(e, { sucursalId, codigo: suc.codigo, tipoServicio, cliente, usuario: c.username });
  });
  res.json(ped);
}));

app.post('/api/pedidos/:folio/lineas', wrap(async (req, res) => {
  const { folio } = req.params;
  const { productoId, cantidad = 1, modsElegidos = [], notas = '' } = req.body || {};
  const ped = await withState((e) => {
    const p = e.pedidos[folio];
    if (!p) throw bad('Pedido inexistente', 404);
    if (p.estado !== 'abierto') throw bad('El pedido ya está cerrado');
    const prod = e.menu.productos[productoId];
    if (!prod) throw bad('Producto inexistente');
    p.lineas.push(M.crearLinea(prod, e, { cantidad, modsElegidos, notas }));
    p.actualizado = new Date().toISOString();
    return M.recalcularPedido(p);
  });
  res.json(ped);
}));

app.delete('/api/pedidos/:folio/lineas/:lineaId', wrap(async (req, res) => {
  const { folio, lineaId } = req.params;
  const ped = await withState((e) => {
    const p = e.pedidos[folio];
    if (!p) throw bad('Pedido inexistente', 404);
    p.lineas = p.lineas.filter((l) => l.id !== lineaId);
    return M.recalcularPedido(p);
  });
  res.json(ped);
}));

app.patch('/api/pedidos/:folio', wrap(async (req, res) => {
  const { folio } = req.params;
  const { costoEnvio, propina, descuento, cliente } = req.body || {};
  const ped = await withState((e) => {
    const p = e.pedidos[folio];
    if (!p) throw bad('Pedido inexistente', 404);
    if (costoEnvio != null) p.costoEnvio = costoEnvio;
    if (propina != null) p.propina = propina;
    if (descuento !== undefined) p.descuento = descuento;
    if (cliente !== undefined) p.cliente = cliente;
    return M.recalcularPedido(p);
  });
  res.json(ped);
}));

app.post('/api/pedidos/:folio/comanda', wrap(async (req, res) => {
  const { folio } = req.params;
  const out = await withState((e) => {
    const p = e.pedidos[folio];
    if (!p) throw bad('Pedido inexistente', 404);
    const enviadas = M.mandarComanda(p);
    return { folio, enviadas, pedido: p };
  });
  res.json(out);
}));

app.post('/api/pedidos/:folio/cobrar', wrap(async (req, res) => {
  const { folio } = req.params;
  const { pagos = [], recibido = 0 } = req.body || {};
  if (!pagos.length) throw bad('Faltan pagos');
  const out = await withState((e, c) => {
    const p = e.pedidos[folio];
    if (!p) throw bad('Pedido inexistente', 404);
    if (p.estado === 'cobrado') throw bad('El pedido ya está cobrado', 409);
    if (!p.lineas.length) throw bad('El pedido no tiene productos');
    M.recalcularPedido(p);
    const sumPagos = M.r2(pagos.reduce((s, x) => s + x.monto, 0));
    if (sumPagos < p.total) throw bad(`El pago (${sumPagos}) no cubre el total (${p.total})`);
    const turno = M.turnoAbierto(e, p.sucursalId);
    if (!turno) throw bad('No hay turno de caja abierto en la sucursal', 409);
    p.turnoId = turno.id;
    M.mandarComanda(p); // dispara a cocina lo que falte (mostrador) o ronda final (mesa)
    M.registrarPago(p, { pagos, recibido });
    M.registrarVentaEnTurno(turno, p);
    M.descontarInventario(e, p);
    if (p.tipoServicio === 'mesa' && p.mesaId && e.mesas[p.mesaId]) {
      e.mesas[p.mesaId].estado = 'libre';
      e.mesas[p.mesaId].pedidoFolio = null;
    }
    return p;
  });
  res.json(out);
}));

app.get('/api/pedidos', wrap(async (req, res) => {
  const e = await readState();
  const { estado, sucursalId } = req.query;
  let arr = Object.values(e.pedidos);
  if (sucursalId) arr = arr.filter((p) => p.sucursalId === sucursalId);
  if (estado) arr = arr.filter((p) => p.estado === estado);
  res.json(arr);
}));

// ---------------------------------------------------------------------------
//  COCINA (KDS)
// ---------------------------------------------------------------------------
app.get('/api/cocina', wrap(async (req, res) => {
  const e = await readState();
  const { sucursalId } = req.query;
  const arr = Object.values(e.pedidos)
    .filter((p) => (!sucursalId || p.sucursalId === sucursalId) && p.lineas.some((l) => l.cocina === 'enviado'))
    .sort((a, b) => new Date(a.tiemposCocina.recibido) - new Date(b.tiemposCocina.recibido))
    .map((p) => ({ folio: p.folio, tipoServicio: p.tipoServicio, mesaId: p.mesaId, recibido: p.tiemposCocina.recibido, listo: !!p._kdsListo, items: p.lineas.filter((l) => l.cocina === 'enviado').map((l) => ({ cantidad: l.cantidad, nombre: l.nombre, modificadores: l.modificadores.map((m) => m.opcionNombre), notas: l.notas })) }));
  res.json(arr);
}));
app.post('/api/cocina/:folio/listo', wrap(async (req, res) => {
  const out = await withState((e) => { const p = e.pedidos[req.params.folio]; if (!p) throw bad('Pedido inexistente', 404); p._kdsListo = true; p.tiemposCocina.listo = new Date().toISOString(); return { ok: true }; });
  res.json(out);
}));
app.post('/api/cocina/:folio/entregar', wrap(async (req, res) => {
  const out = await withState((e) => {
    const p = e.pedidos[req.params.folio];
    if (!p) throw bad('Pedido inexistente', 404);
    for (const l of p.lineas) if (l.cocina === 'enviado') l.cocina = 'servido';
    p._kdsListo = false;
    return { ok: true };
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
//  INVENTARIO
// ---------------------------------------------------------------------------
app.get('/api/inventario', wrap(async (req, res) => {
  const e = await readState();
  const insumos = Object.values(e.insumos).map((i) => ({ ...i, bajo: i.stock <= i.stockMin }));
  const foodCost = Object.values(e.menu.productos).filter((p) => p.receta.length).map((p) => ({ id: p.id, nombre: p.nombre, costo: M.costoReceta(e, p), precio: p.precioBase, foodCostPct: M.foodCostPct(e, p) }));
  res.json({ insumos, foodCost });
}));
app.post('/api/inventario/insumos', wrap(async (req, res) => {
  const { nombre, unidad, stock = 0, costoUnitario = 0, stockMin = 0 } = req.body || {};
  if (!nombre || !unidad) throw bad('Falta nombre o unidad');
  const i = await withState((e) => { const ins = M.crearInsumo({ nombre, unidad, stock, costoUnitario, stockMin }); e.insumos[ins.id] = ins; return ins; });
  res.json(i);
}));
app.post('/api/inventario/insumos/:id/entrada', wrap(async (req, res) => {
  const { cantidad = 0 } = req.body || {};
  const i = await withState((e) => { const ins = e.insumos[req.params.id]; if (!ins) throw bad('Insumo inexistente', 404); ins.stock = M.r2(ins.stock + cantidad); return ins; });
  res.json(i);
}));

// ---------------------------------------------------------------------------
//  MESAS
// ---------------------------------------------------------------------------
app.get('/api/mesas', wrap(async (req, res) => {
  const e = await readState();
  const { sucursalId } = req.query;
  const arr = Object.values(e.mesas).filter((m) => !sucursalId || m.sucursalId === sucursalId).map((m) => {
    const p = m.pedidoFolio ? e.pedidos[m.pedidoFolio] : null;
    return { ...m, total: p ? p.total : 0, items: p ? p.lineas.length : 0, abierto: p ? p.creado : null };
  });
  res.json(arr);
}));
app.post('/api/mesas/:id/cuenta', wrap(async (req, res) => {
  const m = await withState((e) => { const mesa = e.mesas[req.params.id]; if (!mesa) throw bad('Mesa inexistente', 404); if (mesa.estado === 'ocupada') mesa.estado = 'cuenta'; return mesa; });
  res.json(m);
}));
app.post('/api/mesas', wrap(async (req, res) => {
  const { sucursalId, nombre } = req.body || {};
  if (!sucursalId) throw bad('Falta sucursalId');
  const m = await withState((e) => {
    if (!e.sucursales[sucursalId]) throw bad('Sucursal inexistente');
    const n = Object.values(e.mesas).filter((x) => x.sucursalId === sucursalId).length;
    const mesa = M.crearMesa({ nombre: nombre || ('Mesa ' + (n + 1)), sucursalId });
    e.mesas[mesa.id] = mesa; return mesa;
  });
  res.json(m);
}));
app.post('/api/mesas/bulk', wrap(async (req, res) => {
  const { sucursalId, cantidad = 6 } = req.body || {};
  if (!sucursalId) throw bad('Falta sucursalId');
  const arr = await withState((e) => {
    if (!e.sucursales[sucursalId]) throw bad('Sucursal inexistente');
    const base = Object.values(e.mesas).filter((x) => x.sucursalId === sucursalId).length;
    const out = [];
    for (let i = 1; i <= cantidad; i++) { const m = M.crearMesa({ nombre: 'Mesa ' + (base + i), sucursalId }); e.mesas[m.id] = m; out.push(m); }
    return out;
  });
  res.json(arr);
}));

// ---------------------------------------------------------------------------
//  REPORTES
// ---------------------------------------------------------------------------
app.get('/api/reportes/resumen', wrap(async (req, res) => {
  const e = await readState();
  const { sucursalId } = req.query;
  const peds = Object.values(e.pedidos).filter((p) => p.estado === 'cobrado' && (!sucursalId || p.sucursalId === sucursalId));
  const venta = M.r2(peds.reduce((s, p) => s + p.total, 0));
  const porProducto = {}; peds.forEach((p) => p.lineas.forEach((l) => { porProducto[l.nombre] = porProducto[l.nombre] || { q: 0, total: 0 }; porProducto[l.nombre].q += l.cantidad; porProducto[l.nombre].total = M.r2(porProducto[l.nombre].total + l.importe); }));
  const porPago = { efectivo: 0, tarjeta: 0, transferencia: 0 }; peds.forEach((p) => p.pago && p.pago.pagos.forEach((x) => porPago[x.metodo] = M.r2((porPago[x.metodo] || 0) + x.monto)));
  const porServicio = { mostrador: 0, domicilio: 0, mesa: 0 }; peds.forEach((p) => porServicio[p.tipoServicio] = M.r2(porServicio[p.tipoServicio] + p.total));
  res.json({ venta, pedidos: peds.length, ticketPromedio: peds.length ? M.r2(venta / peds.length) : 0, porProducto, porPago, porServicio });
}));

// estado completo (debug / export)
app.get('/api/estado', wrap(async (req, res) => { res.json(await readState()); }));

// Fallback SPA: cualquier ruta que no sea /api sirve el frontend
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------------------------------------------------------------------------
//  Arranque
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  db.initDB().then(() => app.listen(PORT, () => console.log('ComandaPro API en puerto ' + PORT)))
    .catch((err) => { console.error('No arrancó:', err); process.exit(1); });
}

module.exports = app;
