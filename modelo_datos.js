// ============================================================================
//  ComandaPro — Modelo de datos  (menú + pedido + caja)
//  Montado sobre la arquitectura JSONB multi-tenant de CobraPro.
//
//  Idea base (igual que CobraPro):
//    - 1 tabla:  comandapro_state(id INT PRIMARY KEY, data JSONB)
//    - 1 fila por tenant (restaurante).  id=0 = fila SYS (catálogo de tenants).
//    - Todo el estado del restaurante vive en data (un documento JSONB).
//    - AsyncLocalStorage resuelve qué tenant es en cada request, igual que hoy.
//
//  Este archivo NO toca la base. Solo define la FORMA del documento y las
//  funciones de fábrica/cálculo. Es el cimiento: si esto queda bien, los
//  endpoints se montan encima sin dolor.
//
//  Para verlo funcionando:   node modelo_datos.js
// ============================================================================

'use strict';

const crypto = require('crypto');
const id = (p) => p + '_' + crypto.randomBytes(4).toString('hex'); // id corto

// ============================================================================
//  1) DOCUMENTO DE ESTADO POR TENANT  (lo que va en data JSONB)
// ============================================================================
//
//  {
//    meta:        { ...identidad del restaurante... },
//    config:      { ...moneda, tipos de servicio, envío... },
//    sucursales:  { [sucId]: { nombre, direccion, activa } },
//    menu: {
//      categorias:          { [catId]: Categoria },
//      gruposModificadores: { [grpId]: GrupoModificador },  // reutilizables
//      productos:           { [prodId]: Producto },
//    },
//    pedidos:     { [folio]: Pedido },     // activos + del turno en curso
//    caja:        { turnos: { [turnoId]: Turno } },
//    secuencias:  { pedido: { [sucId]: N } } // contadores de folio por sucursal
//  }
//
//  NOTA sobre crecimiento: los pedidos cobrados se quedan en el documento
//  solo durante su turno. Al CERRAR un turno, esos pedidos se mueven a un
//  archivo histórico (otra fila/tabla) para que el documento vivo no engorde.
//  Eso lo resolvemos cuando toque; aquí queda señalado.

function estadoInicial(meta = {}) {
  return {
    meta: {
      tenantId: meta.tenantId || id('rest'),
      nombre: meta.nombre || 'Restaurante',
      creado: new Date().toISOString(),
      version: 1,
    },
    config: {
      moneda: 'MXN',
      zonaHoraria: 'America/Mexico_City',
      // Tipos de servicio que maneja el negocio (prende/apaga lo que no uses):
      tiposServicio: ['mostrador', 'domicilio', 'mesa'],
      costoEnvioDefault: 0,        // costo de envío sugerido a domicilio
      ivaIncluido: true,           // en MX el precio de menú normalmente YA trae IVA
      propinaSugerida: [10, 15],   // % sugeridos (informativo)
    },
    sucursales: {},
    menu: {
      categorias: {},
      gruposModificadores: {},
      productos: {},
    },
    pedidos: {},
    caja: { turnos: {} },
    secuencias: { pedido: {} },
  };
}

// ============================================================================
//  2) MENÚ
// ============================================================================

// --- Categoría: Hamburguesas, Bebidas, Postres... ---------------------------
function crearCategoria({ nombre, orden = 0, visible = true }) {
  return {
    id: id('cat'),
    nombre,
    orden,            // para ordenar en pantalla
    visible,          // se puede ocultar sin borrar
  };
}

// --- Opción: una elección dentro de un grupo (ej. "Tocino +$15") ------------
//  precioDelta = cuánto SUMA (o resta) al precio base. 0 = no cambia el precio.
function crearOpcion({ nombre, precioDelta = 0, porDefecto = false, activo = true }) {
  return { id: id('opt'), nombre, precioDelta, porDefecto, activo };
}

// --- Grupo de modificadores: REUTILIZABLE entre productos --------------------
//  tipo 'unico'    -> elige exactamente 1 (Tamaño, Término, Bebida del combo)
//  tipo 'multiple' -> elige varios        (Extras, Quitar ingredientes)
//  min/max aplican a 'multiple'. obligatorio fuerza al menos 1 (o min).
function crearGrupoModificador({ nombre, tipo = 'unico', obligatorio = false, min = 0, max = null, opciones = [] }) {
  return {
    id: id('grp'),
    nombre,
    tipo,
    obligatorio,
    min,
    max,            // null = sin tope
    opciones,       // [ crearOpcion(...) ]
  };
}

