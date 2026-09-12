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
    clientes: {},
    proveedores: {},
    gastos: [],
    secuencias: { pedido: {}, gasto: {} },
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
//  tipo: 'porcentaje' | 'monto' | '2x1'
//  En 2x1 se cuentan las piezas elegibles, se ordenan de más cara a más barata
//  y se regala una de cada par: siempre la más barata. Eso es lo que significa
//  "se cobra la pizza más cara".
const crearPromocion = ({ nombre, tipo = 'porcentaje', valor = 0, categorias = [] }) =>
  ({ id: uid('promo'), nombre, tipo, valor, categorias: Array.isArray(categorias) ? categorias.slice() : [], activo: true });

function promo2x1Activa(e) {
  return Object.values(e.promociones || {}).find((p) => p.tipo === '2x1' && p.activo) || null;
}

// Calcula cuánto se regala por el 2x1 y lo deja guardado en el pedido.
// Devuelve el detalle para poder imprimirlo en el ticket.
function calcular2x1(e, p) {
  const promo = promo2x1Activa(e);
  if (!promo || !promo.categorias.length) { p.promo2x1 = null; return null; }
  const piezas = [];
  for (const l of p.lineas || []) {
    const prod = e.menu.productos[l.productoId];
    if (!prod || !promo.categorias.includes(prod.categoriaId)) continue;
    for (let i = 0; i < l.cantidad; i++) piezas.push({ nombre: l.nombre, precio: l.precioUnitario });
  }
  if (piezas.length < 2) { p.promo2x1 = null; return null; }
  piezas.sort((a, b) => b.precio - a.precio);      // de la más cara a la más barata
  const gratis = [];
  for (let i = 1; i < piezas.length; i += 2) gratis.push(piezas[i]);   // la 2ª de cada par
  const monto = r2(gratis.reduce((t, x) => t + x.precio, 0));
  p.promo2x1 = { promoId: promo.id, nombre: promo.nombre, monto, gratis: gratis.map((x) => ({ nombre: x.nombre, importe: x.precio })) };
  return p.promo2x1;
}

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
  const promo = (p.promo2x1 && p.promo2x1.monto) || 0;
  p.total = r2(p.subtotal + (p.costoEnvio || 0) - d - promo); // la propina NO entra al total del consumo
  if (p.total < 0) p.total = 0;
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
  calificacion: null,
  destino: null,   // coords reales del domicilio, aprendidas al entregar
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
  const ahora = new Date().toISOString();
  const prev = e.repartoUbicaciones[empleadoId] || {};
  const corte = Date.now() - 40 * 60000;
  const rastro = (prev.rastro || []).filter((p) => new Date(p.ts).getTime() > corte);
  rastro.push({ lat: la, lng: ln, ts: ahora });
  while (rastro.length > 20) rastro.shift();
  e.repartoUbicaciones[empleadoId] = {
    lat: la, lng: ln, precision: precision == null ? null : +precision, ts: ahora, rastro,
  };
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

// ---- Estimación de llegada --------------------------------------------------
//  El cálculo viejo era "promedio histórico menos lo transcurrido". Con pocas
//  entregas, o si alguna se marcó entregada de inmediato, la mediana queda en
//  dos minutos y el cliente ve "menos de 1 min" con la moto todavía lejos.
//  Ahora, cuando conocemos dónde va la moto y dónde vive el cliente, se estima
//  por distancia real. La velocidad se aprende de las propias entregas.
// Si "entregado" se marca sin salir del local, la posición de la moto no es el
// domicilio del cliente: es el local. Guardarla convierte al sistema en un
// mentiroso confiado ("a 0 m" con el cliente a 28 km).
const MIN_KM_ENTREGA = 0.15;
function destinoCreible(destino, referencia) {
  if (!destino || destino.lat == null) return false;
  if (!referencia || referencia.lat == null) return true;   // sin con qué comparar, se acepta
  const d = distanciaKm(destino, referencia);
  return d == null || d >= MIN_KM_ENTREGA;
}

