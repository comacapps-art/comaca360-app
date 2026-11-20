'use strict';
// CONGELADO: copia exacta (solo convertida en función de primer nivel) del cálculo `carteraStats` del GerenteDashboard tal como
// estaba en el index.html publicado el 20-nov-2026 (rama desarrollo, commit 69ec69d). Cruzaba cada cliente con TODAS las filas
// del mes (clientes × filas) y llamaba a normalizeId en cada una. Es la referencia contra la que se compara el cálculo nuevo
// (calcularCarteraStats): NO la modifiques.
module.exports = (normalizeId, filtrarCarteraPorVendedor, filtrarCarteraPorEquipo) => ({ cartera, sales, currentMonthStr, selectedVendedorCartera, searchCliente, myTeamIds, myTeam }) => {
    if (!cartera) return { total: 0, activos: 0, inactivos: 0, cobertura: 0, clientes: [] };

    let filteredCartera = cartera;
    if (selectedVendedorCartera) {
        filteredCartera = filtrarCarteraPorVendedor(cartera, selectedVendedorCartera);
    } else {
        filteredCartera = filtrarCarteraPorEquipo(cartera, myTeamIds, myTeam);
    }

    if (searchCliente) {
        const searchLower = searchCliente.toLowerCase();
        filteredCartera = filteredCartera.filter(c =>
            (c.cliente && c.cliente.toLowerCase().includes(searchLower)) ||
            (c.idCliente && c.idCliente.toLowerCase().includes(searchLower))
        );
    }

    const currentSales = sales.filter(s =>
        (s.source === 'currMonth' || (!s.source && s.fecha && String(s.fecha).startsWith(currentMonthStr)))
    );

    const clientsProcessed = filteredCartera.map(c => {
        const codC = normalizeId(c.idCliente);
        const compras = currentSales.filter(s => {
            const codS = normalizeId(s.idCliente);
            if (codC && codS) return codC === codS;
            return s.cliente === c.cliente || (s.rawCliente && s.rawCliente === c.cliente);
        });

        const montoTotal = compras.reduce((sum, s) => sum + s.monto, 0);
        const lastCompra = compras.length > 0 ? compras.sort((a,b) => new Date(b.fecha) - new Date(a.fecha))[0].fecha : null;

        return {
            ...c,
            status: montoTotal > 0 ? 'Activo' : 'Inactivo',
            montoMes: montoTotal,
            ultimaCompra: lastCompra
        };
    });

    const total = clientsProcessed.length;
    const activos = clientsProcessed.filter(c => c.status === 'Activo').length;
    const inactivos = total - activos;
    const cobertura = total > 0 ? (activos / total) * 100 : 0;

    return { total, activos, inactivos, cobertura, clientes: clientsProcessed };
};