// --- Producto ---------------------------------------------------------------
//  gruposIds: qué grupos de modificadores aplican y EN QUÉ ORDEN.
//             Una hamburguesa usa [Tamaño, Término, Extras].
//             Un refresco usa [].
//             Un COMBO usa [Bebida, Acompañamiento] -> el modelo ya lo cubre.
//  destino:   a dónde se imprime la comanda ('cocina' | 'barra').
function crearProducto({ categoriaId, nombre, precioBase, descripcion = '', foto = null, gruposIds = [], destino = 'cocina', activo = true }) {
  return {
    id: id('prod'),
    categoriaId,
    nombre,
    descripcion,
    precioBase,
    foto,
    gruposIds,
    destino,
    activo,
  };
}

// ============================================================================
//  3) PEDIDO
// ============================================================================
//
//  Estados del pedido (flujo):
//    abierto -> en_cocina -> listo -> [en_camino -> entregado] -> cobrado
//                                                        \-> cancelado
//
//  REGLA DE ORO: cada línea guarda un SNAPSHOT del nombre y precio al momento
//  de venderse. Si mañana cambias el precio del menú, los tickets viejos
//  conservan su precio original. Nunca recalcules un pedido contra el menú actual.

function folioPedido(estado, sucId, sucCodigo = 'SUC') {
  estado.secuencias.pedido[sucId] = (estado.secuencias.pedido[sucId] || 0) + 1;
  const n = String(estado.secuencias.pedido[sucId]).padStart(4, '0');
  return `P-${sucCodigo}-${n}`;
}

// --- Línea del pedido: un producto con sus modificadores elegidos -----------
//  Recibe el producto y la lista de opciones elegidas (ya resueltas del menú).
function crearLinea(producto, { cantidad = 1, modificadores = [], notas = '' } = {}) {
  // modificadores = [ { grupoId, grupoNombre, opcionId, opcionNombre, precioDelta } ]
  const deltas = modificadores.reduce((s, m) => s + (m.precioDelta || 0), 0);
  const precioUnitario = +(producto.precioBase + deltas).toFixed(2);
  return {
    id: id('ln'),
    productoId: producto.id,
    nombre: producto.nombre,      // SNAPSHOT
    cantidad,
    precioUnitario,               // SNAPSHOT (base + modificadores)
    modificadores,                // SNAPSHOT de las elecciones
    notas,                        // "bien cocida, sin sal"
    importe: +(precioUnitario * cantidad).toFixed(2),
  };
}

// --- Pedido ------------------------------------------------------------------
function crearPedido(estado, { sucursalId, sucCodigo, tipoServicio = 'mostrador', mesa = null, cliente = null, usuario = 'sistema', turnoId = null }) {
  const folio = folioPedido(estado, sucursalId, sucCodigo);
  const ped = {
    folio,
    sucursalId,
    tipoServicio,                 // 'mostrador' | 'domicilio' | 'mesa'
    estado: 'abierto',
    mesa,                         // id de mesa si aplica
    cliente,                      // { nombre, telefono, direccion, referencias } para domicilio
    lineas: [],
    subtotal: 0,
    costoEnvio: 0,
    descuento: null,              // { tipo:'monto'|'porcentaje', valor, motivo }
    propina: 0,
    total: 0,
    pago: null,                   // se llena al cobrar (ver registrarPago)
    turnoId,                      // a qué turno de caja pertenece
    creadoPor: usuario,
    creado: new Date().toISOString(),
    actualizado: new Date().toISOString(),
    tiemposCocina: { recibido: null, iniciado: null, listo: null }, // para el KDS
  };
  estado.pedidos[folio] = ped;
  return ped;
}

