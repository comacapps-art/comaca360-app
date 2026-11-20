'use strict';
// CONGELADO: la función agregarActivacionPorProducto tal como estaba en desarrollo el 20-nov-2026, ANTES de descontar
// las devoluciones (descartaba las filas con monto y cajas <= 0). Es la referencia contra la que prueba_activacion.js
// comprueba que el cambio no altera quién cuenta como activo. NO la modifiques.
module.exports = (normalizeId) => {
    const agregarActivacionPorProducto = (sales, cartera, filtros) => {
        const { grupo, subgrupo, articulo, desde, hasta } = filtros || {};
    
        const rutas = new Map(); // idVendedorNorm -> { idVendedor, vendedor, clientes: Map(idClienteNorm -> {idCliente, cliente}) }
        // Un nombre "real" es cualquiera que no sea, en el fondo, el mismo código repetido
        // (columna VENDEDOR de la cartera cargada solo con el número, sin nombre detrás).
        const esNombreDeRutaReal = (nom, id) => !!nom && nom.trim() !== '' && normalizeId(nom) !== normalizeId(id);
        const obtenerRuta = (idVendedorRaw, vendedorRaw) => {
            const key = normalizeId(idVendedorRaw) || 'S/N';
            if (!rutas.has(key)) rutas.set(key, { idVendedor: idVendedorRaw || 'S/N', vendedor: vendedorRaw || idVendedorRaw || 'Sin ruta', clientes: new Map() });
            const r = rutas.get(key);
            // Se confirma el nombre solo cuando aporta algo distinto del código: si la
            // cartera trae el vendedor sin nombre detrás, no debe bloquear que el nombre
            // real que sí traiga `sales` (o viceversa) termine mostrándose.
            if (!r.vendedorConfirmado && esNombreDeRutaReal(vendedorRaw, idVendedorRaw)) {
                r.vendedor = vendedorRaw;
                r.vendedorConfirmado = true;
            }
            return { r, key };
        };
    
        // Universo: la cartera asignada a cada ruta.
        (cartera || []).forEach(c => {
            if (!c || !c.idCliente) return;
            const { r } = obtenerRuta(c.idVendedor, c.vendedorNombre);
            const idC = normalizeId(c.idCliente) || c.idCliente;
            if (!r.clientes.has(idC)) r.clientes.set(idC, { idCliente: c.idCliente, cliente: c.cliente || idC });
        });
    
        // Clientes activos: agregado por (ruta, cliente) desde las ventas filtradas.
        const activos = new Map(); // "idVendedorNorm||idClienteNorm" -> registro con monto/cajas
        (sales || []).forEach(s => {
            if (!s || !s.fecha) return;
            if (grupo && s.grupo !== grupo) return;
            if (subgrupo && s.subgrupo !== subgrupo) return;
            if (articulo && s.articulo !== articulo) return;
            const fechaStr = String(s.fecha).slice(0, 10);
            if (desde && fechaStr < desde) return;
            if (hasta && fechaStr > hasta) return;
    
            const monto = Number(s.monto) || 0;
            const cajas = Number(s.cajas) || 0;
            if (monto <= 0 && cajas <= 0) return; // no aporta activación
    
            const { key: idVKey } = obtenerRuta(s.idVendedor, s.vendedor);
            const idC = normalizeId(s.idCliente) || s.idCliente || 'S/N';
            const key = idVKey + '||' + idC;
            if (!activos.has(key)) {
                activos.set(key, {
                    idVendedorKey: idVKey, idCliente: s.idCliente || idC, cliente: s.cliente || idC,
                    monto: 0, cajas: 0, ultimaCompra: fechaStr
                });
            }
            const a = activos.get(key);
            a.monto += monto;
            a.cajas += cajas;
            if (fechaStr > a.ultimaCompra) a.ultimaCompra = fechaStr;
        });
    
        const porRuta = [];
        rutas.forEach((r, key) => {
            const clientesActivos = [];
            activos.forEach(a => { if (a.idVendedorKey === key) clientesActivos.push(a); });
    
            const idsActivos = new Set(clientesActivos.map(a => normalizeId(a.idCliente) || a.idCliente));
            const clientesInactivos = Array.from(r.clientes.values()).filter(c => !idsActivos.has(normalizeId(c.idCliente) || c.idCliente));
    
            if (clientesActivos.length === 0 && clientesInactivos.length === 0) return; // ruta sin datos, no aporta
    
            clientesActivos.sort((a, b) => b.monto - a.monto);
            clientesInactivos.sort((a, b) => (a.cliente || '').localeCompare(b.cliente || ''));
    
            porRuta.push({
                idVendedor: r.idVendedor, vendedor: r.vendedor,
                clientesActivos: clientesActivos.length,
                monto: clientesActivos.reduce((s, a) => s + a.monto, 0),
                cajas: clientesActivos.reduce((s, a) => s + a.cajas, 0),
                clientes: clientesActivos,
                clientesSinActivar: clientesInactivos.length,
                clientesInactivos
            });
        });
        porRuta.sort((a, b) => b.clientesActivos - a.clientesActivos);
    
        // Totales únicos (no por par ruta-cliente): si el mismo código aparece repartido
        // en dos rutas por datos sucios, cuenta una sola vez en cada total.
        const idsActivosUnicos = new Set();
        activos.forEach(a => idsActivosUnicos.add(normalizeId(a.idCliente) || a.idCliente));
        const idsInactivosUnicos = new Set();
        porRuta.forEach(r => r.clientesInactivos.forEach(c => idsInactivosUnicos.add(normalizeId(c.idCliente) || c.idCliente)));
    
        return {
            porRuta,
            totalClientesActivos: idsActivosUnicos.size,
            totalClientesSinActivar: idsInactivosUnicos.size
        };
    };
    return agregarActivacionPorProducto;
};
