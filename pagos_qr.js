'use strict';
// ============================================================================
//  pagos_qr.js — Pago anticipado con Mercado Pago para el menú QR
// ----------------------------------------------------------------------------
//  Se monta desde server.js con una línea:
//     require('./pagos_qr')(app, { db, M, readState, withState, runPublic });
//
//  Reemplaza al POST /qr/:row/:suc/pedido original. La diferencia de fondo:
//  antes el cliente pedía y pasaba a caja (caja era el filtro anti-abuso).
//  Ahora paga primero y el pago ES el filtro: al confirmarse, el pedido entra
//  solo a las pantallas de producción.
//
//  Variables de entorno:
//    MP_ACCESS_TOKEN    token privado de Mercado Pago (APP_USR-...)
//    MP_WEBHOOK_SECRET  clave secreta del webhook (panel de MP)
//    PUBLIC_URL         https://comandapro.onrender.com  (sin slash final)
//
//  Sin MP_ACCESS_TOKEN el módulo arranca en MODO DEMO: no llama a Mercado Pago
//  y habilita un endpoint para simular el cobro. Sirve para presentar sin
//  credenciales; en producción basta con poner el token.
// ============================================================================

const crypto = require('crypto');
const MP_API = 'https://api.mercadopago.com';

// Propinas permitidas. El cliente manda el porcentaje, nunca el monto.
const PROPINAS_OK = [0, 10, 15, 20];

