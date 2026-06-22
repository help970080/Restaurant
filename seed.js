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

  // Mesas (6 por sucursal)
  for (const suc of [a, b]) for (let i = 1; i <= 6; i++) { const m = M.crearMesa({ nombre: 'Mesa ' + i, sucursalId: suc.id }); e.mesas[m.id] = m; }

  return e;
}

module.exports = { buildTenantDoc };