// Una entrega no es solo trayecto: hay un tiempo fijo de salir del local,
// estacionarse, tocar y cobrar. Sin ese fijo, los domicilios cercanos salían
// absurdamente rápidos y los lejanos se compensaban con una velocidad muy
// baja, que a su vez inflaba los tiempos largos al doble.
//   tiempo = MINUTOS_FIJOS + distancia / velocidad
const MINUTOS_FIJOS = 4;
const KM_MIN_DEFAULT = 0.5;    // 30 km/h en línea recta ≈ 40 km/h de calle
const KM_MIN_MIN = 0.15;       // topes de cordura por si un dato sale raro
const KM_MIN_MAX = 1.2;

function velocidadReparto(e) {
  const v = (e.config && e.config.velocidadReparto) || null;
  if (!v || !(v.muestras >= 3) || !(v.kmMin > 0)) return { kmMin: KM_MIN_DEFAULT, muestras: (v && v.muestras) || 0, aprendida: false };
  const kmMin = Math.min(Math.max(v.kmMin, KM_MIN_MIN), KM_MIN_MAX);
  return { kmMin, muestras: v.muestras, aprendida: true };
}

// Al entregar sabemos de dónde salió, a dónde llegó y cuánto tardó: con eso se
// va calibrando la velocidad real del negocio (promedio móvil).
function aprenderVelocidad(e, p) {
  const r = p.reparto || {};
  if (!r.origen || !r.destino || !r.salida || !r.entregado) return null;
  const km = distanciaKm(r.origen, r.destino);
  const min = (new Date(r.entregado) - new Date(r.salida)) / 60000;
  if (!(km >= MIN_KM_ENTREGA) || !(min > 0.5) || min > 120) return null;   // datos absurdos fuera
  // Se aprende la velocidad de TRAYECTO: hay que descontar el tiempo fijo.
  const trayecto = min - MINUTOS_FIJOS;
  if (trayecto <= 0.5) return null;
  const kmMin = km / trayecto;
  if (kmMin < KM_MIN_MIN || kmMin > KM_MIN_MAX) return null;
  if (!e.config.velocidadReparto) e.config.velocidadReparto = { kmMin: KM_MIN_DEFAULT, muestras: 0 };
  const v = e.config.velocidadReparto;
  const n = Math.min(v.muestras + 1, 40);                        // se adapta si cambia la operación
  v.kmMin = r2(((v.kmMin * (n - 1)) + kmMin) / n);
  v.muestras = n;
  v.actualizado = new Date().toISOString();
  return v;
}

