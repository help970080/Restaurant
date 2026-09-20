'use strict';
// ============================================================================
//  seed_pizzeria.js — Catálogo inicial para tenants de PIZZERÍA
//
//  No construye el documento completo del tenant: eso lo sigue haciendo
//  buildTenantDoc() de seed.js, que ya sabe armar sucursales, mesas, config y
//  usuarios. Aquí solo se reemplaza el MENÚ, los INSUMOS y las PROMOCIONES,
//  igual que hace /api/admin/recargar-menu. Así el alta pública no depende de
//  que yo adivine la forma interna del resto del documento.
//
//  Precios y costos son de arranque: el dueño los edita desde Menú > Productos
//  y con /api/menu/precios/aplicar. Están puestos para que al entrar vea algo
//  que se parece a su negocio, no una pantalla vacía.
// ============================================================================

const M = require('./model');

function menuPizzeria() {
  const categorias = {};
  const gruposModificadores = {};
  const productos = {};
  const insumos = {};
  const promociones = {};

  const cat = (nombre, orden) => {
    const c = M.crearCategoria({ nombre, orden });
    categorias[c.id] = c;
    return c.id;
  };
  const ins = (nombre, unidad, costoUnitario, stockMin) => {
    const i = M.crearInsumo({ nombre, unidad, stock: 0, costoUnitario, stockMin });
    insumos[i.id] = i;
    return i.id;
  };
  const grupo = (nombre, tipo, obligatorio, max, opciones) => {
    const g = M.crearGrupo({
      nombre, tipo, obligatorio, max,
      opciones: opciones.map(([n, d, def]) => M.crearOpcion({ nombre: n, precioDelta: d, porDefecto: !!def })),
    });
    gruposModificadores[g.id] = g;
    return g.id;
  };
  const prod = (o) => {
    const p = M.crearProducto(o);
    productos[p.id] = p;
    return p.id;
  };

  // ---- Insumos --------------------------------------------------------------
  const iMasa    = ins('Harina para masa', 'kg', 22, 25);
  const iQueso   = ins('Queso mozzarella', 'kg', 145, 10);
  const iSalsa   = ins('Salsa de tomate', 'L', 38, 8);
  const iPepp    = ins('Pepperoni', 'kg', 180, 3);
  const iJamon   = ins('Jamón', 'kg', 95, 3);
  const iPina    = ins('Piña en almíbar', 'kg', 32, 4);
  const iChamp   = ins('Champiñón', 'kg', 60, 2);
  const iChorizo = ins('Chorizo', 'kg', 110, 2);
  const iCarnita = ins('Carnitas', 'kg', 180, 2);
  const iTocino  = ins('Tocino', 'kg', 150, 2);
  const iPimien  = ins('Pimiento morrón', 'kg', 40, 2);
  const iCebolla = ins('Cebolla', 'kg', 25, 3);
  const iJalap   = ins('Jalapeño', 'kg', 35, 2);
  const iAceit   = ins('Aceituna', 'kg', 120, 1);
  const iSalami  = ins('Salami', 'kg', 160, 2);
  const iQCrema  = ins('Queso crema', 'kg', 130, 2);
  const iCaja    = ins('Caja para pizza', 'pieza', 5.5, 100);
  const iRef600  = ins('Refresco 600 ml', 'pieza', 12, 24);
  const iRef2L   = ins('Refresco 2 L', 'pieza', 26, 12);
  const iAgua    = ins('Agua 600 ml', 'pieza', 7, 24);
  const iPapa    = ins('Papa gajo', 'kg', 45, 5);
  const iBonel   = ins('Boneless', 'kg', 130, 5);
  const iAlitas  = ins('Alitas', 'kg', 95, 5);
  const iBaguet  = ins('Baguette', 'pieza', 14, 10);
  const iNutella = ins('Avellana / Nutella', 'kg', 210, 1);
  const iMante   = ins('Mantequilla con ajo', 'kg', 90, 1);

  // ---- Categorías -----------------------------------------------------------
  const cEspec  = cat('Especialidades', 1);
  const cArma   = cat('Arma tu pizza', 2);
  const cComple = cat('Complementos', 3);
  const cAlitas = cat('Alitas y boneless', 4);
  const cBebida = cat('Bebidas', 5);
  const cPostre = cat('Postres', 6);

  // ---- Grupos de modificadores ---------------------------------------------
  //  El precio base de cada especialidad es el de la MEDIANA. Los demás tamaños
  //  se mueven con el delta, así el dueño ajusta un solo número por producto.
  const gTam = grupo('Tamaño', 'unico', true, null, [
    ['Chica (4 rebanadas)', -60, false],
    ['Mediana (6 rebanadas)', 0, true],
    ['Grande (8 rebanadas)', 70, false],
    ['Familiar (12 rebanadas)', 130, false],
  ]);
  const gOrilla = grupo('Orilla', 'unico', false, null, [
    ['Orilla normal', 0, true],
    ['Orilla rellena de queso', 45, false],
    ['Orilla rellena de queso crema', 60, false],
  ]);
  const gExtras = grupo('Ingredientes extra', 'multiple', false, 4, [
    ['Queso extra', 25, false],
    ['Tocino', 25, false],
    ['Champiñón', 18, false],
    ['Piña', 15, false],
    ['Jalapeño', 10, false],
    ['Cebolla', 8, false],
    ['Aceituna', 15, false],
    ['Orégano', 0, false],
  ]);
  const gCoccion = grupo('Preparación', 'unico', false, null, [
    ['Normal', 0, true],
    ['Bien cocida', 0, false],
    ['Sin cebolla', 0, false],
    ['Partida en cuadros', 0, false],
  ]);
  const gSalsaAla = grupo('Salsa', 'unico', true, null, [
    ['BBQ', 0, true],
    ['Búfalo', 0, false],
    ['Mango habanero', 0, false],
    ['Ajo parmesano', 10, false],
  ]);

  // Base de masa, salsa, queso y caja que lleva toda pizza mediana
  const BASE = [
    { insumoId: iMasa, cantidad: 0.35 },
    { insumoId: iSalsa, cantidad: 0.08 },
    { insumoId: iQueso, cantidad: 0.18 },
    { insumoId: iCaja, cantidad: 1 },
  ];
  const receta = (...extras) => BASE.concat(extras);

  // ---- Especialidades -------------------------------------------------------
  //  divisible: se puede pedir mitad y mitad con cualquier otra especialidad.
  //  El precio NO cambia: es el de la pizza elegida. Eso ya lo resuelve
  //  armarPartes() en model.js.
  const DIV = { maxPartes: 2, excluirCategorias: [cBebida, cPostre, cComple, cAlitas] };

  const espec = (nombre, precioBase, descripcion, extras, icono) => prod({
    categoriaId: cEspec, nombre, precioBase, descripcion, icono,
    gruposIds: [gTam, gOrilla, gExtras, gCoccion],
    destino: 'cocina', estacion: 'Pizzas',
    receta: receta(...extras),
    divisible: DIV,
  });

  espec('Pepperoni', 179, 'Queso mozzarella y pepperoni.', [{ insumoId: iPepp, cantidad: 0.09 }], '🍕');
  espec('Hawaiana', 179, 'Jamón y piña.', [{ insumoId: iJamon, cantidad: 0.09 }, { insumoId: iPina, cantidad: 0.08 }], '🍍');
  espec('Mexicana', 189, 'Chorizo, jalapeño, cebolla y pimiento.', [
    { insumoId: iChorizo, cantidad: 0.08 }, { insumoId: iJalap, cantidad: 0.03 },
    { insumoId: iCebolla, cantidad: 0.04 }, { insumoId: iPimien, cantidad: 0.04 },
  ], '🌶️');
  espec('Carnes frías', 199, 'Jamón, salami y pepperoni.', [
    { insumoId: iJamon, cantidad: 0.06 }, { insumoId: iSalami, cantidad: 0.05 }, { insumoId: iPepp, cantidad: 0.05 },
  ], '🥓');
  espec('Vegetariana', 179, 'Champiñón, pimiento, cebolla y aceituna.', [
    { insumoId: iChamp, cantidad: 0.07 }, { insumoId: iPimien, cantidad: 0.05 },
    { insumoId: iCebolla, cantidad: 0.05 }, { insumoId: iAceit, cantidad: 0.03 },
  ], '🥬');
  espec('Carnitas', 209, 'Carnitas, cebolla y cilantro.', [
    { insumoId: iCarnita, cantidad: 0.1 }, { insumoId: iCebolla, cantidad: 0.04 },
  ], '🐖');
  espec('Tres quesos', 199, 'Mozzarella, queso crema y parmesano.', [
    { insumoId: iQueso, cantidad: 0.09 }, { insumoId: iQCrema, cantidad: 0.06 },
  ], '🧀');
  espec('Suprema', 219, 'Pepperoni, champiñón, pimiento, cebolla y aceituna.', [
    { insumoId: iPepp, cantidad: 0.05 }, { insumoId: iChamp, cantidad: 0.05 },
    { insumoId: iPimien, cantidad: 0.04 }, { insumoId: iCebolla, cantidad: 0.03 }, { insumoId: iAceit, cantidad: 0.03 },
  ], '⭐');
  espec('Tocino y piña', 189, 'Tocino crujiente con piña.', [
    { insumoId: iTocino, cantidad: 0.08 }, { insumoId: iPina, cantidad: 0.07 },
  ], '🥓');

  // ---- Arma tu pizza --------------------------------------------------------
  prod({
    categoriaId: cArma, nombre: 'Pizza al gusto', precioBase: 169,
    descripcion: 'Queso y salsa. Agrega los ingredientes que quieras.',
    gruposIds: [gTam, gOrilla, gExtras, gCoccion],
    destino: 'cocina', estacion: 'Pizzas', receta: receta(), divisible: DIV, icono: '🛠️',
  });
  prod({
    categoriaId: cArma, nombre: 'Mega pizza 2 sabores', precioBase: 349,
    descripcion: '16 rebanadas. Elige dos especialidades, mitad y mitad.',
    gruposIds: [gOrilla, gExtras, gCoccion],
    destino: 'cocina', estacion: 'Pizzas',
    receta: [
      { insumoId: iMasa, cantidad: 0.7 }, { insumoId: iSalsa, cantidad: 0.16 },
      { insumoId: iQueso, cantidad: 0.36 }, { insumoId: iCaja, cantidad: 1 },
    ],
    divisible: { maxPartes: 2, excluirCategorias: [cBebida, cPostre, cComple, cAlitas] },
    icono: '🍕',
  });
  prod({
    categoriaId: cArma, nombre: 'Barra familiar 4 sabores', precioBase: 429,
    descripcion: 'Rectangular. Hasta cuatro especialidades distintas.',
    gruposIds: [gOrilla, gExtras, gCoccion],
    destino: 'cocina', estacion: 'Pizzas',
    receta: [
      { insumoId: iMasa, cantidad: 0.85 }, { insumoId: iSalsa, cantidad: 0.2 },
      { insumoId: iQueso, cantidad: 0.45 }, { insumoId: iCaja, cantidad: 1 },
    ],
    divisible: { maxPartes: 4, excluirCategorias: [cBebida, cPostre, cComple, cAlitas] },
    icono: '📐',
  });

  // ---- Complementos ---------------------------------------------------------
  prod({ categoriaId: cComple, nombre: 'Pan de ajo', precioBase: 69, descripcion: 'Con mantequilla de ajo y queso gratinado.',
    gruposIds: [], destino: 'cocina', estacion: 'Pizzas', icono: '🥖',
    receta: [{ insumoId: iBaguet, cantidad: 1 }, { insumoId: iMante, cantidad: 0.03 }, { insumoId: iQueso, cantidad: 0.05 }] });
  prod({ categoriaId: cComple, nombre: 'Papas gajo', precioBase: 75, descripcion: 'Orden grande con aderezo.',
    gruposIds: [], destino: 'cocina', estacion: 'Freidora', icono: '🍟',
    receta: [{ insumoId: iPapa, cantidad: 0.3 }] });
  prod({ categoriaId: cComple, nombre: 'Ensalada César', precioBase: 89, descripcion: 'Lechuga, crutones y aderezo.',
    gruposIds: [], destino: 'cocina', estacion: 'Cocina', icono: '🥗', receta: [] });

  // ---- Alitas y boneless ----------------------------------------------------
  prod({ categoriaId: cAlitas, nombre: 'Boneless 500 g', precioBase: 159, descripcion: 'Con papas y aderezo.',
    gruposIds: [gSalsaAla], destino: 'cocina', estacion: 'Freidora', icono: '🍗',
    receta: [{ insumoId: iBonel, cantidad: 0.5 }, { insumoId: iPapa, cantidad: 0.1 }] });
  prod({ categoriaId: cAlitas, nombre: 'Alitas 12 piezas', precioBase: 179, descripcion: 'Con apio y aderezo.',
    gruposIds: [gSalsaAla], destino: 'cocina', estacion: 'Freidora', icono: '🍗',
    receta: [{ insumoId: iAlitas, cantidad: 0.8 }] });

  // ---- Bebidas (van a barra, no a la pantalla de cocina) --------------------
  prod({ categoriaId: cBebida, nombre: 'Refresco 600 ml', precioBase: 28, descripcion: '',
    gruposIds: [], destino: 'barra', estacion: 'Barra', icono: '🥤', receta: [{ insumoId: iRef600, cantidad: 1 }] });
  prod({ categoriaId: cBebida, nombre: 'Refresco 2 litros', precioBase: 55, descripcion: '',
    gruposIds: [], destino: 'barra', estacion: 'Barra', icono: '🥤', receta: [{ insumoId: iRef2L, cantidad: 1 }] });
  prod({ categoriaId: cBebida, nombre: 'Agua embotellada', precioBase: 18, descripcion: '',
    gruposIds: [], destino: 'barra', estacion: 'Barra', icono: '💧', receta: [{ insumoId: iAgua, cantidad: 1 }] });

  // ---- Postres --------------------------------------------------------------
  prod({ categoriaId: cPostre, nombre: 'Pizza de avellana', precioBase: 129, descripcion: 'Masa dulce con avellana y plátano.',
    gruposIds: [], destino: 'cocina', estacion: 'Pizzas', icono: '🍫',
    receta: [{ insumoId: iMasa, cantidad: 0.25 }, { insumoId: iNutella, cantidad: 0.08 }, { insumoId: iCaja, cantidad: 1 }] });
  prod({ categoriaId: cPostre, nombre: 'Pay de queso', precioBase: 59, descripcion: 'Rebanada individual.',
    gruposIds: [], destino: 'barra', estacion: 'Barra', icono: '🍰', receta: [] });

  // ---- Promoción 2x1 (apagada) ---------------------------------------------
  //  Se deja creada y APAGADA: que el dueño la prenda cuando quiera, no que le
  //  aparezcan descuentos el primer día sin haberlos pedido.
  const p2x1 = M.crearPromocion({ nombre: '2x1 en especialidades', tipo: '2x1', valor: 0, categorias: [cEspec] });
  p2x1.activo = false;
  promociones[p2x1.id] = p2x1;

  const pMartes = M.crearPromocion({ nombre: 'Martes de pizza -20%', tipo: 'porcentaje', valor: 20, categorias: [cEspec, cArma] });
  pMartes.activo = false;
  promociones[pMartes.id] = pMartes;

  return { menu: { categorias, gruposModificadores, productos }, insumos, promociones };
}

// Sustituye el catálogo de un documento ya construido por buildTenantDoc().
// No toca sucursales, mesas, usuarios, caja ni nada de la operación.
function aplicarMenuPizzeria(doc) {
  const m = menuPizzeria();
  doc.menu = m.menu;
  doc.insumos = m.insumos;
  doc.promociones = m.promociones;
  doc.meta = doc.meta || {};
  doc.meta.plantilla = 'pizzeria';
  return doc;
}

module.exports = { menuPizzeria, aplicarMenuPizzeria };
