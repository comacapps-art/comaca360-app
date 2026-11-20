'use strict';
// Prueba del "Resumen de Cartera" del administrador y el gerente: el cálculo nuevo (calcularCarteraStats, con índices) debe dar
// EXACTAMENTE el mismo resultado que el anterior (cruce clientes × filas), y ser mucho más rápido. Corre en Node, sin navegador,
// sin red y con datos inventados.
//
//   node herramientas/medicion_ventas/prueba_cartera.js
//
// Compara la función `calcularCarteraStats` de tu index.html con la copia congelada del 20-nov-2026 (cartera_congelada_20nov.js).
// Además comprueba que la propia prueba SIRVE: introduce errores a propósito en una copia de la función (los "mutantes") y exige
// que la prueba los detecte. Una prueba que no detecta un error inventado no protege de uno real.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SALIDA = path.join(__dirname, 'cartera_extraido.js');
execFileSync(process.execPath, [path.join(__dirname, 'extraer.js'), '--extra', 'filtrarCarteraPorVendedor,filtrarCarteraPorEquipo,calcularCarteraStats,STATS_CARTERA_VACIO,SIN_VENTAS_DE_EQUIPO', '--salida', SALIDA], { stdio: 'inherit' });
const actual = require(SALIDA);
const { normalizeId, filtrarCarteraPorVendedor, filtrarCarteraPorEquipo } = actual;
const nueva = actual.calcularCarteraStats;
const antes = require('./cartera_congelada_20nov.js')(normalizeId, filtrarCarteraPorVendedor, filtrarCarteraPorEquipo);

let ok = 0, mal = 0;
const prueba = (nombre, fn) => { try { fn(); ok++; console.log('  ok    ' + nombre); } catch (e) { mal++; console.log('  FALLA ' + nombre + '\n        ' + String(e.message).split('\n').slice(0, 4).join('\n        ')); } };

// ---- datos inventados con semilla fija
let semilla = 20261121;
const azar = () => { semilla = (semilla * 1664525 + 1013904223) >>> 0; return semilla / 4294967296; };
const elige = (a) => a[Math.floor(azar() * a.length)];
const redondea = (x) => Math.round(x * 100) / 100;
const conOSinCeros = (n, ancho) => (azar() < 0.5 ? String(n) : String(n).padStart(ancho, '0')); // "52" o "000052": normalizeId los iguala

// `sucio`=true añade lo que en los datos reales puede aparecer: códigos con y sin ceros, códigos vacíos o con símbolos, nombres
// repetidos entre clientes de distinto código, rawCliente distinto del nombre, cliente sin nombre, fechas repetidas, montos
// negativos y decimales, filas sin source, y ventas de otros meses.
function genera(sucio, tam) {
  const nClientes = 3 + Math.floor(azar() * (tam || 14)), nFilas = Math.floor(azar() * (tam ? tam * 6 : 70));
  const nombres = Array.from({ length: Math.max(2, Math.floor(nClientes * 0.7)) }, (_, i) => 'CLIENTE ' + i); // menos nombres que clientes: hay repetidos
  const cartera = [];
  for (let i = 0; i < nClientes; i++) {
    const sinCodigo = sucio && azar() < 0.12;
    cartera.push({ idCliente: sinCodigo ? elige(['', ' ', '--', undefined]) : conOSinCeros(100 + i, 6), cliente: sucio ? elige(nombres) : 'CLIENTE ' + i, idVendedor: conOSinCeros(50 + Math.floor(azar() * 3), 3), vendedorNombre: 'RUTA' });
  }
  const sales = [];
  for (let i = 0; i < nFilas; i++) {
    const c = elige(cartera);
    const sinCodigo = sucio && azar() < 0.15;
    const fila = {
      source: 'currMonth', fecha: '2026-11-' + String(1 + Math.floor(azar() * (sucio ? 4 : 19))).padStart(2, '0'),
      idCliente: sinCodigo ? elige(['', undefined, '--']) : (azar() < 0.1 && sucio ? conOSinCeros(100 + Math.floor(azar() * (nClientes + 3)), 6) : (c.idCliente === undefined ? '' : (azar() < 0.5 ? c.idCliente : String(normalizeId(c.idCliente) || '').padStart(6, '0')))),
      cliente: sucio && azar() < 0.05 ? undefined : (sucio ? elige(nombres) : c.cliente), idVendedor: c.idVendedor,
      monto: redondea((sucio && azar() < 0.2 ? -1 : 1) * (5 + azar() * 900)), cajas: 1, unidades: 1, kilos: 1,
    };
    if (sucio) {
      if (azar() < 0.2) fila.rawCliente = elige(nombres);
      if (azar() < 0.08) delete fila.source;
      if (azar() < 0.08) fila.source = 'currYear';
      if (azar() < 0.05) fila.fecha = '2026-10-15';
    }
    sales.push(fila);
  }
  const equipo = ['050', '51', '052'];
  return {
    cartera, sales, currentMonthStr: '2026-11',
    selectedVendedorCartera: sucio && azar() < 0.25 ? elige(['50', '051', '52']) : '',
    searchCliente: sucio && azar() < 0.2 ? elige(['cliente 1', '10', '000', 'xyz']) : '',
    myTeamIds: (sucio ? equipo.filter(() => azar() < 0.8) : equipo).map(normalizeId), myTeam: equipo.map(id => ({ id })),
  };
}
const mismo = (a, b) => { assert.deepStrictEqual(a, b); }; // compara también el orden y los bits de los decimales