//  Devuelve { min, base, distanciaKm }. base: 'gps' | 'historial' | null
function estimarLlegada(e, p, { ubicacion = null, promedioMin = null } = {}) {
  const r = p.reparto || {};
  if (r.estado !== 'en_ruta' || !r.salida) return { min: null, base: null, distanciaKm: null };
  const transcurrido = Math.round((Date.now() - new Date(r.salida).getTime()) / 60000);
  // Defensa para datos ya guardados mal: un domicilio que cae encima del local
  // no es un domicilio, es un "entregado" marcado sin salir.
  const suc = (e.sucursales || {})[p.sucursalId] || {};
  const destinoOK = destinoCreible(r.destino, suc.coordenadas || r.origen);
  // 1) Con posición viva y domicilio ubicado: distancia real
  if (ubicacion && r.destino && destinoOK) {
    const km = distanciaKm(ubicacion, r.destino);
    if (km != null) {
      const { kmMin } = velocidadReparto(e);
      // A menos de 150 m ya está en la puerta: no se le suma el tiempo fijo.
      const min = km < MIN_KM_ENTREGA ? 0 : Math.round(MINUTOS_FIJOS + km / kmMin);
      return { min: Math.max(0, min), base: 'gps', distanciaKm: km };
    }
  }
  // 2) Sin GPS o sin domicilio ubicado: el promedio, pero sin prometer de más.
  //    Con menos de 5 entregas de historial la mediana no es confiable.
  const v = (e.config && e.config.velocidadReparto) || {};
  if (promedioMin != null && v.muestras >= 5) {
    return { min: Math.max(0, promedioMin - transcurrido), base: 'historial', distanciaKm: null };
  }
  return { min: null, base: null, distanciaKm: null };
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
function vistaSeguimiento(e, p, { repartidor = null, ubicacion = null, etaMin = null, etaBase = null, distanciaKm: distEta = null } = {}) {
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
    etaMin, etaBase, distanciaKm: distEta,
    repartidor: repartidor ? { nombre: repartidor.nombre, telefono: repartidor.telefono || null } : null,
    repartidorNombre: r.repartidorNombre || null,
    calificacion: r.calificacion ? { estrellas: r.calificacion.estrellas } : null,
    puedeCalificar: r.estado === 'entregado' && !r.calificacion,
    moto: ubicacion ? { lat: ubicacion.lat, lng: ubicacion.lng, ts: ubicacion.ts } : null,
    items: (p.lineas || []).map((l) => ({ cantidad: l.cantidad, nombre: l.nombre, modificadores: (l.modificadores || []).map((m) => m.opcionNombre) })),
    total: p.total,
  };
}

// ---- Directorio de clientes -------------------------------------------------
//  Se llena solo con cada pedido a domicilio. La llave es el telefono a 10
//  digitos, que es como los identifica quien contesta el telefono.
const llaveTel = (t) => String(t == null ? '' : t).replace(/\D/g, '').slice(-10);

function upsertCliente(e, entrega, extra = {}) {
  if (!e.clientes) e.clientes = {};
  const k = llaveTel(entrega && entrega.telefono);
  if (k.length !== 10) return null;
  const prev = e.clientes[k] || { telefono: k, pedidos: 0, creado: new Date().toISOString(), lat: null, lng: null };
  const c = Object.assign(prev, {
    nombre: entrega.nombre || prev.nombre || '',
    calle: entrega.calle || prev.calle || '',
    numero: entrega.numero || prev.numero || '',
    colonia: entrega.colonia || prev.colonia || '',
    referencias: entrega.referencias != null && entrega.referencias !== '' ? entrega.referencias : (prev.referencias || ''),
    actualizado: new Date().toISOString(),
  });
  c.direccion = `${c.calle} ${c.numero}, ${c.colonia}`.trim();
  // Las coords solo se pisan cuando llega una nueva medida real
  if (extra.lat != null && extra.lng != null) {
    c.lat = +extra.lat; c.lng = +extra.lng;
    c.fuente = extra.fuente || 'gps';
    if (extra.verificado != null) c.verificado = !!extra.verificado;
    c.ubicadoEn = new Date().toISOString();
  }
  if (extra.sumarPedido) { c.pedidos = (c.pedidos || 0) + 1; c.ultimoPedido = new Date().toISOString(); }
  e.clientes[k] = c;
  return c;
}

function buscarClientes(e, q, limite = 8) {
  const t = String(q || '').trim().toLowerCase();
  if (t.length < 3) return [];
  const dig = t.replace(/\D/g, '');
  return Object.values(e.clientes || {})
    .filter((c) => (dig.length >= 3 && c.telefono.includes(dig))
      || (c.nombre || '').toLowerCase().includes(t)
      || (c.direccion || '').toLowerCase().includes(t))
    .sort((a, b) => new Date(b.ultimoPedido || b.actualizado || 0) - new Date(a.ultimoPedido || a.actualizado || 0))
    .slice(0, limite);
}

// Distancia en linea recta (km). No es la ruta, pero para "¿ya mero llega?"
// alcanza y no cuesta una llamada a ningun servicio de mapas.
function distanciaKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, rad = (x) => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return r2(2 * R * Math.asin(Math.sqrt(h)));
}

