'use strict';
// ============================================================================
//  seed_marvin.js — Catálogo de MARVIN PIZZA (tenant #5)
//  Capturado del volante de septiembre 2026.
//
//  Estructura de precios de Marvin: el precio NO depende solo del tamaño, sino
//  del tipo de pizza. Hay cuatro escalas distintas (especialidad, sencilla,
//  marinera, camarón), por eso hay cuatro grupos de "Tamaño" y cada producto
//  usa el que le toca.
//
//  La orilla rellena también cambia con el tamaño, así que va DENTRO del mismo
//  grupo de tamaño: 12 opciones por escala (6 sin orilla + 6 con orilla). De
//  esa forma el cajero elige una sola vez y no puede equivocarse de
//  combinación.
//
//  El 2x1 de Marvin aplica a Especialidades, Sencillas y Mariscos, y NO a las
//  formas especiales ni a los paquetes. Por eso están en categorías separadas:
//  la promoción del sistema trabaja por categoría.
// ============================================================================

const M = require('./model');

// Precio de la orilla rellena y del ingrediente extra, por tamaño
const ORILLA = [65, 78, 90, 110, 128, 154];
const EXTRA = [48, 58, 69, 84, 98, 113];
const TAMANOS = [
  'IND 4 reb (20 cm)',
  'CH 6 reb (25 cm)',
  'MED 8 reb (30 cm)',
  'GDE 8 reb (35 cm)',
  'FAM 10 reb (40 cm)',
  'JUM 12 reb (45 cm)',
];

// Las cuatro escalas de precio, en el orden de TAMANOS
const PRECIOS = {
  especialidad: [150, 199, 295, 379, 462, 525],
  sencilla:     [140, 180, 271, 342, 418, 489],
  marinera:     [276, 349, 475, 571, 691, 803],
  camaron:      [225, 321, 405, 500, 602, 695],
};

