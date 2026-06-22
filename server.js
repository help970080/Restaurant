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
  if (u.rol === 'superadmin') return res.json({ token, tenant: { nombre: 'Super Admin', logo: null, rol: 'superadmin' } });
  const tdoc = await db.loadState(u.row);
  res.json({ token, tenant: { nombre: tdoc ? tdoc.meta.nombre : '', logo: (tdoc && tdoc.config && tdoc.config.logo) || null, rol: u.rol } });
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

// Crear el SUPER ADMIN (protegido por SETUP_TOKEN). No pertenece a ningún restaurante.
app.post('/api/super/provision', wrap(async (req, res) => {
  if (req.headers['x-setup-token'] !== process.env.SETUP_TOKEN) throw bad('No autorizado', 401);
  const { username, password } = req.body || {};
  if (!username || !password) throw bad('Falta usuario o contraseña');
  const sys = await db.loadSys();
  if (sys.usuarios[username]) throw bad('Ese usuario ya existe', 409);
  sys.usuarios[username] = { row: 0, rol: 'superadmin', passHash: bcrypt.hashSync(password, 10) };
  await db.saveSys(sys);
  res.json({ ok: true, username });
}));

// A partir de aquí, todo requiere JWT y corre dentro del contexto del tenant
app.use('/api', auth);

