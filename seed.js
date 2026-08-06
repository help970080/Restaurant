'use strict';
// ============================================================================
//  seed.js — Construye el documento inicial de un tenant (catálogo real,
//  sin ventas de demo). Lo usa /api/admin/provision.
// ============================================================================

const M = require('./model');

function buildTenantDoc(nombre = 'Jefe Burgers') {
  const e = M.estadoInicial({ nombre });

  // Sucursales
  const a = { id: M.uid('suc'), nombre: 'Centro', codigo: 'CENTRO', activa: true };
  const b = { id: M.uid('suc'), nombre: 'Sur', codigo: 'SUR', activa: true };
  e.sucursales[a.id] = a; e.sucursales[b.id] = b;

  // Insumos
  const ins = {
    pan: M.crearInsumo({ nombre: 'Pan brioche', unidad: 'pza', stock: 120, costoUnitario: 6, stockMin: 40 }),
    carne: M.crearInsumo({ nombre: 'Carne 150g', unidad: 'pza', stock: 90, costoUnitario: 22, stockMin: 30 }),
    queso: M.crearInsumo({ nombre: 'Queso amarillo', unidad: 'reb', stock: 200, costoUnitario: 3.5, stockMin: 50 }),
    tocino: M.crearInsumo({ nombre: 'Tocino', unidad: 'tira', stock: 80, costoUnitario: 4, stockMin: 30 }),
    papas: M.crearInsumo({ nombre: 'Papas (orden)', unidad: 'orden', stock: 60, costoUnitario: 9, stockMin: 25 }),
    refresco: M.crearInsumo({ nombre: 'Refresco lata', unidad: 'pza', stock: 100, costoUnitario: 8, stockMin: 30 }),
    bbq: M.crearInsumo({ nombre: 'Salsa BBQ', unidad: 'porc', stock: 70, costoUnitario: 2.5, stockMin: 20 }),
  };
  Object.values(ins).forEach((i) => (e.insumos[i.id] = i));

  // Grupos de modificadores
  const gTam = M.crearGrupo({ nombre: 'Tamaño', obligatorio: true, opciones: [M.crearOpcion({ nombre: 'Sencilla', porDefecto: true }), M.crearOpcion({ nombre: 'Doble carne', precioDelta: 35 })] });
  const gTer = M.crearGrupo({ nombre: 'Término', obligatorio: true, opciones: [M.crearOpcion({ nombre: 'Tres cuartos', porDefecto: true }), M.crearOpcion({ nombre: 'Bien cocida' })] });
  const gExt = M.crearGrupo({ nombre: 'Extras', tipo: 'multiple', max: 5, opciones: [M.crearOpcion({ nombre: 'Tocino', precioDelta: 15 }), M.crearOpcion({ nombre: 'Queso extra', precioDelta: 12 }), M.crearOpcion({ nombre: 'Aguacate', precioDelta: 18 })] });
  const gQui = M.crearGrupo({ nombre: 'Quitar', tipo: 'multiple', opciones: [M.crearOpcion({ nombre: 'Sin cebolla' }), M.crearOpcion({ nombre: 'Sin jitomate' })] });
  const gBeb = M.crearGrupo({ nombre: 'Bebida del combo', obligatorio: true, opciones: [M.crearOpcion({ nombre: 'Refresco', porDefecto: true }), M.crearOpcion({ nombre: 'Agua fresca' })] });
  [gTam, gTer, gExt, gQui, gBeb].forEach((g) => (e.menu.gruposModificadores[g.id] = g));

  // Categorías
  const cB = M.crearCategoria({ nombre: 'Hamburguesas', orden: 1 });
  const cD = M.crearCategoria({ nombre: 'Bebidas', orden: 2 });
  const cP = M.crearCategoria({ nombre: 'Acompañamientos', orden: 3 });
  [cB, cD, cP].forEach((c) => (e.menu.categorias[c.id] = c));

  // Productos (con receta)
  const prods = [
    M.crearProducto({ categoriaId: cB.id, nombre: 'Hamburguesa clásica', precioBase: 95, gruposIds: [gTam.id, gTer.id, gExt.id, gQui.id], receta: [{ insumoId: ins.pan.id, cantidad: 1 }, { insumoId: ins.carne.id, cantidad: 1 }, { insumoId: ins.queso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cB.id, nombre: 'BBQ tocino', precioBase: 115, gruposIds: [gTam.id, gTer.id, gExt.id, gQui.id], receta: [{ insumoId: ins.pan.id, cantidad: 1 }, { insumoId: ins.carne.id, cantidad: 1 }, { insumoId: ins.queso.id, cantidad: 1 }, { insumoId: ins.tocino.id, cantidad: 2 }, { insumoId: ins.bbq.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cB.id, nombre: 'Combo clásica + papas', precioBase: 135, gruposIds: [gTam.id, gTer.id, gExt.id, gBeb.id], receta: [{ insumoId: ins.pan.id, cantidad: 1 }, { insumoId: ins.carne.id, cantidad: 1 }, { insumoId: ins.queso.id, cantidad: 1 }, { insumoId: ins.papas.id, cantidad: 1 }, { insumoId: ins.refresco.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cD.id, nombre: 'Refresco 600ml', precioBase: 25, destino: 'barra', receta: [{ insumoId: ins.refresco.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cD.id, nombre: 'Agua fresca 500ml', precioBase: 22, destino: 'barra', receta: [] }),
    M.crearProducto({ categoriaId: cP.id, nombre: 'Papas a la francesa', precioBase: 45, receta: [{ insumoId: ins.papas.id, cantidad: 1 }] }),
  ];
  prods.forEach((p) => (e.menu.productos[p.id] = p));

  // Promoción de ejemplo
  const promo = M.crearPromocion({ nombre: 'Descuento 10%', tipo: 'porcentaje', valor: 10 });
  e.promociones[promo.id] = promo;

  // Canales de venta / delivery (México)
  e.config.canales = M.canalesDefault();

  // Mesas (6 por sucursal)
  for (const suc of [a, b]) for (let i = 1; i <= 6; i++) { const m = M.crearMesa({ nombre: 'Mesa ' + i, sucursalId: suc.id }); e.mesas[m.id] = m; }

  return e;
}

// ============================================================================
//  Plantilla NEVERÍA — Hawaiian Paradise (Cocoyoc)
//  Catálogo tomado de sus pizarrones: raspados, smoothies, aguas, crepas
//  y botanas. Dos estaciones de producción: Barra y Crepería.
//
//  Nota: TODO lo que se prepara lleva destino 'cocina' para que entre al KDS;
//  la separación real de pantallas la hace el campo `estacion`.
//
//  Sobre los tamaños: el precio base de cada raspado es el CH ($25) y los
//  tamaños M, G y Bubble suben por modificador. Así un solo producto cubre
//  las cuatro columnas del pizarrón sin duplicar el menú.
// ============================================================================
function buildHawaiianDoc(nombre = 'Hawaiian Paradise') {
  const e = M.estadoInicial({ nombre });
  const BARRA = 'Barra';
  const CREPE = 'Crepería';

  // Sucursal
  const suc = { id: M.uid('suc'), nombre: 'Cocoyoc', codigo: 'COCOYOC', activa: true };
  e.sucursales[suc.id] = suc;

  // ---- Insumos -------------------------------------------------------------
  const ins = {
    hielo:    M.crearInsumo({ nombre: 'Hielo', unidad: 'kg', stock: 250, costoUnitario: 3.5, stockMin: 70 }),
    jNatural: M.crearInsumo({ nombre: 'Jarabe natural', unidad: 'lt', stock: 30, costoUnitario: 42, stockMin: 8 }),
    jLeche:   M.crearInsumo({ nombre: 'Jarabe base leche', unidad: 'lt', stock: 30, costoUnitario: 48, stockMin: 8 }),
    jConc:    M.crearInsumo({ nombre: 'Jarabe concentrado', unidad: 'lt', stock: 20, costoUnitario: 26, stockMin: 6 }),
    chamoy:   M.crearInsumo({ nombre: 'Chamoy', unidad: 'porc', stock: 300, costoUnitario: 1.6, stockMin: 80 }),
    chile:    M.crearInsumo({ nombre: 'Chile en polvo', unidad: 'porc', stock: 300, costoUnitario: 0.9, stockMin: 80 }),
    lechera:  M.crearInsumo({ nombre: 'Lechera', unidad: 'porc', stock: 300, costoUnitario: 2.8, stockMin: 80 }),
    vaso:     M.crearInsumo({ nombre: 'Vaso y popote', unidad: 'pza', stock: 800, costoUnitario: 2.8, stockMin: 200 }),
    tapioca:  M.crearInsumo({ nombre: 'Perlas de tapioca', unidad: 'porc', stock: 150, costoUnitario: 7.5, stockMin: 40 }),
    leche:    M.crearInsumo({ nombre: 'Leche', unidad: 'lt', stock: 70, costoUnitario: 26, stockMin: 18 }),
    baseSmo:  M.crearInsumo({ nombre: 'Base para smoothie', unidad: 'porc', stock: 200, costoUnitario: 9, stockMin: 50 }),
    fruta:    M.crearInsumo({ nombre: 'Fruta natural', unidad: 'g', stock: 9000, costoUnitario: 0.09, stockMin: 2000 }),
    cafe:     M.crearInsumo({ nombre: 'Café molido', unidad: 'g', stock: 4000, costoUnitario: 0.42, stockMin: 800 }),
    masa:     M.crearInsumo({ nombre: 'Masa para crepa', unidad: 'pza', stock: 200, costoUnitario: 5.5, stockMin: 60 }),
    queso:    M.crearInsumo({ nombre: 'Queso', unidad: 'g', stock: 9000, costoUnitario: 0.16, stockMin: 2200 }),
    jamon:    M.crearInsumo({ nombre: 'Jamón', unidad: 'reb', stock: 320, costoUnitario: 3.2, stockMin: 90 }),
    pepperoni:M.crearInsumo({ nombre: 'Pepperoni', unidad: 'reb', stock: 400, costoUnitario: 1.5, stockMin: 100 }),
    dulce:    M.crearInsumo({ nombre: 'Mermelada / cajeta / nutella', unidad: 'porc', stock: 260, costoUnitario: 4.2, stockMin: 70 }),
    totopo:   M.crearInsumo({ nombre: 'Frituras para botana', unidad: 'porc', stock: 180, costoUnitario: 9.5, stockMin: 50 }),
    yogurt:   M.crearInsumo({ nombre: 'Yogurt natural', unidad: 'porc', stock: 90, costoUnitario: 12, stockMin: 25 }),
  };
  Object.values(ins).forEach((i) => (e.insumos[i.id] = i));

  // ---- Grupos de modificadores --------------------------------------------
  // Raspados: CH 25 · M 50 · G 60 · Bubble 75
  const gTamRaspado = M.crearGrupo({
    nombre: 'Tamaño', obligatorio: true,
    opciones: [
      M.crearOpcion({ nombre: 'Chico', porDefecto: true }),
      M.crearOpcion({ nombre: 'Mediano', precioDelta: 25 }),
      M.crearOpcion({ nombre: 'Grande', precioDelta: 35 }),
      M.crearOpcion({ nombre: 'Hawaiian Bubble (con boba)', precioDelta: 50 }),
    ],
  });
  const gCombina = M.crearGrupo({
    nombre: 'Combina dos sabores', tipo: 'multiple', max: 1,
    opciones: [
      M.crearOpcion({ nombre: 'Fresa' }), M.crearOpcion({ nombre: 'Limón' }),
      M.crearOpcion({ nombre: 'Mango' }), M.crearOpcion({ nombre: 'Tamarindo' }),
      M.crearOpcion({ nombre: 'Guayaba' }), M.crearOpcion({ nombre: 'Vainilla' }),
      M.crearOpcion({ nombre: 'Leche quemada' }), M.crearOpcion({ nombre: 'Piña colada' }),
      M.crearOpcion({ nombre: 'Rompope' }), M.crearOpcion({ nombre: 'Nuez' }),
      M.crearOpcion({ nombre: 'Chocolate' }), M.crearOpcion({ nombre: 'Coco' }),
    ],
  });
  const gExtrasRaspado = M.crearGrupo({
    nombre: 'Agrégale', tipo: 'multiple', max: 4,
    opciones: [
      M.crearOpcion({ nombre: 'Lechera' }), M.crearOpcion({ nombre: 'Chamoy' }),
      M.crearOpcion({ nombre: 'Chile en polvo' }), M.crearOpcion({ nombre: 'Fruta picada', precioDelta: 15 }),
      M.crearOpcion({ nombre: 'Perlas de tapioca', precioDelta: 15 }),
    ],
  });
  // Smoothies: normal o con boba (+15)
  const gBoba = M.crearGrupo({
    nombre: '¿Lo quieres boba?', obligatorio: true,
    opciones: [
      M.crearOpcion({ nombre: 'Normal', porDefecto: true }),
      M.crearOpcion({ nombre: 'Hawaiian Bubble (con boba)', precioDelta: 15 }),
    ],
  });
  // Aguas frescas: CH 30 · G 50
  const gTamAgua = M.crearGrupo({
    nombre: 'Tamaño', obligatorio: true,
    opciones: [
      M.crearOpcion({ nombre: 'Chico', porDefecto: true }),
      M.crearOpcion({ nombre: 'Grande', precioDelta: 20 }),
    ],
  });
  // Crepas: ingrediente extra $15, color sin costo
  const gExtraCrepa = M.crearGrupo({
    nombre: 'Ingrediente extra', tipo: 'multiple', max: 3,
    opciones: [
      M.crearOpcion({ nombre: 'Queso Philadelphia', precioDelta: 15 }),
      M.crearOpcion({ nombre: 'Nuez', precioDelta: 15 }),
      M.crearOpcion({ nombre: 'Plátano', precioDelta: 15 }),
    ],
  });
  const gColor = M.crearGrupo({
    nombre: 'Crepa de colores · sin costo extra', obligatorio: true,
    opciones: [
      M.crearOpcion({ nombre: 'Natural', porDefecto: true }),
      M.crearOpcion({ nombre: 'Rosa' }), M.crearOpcion({ nombre: 'Azul' }),
      M.crearOpcion({ nombre: 'Verde' }), M.crearOpcion({ nombre: 'Morada' }),
    ],
  });
  const gRelleno = M.crearGrupo({
    nombre: 'Elige el relleno', obligatorio: true,
    opciones: [M.crearOpcion({ nombre: 'Cajeta', porDefecto: true }), M.crearOpcion({ nombre: 'Nutella' })],
  });
  [gTamRaspado, gCombina, gExtrasRaspado, gBoba, gTamAgua, gExtraCrepa, gColor, gRelleno]
    .forEach((g) => (e.menu.gruposModificadores[g.id] = g));

  // ---- Categorías ----------------------------------------------------------
  const cNat  = M.crearCategoria({ nombre: 'Raspados naturales', orden: 1 });
  const cLec  = M.crearCategoria({ nombre: 'Raspados de leche', orden: 2 });
  const cLig  = M.crearCategoria({ nombre: 'Light', orden: 3 });
  const cExp  = M.crearCategoria({ nombre: 'Explosivos', orden: 4 });
  const cCon  = M.crearCategoria({ nombre: 'Concentrados', orden: 5 });
  const cEsp  = M.crearCategoria({ nombre: 'Especiales', orden: 6 });
  const cSmo  = M.crearCategoria({ nombre: 'Smoothies', orden: 7 });
  const cAgu  = M.crearCategoria({ nombre: 'Aguas frescas', orden: 8 });
  const cCreD = M.crearCategoria({ nombre: 'Crepas dulces', orden: 9 });
  const cCreS = M.crearCategoria({ nombre: 'Crepas saladas', orden: 10 });
  const cCreE = M.crearCategoria({ nombre: 'Especialidades', orden: 11 });
  const cMas  = M.crearCategoria({ nombre: 'Algo más', orden: 12 });
  [cNat, cLec, cLig, cExp, cCon, cEsp, cSmo, cAgu, cCreD, cCreS, cCreE, cMas]
    .forEach((c) => (e.menu.categorias[c.id] = c));

  // ---- Recetas base --------------------------------------------------------
  const rRaspado = (jarabe, extra = []) => [
    { insumoId: ins.hielo.id, cantidad: 0.3 },
    { insumoId: jarabe, cantidad: 0.07 },
    { insumoId: ins.vaso.id, cantidad: 1 },
    ...extra,
  ];
  const picante = [{ insumoId: ins.chamoy.id, cantidad: 1 }, { insumoId: ins.chile.id, cantidad: 1 }];
  const rCrepa = (extra = []) => [{ insumoId: ins.masa.id, cantidad: 1 }, ...extra];

  // Los raspados comparten grupos: tamaño, combinar sabor y agregados.
  const gRasp = [gTamRaspado.id, gCombina.id, gExtrasRaspado.id];

  const prods = [
    // ---- Naturales · CH 25 ----
    M.crearProducto({ categoriaId: cNat.id, nombre: 'Raspado de Fresa', precioBase: 25, estacion: BARRA, icono: '🍓', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id) }),
    M.crearProducto({ categoriaId: cNat.id, nombre: 'Raspado de Limón', precioBase: 25, estacion: BARRA, icono: '🍋', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id) }),
    M.crearProducto({ categoriaId: cNat.id, nombre: 'Raspado de Mango', precioBase: 25, estacion: BARRA, icono: '🥭', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id) }),
    M.crearProducto({ categoriaId: cNat.id, nombre: 'Raspado de Tamarindo', precioBase: 25, estacion: BARRA, icono: '🟤', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id) }),
    M.crearProducto({ categoriaId: cNat.id, nombre: 'Raspado de Guayaba', precioBase: 25, estacion: BARRA, icono: '🍈', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id) }),
    M.crearProducto({ categoriaId: cNat.id, nombre: 'Raspado de Tequila', precioBase: 25, estacion: BARRA, icono: '🌵', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id) }),

    // ---- De leche ----
    M.crearProducto({ categoriaId: cLec.id, nombre: 'Raspado de Vainilla', precioBase: 25, estacion: BARRA, icono: '🍦', gruposIds: gRasp, receta: rRaspado(ins.jLeche.id, [{ insumoId: ins.lechera.id, cantidad: 1 }]) }),
    M.crearProducto({ categoriaId: cLec.id, nombre: 'Raspado de Leche Quemada', descripcion: 'El más pedido', precioBase: 25, estacion: BARRA, icono: '🍮', gruposIds: gRasp, receta: rRaspado(ins.jLeche.id, [{ insumoId: ins.lechera.id, cantidad: 1 }]) }),
    M.crearProducto({ categoriaId: cLec.id, nombre: 'Raspado Piña Colada', descripcion: 'Con canela y lechera', precioBase: 25, estacion: BARRA, icono: '🍍', gruposIds: gRasp, receta: rRaspado(ins.jLeche.id, [{ insumoId: ins.lechera.id, cantidad: 1 }]) }),
    M.crearProducto({ categoriaId: cLec.id, nombre: 'Raspado Fresa Colada', descripcion: 'Con canela y lechera', precioBase: 25, estacion: BARRA, icono: '🍓', gruposIds: gRasp, receta: rRaspado(ins.jLeche.id, [{ insumoId: ins.lechera.id, cantidad: 1 }]) }),
    M.crearProducto({ categoriaId: cLec.id, nombre: 'Raspado de Rompope', descripcion: 'Con canela y lechera, sin alcohol', precioBase: 25, estacion: BARRA, icono: '🥛', gruposIds: gRasp, receta: rRaspado(ins.jLeche.id, [{ insumoId: ins.lechera.id, cantidad: 1 }]) }),
    M.crearProducto({ categoriaId: cLec.id, nombre: 'Raspado de Mango con leche', precioBase: 25, estacion: BARRA, icono: '🥭', gruposIds: gRasp, receta: rRaspado(ins.jLeche.id, [{ insumoId: ins.lechera.id, cantidad: 1 }]) }),
    M.crearProducto({ categoriaId: cLec.id, nombre: 'Raspado de Nuez', precioBase: 25, estacion: BARRA, icono: '🌰', gruposIds: gRasp, receta: rRaspado(ins.jLeche.id, [{ insumoId: ins.lechera.id, cantidad: 1 }]) }),
    M.crearProducto({ categoriaId: cLec.id, nombre: 'Raspado de Chocolate', precioBase: 25, estacion: BARRA, icono: '🍫', gruposIds: gRasp, receta: rRaspado(ins.jLeche.id, [{ insumoId: ins.lechera.id, cantidad: 1 }]) }),
    M.crearProducto({ categoriaId: cLec.id, nombre: 'Raspado de Coco', precioBase: 25, estacion: BARRA, icono: '🥥', gruposIds: gRasp, receta: rRaspado(ins.jLeche.id, [{ insumoId: ins.lechera.id, cantidad: 1 }]) }),

    // ---- Light ----
    M.crearProducto({ categoriaId: cLig.id, nombre: 'Chamoicano Light', descripcion: 'Chamoy, limón y chile', precioBase: 25, estacion: BARRA, icono: '🌶️', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id, picante) }),
    M.crearProducto({ categoriaId: cLig.id, nombre: 'T.N.T. Light', descripcion: 'Tamarindo, limón y chile', precioBase: 25, estacion: BARRA, icono: '🧨', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id, picante) }),
    M.crearProducto({ categoriaId: cLig.id, nombre: 'Fresa Light', precioBase: 25, estacion: BARRA, icono: '🍓', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id) }),
    M.crearProducto({ categoriaId: cLig.id, nombre: 'Mango Light', precioBase: 25, estacion: BARRA, icono: '🥭', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id) }),
    M.crearProducto({ categoriaId: cLig.id, nombre: 'Tamarindo Light', precioBase: 25, estacion: BARRA, icono: '🟤', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id) }),

    // ---- Explosivos ----
    M.crearProducto({ categoriaId: cExp.id, nombre: 'Chamoicano', descripcion: 'Chamoy, limón y chile', precioBase: 25, estacion: BARRA, icono: '💥', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id, picante) }),
    M.crearProducto({ categoriaId: cExp.id, nombre: 'T.N.T.', descripcion: 'Tamarindo, limón y chile', precioBase: 25, estacion: BARRA, icono: '🧨', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id, picante) }),
    M.crearProducto({ categoriaId: cExp.id, nombre: 'Bomba', descripcion: 'Limón y chile', precioBase: 25, estacion: BARRA, icono: '💣', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id, picante) }),
    M.crearProducto({ categoriaId: cExp.id, nombre: 'Picamango', descripcion: 'Mango, limón y chile', precioBase: 25, estacion: BARRA, icono: '🥭', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id, picante) }),
    M.crearProducto({ categoriaId: cExp.id, nombre: 'Picafresa', descripcion: 'Fresa, limón y chile', precioBase: 25, estacion: BARRA, icono: '🍓', gruposIds: gRasp, receta: rRaspado(ins.jNatural.id, picante) }),

    // ---- Concentrados ----
    M.crearProducto({ categoriaId: cCon.id, nombre: 'Raspado de Uva', precioBase: 25, estacion: BARRA, icono: '🍇', gruposIds: gRasp, receta: rRaspado(ins.jConc.id) }),
    M.crearProducto({ categoriaId: cCon.id, nombre: 'Raspado de Grosella', precioBase: 25, estacion: BARRA, icono: '🔴', gruposIds: gRasp, receta: rRaspado(ins.jConc.id) }),
    M.crearProducto({ categoriaId: cCon.id, nombre: 'Raspado de Chicle Azul', precioBase: 25, estacion: BARRA, icono: '🔵', gruposIds: gRasp, receta: rRaspado(ins.jConc.id) }),
    M.crearProducto({ categoriaId: cCon.id, nombre: 'Raspado de Durazno', precioBase: 25, estacion: BARRA, icono: '🍑', gruposIds: gRasp, receta: rRaspado(ins.jConc.id) }),

    // ---- Especiales · precio único 75 ----
    M.crearProducto({ categoriaId: cEsp.id, nombre: 'Súper Explosivo', descripcion: 'El grande de la casa, bien cargado', precioBase: 75, estacion: BARRA, icono: '🌋', gruposIds: [gExtrasRaspado.id], receta: rRaspado(ins.jNatural.id, [...picante, { insumoId: ins.fruta.id, cantidad: 120 }]) }),
    M.crearProducto({ categoriaId: cEsp.id, nombre: 'Mangada', descripcion: 'Mango, chamoy y chile', precioBase: 75, estacion: BARRA, icono: '🥭', gruposIds: [gExtrasRaspado.id], receta: rRaspado(ins.jNatural.id, [...picante, { insumoId: ins.fruta.id, cantidad: 120 }]) }),
    M.crearProducto({ categoriaId: cEsp.id, nombre: 'Fresada', descripcion: 'Fresa, chamoy y chile', precioBase: 75, estacion: BARRA, icono: '🍓', gruposIds: [gExtrasRaspado.id], receta: rRaspado(ins.jNatural.id, [...picante, { insumoId: ins.fruta.id, cantidad: 120 }]) }),

    // ---- Smoothies · 60 (boba +15) ----
    M.crearProducto({ categoriaId: cSmo.id, nombre: 'Smoothie de Mango', precioBase: 60, estacion: BARRA, icono: '🥭', gruposIds: [gBoba.id], receta: [{ insumoId: ins.baseSmo.id, cantidad: 1 }, { insumoId: ins.fruta.id, cantidad: 120 }, { insumoId: ins.hielo.id, cantidad: 0.2 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cSmo.id, nombre: 'Smoothie de Fresa', precioBase: 60, estacion: BARRA, icono: '🍓', gruposIds: [gBoba.id], receta: [{ insumoId: ins.baseSmo.id, cantidad: 1 }, { insumoId: ins.fruta.id, cantidad: 120 }, { insumoId: ins.hielo.id, cantidad: 0.2 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cSmo.id, nombre: 'Smoothie de Mazapán', precioBase: 60, estacion: BARRA, icono: '🥜', gruposIds: [gBoba.id], receta: [{ insumoId: ins.baseSmo.id, cantidad: 1 }, { insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.hielo.id, cantidad: 0.2 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cSmo.id, nombre: 'Chocolate Malt', precioBase: 60, estacion: BARRA, icono: '🍫', gruposIds: [gBoba.id], receta: [{ insumoId: ins.baseSmo.id, cantidad: 1 }, { insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.hielo.id, cantidad: 0.2 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cSmo.id, nombre: 'Caramel Latté', precioBase: 60, estacion: BARRA, icono: '☕', gruposIds: [gBoba.id], receta: [{ insumoId: ins.cafe.id, cantidad: 14 }, { insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.hielo.id, cantidad: 0.2 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cSmo.id, nombre: 'Mokaccino', precioBase: 60, estacion: BARRA, icono: '☕', gruposIds: [gBoba.id], receta: [{ insumoId: ins.cafe.id, cantidad: 14 }, { insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.hielo.id, cantidad: 0.2 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cSmo.id, nombre: 'Capuccino', precioBase: 60, estacion: BARRA, icono: '☕', gruposIds: [gBoba.id], receta: [{ insumoId: ins.cafe.id, cantidad: 16 }, { insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    // Smoothies premium · 75 (boba +15)
    M.crearProducto({ categoriaId: cSmo.id, nombre: 'Smoothie de Taro', precioBase: 75, estacion: BARRA, icono: '🟣', gruposIds: [gBoba.id], receta: [{ insumoId: ins.baseSmo.id, cantidad: 1 }, { insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.hielo.id, cantidad: 0.2 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cSmo.id, nombre: 'Chicle Rosa', precioBase: 75, estacion: BARRA, icono: '🩷', gruposIds: [gBoba.id], receta: [{ insumoId: ins.baseSmo.id, cantidad: 1 }, { insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.hielo.id, cantidad: 0.2 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cSmo.id, nombre: 'Matcha', precioBase: 75, estacion: BARRA, icono: '🍵', gruposIds: [gBoba.id], receta: [{ insumoId: ins.baseSmo.id, cantidad: 1 }, { insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.hielo.id, cantidad: 0.2 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cSmo.id, nombre: 'Chai Vainilla', precioBase: 75, estacion: BARRA, icono: '🍵', gruposIds: [gBoba.id], receta: [{ insumoId: ins.baseSmo.id, cantidad: 1 }, { insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cSmo.id, nombre: 'Chai Verde', precioBase: 75, estacion: BARRA, icono: '🍵', gruposIds: [gBoba.id], receta: [{ insumoId: ins.baseSmo.id, cantidad: 1 }, { insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cSmo.id, nombre: 'Cookies and Cream', precioBase: 75, estacion: BARRA, icono: '🍪', gruposIds: [gBoba.id], receta: [{ insumoId: ins.baseSmo.id, cantidad: 1 }, { insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.hielo.id, cantidad: 0.2 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cSmo.id, nombre: 'Algodón de Azúcar', precioBase: 75, estacion: BARRA, icono: '🍬', gruposIds: [gBoba.id], receta: [{ insumoId: ins.baseSmo.id, cantidad: 1 }, { insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.hielo.id, cantidad: 0.2 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),

    // ---- Aguas frescas · CH 30 · G 50 ----
    M.crearProducto({ categoriaId: cAgu.id, nombre: 'Agua de Tamarindo', precioBase: 30, estacion: BARRA, icono: '🟤', gruposIds: [gTamAgua.id], receta: [{ insumoId: ins.jNatural.id, cantidad: 0.05 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cAgu.id, nombre: 'Agua de Guayaba', precioBase: 30, estacion: BARRA, icono: '🍈', gruposIds: [gTamAgua.id], receta: [{ insumoId: ins.jNatural.id, cantidad: 0.05 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cAgu.id, nombre: 'Agua de Fresa', precioBase: 30, estacion: BARRA, icono: '🍓', gruposIds: [gTamAgua.id], receta: [{ insumoId: ins.jNatural.id, cantidad: 0.05 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cAgu.id, nombre: 'Agua de Mango', precioBase: 30, estacion: BARRA, icono: '🥭', gruposIds: [gTamAgua.id], receta: [{ insumoId: ins.jNatural.id, cantidad: 0.05 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cAgu.id, nombre: 'Agua de Limón', precioBase: 30, estacion: BARRA, icono: '🍋', gruposIds: [gTamAgua.id], receta: [{ insumoId: ins.jNatural.id, cantidad: 0.05 }, { insumoId: ins.vaso.id, cantidad: 1 }] }),

    // ---- Crepas dulces · 50 ----
    M.crearProducto({ categoriaId: cCreD.id, nombre: 'Crepa de Cajeta', precioBase: 50, estacion: CREPE, icono: '🥞', gruposIds: [gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.dulce.id, cantidad: 1 }]) }),
    M.crearProducto({ categoriaId: cCreD.id, nombre: 'Crepa de Nutella', precioBase: 50, estacion: CREPE, icono: '🍫', gruposIds: [gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.dulce.id, cantidad: 1 }]) }),
    M.crearProducto({ categoriaId: cCreD.id, nombre: 'Crepa de Chabacano', precioBase: 50, estacion: CREPE, icono: '🍑', gruposIds: [gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.dulce.id, cantidad: 1 }]) }),
    M.crearProducto({ categoriaId: cCreD.id, nombre: 'Crepa de Fresa', precioBase: 50, estacion: CREPE, icono: '🍓', gruposIds: [gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.dulce.id, cantidad: 1 }]) }),
    M.crearProducto({ categoriaId: cCreD.id, nombre: 'Crepa de Zarzamora', precioBase: 50, estacion: CREPE, icono: '🫐', gruposIds: [gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.dulce.id, cantidad: 1 }]) }),
    M.crearProducto({ categoriaId: cCreD.id, nombre: 'Crepa de Durazno', precioBase: 50, estacion: CREPE, icono: '🍑', gruposIds: [gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.dulce.id, cantidad: 1 }]) }),

    // ---- Crepas saladas ----
    M.crearProducto({ categoriaId: cCreS.id, nombre: 'Crepa Pepperoni y Queso', precioBase: 55, estacion: CREPE, icono: '🍕', gruposIds: [gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.queso.id, cantidad: 70 }, { insumoId: ins.pepperoni.id, cantidad: 8 }]) }),
    M.crearProducto({ categoriaId: cCreS.id, nombre: 'Crepa Jamón y Queso', precioBase: 55, estacion: CREPE, icono: '🧀', gruposIds: [gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.queso.id, cantidad: 70 }, { insumoId: ins.jamon.id, cantidad: 2 }]) }),
    M.crearProducto({ categoriaId: cCreS.id, nombre: 'Crepa Jamón, Queso y Huevo', precioBase: 65, estacion: CREPE, icono: '🍳', gruposIds: [gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.queso.id, cantidad: 70 }, { insumoId: ins.jamon.id, cantidad: 2 }]) }),
    M.crearProducto({ categoriaId: cCreS.id, nombre: 'Crepa de Rajas con Queso', precioBase: 55, estacion: CREPE, icono: '🌶️', gruposIds: [gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.queso.id, cantidad: 70 }]) }),
    M.crearProducto({ categoriaId: cCreS.id, nombre: 'Crepa de Champiñón con Queso', precioBase: 55, estacion: CREPE, icono: '🍄', gruposIds: [gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.queso.id, cantidad: 70 }]) }),

    // ---- Especialidades · 70 ----
    M.crearProducto({ categoriaId: cCreE.id, nombre: 'Hawaiiana', descripcion: 'Queso, jamón y piña', precioBase: 70, estacion: CREPE, icono: '🍍', gruposIds: [gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.queso.id, cantidad: 80 }, { insumoId: ins.jamon.id, cantidad: 2 }]) }),
    M.crearProducto({ categoriaId: cCreE.id, nombre: 'Bandido', descripcion: 'Pepperoni, jamón, queso y tocino', precioBase: 70, estacion: CREPE, icono: '🥓', gruposIds: [gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.queso.id, cantidad: 80 }, { insumoId: ins.jamon.id, cantidad: 2 }, { insumoId: ins.pepperoni.id, cantidad: 8 }]) }),
    M.crearProducto({ categoriaId: cCreE.id, nombre: 'Frepizza', descripcion: 'Fresa natural, lechera y canela', precioBase: 70, estacion: CREPE, icono: '🍓', gruposIds: [gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.fruta.id, cantidad: 100 }, { insumoId: ins.lechera.id, cantidad: 1 }]) }),
    M.crearProducto({ categoriaId: cCreE.id, nombre: 'Plátano', descripcion: 'Plátano, nuez y cajeta o nutella', precioBase: 70, estacion: CREPE, icono: '🍌', gruposIds: [gRelleno.id, gColor.id, gExtraCrepa.id], receta: rCrepa([{ insumoId: ins.fruta.id, cantidad: 100 }, { insumoId: ins.dulce.id, cantidad: 1 }]) }),

    // ---- Algo más ----
    M.crearProducto({ categoriaId: cMas.id, nombre: 'Nachos con Queso', precioBase: 65, estacion: CREPE, icono: '🧀', receta: [{ insumoId: ins.totopo.id, cantidad: 1 }, { insumoId: ins.queso.id, cantidad: 60 }] }),
    M.crearProducto({ categoriaId: cMas.id, nombre: 'Papas Lokas', precioBase: 65, estacion: CREPE, icono: '🍟', receta: [{ insumoId: ins.totopo.id, cantidad: 1 }, { insumoId: ins.queso.id, cantidad: 50 }] }),
    M.crearProducto({ categoriaId: cMas.id, nombre: 'Dorilokos', precioBase: 65, estacion: CREPE, icono: '🌽', receta: [{ insumoId: ins.totopo.id, cantidad: 1 }, { insumoId: ins.chamoy.id, cantidad: 2 }, { insumoId: ins.chile.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cMas.id, nombre: 'Botanita', precioBase: 35, estacion: CREPE, icono: '🥨', receta: [{ insumoId: ins.totopo.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cMas.id, nombre: 'Yogurt con Fruta', precioBase: 70, estacion: BARRA, icono: '🍨', receta: [{ insumoId: ins.yogurt.id, cantidad: 1 }, { insumoId: ins.fruta.id, cantidad: 150 }] }),
  ];
  prods.forEach((p) => (e.menu.productos[p.id] = p));

  // Paleta del menú QR para este tenant (la usa qr.html; sin esto toma la de fábrica)
  e.config.tema = { bg: '#FFF6EC', card: '#FFFFFF', ink: '#12303A', acento: '#00BCD4', acento2: '#FF3D77', linea: '#EADCC9', muted: '#6C8189' };

  // Canales de venta
  e.config.canales = M.canalesDefault();

  // Mesas
  for (let i = 1; i <= 10; i++) { const m = M.crearMesa({ nombre: 'Mesa ' + i, sucursalId: suc.id }); e.mesas[m.id] = m; }

  return e;
}

module.exports = { buildTenantDoc, buildHawaiianDoc };
