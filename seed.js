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
//  Plantilla NEVERÍA — Hawaiian Paradise
//  Dos estaciones de producción: Barra (raspados, nieves, frappés, café) y
//  Crepería (crepas dulces y saladas).
//  Nota: TODO lo que se prepara lleva destino 'cocina' para que entre al KDS;
//  la separación real de pantallas la hace el campo `estacion`.
// ============================================================================
function buildHawaiianDoc(nombre = 'Hawaiian Paradise') {
  const e = M.estadoInicial({ nombre });
  const BARRA = 'Barra';
  const CREPE = 'Crepería';

  // Sucursal
  const suc = { id: M.uid('suc'), nombre: 'Lomas de Cocoyoc', codigo: 'COCOYOC', activa: true };
  e.sucursales[suc.id] = suc;

  // Insumos
  const ins = {
    hielo:    M.crearInsumo({ nombre: 'Hielo', unidad: 'kg', stock: 200, costoUnitario: 3.5, stockMin: 60 }),
    jLeche:   M.crearInsumo({ nombre: 'Jarabe base leche', unidad: 'lt', stock: 30, costoUnitario: 48, stockMin: 8 }),
    jNatural: M.crearInsumo({ nombre: 'Jarabe fruta natural', unidad: 'lt', stock: 30, costoUnitario: 42, stockMin: 8 }),
    jConc:    M.crearInsumo({ nombre: 'Jarabe concentrado', unidad: 'lt', stock: 20, costoUnitario: 26, stockMin: 6 }),
    lechera:  M.crearInsumo({ nombre: 'Lechera', unidad: 'porc', stock: 300, costoUnitario: 2.8, stockMin: 80 }),
    chamoy:   M.crearInsumo({ nombre: 'Chamoy', unidad: 'porc', stock: 250, costoUnitario: 1.6, stockMin: 60 }),
    vaso16:   M.crearInsumo({ nombre: 'Vaso 16 oz', unidad: 'pza', stock: 500, costoUnitario: 2.4, stockMin: 150 }),
    vaso24:   M.crearInsumo({ nombre: 'Vaso 24 oz', unidad: 'pza', stock: 250, costoUnitario: 3.2, stockMin: 80 }),
    nieve:    M.crearInsumo({ nombre: 'Nieve de garrafa', unidad: 'lt', stock: 45, costoUnitario: 62, stockMin: 12 }),
    masa:     M.crearInsumo({ nombre: 'Masa para crepa', unidad: 'pza', stock: 180, costoUnitario: 5.5, stockMin: 50 }),
    queso:    M.crearInsumo({ nombre: 'Queso mozzarella', unidad: 'g', stock: 8000, costoUnitario: 0.16, stockMin: 2000 }),
    jamon:    M.crearInsumo({ nombre: 'Jamón', unidad: 'reb', stock: 300, costoUnitario: 3.2, stockMin: 80 }),
    fresa:    M.crearInsumo({ nombre: 'Fresa natural', unidad: 'g', stock: 6000, costoUnitario: 0.09, stockMin: 1500 }),
    crema:    M.crearInsumo({ nombre: 'Crema batida', unidad: 'porc', stock: 220, costoUnitario: 3.1, stockMin: 60 }),
    leche:    M.crearInsumo({ nombre: 'Leche', unidad: 'lt', stock: 60, costoUnitario: 26, stockMin: 15 }),
    cafe:     M.crearInsumo({ nombre: 'Café molido', unidad: 'g', stock: 4000, costoUnitario: 0.42, stockMin: 800 }),
  };
  Object.values(ins).forEach((i) => (e.insumos[i.id] = i));

  // Grupos de modificadores
  const gTam = M.crearGrupo({
    nombre: 'Tamaño', obligatorio: true,
    opciones: [M.crearOpcion({ nombre: '16 oz', porDefecto: true }), M.crearOpcion({ nombre: '24 oz', precioDelta: 25 })],
  });
  const gTop = M.crearGrupo({
    nombre: 'Toppings', tipo: 'multiple', max: 6,
    opciones: [
      M.crearOpcion({ nombre: 'Lechera', porDefecto: true }),
      M.crearOpcion({ nombre: 'Chamoy' }),
      M.crearOpcion({ nombre: 'Chile en polvo' }),
      M.crearOpcion({ nombre: 'Canela' }),
      M.crearOpcion({ nombre: 'Crema batida', precioDelta: 12 }),
      M.crearOpcion({ nombre: 'Chispas de chocolate', precioDelta: 12 }),
      M.crearOpcion({ nombre: 'Galleta Oreo', precioDelta: 12 }),
      M.crearOpcion({ nombre: 'Chocolate líquido', precioDelta: 12 }),
      M.crearOpcion({ nombre: 'Cajeta', precioDelta: 12 }),
      M.crearOpcion({ nombre: 'Gomitas', precioDelta: 15 }),
      M.crearOpcion({ nombre: 'Fruta picada', precioDelta: 15 }),
    ],
  });
  const gPres = M.crearGrupo({
    nombre: 'Presentación', obligatorio: true,
    opciones: [M.crearOpcion({ nombre: 'En vaso', porDefecto: true }), M.crearOpcion({ nombre: 'En cono', precioDelta: 5 })],
  });
  const gSabor = M.crearGrupo({
    nombre: 'Sabor de nieve', obligatorio: true,
    opciones: [
      M.crearOpcion({ nombre: 'Vainilla', porDefecto: true }), M.crearOpcion({ nombre: 'Chocolate' }),
      M.crearOpcion({ nombre: 'Fresa' }), M.crearOpcion({ nombre: 'Limón' }),
      M.crearOpcion({ nombre: 'Mamey' }), M.crearOpcion({ nombre: 'Nuez' }),
    ],
  });
  const gRelleno = M.crearGrupo({
    nombre: 'Agrega a tu crepa', tipo: 'multiple', max: 4,
    opciones: [
      M.crearOpcion({ nombre: 'Plátano', precioDelta: 12 }),
      M.crearOpcion({ nombre: 'Fresa', precioDelta: 15 }),
      M.crearOpcion({ nombre: 'Nuez', precioDelta: 18 }),
      M.crearOpcion({ nombre: 'Bola de nieve', precioDelta: 30 }),
    ],
  });
  [gTam, gTop, gPres, gSabor, gRelleno].forEach((g) => (e.menu.gruposModificadores[g.id] = g));

  // Categorías
  const cLeche  = M.crearCategoria({ nombre: 'Raspados de leche', orden: 1 });
  const cNat    = M.crearCategoria({ nombre: 'Naturales y aciditos', orden: 2 });
  const cNieve  = M.crearCategoria({ nombre: 'Nieves y frappés', orden: 3 });
  const cDulce  = M.crearCategoria({ nombre: 'Crepas dulces', orden: 4 });
  const cSalada = M.crearCategoria({ nombre: 'Crepas saladas', orden: 5 });
  const cPostre = M.crearCategoria({ nombre: 'Postres fríos', orden: 6 });
  const cCal    = M.crearCategoria({ nombre: 'Bebidas calientes', orden: 7 });
  [cLeche, cNat, cNieve, cDulce, cSalada, cPostre, cCal].forEach((c) => (e.menu.categorias[c.id] = c));

  // Recetas base reutilizables
  const rRaspado = (jarabe) => [
    { insumoId: ins.hielo.id, cantidad: 0.35 },
    { insumoId: jarabe, cantidad: 0.08 },
    { insumoId: ins.vaso16.id, cantidad: 1 },
    { insumoId: ins.lechera.id, cantidad: 1 },
  ];
  const rCrepa = (extra = []) => [{ insumoId: ins.masa.id, cantidad: 1 }, ...extra];

  const prods = [
    // ---- Raspados de leche (Barra) ----
    M.crearProducto({ categoriaId: cLeche.id, nombre: 'Raspado de Rompope', descripcion: 'Con canela y lechera, sin alcohol', precioBase: 74, estacion: BARRA, gruposIds: [gTam.id, gTop.id], receta: rRaspado(ins.jLeche.id) }),
    M.crearProducto({ categoriaId: cLeche.id, nombre: 'Raspado Piña Colada', descripcion: 'Piña y coco natural con lechera', precioBase: 74, estacion: BARRA, gruposIds: [gTam.id, gTop.id], receta: rRaspado(ins.jLeche.id) }),
    M.crearProducto({ categoriaId: cLeche.id, nombre: 'Raspado Fresa Colada', descripcion: 'Fresa y coco con lechera', precioBase: 74, estacion: BARRA, gruposIds: [gTam.id, gTop.id], receta: rRaspado(ins.jLeche.id) }),
    M.crearProducto({ categoriaId: cLeche.id, nombre: 'Raspado Leche Quemada', descripcion: 'El más pedido de la casa', precioBase: 74, estacion: BARRA, gruposIds: [gTam.id, gTop.id], receta: rRaspado(ins.jLeche.id) }),
    M.crearProducto({ categoriaId: cLeche.id, nombre: 'Raspado de Coco', descripcion: 'Coco natural con canela y lechera', precioBase: 74, estacion: BARRA, gruposIds: [gTam.id, gTop.id], receta: rRaspado(ins.jLeche.id) }),
    M.crearProducto({ categoriaId: cLeche.id, nombre: 'Raspado de Mazapán', descripcion: 'Con trocitos de mazapán encima', precioBase: 78, estacion: BARRA, gruposIds: [gTam.id, gTop.id], receta: rRaspado(ins.jLeche.id) }),

    // ---- Naturales y aciditos (Barra) ----
    M.crearProducto({ categoriaId: cNat.id, nombre: 'Raspado de Fresa', descripcion: 'Jarabe de fresa 100% natural', precioBase: 74, estacion: BARRA, gruposIds: [gTam.id, gTop.id], receta: rRaspado(ins.jNatural.id) }),
    M.crearProducto({ categoriaId: cNat.id, nombre: 'Raspado de Mango', descripcion: 'Mango natural de temporada', precioBase: 74, estacion: BARRA, gruposIds: [gTam.id, gTop.id], receta: rRaspado(ins.jNatural.id) }),
    M.crearProducto({ categoriaId: cNat.id, nombre: 'Raspado de Limón', descripcion: 'Bien ácido, como debe ser', precioBase: 74, estacion: BARRA, gruposIds: [gTam.id, gTop.id], receta: rRaspado(ins.jNatural.id) }),
    M.crearProducto({ categoriaId: cNat.id, nombre: 'Mango Acidito', descripcion: 'Con chamoy y chile de la casa', precioBase: 82, estacion: BARRA, gruposIds: [gTam.id, gTop.id], receta: [...rRaspado(ins.jNatural.id), { insumoId: ins.chamoy.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cNat.id, nombre: 'Tamarindo Acidito', descripcion: 'Con chamoy y chile de la casa', precioBase: 82, estacion: BARRA, gruposIds: [gTam.id, gTop.id], receta: [...rRaspado(ins.jNatural.id), { insumoId: ins.chamoy.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cNat.id, nombre: 'Raspado Explosivo', descripcion: 'Gomitas, pulparindo y chamoy', precioBase: 95, estacion: BARRA, gruposIds: [gTam.id, gTop.id], receta: [...rRaspado(ins.jNatural.id), { insumoId: ins.chamoy.id, cantidad: 2 }] }),
    M.crearProducto({ categoriaId: cNat.id, nombre: 'Raspado de Uva', descripcion: 'Jarabe concentrado', precioBase: 68, estacion: BARRA, gruposIds: [gTam.id, gTop.id], receta: rRaspado(ins.jConc.id) }),

    // ---- Nieves y frappés (Barra) ----
    M.crearProducto({ categoriaId: cNieve.id, nombre: 'Nieve de garrafa · 1 bola', descripcion: 'Pregunta los sabores del día', precioBase: 45, estacion: BARRA, gruposIds: [gSabor.id, gPres.id], receta: [{ insumoId: ins.nieve.id, cantidad: 0.12 }] }),
    M.crearProducto({ categoriaId: cNieve.id, nombre: 'Nieve de garrafa · 2 bolas', descripcion: 'Combina dos sabores', precioBase: 70, estacion: BARRA, gruposIds: [gSabor.id, gPres.id], receta: [{ insumoId: ins.nieve.id, cantidad: 0.24 }] }),
    M.crearProducto({ categoriaId: cNieve.id, nombre: 'Nieve para llevar · ½ litro', descripcion: 'En envase sellado', precioBase: 130, estacion: BARRA, gruposIds: [gSabor.id], receta: [{ insumoId: ins.nieve.id, cantidad: 0.5 }] }),
    M.crearProducto({ categoriaId: cNieve.id, nombre: 'Nieve para llevar · 1 litro', descripcion: 'En envase sellado', precioBase: 240, estacion: BARRA, gruposIds: [gSabor.id], receta: [{ insumoId: ins.nieve.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cNieve.id, nombre: 'Frappé de Oreo', descripcion: 'Crema batida y galleta encima', precioBase: 85, estacion: BARRA, gruposIds: [gTam.id], receta: [{ insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.hielo.id, cantidad: 0.2 }, { insumoId: ins.crema.id, cantidad: 1 }, { insumoId: ins.vaso16.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cNieve.id, nombre: 'Frappé Moka', descripcion: 'Café, chocolate y crema batida', precioBase: 85, estacion: BARRA, gruposIds: [gTam.id], receta: [{ insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.cafe.id, cantidad: 14 }, { insumoId: ins.hielo.id, cantidad: 0.2 }, { insumoId: ins.crema.id, cantidad: 1 }, { insumoId: ins.vaso16.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cNieve.id, nombre: 'Frappé de Mazapán', descripcion: 'Con chispas de chocolate', precioBase: 85, estacion: BARRA, gruposIds: [gTam.id], receta: [{ insumoId: ins.leche.id, cantidad: 0.25 }, { insumoId: ins.hielo.id, cantidad: 0.2 }, { insumoId: ins.crema.id, cantidad: 1 }, { insumoId: ins.vaso16.id, cantidad: 1 }] }),

    // ---- Crepas dulces (Crepería) ----
    M.crearProducto({ categoriaId: cDulce.id, nombre: 'Crepa de Lechera o Cajeta', descripcion: 'La clásica de siempre', precioBase: 56, estacion: CREPE, gruposIds: [gRelleno.id], receta: rCrepa([{ insumoId: ins.lechera.id, cantidad: 2 }]) }),
    M.crearProducto({ categoriaId: cDulce.id, nombre: 'Crepa de Mermelada y Queso', descripcion: 'Mermelada a elegir con queso crema', precioBase: 72, estacion: CREPE, gruposIds: [gRelleno.id], receta: rCrepa() }),
    M.crearProducto({ categoriaId: cDulce.id, nombre: 'Crepa de Nutella', descripcion: 'Con plátano si lo pides', precioBase: 80, estacion: CREPE, gruposIds: [gRelleno.id], receta: rCrepa() }),
    M.crearProducto({ categoriaId: cDulce.id, nombre: 'Crepa de Oreo', descripcion: 'Chocolate líquido y galleta molida', precioBase: 85, estacion: CREPE, gruposIds: [gRelleno.id], receta: rCrepa() }),

    // ---- Crepas saladas (Crepería) ----
    M.crearProducto({ categoriaId: cSalada.id, nombre: 'Crepa Clásica', descripcion: 'Queso y jamón', precioBase: 69, estacion: CREPE, receta: rCrepa([{ insumoId: ins.queso.id, cantidad: 60 }, { insumoId: ins.jamon.id, cantidad: 2 }]) }),
    M.crearProducto({ categoriaId: cSalada.id, nombre: 'Crepizza', descripcion: 'Mozzarella, pepperoni y salsa de tomate', precioBase: 84, estacion: CREPE, receta: rCrepa([{ insumoId: ins.queso.id, cantidad: 80 }]) }),
    M.crearProducto({ categoriaId: cSalada.id, nombre: 'Vegetariana', descripcion: 'Queso y champiñones', precioBase: 84, estacion: CREPE, receta: rCrepa([{ insumoId: ins.queso.id, cantidad: 70 }]) }),
    M.crearProducto({ categoriaId: cSalada.id, nombre: 'Hawaiiana', descripcion: 'Mozzarella, jamón y piña', precioBase: 94, estacion: CREPE, receta: rCrepa([{ insumoId: ins.queso.id, cantidad: 80 }, { insumoId: ins.jamon.id, cantidad: 2 }]) }),
    M.crearProducto({ categoriaId: cSalada.id, nombre: 'Bandido', descripcion: 'Mozzarella, jamón, pepperoni y tocino', precioBase: 94, estacion: CREPE, receta: rCrepa([{ insumoId: ins.queso.id, cantidad: 80 }, { insumoId: ins.jamon.id, cantidad: 2 }]) }),
    M.crearProducto({ categoriaId: cSalada.id, nombre: 'Tres Quesos', descripcion: 'Mozzarella, manchego y philadelphia', precioBase: 99, estacion: CREPE, receta: rCrepa([{ insumoId: ins.queso.id, cantidad: 110 }]) }),

    // ---- Postres fríos (Barra) ----
    M.crearProducto({ categoriaId: cPostre.id, nombre: 'Fresas con Crema', descripcion: 'Fresa natural con crema y galleta', precioBase: 75, estacion: BARRA, receta: [{ insumoId: ins.fresa.id, cantidad: 150 }, { insumoId: ins.crema.id, cantidad: 2 }, { insumoId: ins.vaso16.id, cantidad: 1 }] }),
    M.crearProducto({ categoriaId: cPostre.id, nombre: 'Banana Split', descripcion: 'Tres nieves, plátano, crema y cereza', precioBase: 99, estacion: BARRA, receta: [{ insumoId: ins.nieve.id, cantidad: 0.36 }, { insumoId: ins.crema.id, cantidad: 2 }] }),
    M.crearProducto({ categoriaId: cPostre.id, nombre: 'Waffle con nieve', descripcion: 'Waffle recién hecho con una bola de nieve', precioBase: 95, estacion: CREPE, gruposIds: [gSabor.id], receta: [{ insumoId: ins.nieve.id, cantidad: 0.12 }] }),
    M.crearProducto({ categoriaId: cPostre.id, nombre: 'Coctel de fruta', descripcion: 'Fruta de temporada picada', precioBase: 80, estacion: BARRA, receta: [{ insumoId: ins.fresa.id, cantidad: 100 }, { insumoId: ins.vaso16.id, cantidad: 1 }] }),

    // ---- Bebidas calientes (Barra) ----
    M.crearProducto({ categoriaId: cCal.id, nombre: 'Chocolate caliente', descripcion: 'Leche espumosa con minibombones', precioBase: 59, estacion: BARRA, receta: [{ insumoId: ins.leche.id, cantidad: 0.3 }] }),
    M.crearProducto({ categoriaId: cCal.id, nombre: 'Espresso americano', descripcion: 'Café de altura, 12 oz', precioBase: 49, estacion: BARRA, receta: [{ insumoId: ins.cafe.id, cantidad: 16 }] }),
    M.crearProducto({ categoriaId: cCal.id, nombre: 'Capuchino', descripcion: 'Con canela o chocolate encima', precioBase: 55, estacion: BARRA, receta: [{ insumoId: ins.cafe.id, cantidad: 16 }, { insumoId: ins.leche.id, cantidad: 0.2 }] }),
  ];
  prods.forEach((p) => (e.menu.productos[p.id] = p));

  // Paleta del menu QR para este tenant (la usa qr.html; sin esto toma la de fabrica)
  e.config.tema = { bg: '#FFF6EC', card: '#FFFFFF', ink: '#12303A', acento: '#00BCD4', acento2: '#FF3D77', linea: '#EADCC9', muted: '#6C8189' };

  // Canales de venta
  e.config.canales = M.canalesDefault();

  // Mesas
  for (let i = 1; i <= 10; i++) { const m = M.crearMesa({ nombre: 'Mesa ' + i, sucursalId: suc.id }); e.mesas[m.id] = m; }

  return e;
}

module.exports = { buildTenantDoc, buildHawaiianDoc };