// Solo administradores
function soloAdmin(req, res, next) {
  if (ctx().rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}
function soloSuper(req, res, next) {
  if (ctx().rol !== 'superadmin') return res.status(403).json({ error: 'Solo super admin' });
  next();
}

// ---------------------------------------------------------------------------
//  SUPER ADMIN — gestiona restaurantes (tenants)
// ---------------------------------------------------------------------------
app.get('/api/super/tenants', soloSuper, wrap(async (req, res) => {
  const sys = await db.loadSys();
  const out = [];
  for (const [row, t] of Object.entries(sys.tenants)) {
    const usuarios = Object.values(sys.usuarios).filter((u) => u.row === +row).length;
    let sucursales = 0;
    try { const doc = await db.loadState(+row); sucursales = doc ? Object.keys(doc.sucursales).length : 0; } catch {}
    out.push({ row: +row, nombre: t.nombre, usuarios, sucursales });
  }
  res.json(out);
}));
app.post('/api/super/tenants', soloSuper, wrap(async (req, res) => {
  const { nombre, adminUser, adminPass } = req.body || {};
  if (!nombre || !adminUser || !adminPass) throw bad('Falta nombre, adminUser o adminPass');
  const sys = await db.loadSys();
  if (sys.usuarios[adminUser]) throw bad('Ese usuario admin ya existe', 409);
  const row = sys.nextRow || 1;
  const doc = buildTenantDoc(nombre);
  await db.insertState(row, doc);
  sys.tenants[row] = { nombre };
  sys.usuarios[adminUser] = { row, rol: 'admin', passHash: bcrypt.hashSync(adminPass, 10) };
  sys.nextRow = row + 1;
  await db.saveSys(sys);
  res.json({ ok: true, row, nombre });
}));

// ---------------------------------------------------------------------------
//  IDENTIDAD
// ---------------------------------------------------------------------------
app.get('/api/me', wrap(async (req, res) => {
  const c = ctx();
  if (c.rol === 'superadmin') return res.json({ username: c.username, rol: 'superadmin', sucursalId: null, tenant: { nombre: 'Super Admin', logo: null } });
  const e = await readState();
  res.json({ username: c.username, rol: c.rol, sucursalId: c.sucursalId, tenant: { nombre: e.meta.nombre, logo: (e.config && e.config.logo) || null } });
}));

// ---------------------------------------------------------------------------
//  USUARIOS (admin) — viven en la fila SYS
// ---------------------------------------------------------------------------
app.get('/api/usuarios', soloAdmin, wrap(async (req, res) => {
  const c = ctx(); const sys = await db.loadSys();
  const arr = Object.entries(sys.usuarios).filter(([, d]) => d.row === c.row).map(([u, d]) => ({ username: u, rol: d.rol, sucursalId: d.sucursalId || null }));
  res.json(arr);
}));
app.post('/api/usuarios', soloAdmin, wrap(async (req, res) => {
  const c = ctx(); const { username, password, rol = 'cajero', sucursalId = null } = req.body || {};
  if (!username || !password) throw bad('Falta usuario o contraseña');
  const sys = await db.loadSys();
  if (sys.usuarios[username]) throw bad('Ese usuario ya existe (debe ser único)', 409);
  sys.usuarios[username] = { row: c.row, rol, passHash: bcrypt.hashSync(password, 10), sucursalId };
  await db.saveSys(sys);
  res.json({ username, rol, sucursalId });
}));
app.patch('/api/usuarios/:username', soloAdmin, wrap(async (req, res) => {
  const c = ctx(); const u = req.params.username; const { password, rol, sucursalId } = req.body || {};
  const sys = await db.loadSys(); const d = sys.usuarios[u];
  if (!d || d.row !== c.row) throw bad('Usuario inexistente', 404);
  if (password) d.passHash = bcrypt.hashSync(password, 10);
  if (rol) d.rol = rol;
  if (sucursalId !== undefined) d.sucursalId = sucursalId;
  await db.saveSys(sys);
  res.json({ ok: true });
}));
app.delete('/api/usuarios/:username', soloAdmin, wrap(async (req, res) => {
  const c = ctx(); const u = req.params.username;
  if (u === c.username) throw bad('No puedes eliminar tu propio usuario');
  const sys = await db.loadSys(); const d = sys.usuarios[u];
  if (!d || d.row !== c.row) throw bad('Usuario inexistente', 404);
  delete sys.usuarios[u]; await db.saveSys(sys);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
//  CONFIGURACIÓN / MARCA (logo + nombre)
// ---------------------------------------------------------------------------
app.get('/api/config', wrap(async (req, res) => {
  const e = await readState();
  res.json({ nombre: e.meta.nombre, logo: (e.config && e.config.logo) || null, moneda: e.config.moneda });
}));
app.patch('/api/config', soloAdmin, wrap(async (req, res) => {
  const { nombre, logo } = req.body || {};
  const out = await withState((e) => {
    if (nombre) e.meta.nombre = nombre;
    if (logo !== undefined) e.config.logo = logo;
    return { nombre: e.meta.nombre, logo: e.config.logo || null };
  });
  res.json(out);
}));

// ---------------------------------------------------------------------------
//  PROMOCIONES
// ---------------------------------------------------------------------------
app.get('/api/promociones', wrap(async (req, res) => {
  const e = await readState();
  res.json(Object.values(e.promociones || {}));
}));
app.post('/api/promociones', soloAdmin, wrap(async (req, res) => {
  const { nombre, tipo = 'porcentaje', valor } = req.body || {};
  if (!nombre || valor == null) throw bad('Falta nombre o valor');
  const p = await withState((e) => { if (!e.promociones) e.promociones = {}; const pr = M.crearPromocion({ nombre, tipo, valor }); e.promociones[pr.id] = pr; return pr; });
  res.json(p);
}));
app.patch('/api/promociones/:id', soloAdmin, wrap(async (req, res) => {
  const patch = req.body || {};
  const p = await withState((e) => {
    const pr = (e.promociones || {})[req.params.id];
    if (!pr) throw bad('Promoción inexistente', 404);
    for (const k of ['nombre', 'tipo', 'valor', 'activo']) if (k in patch) pr[k] = patch[k];
    return pr;
  });
  res.json(p);
}));
app.delete('/api/promociones/:id', soloAdmin, wrap(async (req, res) => {
  await withState((e) => { if (e.promociones) delete e.promociones[req.params.id]; });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
//  MENÚ
// ---------------------------------------------------------------------------
app.get('/api/menu', wrap(async (req, res) => {
  const e = await readState();
  res.json({ categorias: e.menu.categorias, gruposModificadores: e.menu.gruposModificadores, productos: e.menu.productos });
}));
app.post('/api/menu/categorias', soloAdmin, wrap(async (req, res) => {
  const { nombre, orden = 0 } = req.body || {};
  if (!nombre) throw bad('Falta nombre');
  const c = await withState((e) => { const c = M.crearCategoria({ nombre, orden }); e.menu.categorias[c.id] = c; return c; });
  res.json(c);
}));
app.post('/api/menu/grupos', soloAdmin, wrap(async (req, res) => {
  const { nombre, tipo, obligatorio, max, opciones = [] } = req.body || {};
  if (!nombre) throw bad('Falta nombre');
  const g = await withState((e) => {
    const grp = M.crearGrupo({ nombre, tipo, obligatorio, max, opciones: opciones.map((o) => M.crearOpcion(o)) });
    e.menu.gruposModificadores[grp.id] = grp; return grp;
  });
  res.json(g);
}));
app.post('/api/menu/productos', soloAdmin, wrap(async (req, res) => {
  const { categoriaId, nombre, precioBase, gruposIds = [], destino = 'cocina', receta = [], componentes = null, foto = null } = req.body || {};
  if (!categoriaId || !nombre || precioBase == null) throw bad('Faltan datos del producto');
  const p = await withState((e) => {
    if (!e.menu.categorias[categoriaId]) throw bad('Categoría inexistente');
    let finalReceta = receta, esCombo = false;
    if (componentes && componentes.length) { finalReceta = M.recetaDeCombo(e, componentes); esCombo = true; }
    const prod = M.crearProducto({ categoriaId, nombre, precioBase, gruposIds, destino, receta: finalReceta });
    if (esCombo) { prod.esCombo = true; prod.componentes = componentes; }
    if (foto) prod.foto = foto;
    e.menu.productos[prod.id] = prod; return prod;
  });
  res.json(p);
}));
app.patch('/api/menu/productos/:id', soloAdmin, wrap(async (req, res) => {
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
  const insumos = Object.values(e.insumos).map((i) => ({ ...i, bajo: i.stock <= i.stockMin, valor: M.r2(i.stock * i.costoUnitario) }));
  const foodCost = Object.values(e.menu.productos).filter((p) => p.receta.length).map((p) => ({ id: p.id, nombre: p.nombre, costo: M.costoReceta(e, p), precio: p.precioBase, foodCostPct: M.foodCostPct(e, p) }));
  const valuacion = M.r2(insumos.reduce((s, i) => s + i.valor, 0));
  res.json({ insumos, foodCost, valuacion });
}));
// Conteo físico: compara teórico vs físico, calcula merma en $ y ajusta el stock
app.post('/api/inventario/conteo', soloAdmin, wrap(async (req, res) => {
  const { conteos = [] } = req.body || {};
  if (!conteos.length) throw bad('No hay conteos');
  const out = await withState((e, c) => {
    if (!e.conteos) e.conteos = [];
    const lineas = []; let mermaTotal = 0;
    for (const ct of conteos) {
      const i = e.insumos[ct.insumoId];
      if (!i || ct.fisico == null) continue;
      const teorico = i.stock, fisico = M.r2(ct.fisico);
      const diff = M.r2(fisico - teorico);
      const valor = M.r2((teorico - fisico) * i.costoUnitario); // positivo = merma (pérdida)
      lineas.push({ insumoId: i.id, nombre: i.nombre, teorico, fisico, diff, valor });
      mermaTotal = M.r2(mermaTotal + valor);
      i.stock = fisico; // ajustar a lo contado
    }
    const audit = { id: M.uid('aud'), fecha: new Date().toISOString(), usuario: c.username, mermaTotal, lineas };
    e.conteos.unshift(audit);
    if (e.conteos.length > 60) e.conteos = e.conteos.slice(0, 60);
    return audit;
  });
  res.json(out);
}));
app.get('/api/inventario/auditorias', wrap(async (req, res) => {
  const e = await readState();
  res.json((e.conteos || []).slice(0, 20));
}));
app.post('/api/inventario/insumos', soloAdmin, wrap(async (req, res) => {
  const { nombre, unidad, stock = 0, costoUnitario = 0, stockMin = 0 } = req.body || {};
  if (!nombre || !unidad) throw bad('Falta nombre o unidad');
  const i = await withState((e) => { const ins = M.crearInsumo({ nombre, unidad, stock, costoUnitario, stockMin }); e.insumos[ins.id] = ins; return ins; });
  res.json(i);
}));
app.patch('/api/inventario/insumos/:id', soloAdmin, wrap(async (req, res) => {
  const patch = req.body || {};
  const i = await withState((e) => {
    const ins = e.insumos[req.params.id];
    if (!ins) throw bad('Insumo inexistente', 404);
    if (patch.nombre != null) ins.nombre = patch.nombre;
    if (patch.unidad != null) ins.unidad = patch.unidad;
    if (patch.stock != null) ins.stock = M.r2(+patch.stock);
    if (patch.stockMin != null) ins.stockMin = M.r2(+patch.stockMin);
    if (patch.costoUnitario != null) ins.costoUnitario = M.r2(+patch.costoUnitario);
    return ins;
  });
  res.json(i);
}));
app.delete('/api/inventario/insumos/:id', soloAdmin, wrap(async (req, res) => {
  await withState((e) => {
    const usado = Object.values(e.menu.productos).some((p) => (p.receta || []).some((r) => r.insumoId === req.params.id));
    if (usado) throw bad('Ese insumo está en la receta de un producto. Quítalo de la receta primero.');
    delete e.insumos[req.params.id];
  });
  res.json({ ok: true });
}));
app.post('/api/inventario/insumos/:id/entrada', soloAdmin, wrap(async (req, res) => {
  const { cantidad = 0 } = req.body || {};
  const i = await withState((e) => { const ins = e.insumos[req.params.id]; if (!ins) throw bad('Insumo inexistente', 404); ins.stock = M.r2(ins.stock + cantidad); return ins; });
  res.json(i);
}));

// Aplicar margen/food cost a TODOS los productos con receta (admin)
// tipo='foodcost' -> precio = costoReceta / (valor/100) ; tipo='markup' -> precio = costoReceta * valor
app.post('/api/menu/precios/aplicar', soloAdmin, wrap(async (req, res) => {
  const { tipo = 'foodcost', valor, redondeo = 0 } = req.body || {};
  if (!valor || valor <= 0) throw bad('Falta el valor');
  const out = await withState((e) => {
    let actualizados = 0, omitidos = 0;
    const cambios = [];
    for (const p of Object.values(e.menu.productos)) {
      const costo = M.costoReceta(e, p);
      if (!costo) { omitidos++; continue; }
      let nuevo = tipo === 'markup' ? costo * valor : costo / (valor / 100);
      if (redondeo > 0) nuevo = Math.ceil(nuevo / redondeo) * redondeo; else nuevo = M.r2(nuevo);
      cambios.push({ nombre: p.nombre, antes: p.precioBase, despues: nuevo });
      p.precioBase = nuevo; actualizados++;
    }
    return { actualizados, omitidos, cambios };
  });
  res.json(out);
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

// ---------------------------------------------------------------------------
//  REPORTE FINANCIERO (admin)  — COGS teórico, margen, food cost, rentabilidad
// ---------------------------------------------------------------------------
app.get('/api/reportes/financiero', soloAdmin, wrap(async (req, res) => {
  const e = await readState();
  const { sucursalId } = req.query;
  const peds = Object.values(e.pedidos).filter((p) => p.estado === 'cobrado' && (!sucursalId || p.sucursalId === sucursalId));
  let ingresos = 0, cogs = 0, descuentos = 0;
  const porProd = {};
  for (const p of peds) {
    ingresos = M.r2(ingresos + p.total);
    if (p.descuento) {
      const subt = p.lineas.reduce((s, l) => s + l.importe, 0);
      const d = p.descuento.tipo === 'porcentaje' ? subt * p.descuento.valor / 100 : p.descuento.valor;
      descuentos = M.r2(descuentos + d);
    }
    for (const l of p.lineas) {
      const prod = e.menu.productos[l.productoId];
      const costoLinea = prod ? M.r2(M.costoReceta(e, prod) * l.cantidad) : 0;
      cogs = M.r2(cogs + costoLinea);
      const k = l.nombre;
      porProd[k] = porProd[k] || { unidades: 0, ingreso: 0, costo: 0 };
      porProd[k].unidades += l.cantidad;
      porProd[k].ingreso = M.r2(porProd[k].ingreso + l.importe);
      porProd[k].costo = M.r2(porProd[k].costo + costoLinea);
    }
  }
  const margenBruto = M.r2(ingresos - cogs);
  const rentabilidad = Object.entries(porProd).map(([nombre, d]) => ({
    nombre, unidades: d.unidades, ingreso: d.ingreso, costo: d.costo,
    margen: M.r2(d.ingreso - d.costo), margenPct: d.ingreso ? M.r2((d.ingreso - d.costo) / d.ingreso * 100) : 0,
  })).sort((a, b) => b.margen - a.margen);
  res.json({
    ingresos, cogs, margenBruto,
    margenBrutoPct: ingresos ? M.r2(margenBruto / ingresos * 100) : 0,
    foodCostPct: ingresos ? M.r2(cogs / ingresos * 100) : 0,
    descuentos, pedidos: peds.length,
    ticketPromedio: peds.length ? M.r2(ingresos / peds.length) : 0,
    rentabilidad,
  });
}));

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