// --- Recalcular totales del pedido ------------------------------------------
function recalcularPedido(ped) {
  ped.subtotal = +ped.lineas.reduce((s, l) => s + l.importe, 0).toFixed(2);
  let desc = 0;
  if (ped.descuento) {
    desc = ped.descuento.tipo === 'porcentaje'
      ? ped.subtotal * (ped.descuento.valor / 100)
      : ped.descuento.valor;
  }
  ped.total = +(ped.subtotal + (ped.costoEnvio || 0) - desc + (ped.propina || 0)).toFixed(2);
  ped.actualizado = new Date().toISOString();
  return ped;
}

// --- Cobrar el pedido --------------------------------------------------------
//  pagos = [ { metodo:'efectivo'|'tarjeta'|'transferencia', monto } ]
//  recibido = efectivo entregado por el cliente (para calcular cambio).
function registrarPago(ped, { pagos = [], recibido = 0 } = {}) {
  const pagadoEfectivo = pagos.filter(p => p.metodo === 'efectivo').reduce((s, p) => s + p.monto, 0);
  const cambio = recibido > 0 ? +(recibido - pagadoEfectivo).toFixed(2) : 0;
  ped.pago = {
    pagos,
    recibido,
    cambio: cambio > 0 ? cambio : 0,
    metodo: pagos.length === 1 ? pagos[0].metodo : 'mixto',
  };
  ped.estado = 'cobrado';
  ped.actualizado = new Date().toISOString();
  return ped;
}

// ============================================================================
//  4) CAJA  (turno con fondo + movimientos + cierre con detección de faltante)
// ============================================================================

// --- Abrir turno: el cajero declara el FONDO de cambio ----------------------
function abrirTurno(estado, { sucursalId, usuario, fondoInicial = 0 }) {
  const turnoId = id('turno');
  const turno = {
    id: turnoId,
    sucursalId,
    estado: 'abierto',
    abiertoPor: usuario,
    abierto: new Date().toISOString(),
    fondoInicial,
    movimientos: [],
    // se llenan al cerrar:
    cerradoPor: null,
    cerrado: null,
    esperado: null,      // lo que el sistema dice que DEBE haber
    conteo: null,        // lo que el cajero contó físicamente
    diferencia: null,    // conteo - esperado  (negativo = FALTANTE)
  };
  // Movimiento de apertura (deja rastro del fondo)
  turno.movimientos.push(movimiento({ tipo: 'apertura', monto: fondoInicial, metodoPago: 'efectivo', usuario, motivo: 'Fondo inicial' }));
  estado.caja.turnos[turnoId] = turno;
  return turno;
}

// --- Movimiento de caja ------------------------------------------------------
//  tipo: 'apertura' | 'venta' | 'entrada' | 'salida'
//    venta   -> dinero que entra por un pedido
//    entrada -> dinero que entra por otra razón (ej. préstamo de cambio)
//    salida  -> dinero que SALE de la caja (pagar al repartidor, comprar hielo)
function movimiento({ tipo, monto, metodoPago = 'efectivo', usuario = 'sistema', motivo = '', pedidoFolio = null }) {
  return {
    id: id('mov'),
    tipo,
    monto: +(+monto).toFixed(2),
    metodoPago,           // efectivo | tarjeta | transferencia
    motivo,
    pedidoFolio,
    usuario,
    timestamp: new Date().toISOString(),
  };
}

// --- Al cobrar un pedido, registrar su(s) movimiento(s) en el turno ---------
function registrarVentaEnTurno(turno, ped) {
  for (const p of ped.pago.pagos) {
    turno.movimientos.push(movimiento({
      tipo: 'venta',
      monto: p.monto,
      metodoPago: p.metodo,
      pedidoFolio: ped.folio,
      usuario: ped.creadoPor,
      motivo: `Venta ${ped.folio}`,
    }));
  }
  return turno;
}