// ---- propiedad: la función (original o mutante) da lo mismo que la congelada; devuelve la cantidad de casos que difieren
function difieren(fn, n, sucio, tam) {
  let malos = 0;
  for (let i = 0; i < n; i++) {
    const caso = genera(sucio, tam);
    let r;
    try { r = fn(caso); } catch (e) { malos++; continue; }
    try { mismo(r, antes(caso)); } catch (e) {
      malos++;
      if (process.env.DEPURAR && !difieren.yaMostro) { difieren.yaMostro = true; console.log('\n  --- primer caso que difiere ---\n  ' + String(e.message).split('\n').slice(0, 12).join('\n  ') + '\n'); }
    }
  }
  return malos;
}

console.log('\n1) Datos limpios: el resultado es IDÉNTICO al de antes');
prueba('3.000 casos limpios -> mismo resultado exacto (orden y decimales incluidos)', () => { assert.strictEqual(difieren(nueva, 3000, false), 0); });

console.log('\n2) Datos sucios (códigos con y sin ceros, vacíos, nombres repetidos, rawCliente, fechas repetidas, devoluciones)');
prueba('5.000 casos sucios pequeños -> mismo resultado exacto', () => { assert.strictEqual(difieren(nueva, 5000, true), 0); });
prueba('400 casos sucios grandes (hasta ≈ 60 clientes y 360 filas) -> mismo resultado exacto', () => { assert.strictEqual(difieren(nueva, 400, true, 60), 0); });

console.log('\n3) La prueba sirve: detecta errores introducidos a propósito (mutantes)');
const textoFuncion = fs.readFileSync(SALIDA, 'utf8');
const mutantes = [
  ['el nombre no cuenta por rawCliente entre las ventas sin código', "                    agregar(todasPorNombre, s.rawCliente, i);\n                    if (!cod) agregar(sinCodigoPorNombre, s.rawCliente, i);", "                    agregar(todasPorNombre, s.rawCliente, i);"],
  ['el nombre no cuenta por rawCliente en ninguna lista', "                    agregar(todasPorNombre, s.rawCliente, i);\n                    if (!cod) agregar(sinCodigoPorNombre, s.rawCliente, i);", "                    /* sin rawCliente */"],
  ['las ventas con código también cruzan por nombre', "                if (!cod) agregar(sinCodigoPorNombre, s.cliente, i);", "                agregar(sinCodigoPorNombre, s.cliente, i);"],
  ['las compras de código y de nombre se juntan sin ordenar', "posiciones = !porNom ? (porCod || []) : (!porCod ? porNom : mezclar(porCod, porNom));", "posiciones = !porNom ? (porCod || []) : (!porCod ? porNom : porCod.concat(porNom));"],
  ['un cliente sin código solo cruza con las ventas sin código', "posiciones = todasPorNombre.get(c.cliente) || [];", "posiciones = sinCodigoPorNombre.get(c.cliente) || [];"],
  ['se olvida el filtro de búsqueda', "if (searchCliente) {", "if (false) {"],
  ['no se normaliza el código de la cartera', "const codC = idNorm(c.idCliente);", "const codC = c.idCliente;"],
  ['se cuentan ventas que no son del mes en curso', "const currentSales = sales.filter(s =>", "const currentSales = sales.filter(s => true ||"],
];
mutantes.forEach(([nombre, de, a], i) => {
  prueba('detecta el error: ' + nombre, () => {
    const deConEol = textoFuncion.includes(de) ? de : de.split('\n').join('\r\n');
    assert.ok(textoFuncion.includes(deConEol), 'no encontré en la función el trozo que se iba a estropear: ' + de.slice(0, 60));
    const ruta = path.join(__dirname, `cartera_mutante_${i}.js`);
    fs.writeFileSync(ruta, textoFuncion.replace(deConEol, () => (deConEol === de ? a : a.split('\n').join('\r\n'))));
    try {
      const mutante = require(ruta).calcularCarteraStats;
      assert.ok(difieren(mutante, 1500, true, 30) > 0, 'la prueba NO detectó este error: no protege de él');
    } finally { try { fs.unlinkSync(ruta); } catch (e) { /* ya no está */ } delete require.cache[require.resolve(ruta)]; }
  });
});

