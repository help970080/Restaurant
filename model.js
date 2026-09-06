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
    config: { moneda: 'MXN', zonaHoraria: 'America/Mexico_City', logo: null, fiscal: {} },
    sucursales: {},
    menu: { categorias: {}, gruposModificadores: {}, productos: {} },
    insumos: {},
    promociones: {},
    empleados: {},
    asistencias: [],
    reservas: [],
    cancelaciones: [],
    pedidos: {},
    mesas: {},
    caja: { turnos: {} },
    conteos: [],
    liquidaciones: [],
    secuencias: { pedido: {} },
  };
}

// ---- Canales de venta / delivery (México) -----------------------------------
function canalesDefault() {
  return {
    local:    { id: 'local',    nombre: 'Mostrador',          comisionPct: 0, activo: true, esApp: false },
    whatsapp: { id: 'whatsapp', nombre: 'WhatsApp / Teléfono', comisionPct: 0, activo: true, esApp: false },
    qr:       { id: 'qr',       nombre: 'Menú QR',            comisionPct: 0, activo: true, esApp: false },
  };
}
const crearCanal = ({ nombre, comisionPct = 0, esApp = true }) => ({ id: uid('canal'), nombre, comisionPct: r2(comisionPct), activo: true, esApp });

// ---- RH / Empleados ---------------------------------------------------------
const crearEmpleado = ({ nombre, puesto = '', sucursalId = null, salarioBase = 0, comisionPct = 0, cumple = '', ingreso = '', telefono = '', username = '', pin = '', rfc = '', domicilio = '' }) => ({
  id: uid('emp'), nombre, puesto, sucursalId, salarioBase: r2(salarioBase), comisionPct: r2(comisionPct),
  cumple, ingreso: ingreso || new Date().toISOString().slice(0, 10), telefono, username, pin: String(pin || ''), rfc, domicilio,
  activo: true, fechaBaja: null, creado: new Date().toISOString(),
});

const crearReserva = ({ sucursalId = null, nombre, telefono = '', personas = 2, fecha, hora, mesaId = null, notas = '', creadoPor = '' }) => ({
  id: uid('res'), sucursalId, nombre: String(nombre || '').trim(), telefono, personas: Math.max(1, +personas || 1),
  fecha, hora, mesaId: mesaId || null, notas, estado: 'pendiente', creado: new Date().toISOString(), creadoPor,
});
const crearPromocion = ({ nombre, tipo = 'porcentaje', valor = 0 }) => ({ id: uid('promo'), nombre, tipo, valor, activo: true });

// Receta agregada de un combo: suma las recetas de sus productos componentes
function recetaDeCombo(e, componentes = []) {
  const acc = {};
  for (const pid of componentes) {
    const p = e.menu.productos[pid];
    if (!p) continue;
    for (const r of p.receta) acc[r.insumoId] = r2((acc[r.insumoId] || 0) + r.cantidad);
  }
  return Object.entries(acc).map(([insumoId, cantidad]) => ({ insumoId, cantidad }));
}

// ---- Menú -------------------------------------------------------------------
const crearCategoria = ({ nombre, orden = 0 }) => ({ id: uid('cat'), nombre, orden, visible: true });
const crearOpcion = ({ nombre, precioDelta = 0, porDefecto = false }) => ({ id: uid('opt'), nombre, precioDelta, porDefecto, activo: true });
const crearGrupo = ({ nombre, tipo = 'unico', obligatorio = false, max = null, opciones = [] }) => ({ id: uid('grp'), nombre, tipo, obligatorio, max, opciones });
const crearProducto = ({ categoriaId, nombre, precioBase, gruposIds = [], destino = 'cocina', receta = [], descripcion = '', estacion = 'Cocina', icono = '' }) =>
  ({ id: uid('prod'), categoriaId, nombre, descripcion, precioBase, gruposIds, destino, estacion, icono, receta, activo: true, disponible: true });
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
    estacion: prod.estacion || 'Cocina', // SNAPSHOT — estación de cocina para ruteo del KDS
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
  p.total = r2(p.subtotal + (p.costoEnvio || 0) - d); // la propina NO entra al total del consumo
  return p;
}

