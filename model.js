'use strict';
// ============================================================================
//  model.js — Lógica pura del dominio (menú, pedido, caja, inventario)
//  Sin Express, sin DB, sin DOM. Solo funciones que reciben/devuelven datos.
//  El server llama a estas funciones sobre el documento JSONB del tenant.
// ============================================================================

const crypto = require('crypto');
const uid = (p) => p + '_' + crypto.randomBytes(4).toString('hex');
const r2 = (n) => Math.round((+n) * 100) / 100;

// ---- Documento de estado inicial de un tenant ------------------------------
function estadoInicial(meta = {}) {
  return {
    meta: { nombre: meta.nombre || 'Restaurante', creado: new Date().toISOString(), version: 1 },
    config: { moneda: 'MXN', zonaHoraria: 'America/Mexico_City' },
    sucursales: {},
    menu: { categorias: {}, gruposModificadores: {}, productos: {} },
    insumos: {},
    pedidos: {},
    mesas: {},
    caja: { turnos: {} },
    secuencias: { pedido: {} },
  };
}

// ---- Menú -------------------------------------------------------------------
const crearCategoria = ({ nombre, orden = 0 }) => ({ id: uid('cat'), nombre, orden, visible: true });
const crearOpcion = ({ nombre, precioDelta = 0, porDefecto = false }) => ({ id: uid('opt'), nombre, precioDelta, porDefecto, activo: true });
const crearGrupo = ({ nombre, tipo = 'unico', obligatorio = false, max = null, opciones = [] }) => ({ id: uid('grp'), nombre, tipo, obligatorio, max, opciones });
const crearProducto = ({ categoriaId, nombre, precioBase, gruposIds = [], destino = 'cocina', receta = [] }) =>
  ({ id: uid('prod'), categoriaId, nombre, precioBase, gruposIds, destino, receta, activo: true });
const crearInsumo = ({ nombre, unidad, stock = 0, costoUnitario = 0, stockMin = 0 }) => ({ id: uid('ins'), nombre, unidad, stock, costoUnitario, stockMin });
const crearMesa = ({ nombre, sucursalId }) => ({ id: uid('mesa'), nombre, sucursalId, estado: 'libre', pedidoFolio: null });

// ---- Folio por sucursal -----------------------------------------------------
function folioPedido(e, sucId, codigo = 'SUC') {
  e.secuencias.pedido[sucId] = (e.secuencias.pedido[sucId] || 0) + 1;
  return `P-${codigo}-${String(e.secuencias.pedido[sucId]).padStart(4, '0')}`;
}

// ---- Línea del pedido (resuelve modificadores y snapshot de precio) ---------
//  prod: producto del menú.  modsElegidos: [{ grupoId, opcionId }]
function crearLinea(prod, e, { cantidad = 1, modsElegidos = [], notas = '' } = {}) {
  const modificadores = [];
  for (const sel of modsElegidos) {
    const g = e.menu.gruposModificadores[sel.grupoId];
    if (!g) continue;
    const o = g.opciones.find((x) => x.id === sel.opcionId);
    if (!o) continue;
    modificadores.push({ grupoId: g.id, grupoNombre: g.nombre, opcionId: o.id, opcionNombre: o.nombre, precioDelta: o.precioDelta });
  }
  const deltas = modificadores.reduce((s, m) => s + (m.precioDelta || 0), 0);
  const precioUnitario = r2(prod.precioBase + deltas);
  return {
    id: uid('ln'),
    productoId: prod.id,
    nombre: prod.nombre,            // SNAPSHOT
    destino: prod.destino,
    cantidad,
    precioUnitario,                 // SNAPSHOT
    modificadores,                  // SNAPSHOT
    notas,
    cocina: prod.destino === 'cocina' ? 'pendiente' : null, // pendiente -> enviado -> servido
    importe: r2(precioUnitario * cantidad),
  };
}

function recalcularPedido(p) {
  p.subtotal = r2(p.lineas.reduce((s, l) => s + l.importe, 0));
  let d = 0;
  if (p.descuento) d = p.descuento.tipo === 'porcentaje' ? p.subtotal * (p.descuento.valor / 100) : p.descuento.valor;
  p.total = r2(p.subtotal + (p.costoEnvio || 0) - d + (p.propina || 0));
  return p;
}

// ---- Crear pedido -----------------------------------------------------------
function crearPedido(e, { sucursalId, codigo, tipoServicio = 'mostrador', mesaId = null, cliente = null, usuario = 'sistema', turnoId = null }) {
  const folio = folioPedido(e, sucursalId, codigo);
  const ped = {
    folio, sucursalId, tipoServicio, mesaId,
    estado: 'abierto',              // abierto -> cobrado | cancelado
    cliente, lineas: [], subtotal: 0, costoEnvio: 0, descuento: null, propina: 0, total: 0,
    pago: null, turnoId, creadoPor: usuario,
    creado: new Date().toISOString(), actualizado: new Date().toISOString(),
    tiemposCocina: { recibido: null, listo: null },
  };
  e.pedidos[folio] = ped;
  return ped;
}