// ---- Calificacion del repartidor -------------------------------------------
function calificarReparto(p, { estrellas, comentario = '' }) {
  const n = Math.round(+estrellas);
  if (!(n >= 1 && n <= 5)) { const x = new Error('La calificación va de 1 a 5'); x.status = 400; throw x; }
  if (!p.reparto || p.reparto.estado !== 'entregado') { const x = new Error('El pedido aún no se entrega'); x.status = 409; throw x; }
  p.reparto.calificacion = {
    estrellas: n,
    comentario: String(comentario || '').trim().slice(0, 300),
    fecha: new Date().toISOString(),
    repartidorId: p.reparto.repartidorId,
  };
  return p.reparto.calificacion;
}

// ---- GASTOS Y COMPRAS -------------------------------------------------------
//  Distinción que importa para no mentirle al estado de resultados:
//  - Comprar insumos NO es gasto del periodo: es inventario. Se vuelve costo
//    (COGS) cuando el producto se vende. Si se contara como gasto además del
//    COGS, el mismo peso se restaría dos veces.
//  - Gasolina, renta, reparaciones y demás sí son gasto operativo del periodo.
const CATEGORIAS_GASTO = {
  insumos:       { nombre: 'Insumos y mercancía', inventario: true },
  gasolina:      { nombre: 'Gasolina y transporte' },
  mantenimiento: { nombre: 'Mantenimiento y reparaciones' },
  servicios:     { nombre: 'Servicios (luz, agua, gas)' },
  renta:         { nombre: 'Renta' },
  nomina:        { nombre: 'Nómina y honorarios' },
  empaque:       { nombre: 'Empaques y desechables' },
  limpieza:      { nombre: 'Limpieza' },
  publicidad:    { nombre: 'Publicidad' },
  otros:         { nombre: 'Otros' },
};
const esCompraInventario = (cat) => !!(CATEGORIAS_GASTO[cat] && CATEGORIAS_GASTO[cat].inventario);

const crearProveedor = ({ nombre, telefono = '', contacto = '', notas = '' }) => ({
  id: uid('prov'), nombre: String(nombre || '').trim(), telefono: String(telefono || '').replace(/[^\d+]/g, ''),
  contacto, notas, activo: true, creado: new Date().toISOString(),
});

function folioGasto(e, sucId, codigo = 'SUC') {
  if (!e.secuencias.gasto) e.secuencias.gasto = {};
  e.secuencias.gasto[sucId] = (e.secuencias.gasto[sucId] || 0) + 1;
  return `G-${codigo}-${String(e.secuencias.gasto[sucId]).padStart(4, '0')}`;
}

// Cada línea: { descripcion, insumoId?, cantidad, precioUnitario }
function normalizarLineasGasto(e, lineas = []) {
  const out = [];
  for (const l of lineas) {
    const cant = +l.cantidad, pu = +l.precioUnitario;
    const desc = String(l.descripcion || '').trim() || ((e.insumos[l.insumoId] || {}).nombre) || '';
    if (!desc) { const x = new Error('Cada renglón necesita concepto'); x.status = 400; throw x; }
    if (!(cant > 0)) { const x = new Error(`Cantidad inválida en "${desc}"`); x.status = 400; throw x; }
    if (!(pu >= 0)) { const x = new Error(`Precio inválido en "${desc}"`); x.status = 400; throw x; }
    const insumoId = l.insumoId && e.insumos[l.insumoId] ? l.insumoId : null;
    out.push({ id: uid('gl'), descripcion: desc, insumoId, unidad: insumoId ? e.insumos[insumoId].unidad : (l.unidad || ''),
      cantidad: r2(cant), precioUnitario: r2(pu), importe: r2(cant * pu) });
  }
  if (!out.length) { const x = new Error('El gasto necesita al menos un renglón'); x.status = 400; throw x; }
  return out;
}