// ---- Crear pedido -----------------------------------------------------------
function crearPedido(e, { sucursalId, codigo, tipoServicio = 'mostrador', mesaId = null, cliente = null, usuario = 'sistema', turnoId = null, canalId = 'local' }) {
  const folio = folioPedido(e, sucursalId, codigo);
  const ped = {
    folio, sucursalId, tipoServicio, mesaId, canalId,
    estado: 'abierto',              // abierto -> cobrado | cancelado
    cliente, lineas: [], subtotal: 0, costoEnvio: 0, descuento: null, propina: 0, total: 0,
    pago: null, turnoId, creadoPor: usuario,
    creado: new Date().toISOString(), actualizado: new Date().toISOString(),
    tiemposCocina: { recibido: null, listo: null },
    // Reparto propio (solo tipoServicio 'domicilio'). null en mostrador/mesa.
    reparto: tipoServicio === 'domicilio' ? nuevoReparto() : null,
    // Liga publica de seguimiento para el cliente. Token aleatorio, no el folio.
    seguimiento: tipoServicio === 'domicilio' ? { token: tokenSeguimiento(), creado: new Date().toISOString(), avisado: null } : null,
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

// ---- REPARTO PROPIO (motos de la casa) --------------------------------------
//  Ciclo: por_asignar -> asignado -> en_ruta -> entregado
//  El repartidor cobra en la puerta; el efectivo NO entra al turno hasta que
//  liquida al volver (reparto.liquidado). Por eso entregar y liquidar son dos
//  pasos distintos: mientras uno esta en falso, el dinero esta con la moto.
const tokenSeguimiento = () => crypto.randomBytes(9).toString('hex');
const nuevoReparto = () => ({
  estado: 'por_asignar',
  repartidorId: null, repartidorNombre: null,
  asignado: null, salida: null, entregado: null,
  liquidado: false, liquidacionId: null,
  intentos: 0, ultimoFallo: null,
});

// Normaliza y valida la direccion de entrega. Lanza si faltan datos minimos.
function normalizarEntrega(cliente) {
  const c = cliente || {};
  const t = (v) => String(v == null ? '' : v).trim();
  const out = {
    nombre: t(c.nombre), telefono: t(c.telefono).replace(/[^\d+]/g, ''),
    calle: t(c.calle), numero: t(c.numero), colonia: t(c.colonia),
    referencias: t(c.referencias), notas: t(c.notas),
  };
  const faltan = [];
  if (!out.nombre) faltan.push('nombre');
  if (out.telefono.replace(/\D/g, '').length < 10) faltan.push('telefono (10 digitos)');
  if (!out.calle) faltan.push('calle');
  if (!out.numero) faltan.push('numero');
  if (!out.colonia) faltan.push('colonia');
  if (faltan.length) { const e = new Error('Faltan datos de entrega: ' + faltan.join(', ')); e.status = 400; throw e; }
  out.direccion = `${out.calle} ${out.numero}, ${out.colonia}`;
  return out;
}

const esRepartidor = (emp) => !!emp && emp.activo !== false && /repartidor|motoriz|moto\b/i.test(String(emp.puesto || ''));
function repartidoresDe(e, sucursalId) {
  return Object.values(e.empleados || {})
    .filter((x) => esRepartidor(x) && (!sucursalId || !x.sucursalId || x.sucursalId === sucursalId));
}
const esDomicilio = (p) => p.tipoServicio === 'domicilio';
// Pedido que ya salio y aun no se entrega
const enRuta = (p) => esDomicilio(p) && p.reparto && p.reparto.estado === 'en_ruta';
// Entregado y cobrado, pero el efectivo todavia no llega a caja
const porLiquidar = (p) => esDomicilio(p) && p.reparto && p.reparto.estado === 'entregado' && !p.reparto.liquidado && p.estado === 'cobrado';
// Efectivo (venta + propina en efectivo) que trae el repartidor encima
function efectivoDePedido(p) {
  if (!p.pago) return 0;
  const v = p.pago.pagos.filter((x) => x.metodo === 'efectivo').reduce((s, x) => s + x.monto, 0);
  const pr = p.propina && p.propina.metodo === 'efectivo' ? p.propina.monto : 0;
  return r2(v + pr);
}

function asignarReparto(e, p, empleadoId) {
  const emp = (e.empleados || {})[empleadoId];
  if (!esRepartidor(emp)) { const x = new Error('El empleado no esta activo o no tiene puesto de repartidor'); x.status = 400; throw x; }
  const r = p.reparto || (p.reparto = nuevoReparto());
  if (r.estado === 'entregado') { const x = new Error('El pedido ya fue entregado'); x.status = 409; throw x; }
  r.repartidorId = emp.id; r.repartidorNombre = emp.nombre;
  r.estado = 'asignado'; r.asignado = new Date().toISOString();
  p.actualizado = r.asignado;
  return p;
}

function marcarSalida(e, p) {
  const r = p.reparto;
  if (!r || !r.repartidorId) { const x = new Error('El pedido no tiene repartidor asignado'); x.status = 409; throw x; }
  if (r.estado === 'entregado') { const x = new Error('El pedido ya fue entregado'); x.status = 409; throw x; }
  if (!p.lineas.length) { const x = new Error('El pedido no tiene productos'); x.status = 400; throw x; }
  r.estado = 'en_ruta'; r.salida = new Date().toISOString();
  p.actualizado = r.salida;
  return p;
}

// Entrega + cobro en la puerta. Cierra el pedido pero deja el efectivo pendiente.
function marcarEntregado(p) {
  const r = p.reparto;
  if (!r) { const x = new Error('El pedido no es de reparto'); x.status = 400; throw x; }
  r.estado = 'entregado'; r.entregado = new Date().toISOString();
  p.actualizado = r.entregado;
  return p;
}

// Intento fallido: regresa el pedido a la cola para reasignar.
function marcarFallido(p, motivo = '') {
  const r = p.reparto;
  if (!r) { const x = new Error('El pedido no es de reparto'); x.status = 400; throw x; }
  if (r.estado === 'entregado') { const x = new Error('El pedido ya fue entregado'); x.status = 409; throw x; }
  r.intentos = (r.intentos || 0) + 1;
  r.ultimoFallo = { motivo: motivo || '(sin motivo)', fecha: new Date().toISOString(), repartidorId: r.repartidorId };
  r.estado = 'por_asignar'; r.repartidorId = null; r.repartidorNombre = null; r.asignado = null; r.salida = null;
  p.actualizado = new Date().toISOString();
  return p;
}

// Minutos de cocina->puerta y de salida->entrega
function tiemposReparto(p) {
  const r = p.reparto || {};
  const min = (a, b) => (a && b ? r2((new Date(b) - new Date(a)) / 60000) : null);
  return {
    preparacion: min(p.creado, p.tiemposCocina && p.tiemposCocina.listo),
    enRuta: min(r.salida, r.entregado),
    total: min(p.creado, r.entregado),
  };
}

// Liquidacion: el repartidor entrega el efectivo y esos pedidos entran al turno.
function crearLiquidacion({ repartidorId, repartidorNombre, sucursalId, turnoId, folios, efectivoEsperado, conteoEfectivo, usuario }) {
  const esperado = r2(efectivoEsperado);
  const contado = conteoEfectivo == null ? esperado : r2(conteoEfectivo);
  const dif = r2(contado - esperado);
  return {
    id: uid('liq'), repartidorId, repartidorNombre, sucursalId, turnoId,
    folios: folios.slice(), pedidos: folios.length,
    efectivoEsperado: esperado, conteoEfectivo: contado, diferencia: dif,
    resultado: dif === 0 ? 'cuadrado' : (dif < 0 ? 'faltante' : 'sobrante'),
    usuario, fecha: new Date().toISOString(),
  };
}

// Ubicacion viva de cada repartidor. Se sobrescribe: no se guarda recorrido.
function guardarUbicacion(e, empleadoId, { lat, lng, precision = null }) {
  if (!e.repartoUbicaciones) e.repartoUbicaciones = {};
  const la = +lat, ln = +lng;
  if (!isFinite(la) || !isFinite(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
    const x = new Error('Coordenadas inválidas'); x.status = 400; throw x;
  }
  e.repartoUbicaciones[empleadoId] = { lat: la, lng: ln, precision: precision == null ? null : +precision, ts: new Date().toISOString() };
  return e.repartoUbicaciones[empleadoId];
}
// Una posicion vieja miente mas de lo que informa: se descarta a los 4 minutos.
function ubicacionViva(e, empleadoId, maxMin = 4) {
  const u = (e.repartoUbicaciones || {})[empleadoId];
  if (!u) return null;
  return (Date.now() - new Date(u.ts).getTime()) / 60000 <= maxMin ? u : null;
}

// Minutos promedio salida->entrega de la sucursal, para dar un ETA con datos
// propios en vez de una promesa inventada. null si aun no hay historial.
function promedioEnRuta(e, sucursalId, minMuestras = 3) {
  const ms = [];
  for (const p of Object.values(e.pedidos)) {
    if (p.tipoServicio !== 'domicilio' || !p.reparto) continue;
    if (sucursalId && p.sucursalId !== sucursalId) continue;
    const t = tiemposReparto(p).enRuta;
    if (t != null && t > 0 && t < 180) ms.push(t);
  }
  if (ms.length < minMuestras) return null;
  ms.sort((a, b) => a - b);
  return Math.round(ms[Math.floor(ms.length / 2)]); // mediana: aguanta el pedido raro
}

// Paso del cliente: 0 recibido · 1 en preparacion · 2 listo · 3 en camino · 4 entregado
function pasoCliente(p) {
  const r = p.reparto || {};
  if (r.estado === 'entregado') return 4;
  if (r.estado === 'en_ruta') return 3;
  if (p._kdsListo) return 2;
  if (p.tiemposCocina && p.tiemposCocina.recibido) return 1;
  return 0;
}

// Lo unico que ve el cliente. Sin telefono ni direccion propios, sin totales de
// otros pedidos y sin nada del resto de la operacion.
function vistaSeguimiento(e, p, { repartidor = null, ubicacion = null, etaMin = null } = {}) {
  const r = p.reparto || {};
  const suc = e.sucursales[p.sucursalId] || {};
  return {
    folio: p.folio,
    negocio: (e.meta && e.meta.nombre) || '',
    sucursal: suc.nombre || '',
    cliente: (p.cliente && p.cliente.nombre) || '',
    paso: pasoCliente(p),
    cancelado: p.estado === 'cancelado',
    creado: p.creado,
    salida: r.salida || null,
    entregado: r.entregado || null,
    etaMin,
    repartidor: repartidor ? { nombre: repartidor.nombre, telefono: repartidor.telefono || null } : null,
    moto: ubicacion ? { lat: ubicacion.lat, lng: ubicacion.lng, ts: ubicacion.ts } : null,
    items: (p.lineas || []).map((l) => ({ cantidad: l.cantidad, nombre: l.nombre, modificadores: (l.modificadores || []).map((m) => m.opcionNombre) })),
    total: p.total,
  };
}

// ---- Pago -------------------------------------------------------------------
function registrarPago(p, { pagos = [], recibido = 0, propina = null } = {}) {
  const ef = pagos.filter((x) => x.metodo === 'efectivo').reduce((s, x) => s + x.monto, 0);
  const propMonto = propina && propina.monto > 0 ? r2(propina.monto) : 0;
  const propEf = propina && propina.metodo === 'efectivo' ? propMonto : 0;
  const efectivoTotal = ef + propEf;
  const cambio = recibido > 0 ? r2(recibido - efectivoTotal) : 0;
  p.pago = { pagos, recibido, cambio: cambio > 0 ? cambio : 0, metodo: pagos.length === 1 ? pagos[0].metodo : 'mixto', timestamp: new Date().toISOString() };
  // La propina NO es ingreso del restaurante (LFT 346-347): se guarda aparte, no suma a la venta.
  p.propina = propMonto > 0 ? { monto: propMonto, metodo: (propina && propina.metodo) || 'efectivo' } : null;
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
  // La propina en efectivo entra físicamente al cajón; se registra para que el corte cuadre.
  if (p.propina && p.propina.monto > 0) t.movimientos.push(movimiento({ tipo: 'propina', monto: p.propina.monto, metodoPago: p.propina.metodo, pedidoFolio: p.folio, usuario: p.creadoPor, motivo: 'Propina ' + p.folio }));
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
  const vMp = sum((m) => m.tipo === 'venta' && m.metodoPago === 'mercadopago'); // cobros del menú QR
  const ent = sum((m) => m.tipo === 'entrada');
  const sal = sum((m) => m.tipo === 'salida');
  const propEf = sum((m) => m.tipo === 'propina' && m.metodoPago === 'efectivo');
  const propTar = sum((m) => m.tipo === 'propina' && m.metodoPago !== 'efectivo');
  const espEf = r2(t.fondoInicial + vEf + propEf + ent - sal); // las propinas en efectivo están en el cajón
  const dif = r2(conteoEfectivo - espEf);
  t.estado = 'cerrado'; t.cerradoPor = usuario; t.cerrado = new Date().toISOString(); t.conteo = r2(conteoEfectivo);
  t.esperado = { efectivo: espEf, tarjeta: vTa, transferencia: vTr, mercadopago: vMp, ventaTotal: r2(vEf + vTa + vTr + vMp), fondoInicial: t.fondoInicial, entradas: ent, salidas: sal, propinasEfectivo: propEf, propinasTarjeta: propTar, propinasTotal: r2(propEf + propTar) };
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
  crearCategoria, crearOpcion, crearGrupo, crearProducto, crearInsumo, crearMesa, crearPromocion, recetaDeCombo, canalesDefault, crearCanal, crearEmpleado, crearReserva,
  folioPedido, crearLinea, recalcularPedido, crearPedido, mandarComanda, registrarPago,
  nuevoReparto, normalizarEntrega, esRepartidor, repartidoresDe, esDomicilio, enRuta, porLiquidar,
  efectivoDePedido, asignarReparto, marcarSalida, marcarEntregado, marcarFallido, tiemposReparto, crearLiquidacion,
  tokenSeguimiento, guardarUbicacion, ubicacionViva, promedioEnRuta, pasoCliente, vistaSeguimiento,
  movimiento, abrirTurno, turnoAbierto, registrarVentaEnTurno, registrarMovimiento, cerrarTurno,
  costoReceta, foodCostPct, descontarInventario,
};