function menuMarvin() {
  const categorias = {};
  const gruposModificadores = {};
  const productos = {};
  const promociones = {};

  const cat = (nombre, orden) => {
    const c = M.crearCategoria({ nombre, orden });
    categorias[c.id] = c;
    return c.id;
  };
  const prod = (o) => {
    const p = M.crearProducto(o);
    productos[p.id] = p;
    return p.id;
  };
  const grupo = (nombre, tipo, obligatorio, max, opciones) => {
    const g = M.crearGrupo({
      nombre, tipo, obligatorio, max,
      opciones: opciones.map(([n, d, def]) => M.crearOpcion({ nombre: n, precioDelta: d, porDefecto: !!def })),
    });
    gruposModificadores[g.id] = g;
    return g.id;
  };

  // ---- Grupos de tamaño, uno por escala de precio -------------------------
  //  precioBase del producto = el tamaño IND de su escala. Los deltas son la
  //  diferencia contra ese IND, así el dueño cambia un solo número por
  //  producto si sube precios, o edita el grupo si cambia la escala completa.
  function grupoTamano(etiqueta, escala) {
    const p = PRECIOS[escala];
    const base = p[0];
    const ops = [];
    TAMANOS.forEach((t, i) => ops.push([t, p[i] - base, i === 0]));
    TAMANOS.forEach((t, i) => ops.push([`${t} + orilla rellena de queso`, p[i] - base + ORILLA[i], false]));
    return grupo(`Tamaño — ${etiqueta}`, 'unico', true, null, ops);
  }

  const gTamEsp = grupoTamano('especialidad', 'especialidad');
  const gTamSen = grupoTamano('sencilla', 'sencilla');
  const gTamMar = grupoTamano('marinera', 'marinera');
  const gTamCam = grupoTamano('camarón', 'camaron');

  // Ingrediente extra: también cambia con el tamaño. El cajero elige el que
  // corresponde al tamaño que ya escogió arriba.
  const gExtra = grupo('Ingrediente extra (elige según el tamaño)', 'multiple', false, 4,
    TAMANOS.map((t, i) => [`${t.split(' ')[0]} — ingrediente extra`, EXTRA[i], false]));

  // Sartén o tradicional: mismo precio. Aplica a mediana, grande y familiar.
  const gEstilo = grupo('Estilo de masa', 'unico', false, null, [
    ['Tradicional', 0, true],
    ['En sartén (med, gde y fam)', 0, false],
  ]);

  const gSalsa = grupo('Salsa para boneless', 'unico', true, null, [
    ['Mango habanero', 0, true],
    ['BBQ', 0, false],
    ['Original HOT', 0, false],
  ]);

  // ---- Categorías ----------------------------------------------------------
  //  El orden importa: lo que más se vende, primero.
  const cPaq    = cat('Paquetes', 1);
  const cEsp    = cat('Especialidades', 2);
  const cSen    = cat('Sencillas', 3);
  const cMar    = cat('Mariscos', 4);
  const cFormas = cat('Formas especiales', 5);
  const cSpa    = cat('Espagueti', 6);
  const cBeb    = cat('Bebidas', 7);

  // Mitad y mitad: solo entre pizzas redondas, nunca con formas especiales,
  // paquetes, espagueti ni bebidas.
  const DIV = { maxPartes: 2, excluirCategorias: [cPaq, cFormas, cSpa, cBeb] };

  // ---- Especialidades ------------------------------------------------------
  const esp = (nombre, descripcion, extraGrupos = []) => prod({
    categoriaId: cEsp, nombre, descripcion,
    precioBase: PRECIOS.especialidad[0],
    gruposIds: [gTamEsp, gEstilo, gExtra, ...extraGrupos],
    destino: 'cocina', estacion: 'Pizzas', divisible: DIV, icono: '🍕',
  });

  esp('Marvin Especial', 'Pierna, salchicha, salami, chipotle y aguacate.');
  esp('Carnitas', 'Base de aguacate, carnitas michoacanas 100% originales, cilantro, chile habanero con cebolla y limón.');
  esp('Boneless', 'Tocino y boneless, con la salsa que elijas.', [gSalsa]);
  esp('Hawaiana', 'Jamón y piña.');
  esp('Hawaiana Especial', 'Jamón, piña y cereza.');
  esp('Al Pastor', 'Carne al pastor, piña, cebolla y rajas o chipotle.');
  esp('Mexicana', 'Pierna, pollo, chorizo, jalapeños y aguacate.');
  esp('Mexicana Especial', 'Pierna, pollo, chorizo, jalapeño, elote y aguacate.');
  esp('Combinada', 'Jamón, salami, chorizo, champiñones, pimiento verde y cebolla.');
  esp('Azteca', 'Frijoles, champiñones, aguacate, chorizo y jalapeños.');
  esp('Carnes Frías', 'Pierna, salchicha, jamón, salami y peperoni.');
  esp('Champeroni', 'Champiñones y peperoni.');
  esp('Peperoni', 'Peperoni.');                       // REVISAR precio con Marvin
  esp('Cochinita Pibil', 'Cochinita pibil, cebolla morada y chile habanero.');
  esp('Italiana', 'Salchicha, peperoni y salami.');
  esp('Cubana', 'Pierna, atún, jalapeños, jitomate y aguacate.');
  esp('Vegetariana', 'Champiñones, pimiento verde, cebolla y elote.');
  esp('Chipotluda', 'Pollo, frijoles y chipotle.');
  esp('Clásica Especial', 'Frijoles, salchicha, chorizo y jalapeño.');
  esp('Campirana', 'Frijoles, champiñones, tocino y jalapeño.');
  esp('A Tu Elección', '4 ingredientes de tu elección, excepto mariscos.');

  // ---- Sencillas -----------------------------------------------------------
  const sen = (nombre) => prod({
    categoriaId: cSen, nombre, descripcion: 'Pizza sencilla de un ingrediente.',
    precioBase: PRECIOS.sencilla[0],
    gruposIds: [gTamSen, gEstilo, gExtra],
    destino: 'cocina', estacion: 'Pizzas', divisible: DIV, icono: '🍕',
  });
  ['Queso', 'Salami', 'Jamón', 'Pollo', 'Pierna', 'Chorizo', 'Salchicha', 'Champiñones', 'Atún'].forEach(sen);

  // ---- Mariscos ------------------------------------------------------------
  prod({
    categoriaId: cMar, nombre: 'Marinera',
    descripcion: 'Camarón, atún, pulpo, mejillones, aceitunas y cebolla.',
    precioBase: PRECIOS.marinera[0],
    gruposIds: [gTamMar, gEstilo, gExtra],
    destino: 'cocina', estacion: 'Pizzas', divisible: null, icono: '🦐',
  });
  prod({
    categoriaId: cMar, nombre: 'Camarón', descripcion: 'Camarón.',
    precioBase: PRECIOS.camaron[0],
    gruposIds: [gTamCam, gEstilo, gExtra],
    destino: 'cocina', estacion: 'Pizzas', divisible: null, icono: '🦐',
  });

  // ---- Formas especiales (sin 2x1) ----------------------------------------
  const forma = (nombre, precio, descripcion, partes) => prod({
    categoriaId: cFormas, nombre, precioBase: precio, descripcion,
    gruposIds: [gExtra],
    destino: 'cocina', estacion: 'Pizzas', icono: '⬛',
    divisible: partes ? { maxPartes: partes, excluirCategorias: [cPaq, cFormas, cSpa, cBeb] } : null,
  });
  forma('Cuadrada 16 rebanadas', 376, '45 x 45 cm. No entra en el 2x1.', 2);
  forma('Rectangular 24 rebanadas', 366, '36 x 52 cm. No entra en el 2x1.', 2);
  forma('Barra 12 rebanadas', 215, '18 x 52 cm. No entra en el 2x1.', 2);

  // ---- Paquetes (sin 2x1) --------------------------------------------------
  //  Las pizzas que elija el cliente se anotan en las notas de la línea.
  const paq = (n, precio, descripcion) => prod({
    categoriaId: cPaq, nombre: `Paquete ${n}`, precioBase: precio, descripcion,
    gruposIds: [], destino: 'cocina', estacion: 'Pizzas', divisible: null, icono: '📦',
  });
  paq(1, 345, '2 pizzas hawaianas o peperoni grandes + 2 L de refresco.');
  paq(2, 393, '2 pizzas grandes a elegir (excepto mariscos) + 2 L de refresco.');
  paq(3, 483, '2 pizzas familiares a elegir (excepto mariscos) + 4 L de refresco.');
  paq(4, 535, '3 pizzas grandes a elegir (excepto mariscos) + 4 L de refresco.');
  paq(5, 462, '1 pizza rectangular 36x52 con orilla de queso + 2 L de refresco. Excepto mariscos.');
  paq(6, 483, '1 pizza cuadrada 45x45 con orilla de queso + 2 L de refresco. Excepto mariscos.');
  paq(7, 232, '1 pizza de barra 18x52 con 2 especialidades + 2 L de refresco. Excepto mariscos.');
  paq(8, 289, '1 pizza de corazón de especialidad + 2 L de refresco.');

  // ---- Espagueti -----------------------------------------------------------
  prod({ categoriaId: cSpa, nombre: 'Espagueti rojo gratinado Marvin', precioBase: 160, descripcion: '', gruposIds: [], destino: 'cocina', estacion: 'Cocina', icono: '🍝' });
  prod({ categoriaId: cSpa, nombre: 'Espagueti rojo gratinado con jamón', precioBase: 145, descripcion: '', gruposIds: [], destino: 'cocina', estacion: 'Cocina', icono: '🍝' });
  prod({ categoriaId: cSpa, nombre: 'Espagueti rojo gratinado marinero', precioBase: 285, descripcion: '', gruposIds: [], destino: 'cocina', estacion: 'Cocina', icono: '🍝' });

  // ---- Bebidas (van a barra, no a la pantalla de cocina) -------------------
  const gRefresco = grupo('Sabor', 'unico', true, null, [
    ['Pepsi', 0, true], ['Squirt', 0, false], ['7UP', 0, false],
    ['Mirinda', 0, false], ['Manzanita Sol', 0, false],
  ]);
  prod({ categoriaId: cBeb, nombre: 'Agua 600 ml', precioBase: 16, descripcion: '', gruposIds: [], destino: 'barra', estacion: 'Barra', icono: '💧' });
  prod({ categoriaId: cBeb, nombre: 'Refresco 600 ml', precioBase: 26, descripcion: '', gruposIds: [gRefresco], destino: 'barra', estacion: 'Barra', icono: '🥤' });
  prod({ categoriaId: cBeb, nombre: 'Refresco 2 litros', precioBase: 42, descripcion: '', gruposIds: [gRefresco], destino: 'barra', estacion: 'Barra', icono: '🥤' });

  // ---- 2x1 todos los días --------------------------------------------------
  //  Se regala la más barata de cada par, que es justo como lo anuncia Marvin.
  //  Queda ACTIVA porque para ellos es promoción permanente, no de temporada.
  const p2x1 = M.crearPromocion({
    nombre: '2x1 todos los días',
    tipo: '2x1', valor: 0,
    categorias: [cEsp, cSen, cMar],
  });
  p2x1.activo = true;
  promociones[p2x1.id] = p2x1;

  return { menu: { categorias, gruposModificadores, productos }, insumos: {}, promociones };
}

// Sustituye el catálogo de un documento construido por buildTenantDoc().
// No toca sucursales, mesas, usuarios, caja ni pedidos.
function aplicarMenuMarvin(doc) {
  const m = menuMarvin();
  doc.menu = m.menu;
  doc.insumos = m.insumos;
  doc.promociones = m.promociones;
  doc.meta = doc.meta || {};
  doc.meta.plantilla = 'marvin';
  return doc;
}

module.exports = { menuMarvin, aplicarMenuMarvin };