function crearGasto(e, { sucursalId, codigo = 'SUC', categoria = 'otros', proveedorId = null, proveedorNombre = '',
  lineas = [], metodoPago = 'efectivo', folioFactura = '', notas = '', turnoId = null, usuario = 'sistema', fecha = null }) {
  if (!CATEGORIAS_GASTO[categoria]) { const x = new Error('Categoría de gasto desconocida'); x.status = 400; throw x; }
  const ls = normalizarLineasGasto(e, lineas);
  if (!e.proveedores) e.proveedores = {};
  const prov = proveedorId ? e.proveedores[proveedorId] : null;
  const g = {
    id: uid('gas'), folio: folioGasto(e, sucursalId, codigo), sucursalId, categoria,
    proveedorId: prov ? prov.id : null,
    proveedor: prov ? prov.nombre : String(proveedorNombre || '').trim(),
    lineas: ls, total: r2(ls.reduce((t, l) => t + l.importe, 0)),
    metodoPago, folioFactura: String(folioFactura || '').trim(), notas: String(notas || '').trim(),
    inventario: esCompraInventario(categoria),
    estado: 'activo', turnoId, movimientoId: null,
    fecha: fecha || new Date().toISOString(), creadoPor: usuario,
  };
  if (!e.gastos) e.gastos = [];
  e.gastos.unshift(g);
  return g;
}

// Compra de insumos: sube el stock y recalcula el costo unitario con promedio
// ponderado, para que el food cost deje de ser un número teórico.
function aplicarCompraInsumos(e, gasto, signo = 1) {
  const tocados = [];
  for (const l of gasto.lineas) {
    if (!l.insumoId) continue;
    const ins = e.insumos[l.insumoId];
    if (!ins) continue;
    const cant = r2(l.cantidad * signo);
    if (signo > 0) {
      const stockPrev = Math.max(0, ins.stock || 0);
      const valorPrev = stockPrev * (ins.costoUnitario || 0);
      const nuevoStock = r2(stockPrev + cant);
      if (nuevoStock > 0) ins.costoUnitario = r2((valorPrev + l.cantidad * l.precioUnitario) / nuevoStock);
      ins.stock = nuevoStock;
    } else {
      ins.stock = r2((ins.stock || 0) + cant); // al cancelar solo se devuelve el stock
    }
    tocados.push({ insumoId: ins.id, nombre: ins.nombre, stock: ins.stock, costoUnitario: ins.costoUnitario });
  }
  return tocados;
}

// Corta los gastos de un rango en compras de inventario vs gasto operativo
function resumirGastos(gastos, { desde, hasta, sucursalId, tz = 'America/Mexico_City' } = {}) {
  const dia = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz }); }
    catch { return String(iso).slice(0, 10); }
  };
  const dentro = (g) => {
    if (g.estado === 'cancelado') return false;
    if (sucursalId && g.sucursalId !== sucursalId) return false;
    const d = dia(g.fecha);
    return (!desde || d >= desde) && (!hasta || d <= hasta);
  };
  const usados = gastos.filter(dentro);
  const porCategoria = {};
  let operativos = 0, compras = 0;
  for (const g of usados) {
    const k = g.categoria;
    porCategoria[k] = porCategoria[k] || { categoria: k, nombre: (CATEGORIAS_GASTO[k] || {}).nombre || k, total: 0, movimientos: 0, inventario: !!g.inventario };
    porCategoria[k].total = r2(porCategoria[k].total + g.total);
    porCategoria[k].movimientos++;
    if (g.inventario) compras = r2(compras + g.total); else operativos = r2(operativos + g.total);
  }
  return {
    operativos, compras, total: r2(operativos + compras), movimientos: usados.length,
    porCategoria: Object.values(porCategoria).sort((a, b) => b.total - a.total),
  };
}