// --- Cerrar turno: el cajero cuenta el efectivo y el sistema detecta faltante
function cerrarTurno(turno, { usuario, conteoEfectivo }) {
  const mov = turno.movimientos;
  const sum = (f) => mov.filter(f).reduce((s, m) => s + m.monto, 0);

  const ventasEfectivo = sum(m => m.tipo === 'venta'   && m.metodoPago === 'efectivo');
  const ventasTarjeta  = sum(m => m.tipo === 'venta'   && m.metodoPago === 'tarjeta');
  const ventasTransf   = sum(m => m.tipo === 'venta'   && m.metodoPago === 'transferencia');
  const entradas       = sum(m => m.tipo === 'entrada');
  const salidas        = sum(m => m.tipo === 'salida');

  // Efectivo que DEBERÍA haber en el cajón:
  const esperadoEfectivo = +(turno.fondoInicial + ventasEfectivo + entradas - salidas).toFixed(2);
  const diferencia = +(conteoEfectivo - esperadoEfectivo).toFixed(2);

  turno.estado = 'cerrado';
  turno.cerradoPor = usuario;
  turno.cerrado = new Date().toISOString();
  turno.conteo = conteoEfectivo;
  turno.esperado = {
    efectivo: esperadoEfectivo,
    tarjeta: ventasTarjeta,
    transferencia: ventasTransf,
    ventaTotal: +(ventasEfectivo + ventasTarjeta + ventasTransf).toFixed(2),
    fondoInicial: turno.fondoInicial,
    entradas, salidas,
  };
  turno.diferencia = diferencia; // 0 = cuadrado, <0 = faltante, >0 = sobrante
  turno.resultado = diferencia === 0 ? 'cuadrado' : (diferencia < 0 ? 'faltante' : 'sobrante');
  return turno;
}

// ============================================================================
//  5) SEED de ejemplo: "Jefe Burgers"
// ============================================================================

function seedJefeBurgers() {
  const e = estadoInicial({ nombre: 'Jefe Burgers' });

  // --- Sucursal ---
  const sucId = id('suc');
  e.sucursales[sucId] = { nombre: 'Centro', direccion: 'Av. Juárez 100', activa: true, codigo: 'CENTRO' };

  // --- Grupos de modificadores REUTILIZABLES ---
  const gTamano = crearGrupoModificador({
    nombre: 'Tamaño', tipo: 'unico', obligatorio: true,
    opciones: [
      crearOpcion({ nombre: 'Sencilla', precioDelta: 0, porDefecto: true }),
      crearOpcion({ nombre: 'Doble carne', precioDelta: 35 }),
    ],
  });
  const gTermino = crearGrupoModificador({
    nombre: 'Término', tipo: 'unico', obligatorio: true,
    opciones: [
      crearOpcion({ nombre: 'Tres cuartos', porDefecto: true }),
      crearOpcion({ nombre: 'Bien cocida' }),
    ],
  });
  const gExtras = crearGrupoModificador({
    nombre: 'Extras', tipo: 'multiple', obligatorio: false, min: 0, max: 5,
    opciones: [
      crearOpcion({ nombre: 'Tocino', precioDelta: 15 }),
      crearOpcion({ nombre: 'Queso extra', precioDelta: 12 }),
      crearOpcion({ nombre: 'Aguacate', precioDelta: 18 }),
    ],
  });
  const gQuitar = crearGrupoModificador({
    nombre: 'Quitar', tipo: 'multiple', obligatorio: false,
    opciones: [
      crearOpcion({ nombre: 'Sin cebolla' }),
      crearOpcion({ nombre: 'Sin jitomate' }),
    ],
  });
  const gBebidaCombo = crearGrupoModificador({
    nombre: 'Bebida del combo', tipo: 'unico', obligatorio: true,
    opciones: [
      crearOpcion({ nombre: 'Refresco', porDefecto: true }),
      crearOpcion({ nombre: 'Agua fresca' }),
    ],
  });
  for (const g of [gTamano, gTermino, gExtras, gQuitar, gBebidaCombo]) e.menu.gruposModificadores[g.id] = g;

  // --- Categorías ---
  const cBurgers = crearCategoria({ nombre: 'Hamburguesas', orden: 1 });
  const cBebidas = crearCategoria({ nombre: 'Bebidas', orden: 2 });
  for (const c of [cBurgers, cBebidas]) e.menu.categorias[c.id] = c;

  // --- Productos ---
  // Hamburguesa: usa Tamaño + Término + Extras + Quitar
  const pClasica = crearProducto({
    categoriaId: cBurgers.id, nombre: 'Hamburguesa clásica', precioBase: 95, destino: 'cocina',
    gruposIds: [gTamano.id, gTermino.id, gExtras.id, gQuitar.id],
  });
  // COMBO: el mismo modelo, solo agrega el grupo de bebida obligatoria
  const pCombo = crearProducto({
    categoriaId: cBurgers.id, nombre: 'Combo clásica + papas', precioBase: 135, destino: 'cocina',
    gruposIds: [gTamano.id, gTermino.id, gExtras.id, gBebidaCombo.id],
  });
  // Refresco: sin modificadores, va a barra
  const pRefresco = crearProducto({
    categoriaId: cBebidas.id, nombre: 'Refresco 600ml', precioBase: 25, destino: 'barra',
    gruposIds: [],
  });
  for (const p of [pClasica, pCombo, pRefresco]) e.menu.productos[p.id] = p;

  return { estado: e, sucId, sucCodigo: 'CENTRO', refs: { pClasica, pCombo, pRefresco, gTamano, gExtras } };
}