// ---- Mandar a cocina (rondas de mesa o disparo en mostrador) ----------------
function mandarComanda(ped) {
  let envio = 0;
  for (const l of ped.lineas) if (l.cocina === 'pendiente') { l.cocina = 'enviado'; envio++; }
  if (envio && !ped.tiemposCocina.recibido) ped.tiemposCocina.recibido = new Date().toISOString();
  ped.actualizado = new Date().toISOString();
  return envio;
}

// ---- Pago -------------------------------------------------------------------
function registrarPago(p, { pagos = [], recibido = 0 } = {}) {
  const ef = pagos.filter((x) => x.metodo === 'efectivo').reduce((s, x) => s + x.monto, 0);
  const cambio = recibido > 0 ? r2(recibido - ef) : 0;
  p.pago = { pagos, recibido, cambio: cambio > 0 ? cambio : 0, metodo: pagos.length === 1 ? pagos[0].metodo : 'mixto', timestamp: new Date().toISOString() };
  p.estado = 'cobrado';
  p.actualizado = new Date().toISOString();
  return p;
}

// ---- Caja -------------------------------------------------------------------
const movimiento = ({ tipo, monto, metodoPago = 'efectivo', usuario = 'sistema', motivo = '', pedidoFolio = null }) =>
  ({ id: uid('mov'), tipo, monto: r2(monto), metodoPago, motivo, pedidoFolio, usuario, timestamp: new Date().toISOString() });

function abrirTurno(e, { sucursalId, usuario, fondoInicial = 0 }) {
  const id = uid('turno');
  const t = {
    id, sucursalId, estado: 'abierto', abiertoPor: usuario, abierto: new Date().toISOString(),
    fondoInicial: r2(fondoInicial),
    movimientos: [movimiento({ tipo: 'apertura', monto: fondoInicial, usuario, motivo: 'Fondo inicial' })],
    cerradoPor: null, cerrado: null, esperado: null, conteo: null, diferencia: null, resultado: null,
  };
  e.caja.turnos[id] = t;
  return t;
}
function turnoAbierto(e, sucursalId) {
  return Object.values(e.caja.turnos).find((t) => t.sucursalId === sucursalId && t.estado === 'abierto') || null;
}
function registrarVentaEnTurno(t, p) {
  for (const x of p.pago.pagos) t.movimientos.push(movimiento({ tipo: 'venta', monto: x.monto, metodoPago: x.metodo, pedidoFolio: p.folio, usuario: p.creadoPor, motivo: 'Venta ' + p.folio }));
  return t;
}
function registrarMovimiento(t, { tipo, monto, motivo, usuario }) {
  // tipo: 'entrada' | 'salida'
  t.movimientos.push(movimiento({ tipo, monto, motivo, usuario }));
  return t;
}
function cerrarTurno(t, { usuario, conteoEfectivo }) {
  const sum = (f) => t.movimientos.filter(f).reduce((s, m) => s + m.monto, 0);
  const vEf = sum((m) => m.tipo === 'venta' && m.metodoPago === 'efectivo');
  const vTa = sum((m) => m.tipo === 'venta' && m.metodoPago === 'tarjeta');
  const vTr = sum((m) => m.tipo === 'venta' && m.metodoPago === 'transferencia');
  const ent = sum((m) => m.tipo === 'entrada');
  const sal = sum((m) => m.tipo === 'salida');
  const espEf = r2(t.fondoInicial + vEf + ent - sal);
  const dif = r2(conteoEfectivo - espEf);
  t.estado = 'cerrado'; t.cerradoPor = usuario; t.cerrado = new Date().toISOString(); t.conteo = r2(conteoEfectivo);
  t.esperado = { efectivo: espEf, tarjeta: vTa, transferencia: vTr, ventaTotal: r2(vEf + vTa + vTr), fondoInicial: t.fondoInicial, entradas: ent, salidas: sal };
  t.diferencia = dif;
  t.resultado = dif === 0 ? 'cuadrado' : (dif < 0 ? 'faltante' : 'sobrante');
  return t;
}

// ---- Inventario / food cost -------------------------------------------------
function costoReceta(e, prod) {
  return r2(prod.receta.reduce((s, r) => { const i = e.insumos[r.insumoId]; return s + (i ? i.costoUnitario * r.cantidad : 0); }, 0));
}
function foodCostPct(e, prod) {
  const c = costoReceta(e, prod);
  return prod.precioBase > 0 ? r2(c / prod.precioBase * 100) : 0;
}
function descontarInventario(e, ped) {
  for (const l of ped.lineas) {
    const p = e.menu.productos[l.productoId];
    if (!p) continue;
    for (const r of p.receta) {
      const i = e.insumos[r.insumoId];
      if (i) i.stock = r2(i.stock - r.cantidad * l.cantidad);
    }
  }
}

module.exports = {
  uid, r2, estadoInicial,
  crearCategoria, crearOpcion, crearGrupo, crearProducto, crearInsumo, crearMesa,
  folioPedido, crearLinea, recalcularPedido, crearPedido, mandarComanda, registrarPago,
  movimiento, abrirTurno, turnoAbierto, registrarVentaEnTurno, registrarMovimiento, cerrarTurno,
  costoReceta, foodCostPct, descontarInventario,
};
