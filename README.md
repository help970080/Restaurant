# ComandaPro — Backend

POS y administración de restaurante, multi-tenant, sobre la misma arquitectura de CobraPro:
Express + PostgreSQL con **un documento JSONB por tenant** (`comandapro_state`, fila `id=0` = SYS),
aislamiento por tenant con `AsyncLocalStorage` y auth con JWT.

## Archivos

| Archivo | Qué hace |
|---|---|
| `model.js` | Lógica pura del dominio (menú, pedido, caja, inventario). Sin DB ni DOM. |
| `db.js` | Pool de Postgres, tabla `comandapro_state`, carga/guardado del documento. |
| `context.js` | `AsyncLocalStorage` por tenant + middleware de auth JWT + `withState()`. |
| `seed.js` | Construye el documento inicial de un tenant (menú/insumos/mesas). |
| `server.js` | API REST con todos los endpoints. |
| `test_integracion.js` | Prueba end-to-end contra Postgres en memoria (`npm test`). |

## Variables de entorno (obligatorias)

```
DATABASE_URL=postgres://usuario:pass@host:5432/comandapro
JWT_SECRET=<cadena larga y aleatoria>      # el server NO arranca sin esto
SETUP_TOKEN=<token para provisionar tenants>
PORT=3000
```

`JWT_SECRET` y `SETUP_TOKEN` no tienen valores por defecto a propósito: si faltan, el server falla
al arrancar. Genéralos con `openssl rand -hex 32`.

## Correr local

```bash
npm install
# exporta las variables de arriba (DATABASE_URL apuntando a un Postgres real)
npm start
```

## Provisionar el primer restaurante

```bash
curl -X POST http://localhost:3000/api/admin/provision \
  -H "x-setup-token: $SETUP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Jefe Burgers","adminUser":"enrique","adminPass":"cobra2026"}'
```

Luego login para obtener el token:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"enrique","password":"cobra2026"}'
```

Usa el `token` devuelto como `Authorization: Bearer <token>` en todo lo demás.

## Endpoints

```
POST   /api/auth/login                      { username, password } -> { token }
POST   /api/admin/provision                 (header x-setup-token)  crea tenant + admin

GET    /api/menu
POST   /api/menu/categorias
POST   /api/menu/grupos
POST   /api/menu/productos
PATCH  /api/menu/productos/:id
GET    /api/sucursales

POST   /api/caja/abrir                       { sucursalId, fondoInicial }
GET    /api/caja/turno-actual?sucursalId=
POST   /api/caja/movimiento                  { sucursalId, tipo:entrada|salida, monto, motivo }
POST   /api/caja/cerrar                       { turnoId, conteoEfectivo }

POST   /api/pedidos                           { sucursalId, tipoServicio, mesaId? }
POST   /api/pedidos/:folio/lineas             { productoId, cantidad, modsElegidos[], notas }
DELETE /api/pedidos/:folio/lineas/:lineaId
PATCH  /api/pedidos/:folio                     { costoEnvio?, propina?, descuento? }
POST   /api/pedidos/:folio/comanda             (manda a cocina sin cobrar — rondas de mesa)
POST   /api/pedidos/:folio/cobrar              { pagos:[{metodo,monto}], recibido }
GET    /api/pedidos?estado=&sucursalId=

GET    /api/cocina?sucursalId=                 (órdenes con items enviados a cocina)
POST   /api/cocina/:folio/listo
POST   /api/cocina/:folio/entregar

GET    /api/inventario                         (stock + food cost por producto)
POST   /api/inventario/insumos
POST   /api/inventario/insumos/:id/entrada     { cantidad }

GET    /api/mesas?sucursalId=
POST   /api/mesas/:id/cuenta

GET    /api/reportes/resumen?sucursalId=
GET    /api/estado                             (documento completo del tenant)
```

## Flujo de servicio

- **Mostrador / domicilio**: crear pedido → agregar líneas → `cobrar` (dispara la comanda a cocina al pagar).
- **Mesa**: crear pedido con `mesaId` (abre cuenta) → agregar líneas → `comanda` (sale a cocina, sin cobrar) →
  repetir rondas → `cobrar` al final (libera la mesa). El pedido queda `abierto` hasta que se paga.

## Desplegar en Render

- Servicio Web Node. Build `npm install`, Start `npm start`.
- Postgres de Render: pon su `DATABASE_URL` en las env vars (el SSL ya se maneja solo).
- Configura `JWT_SECRET` y `SETUP_TOKEN` en el panel de Render.
- La tabla se crea sola al primer arranque (`initDB`).
- El proxy de Cloudflare Worker apunta igual que en CobraPro.

## Pendiente de endurecer (siguiente iteración)

- `withState` hace lectura-modificación-escritura del documento. Para alta concurrencia conviene
  envolverlo en una transacción con `SELECT ... FOR UPDATE` (bloqueo de fila). Hoy basta para
  uno o pocos cajeros por sucursal.
- Roles finos (cajero vs admin) por endpoint.
- Archivado de pedidos cobrados al cerrar turno, para que el documento vivo no crezca sin límite.

## Frontend incluido

El frontend (SPA en `public/index.html`) lo sirve **el mismo servicio** de Render — no necesitas
un segundo deploy. Al entrar a la URL raíz aparece el login; usa el `adminUser`/`adminPass` con que
provisionaste el tenant. El token JWT se guarda en el navegador (localStorage).

- Productos con ilustración por defecto; si pones una URL en el campo "foto", muestra la imagen real.
- Mesas con vista de salón (icono por estado) y flujo de cuenta abierta (abrir → rondas a cocina → cobrar al final).
- Cocina (KDS) refresca sola cada 10s.

No requiere build: es HTML+JS plano. Render solo necesita `npm install` y `npm start`.