console.log('\n4) Casos concretos');
const fila = (idCliente, cliente, monto, extra) => Object.assign({ source: 'currMonth', fecha: '2026-11-10', idCliente, cliente, monto, cajas: 1 }, extra || {});
const base = { currentMonthStr: '2026-11', selectedVendedorCartera: '', searchCliente: '', myTeamIds: ['53'], myTeam: [{ id: '053' }] };
const cli = (idCliente, cliente) => ({ idCliente, cliente, idVendedor: '053', vendedorNombre: 'RUTA' });
prueba('dos sucursales con el mismo nombre y distinto código no se mezclan', () => {
  const r = nueva({ ...base, cartera: [cli('005196', 'MISMO NOMBRE'), cli('003622', 'MISMO NOMBRE')], sales: [fila('005196', 'MISMO NOMBRE', 100)] });
  assert.deepStrictEqual(r.clientes.map(c => [c.idCliente, c.status, c.montoMes]), [['005196', 'Activo', 100], ['003622', 'Inactivo', 0]]);
});
prueba('una venta sin código cruza por nombre con el cliente que sí tiene código', () => {
  const r = nueva({ ...base, cartera: [cli('000010', 'PANADERIA X')], sales: [fila('', 'PANADERIA X', 40), fila('10', 'PANADERIA X', 60)] });
  assert.strictEqual(r.clientes[0].montoMes, 100);
});
prueba('el código "000197" de ventas y "197" de cartera es el mismo cliente', () => {
  const r = nueva({ ...base, cartera: [cli('197', 'A')], sales: [fila('000197', 'OTRO NOMBRE', 25)] });
  assert.strictEqual(r.clientes[0].montoMes, 25);
});
prueba('sin cartera devuelve el resultado vacío', () => {
  assert.deepStrictEqual(nueva({ ...base, cartera: null, sales: [] }), { total: 0, activos: 0, inactivos: 0, cobertura: 0, clientes: [] });
});
prueba('la fecha de última compra es la más reciente aunque las ventas lleguen desordenadas', () => {
  const r = nueva({ ...base, cartera: [cli('1', 'A')], sales: [fila('1', 'A', 5, { fecha: '2026-11-03' }), fila('1', 'A', 5, { fecha: '2026-11-17' }), fila('1', 'A', 5, { fecha: '2026-11-09' })] });
  assert.strictEqual(r.clientes[0].ultimaCompra, '2026-11-17');
});

console.log('\n5) Velocidad con el tamaño real (3.034 clientes; 16.264 y 62.000 filas del mes)');
function datosReales(nFilas) {
  const cartera = Array.from({ length: 3034 }, (_, i) => ({ idCliente: String(1000 + i).padStart(6, '0'), cliente: 'CLIENTE ' + i, idVendedor: '053', vendedorNombre: 'RUTA' }));
  const sales = Array.from({ length: nFilas }, () => { const c = cartera[Math.floor(azar() * 1500)]; return { source: 'currMonth', idCliente: c.idCliente, cliente: c.cliente, rawCliente: c.cliente, fecha: '2026-11-' + String(1 + Math.floor(azar() * 19)).padStart(2, '0'), monto: redondea(azar() * 300 - 3), cajas: 1 }; });
  return { ...base, cartera, sales };
}
for (const n of [16264, 62000]) {
  prueba(`${n} filas: mismo resultado y el cálculo nuevo tarda menos de 1 segundo`, () => {
    const d = datosReales(n);
    let t = process.hrtime.bigint(); const r = nueva(d); const ms = Number(process.hrtime.bigint() - t) / 1e6;
    t = process.hrtime.bigint(); const a = antes(d); const msAntes = Number(process.hrtime.bigint() - t) / 1e6;
    mismo(r, a);
    console.log(`        antes ${(msAntes / 1000).toFixed(2)} s, ahora ${ms.toFixed(0)} ms (en esta computadora; un teléfono es más lento)`);
    assert.ok(ms < 1000, 'tardó ' + ms.toFixed(0) + ' ms');
  });
}

console.log(`\n${ok} pruebas bien, ${mal} con falla`);
process.exit(mal === 0 ? 0 : 1);