// ============================================================================
//  6) DEMO  (node modelo_datos.js)  — pedido real + cobro + cierre de caja
// ============================================================================

if (require.main === module) {
  const { estado, sucId, sucCodigo, refs } = seedJefeBurgers();
  const cajero = 'jefe_centro';

  // 1) Abrir turno con $500 de fondo
  const turno = abrirTurno(estado, { sucursalId: sucId, usuario: cajero, fondoInicial: 500 });

  // 2) Levantar un pedido de mostrador
  const ped = crearPedido(estado, { sucursalId: sucId, sucCodigo, tipoServicio: 'mostrador', usuario: cajero, turnoId: turno.id });

  // Línea 1: hamburguesa doble, con tocino, bien cocida
  ped.lineas.push(crearLinea(refs.pClasica, {
    cantidad: 1,
    modificadores: [
      { grupoId: refs.gTamano.id, grupoNombre: 'Tamaño', opcionId: 'x', opcionNombre: 'Doble carne', precioDelta: 35 },
      { grupoId: refs.gExtras.id, grupoNombre: 'Extras', opcionId: 'y', opcionNombre: 'Tocino', precioDelta: 15 },
    ],
    notas: 'Bien cocida',
  }));
  // Línea 2: un refresco
  ped.lineas.push(crearLinea(refs.pRefresco, { cantidad: 1 }));

  recalcularPedido(ped);

  // 3) Cobrar: paga $200 en efectivo
  registrarPago(ped, { pagos: [{ metodo: 'efectivo', monto: ped.total }], recibido: 200 });
  registrarVentaEnTurno(turno, ped);

  // 4) Cerrar turno: el cajero cuenta el cajón y declara $645 (debería haber 650)
  cerrarTurno(turno, { usuario: cajero, conteoEfectivo: 645 });

  // --- Imprimir resultado ---
  console.log('\n=== TICKET ' + ped.folio + ' (' + ped.tipoServicio + ') ===');
  for (const l of ped.lineas) {
    console.log(`  ${l.cantidad}x ${l.nombre}  $${l.importe.toFixed(2)}`);
    for (const m of l.modificadores) console.log(`       + ${m.opcionNombre} ($${m.precioDelta})`);
    if (l.notas) console.log(`       * ${l.notas}`);
  }
  console.log(`  Subtotal: $${ped.subtotal.toFixed(2)}`);
  console.log(`  TOTAL:    $${ped.total.toFixed(2)}`);
  console.log(`  Pago: $${ped.pago.recibido} efectivo  ->  cambio $${ped.pago.cambio}`);

  console.log('\n=== CORTE DE TURNO ===');
  console.log(`  Fondo inicial:      $${turno.fondoInicial.toFixed(2)}`);
  console.log(`  Ventas efectivo:    $${(turno.esperado.efectivo - turno.fondoInicial).toFixed(2)}`);
  console.log(`  Esperado en cajón:  $${turno.esperado.efectivo.toFixed(2)}`);
  console.log(`  Contado por cajero: $${turno.conteo.toFixed(2)}`);
  console.log(`  Diferencia:         $${turno.diferencia.toFixed(2)}  -> ${turno.resultado.toUpperCase()}`);
  console.log('');
}

module.exports = {
  estadoInicial,
  crearCategoria, crearOpcion, crearGrupoModificador, crearProducto,
  folioPedido, crearLinea, crearPedido, recalcularPedido, registrarPago,
  abrirTurno, movimiento, registrarVentaEnTurno, cerrarTurno,
  seedJefeBurgers,
};