// ---- Dejar el sistema limpio para arrancar en firme -------------------------
//  Borra los MOVIMIENTOS de prueba y conserva la CONFIGURACIÓN: menú, precios,
//  sucursales, personal y usuarios. Los folios vuelven a empezar en 0001 para
//  que la numeración fiscal y de reparto arranque de cero.
function contarPruebas(e) {
  const turnos = Object.values((e.caja && e.caja.turnos) || {});
  return {
    pedidos: Object.keys(e.pedidos || {}).length,
    turnos: turnos.length,
    turnosAbiertos: turnos.filter((t) => t.estado === 'abierto').length,
    gastos: (e.gastos || []).filter((g) => g.estado !== 'cancelado').length,
    clientes: Object.keys(e.clientes || {}).length,
    proveedores: Object.keys(e.proveedores || {}).length,
    liquidaciones: (e.liquidaciones || []).length,
    cancelaciones: (e.cancelaciones || []).length,
    reservas: (e.reservas || []).length,
    asistencias: (e.asistencias || []).length,
    conteos: (e.conteos || []).length,
    empleados: Object.values(e.empleados || {}).length,
    productos: Object.keys((e.menu && e.menu.productos) || {}).length,
    insumos: Object.keys(e.insumos || {}).length,
  };
}

function limpiarPruebas(e, opciones = {}) {
  const {
    clientes = true, proveedores = false, empleados = false,
    inventarioEnCero = true, reservas = true, asistencias = true,
  } = opciones;
  const antes = contarPruebas(e);

  // Movimientos: siempre se van
  e.pedidos = {};
  e.caja = { turnos: {} };
  e.conteos = [];
  e.liquidaciones = [];
  e.cancelaciones = [];
  e.gastos = [];
  e.repartoUbicaciones = {};
  e.secuencias = { pedido: {}, gasto: {} };          // folios desde 0001

  // La velocidad de reparto se aprendió con entregas falsas: no sirve
  if (e.config) delete e.config.velocidadReparto;

  // Las mesas quedan libres
  for (const m of Object.values(e.mesas || {})) { m.estado = 'libre'; m.pedidoFolio = null; }

  if (clientes) e.clientes = {};
  if (proveedores) e.proveedores = {};
  if (reservas) e.reservas = [];
  if (asistencias) e.asistencias = [];
  if (empleados) e.empleados = {};

  // Inventario: se conservan los insumos y su costo, pero el stock se pone en
  // cero para que la primera cuenta física sea la buena.
  if (inventarioEnCero) for (const i of Object.values(e.insumos || {})) i.stock = 0;

  // El menú queda disponible y sin "agotados" heredados de las pruebas
  for (const p of Object.values((e.menu && e.menu.productos) || {})) p.disponible = true;

  e.meta = e.meta || {};
  e.meta.limpiado = new Date().toISOString();
  return { antes, despues: contarPruebas(e) };
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
  promo2x1Activa, calcular2x1,
  nuevoReparto, normalizarEntrega, esRepartidor, repartidoresDe, esDomicilio, enRuta, porLiquidar,
  efectivoDePedido, asignarReparto, marcarSalida, marcarEntregado, marcarFallido, tiemposReparto, crearLiquidacion,
  tokenSeguimiento, guardarUbicacion, ubicacionViva, promedioEnRuta, pasoCliente, vistaSeguimiento,
  llaveTel, upsertCliente, buscarClientes, distanciaKm, calificarReparto,
  velocidadReparto, aprenderVelocidad, estimarLlegada, destinoCreible, MIN_KM_ENTREGA, MINUTOS_FIJOS,
  contarPruebas, limpiarPruebas,
  CATEGORIAS_GASTO, esCompraInventario, crearProveedor, folioGasto, normalizarLineasGasto,
  crearGasto, aplicarCompraInsumos, resumirGastos,
  movimiento, abrirTurno, turnoAbierto, registrarVentaEnTurno, registrarMovimiento, cerrarTurno,
  costoReceta, foodCostPct, descontarInventario,
};