module.exports = function montarPagosQR(app, deps) {
  const { db, M, readState, withState, runPublic } = deps;
  if (!db || !M || !withState || !runPublic) throw new Error('pagos_qr: faltan dependencias');

  const TOKEN = process.env.MP_ACCESS_TOKEN || '';
  const SECRET = process.env.MP_WEBHOOK_SECRET || '';
  const BASE = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const DEMO = !TOKEN;

  const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };

  // -------------------------------------------------------------------------
  //  Serialización por tenant
  //  withState hace load → mutar en RAM → save del documento completo. Dos
  //  escrituras simultáneas sobre el mismo row y la segunda pisa a la primera.
  //  Con el webhook entrando por su cuenta eso ya no es hipotético, así que
  //  toda escritura de este módulo pasa por una cola por row.
  // -------------------------------------------------------------------------
  const colas = new Map();
  function enCola(row, fn) {
    const previa = colas.get(row) || Promise.resolve();
    const siguiente = previa.then(fn, fn);
    colas.set(row, siguiente.then(() => {}, () => {}));
    return siguiente;
  }

  // -------------------------------------------------------------------------
  //  Límite por IP: el endpoint es público y cada pedido escribe en el blob.
  // -------------------------------------------------------------------------
  const golpes = new Map();
  function limitar(ip, max = 12, ventanaMs = 10 * 60 * 1000) {
    const ahora = Date.now();
    const arr = (golpes.get(ip) || []).filter((t) => ahora - t < ventanaMs);
    arr.push(ahora);
    golpes.set(ip, arr);
    if (golpes.size > 5000) golpes.clear(); // poda simple
    return arr.length <= max;
  }

  // -------------------------------------------------------------------------
  //  1. Crear pedido + preferencia de pago
  // -------------------------------------------------------------------------
  app.post('/qr/:row/:suc/pedido', (req, res) => {
    const { items = [], cliente = {}, propinaPct = 0 } = req.body || {};
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'ip';

    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Tu pedido está vacío' });
    if (items.length > 40) return res.status(400).json({ error: 'Demasiados productos' });
    if (!limitar(String(ip).split(',')[0].trim())) {
      return res.status(429).json({ error: 'Demasiados pedidos seguidos. Espera un momento o pide al mesero.' });
    }

    const pct = PROPINAS_OK.includes(Number(propinaPct)) ? Number(propinaPct) : 0;
    const row = Number(req.params.row);

    runPublic(row, async () => {
      try {
        const armado = await enCola(row, () => withState((e) => {
          const suc = e.sucursales[req.params.suc];
          if (!suc) throw bad('Sucursal no encontrada', 404);

          const p = M.crearPedido(e, {
            sucursalId: suc.id, codigo: suc.codigo, tipoServicio: 'mostrador',
            usuario: 'qr', canalId: 'local',
          });
          p.origen = 'qr';
          p.cliente = {
            nombre: String(cliente.nombre || 'Cliente QR').slice(0, 40),
            mesa: String(cliente.mesa || '').slice(0, 12) || null,
          };

          for (const it of items) {
            const prod = e.menu.productos[it.productoId];
            if (!prod || prod.activo === false || prod.disponible === false) continue;
            const cantidad = Math.min(20, Math.max(1, parseInt(it.cantidad, 10) || 1));
            // crearLinea resuelve los modificadores contra el menú y fija el
            // precio. El navegador nunca dicta importes.
            p.lineas.push(M.crearLinea(prod, e, {
              cantidad,
              modsElegidos: Array.isArray(it.modsElegidos) ? it.modsElegidos.slice(0, 12) : [],
              notas: String(it.notas || '').slice(0, 120),
            }));
          }
          if (!p.lineas.length) throw bad('Ningún producto válido en el pedido');

          M.recalcularPedido(p);
          const propinaMonto = M.r2(p.total * pct / 100);

          // Estado de cobro propio del flujo QR. Mientras no esté 'pagado' no
          // se llama a mandarComanda, así que producción no lo ve.
          p.pagoQr = {
            estado: 'pendiente',
            proveedor: DEMO ? 'demo' : 'mercadopago',
            preferenceId: null,
            paymentId: null,
            propinaPct: pct,
            propinaMonto,
            aCobrar: M.r2(p.total + propinaMonto),
            creado: new Date().toISOString(),
            confirmado: null,
            porConciliar: false,
          };

          return {
            folio: p.folio,
            total: p.total,
            propina: propinaMonto,
            aCobrar: p.pagoQr.aCobrar,
            mesa: p.cliente.mesa,
            sucursalNombre: suc.nombre,
            lineas: p.lineas.map((l) => ({ nombre: l.nombre, cantidad: l.cantidad, importe: l.importe })),
          };
        }));

        if (DEMO) {
          return res.json({ ...armado, demo: true, init_point: null });
        }

        // Preferencia fuera de withState: es una llamada de red, no debe
        // sostener el documento del tenant abierto.
        const pref = await crearPreferencia(row, req.params.suc, armado);
        await enCola(row, () => withState((e) => {
          const p = e.pedidos[armado.folio];
          if (p && p.pagoQr) { p.pagoQr.preferenceId = pref.id; }
          return true;
        }));

        res.json({ ...armado, preference_id: pref.id, init_point: pref.init_point });
      } catch (err) {
        console.error('[pagos_qr] crear pedido:', err && err.message);
        res.status(err.status || 500).json({ error: err.message || 'No se pudo crear el pedido' });
      }
    });
  });

  async function crearPreferencia(row, sucId, armado) {
    const body = {
      external_reference: `${row}|${armado.folio}`,
      items: armado.lineas.map((l) => ({
        title: l.nombre.slice(0, 250),
        quantity: l.cantidad,
        unit_price: M.r2(l.importe / l.cantidad),
        currency_id: 'MXN',
      })),
      back_urls: {
        success: `${BASE}/qr/${row}/${sucId}?folio=${armado.folio}`,
        failure: `${BASE}/qr/${row}/${sucId}?folio=${armado.folio}&pago=fallo`,
        pending: `${BASE}/qr/${row}/${sucId}?folio=${armado.folio}&pago=pendiente`,
      },
      auto_return: 'approved',
      notification_url: `${BASE}/qr/mp/webhook`,
      statement_descriptor: 'COMANDAPRO',
      metadata: { row, folio: armado.folio, mesa: armado.mesa || '' },
    };
    if (armado.propina > 0) {
      body.items.push({ title: 'Propina', quantity: 1, unit_price: armado.propina, currency_id: 'MXN' });
    }

    const r = await fetch(`${MP_API}/checkout/preferences`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `${row}-${armado.folio}`,
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error('Mercado Pago rechazó la preferencia: ' + JSON.stringify(data).slice(0, 300));
    return data;
  }

  // -------------------------------------------------------------------------
  //  2. Webhook de Mercado Pago
  // -------------------------------------------------------------------------
  app.post('/qr/mp/webhook', (req, res) => {
    res.status(200).send('ok'); // MP reintenta si tardamos: contestar primero
    (async () => {
      try {
        const tipo = req.query.type || (req.body && req.body.type);
        if (tipo !== 'payment') return;

        const paymentId = String((req.body && req.body.data && req.body.data.id) || req.query['data.id'] || '');
        if (!paymentId) return;

        if (SECRET && !firmaValida(req, paymentId)) {
          console.warn('[pagos_qr] webhook con firma inválida, pago', paymentId);
          return;
        }

        const r = await fetch(`${MP_API}/v1/payments/${paymentId}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
        const pago = await r.json();
        if (!r.ok) { console.error('[pagos_qr] no se pudo consultar el pago', pago); return; }
        if (pago.status !== 'approved') return;

        const [rowStr, folio] = String(pago.external_reference || '').split('|');
        const row = Number(rowStr);
        if (!row || !folio) return;

        await confirmarPago(row, folio, paymentId, pago.transaction_amount);
      } catch (err) {
        console.error('[pagos_qr] webhook:', err);
      }
    })();
  });

  // Firma x-signature de Mercado Pago: "ts=...,v1=..."
  function firmaValida(req, paymentId) {
    try {
      const partes = {};
      String(req.headers['x-signature'] || '').split(',').forEach((p) => {
        const i = p.indexOf('=');
        if (i > 0) partes[p.slice(0, i).trim()] = p.slice(i + 1).trim();
      });
      if (!partes.ts || !partes.v1) return false;
      const manifest = `id:${paymentId};request-id:${req.headers['x-request-id'] || ''};ts:${partes.ts};`;
      const calc = crypto.createHmac('sha256', SECRET).update(manifest).digest('hex');
      const a = Buffer.from(calc, 'utf8');
      const b = Buffer.from(partes.v1, 'utf8');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (_) { return false; }
  }

  // -------------------------------------------------------------------------
  //  3. Confirmación: replica exactamente lo que hace /api/pedidos/:folio/cobrar
  // -------------------------------------------------------------------------
  function confirmarPago(row, folio, paymentId, montoRecibido) {
    return runPublic(row, () => enCola(row, () => withState((e) => {
      const p = e.pedidos[folio];
      if (!p) { console.warn('[pagos_qr] folio inexistente', folio); return { ok: false }; }
      if (!p.pagoQr) { console.warn('[pagos_qr] pedido sin pagoQr', folio); return { ok: false }; }
      if (p.pagoQr.estado === 'pagado') return { ok: true, repetido: true }; // idempotente

      p.pagoQr.estado = 'pagado';
      p.pagoQr.paymentId = paymentId ? String(paymentId) : null;
      p.pagoQr.confirmado = new Date().toISOString();
      if (montoRecibido != null) p.pagoQr.montoRecibido = M.r2(montoRecibido);

      // Ahora sí: producción lo ve.
      M.mandarComanda(p);

      const propMonto = p.pagoQr.propinaMonto || 0;
      M.registrarPago(p, {
        pagos: [{ metodo: 'mercadopago', monto: p.total }],
        recibido: 0,
        propina: propMonto > 0 ? { monto: propMonto, metodo: 'mercadopago' } : null,
      });

      // Si la caja está cerrada el cobro no se pierde: queda marcado para
      // conciliar contra el siguiente turno en vez de tronar.
      const turno = M.turnoAbierto(e, p.sucursalId);
      if (turno) {
        p.turnoId = turno.id;
        M.registrarVentaEnTurno(turno, p);
      } else {
        p.pagoQr.porConciliar = true;
        console.warn(`[pagos_qr] ${folio} pagado sin turno abierto, queda por conciliar`);
      }

      M.descontarInventario(e, p);

      if (p.tipoServicio === 'mesa' && p.mesaId && e.mesas[p.mesaId]) {
        e.mesas[p.mesaId].estado = 'libre';
        e.mesas[p.mesaId].pedidoFolio = null;
      }

      console.log(`[pagos_qr] pago confirmado ${folio} · ${p.total}${propMonto ? ' + propina ' + propMonto : ''}`);
      return { ok: true };
    })));
  }

  // -------------------------------------------------------------------------
  //  4. Estado en vivo para el cliente (público, sin token)
  // -------------------------------------------------------------------------
  app.get('/qr/:row/:suc/pedido/:folio', (req, res) => {
    runPublic(Number(req.params.row), async () => {
      try {
        const e = await readState();
        if (!e) return res.status(404).json({ error: 'No disponible' });
        const p = e.pedidos[req.params.folio];
        if (!p || p.origen !== 'qr') return res.status(404).json({ error: 'Pedido no encontrado' });

        const pagado = !!(p.pagoQr && p.pagoQr.estado === 'pagado');
        const lineas = p.lineas || [];
        const servidas = lineas.filter((l) => l.cocina === 'servido').length;

        let paso = 0;                        // esperando pago
        if (pagado) paso = 1;                // recibido
        if (pagado && p.tiemposCocina.recibido) paso = 2; // en preparación
        if (p._kdsListo) paso = 3;           // listo
        if (lineas.length && servidas === lineas.length) paso = 4; // entregado

        const porEstacion = {};
        for (const l of lineas) {
          const k = l.estacion || 'Cocina';
          if (!porEstacion[k]) porEstacion[k] = { estacion: k, productos: 0, servidos: 0 };
          porEstacion[k].productos += l.cantidad;
          if (l.cocina === 'servido') porEstacion[k].servidos += l.cantidad;
        }

        res.json({
          folio: p.folio,
          mesa: p.cliente ? p.cliente.mesa : null,
          estado: p.estado,
          pagado,
          paso,
          cancelado: p.estado === 'cancelado',
          total: p.total,
          propina: (p.pagoQr && p.pagoQr.propinaMonto) || 0,
          aCobrar: (p.pagoQr && p.pagoQr.aCobrar) || p.total,
          creado: p.creado,
          confirmado: (p.pagoQr && p.pagoQr.confirmado) || null,
          estaciones: Object.values(porEstacion),
          items: lineas.map((l) => ({
            cantidad: l.cantidad, nombre: l.nombre, estacion: l.estacion || 'Cocina',
            modificadores: (l.modificadores || []).map((m) => m.opcionNombre),
          })),
        });
      } catch (err) {
        console.error('[pagos_qr] estado:', err && err.message);
        res.status(500).json({ error: 'Error al consultar el pedido' });
      }
    });
  });

  // -------------------------------------------------------------------------
  //  5. Modo demo: simular el cobro sin credenciales de Mercado Pago
  // -------------------------------------------------------------------------
  if (DEMO) {
    app.post('/qr/:row/:suc/pedido/:folio/simular-pago', async (req, res) => {
      try {
        await confirmarPago(Number(req.params.row), req.params.folio, 'DEMO-' + Date.now(), null);
        res.json({ ok: true, demo: true });
      } catch (err) {
        res.status(500).json({ error: err.message || 'No se pudo simular el pago' });
      }
    });
  }

  // -------------------------------------------------------------------------
  //  6. Conciliación de cobros que entraron con la caja cerrada
  //     Van montados bajo /api, así que heredan el auth JWT del server.
  // -------------------------------------------------------------------------
  app.get('/api/qr/por-conciliar', async (req, res) => {
    try {
      const e = await readState();
      const arr = Object.values(e.pedidos)
        .filter((p) => p.pagoQr && p.pagoQr.porConciliar && !p.turnoId)
        .map((p) => ({
          folio: p.folio, sucursalId: p.sucursalId, total: p.total,
          propina: p.pagoQr.propinaMonto || 0, paymentId: p.pagoQr.paymentId,
          confirmado: p.pagoQr.confirmado, mesa: p.cliente ? p.cliente.mesa : null,
        }))
        .sort((a, b) => new Date(a.confirmado) - new Date(b.confirmado));
      res.json(arr);
    } catch (err) {
      res.status(500).json({ error: 'Error al consultar' });
    }
  });

  app.post('/api/qr/:folio/conciliar', async (req, res) => {
    try {
      const c = deps.ctx ? deps.ctx() : null;
      const row = c ? c.row : null;
      const aplicar = () => withState((e) => {
        const p = e.pedidos[req.params.folio];
        if (!p) throw bad('Pedido inexistente', 404);
        if (!p.pagoQr || !p.pagoQr.porConciliar) throw bad('Ese pedido no está pendiente de conciliar', 409);
        if (p.turnoId) throw bad('Ya está asignado a un turno', 409);
        const turno = M.turnoAbierto(e, p.sucursalId);
        if (!turno) throw bad('No hay turno de caja abierto en esa sucursal', 409);
        p.turnoId = turno.id;
        M.registrarVentaEnTurno(turno, p);
        p.pagoQr.porConciliar = false;
        p.pagoQr.conciliado = new Date().toISOString();
        return { ok: true, folio: p.folio, turnoId: turno.id };
      });
      const out = row ? await enCola(row, aplicar) : await aplicar();
      res.json(out);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'No se pudo conciliar' });
    }
  });

  console.log('[pagos_qr] montado · ' + (DEMO
    ? 'MODO DEMO (sin MP_ACCESS_TOKEN): el cobro se simula'
    : 'Mercado Pago activo' + (SECRET ? ' con firma de webhook' : ' SIN MP_WEBHOOK_SECRET (webhook sin validar)')));
};
