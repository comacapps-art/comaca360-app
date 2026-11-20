'use strict';
// Prueba de la pantalla "Activación por Producto": que sus montos y cajas descuenten las devoluciones (como la pantalla
// principal de ventas) sin cambiar QUIÉN cuenta como activo. Corre en Node, sin navegador, sin red y con datos inventados.
//
//   node herramientas/medicion_ventas/prueba_activacion.js
//
// Compara la función `agregarActivacionPorProducto` de tu index.html con la versión congelada del 20-nov-2026
// (activacion_congelada_20nov.js), que es la anterior al cambio y NO descontaba devoluciones.
// Además comprueba que la propia prueba SIRVE: introduce errores a propósito en una copia de la función (los "mutantes")
// y exige que la prueba los detecte. Una prueba que no detecta un error inventado no protege de uno real.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SALIDA = path.join(__dirname, 'activacion_extraido.js');
execFileSync(process.execPath, [path.join(__dirname, 'extraer.js'), '--extra', 'agregarActivacionPorProducto', '--salida', SALIDA], { stdio: 'inherit' });
const actual = require(SALIDA);
const normalizeId = actual.normalizeId;
const nueva = actual.agregarActivacionPorProducto;
const antes = require('./activacion_congelada_20nov.js')(normalizeId);

let ok = 0, mal = 0;
const prueba = (nombre, fn) => { try { fn(); ok++; console.log('  ok    ' + nombre); } catch (e) { mal++; console.log('  FALLA ' + nombre + '\n        ' + String(e.message).split('\n').slice(0, 4).join('\n        ')); } };
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ''} esperado ${b}, salió ${a}`);

// ---- datos inventados con semilla fija
let semilla = 20261120;
const azar = () => { semilla = (semilla * 1664525 + 1013904223) >>> 0; return semilla / 4294967296; };
const elige = (a) => a[Math.floor(azar() * a.length)];
const redondea = (x) => Math.round(x * 100) / 100;
const conOSinCeros = (id, ancho) => (azar() < 0.5 ? String(Number(id)) : String(Number(id)).padStart(ancho, '0')); // "50" o "050": normalizeId los iguala

// `sucio`=true añade lo que en los datos reales puede aparecer: devoluciones, filas con signos mezclados (monto positivo y cajas
// negativas o al revés), montos o cajas en cero, códigos con y sin ceros a la izquierda, y clientes "S/N".
function genera(sucio) {
  const nRutas = 1 + Math.floor(azar() * 3), nClientes = 4 + Math.floor(azar() * 10);
  const rutas = Array.from({ length: nRutas }, (_, i) => ({ n: 50 + i, nombre: 'RUTA ' + (50 + i) }));
  const clientes = Array.from({ length: nClientes }, (_, i) => ({ n: 100 + i, nombre: 'CLIENTE ' + i }));
  const grupos = ['A', 'B', 'C'], articulos = ['X1', 'X2', 'X3', 'X4'];
  const sales = [];
  const n = Math.floor(azar() * 40);
  for (let i = 0; i < n; i++) {
    const r = elige(rutas), c = elige(clientes), g = elige(grupos);
    let monto = redondea(10 + azar() * 900), cajas = redondea(1 + azar() * 30), tipo = 'FA';
    if (sucio) {
      const t = azar();
      if (t < 0.22) { monto = -monto; cajas = -cajas; tipo = 'DV'; }          // devolución
      else if (t < 0.30) { cajas = -cajas; }                                    // monto positivo, cajas negativas
      else if (t < 0.38) { monto = -monto; }                                    // monto negativo, cajas positivas
      else if (t < 0.43) { monto = 0; }                                         // solo cajas
      else if (t < 0.48) { cajas = 0; }                                         // solo monto
      else if (t < 0.51) { monto = 0; cajas = 0; }                              // fila vacía
    }
    const sinCliente = sucio && azar() < 0.05;
    sales.push({
      source: 'currMonth', fecha: '2026-11-' + String(1 + Math.floor(azar() * 19)).padStart(2, '0'),
      idVendedor: conOSinCeros(r.n, 3), vendedor: r.nombre, idCliente: sinCliente ? 'S/N' : conOSinCeros(c.n, 6), cliente: sinCliente ? 'SIN CLIENTE' : c.nombre,
      grupo: g, subgrupo: g + '1', articulo: elige(articulos), tipoDoc: tipo, monto, cajas, unidades: 1, kilos: 1,
    });
  }
  const cartera = clientes.filter(() => azar() < 0.8).map(c => { const r = elige(rutas); return { idCliente: conOSinCeros(c.n, 6), cliente: c.nombre, idVendedor: conOSinCeros(r.n, 3), vendedorNombre: r.nombre }; });
  return { sales, cartera };
}
const filtrosAzar = () => ({ grupo: azar() < 0.3 ? elige(['A', 'B', 'C']) : '', subgrupo: '', articulo: azar() < 0.2 ? elige(['X1', 'X2', 'X3', 'X4']) : '' });
const aplica = (sales, f) => sales.filter(s => (!f.grupo || s.grupo === f.grupo) && (!f.subgrupo || s.subgrupo === f.subgrupo) && (!f.articulo || s.articulo === f.articulo));
// Quita los campos nuevos (internos o de la nota) y redondea a 6 decimales: sumar en otro orden cambia la última cifra de la
// coma flotante (121,84 contra 121,83999999999999) y en pantalla se ve idéntico.
const quitaCampoNuevo = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'devolucionesSinCompra' || k === 'compro') ? undefined : (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)));

// ---- las tres propiedades que debe cumplir la función; devuelven los nombres de las que fallan en `n` casos
function propiedades(fn, n) {
  const falla = new Set();
  for (let i = 0; i < n; i++) {
    const { sales, cartera } = genera(true); const f = filtrosAzar();
    const a = antes(sales, cartera, f);
    let r;
    try { r = fn(sales, cartera, f); } catch (e) { falla.add('no se rompe'); continue; }
    // P1: quién cuenta como activo, quién queda sin activar y la fecha de última compra NO cambian
    try {
      assert.strictEqual(r.totalClientesActivos, a.totalClientesActivos);
      assert.strictEqual(r.totalClientesSinActivar, a.totalClientesSinActivar);
      assert.deepStrictEqual(r.porRuta.map(x => [x.idVendedor, x.clientesActivos, x.clientesSinActivar]), a.porRuta.map(x => [x.idVendedor, x.clientesActivos, x.clientesSinActivar]));
      r.porRuta.forEach((x, j) => {
        assert.deepStrictEqual(x.clientes.map(c => [c.idCliente, c.ultimaCompra]).sort(), a.porRuta[j].clientes.map(c => [c.idCliente, c.ultimaCompra]).sort());
        assert.deepStrictEqual(x.clientesInactivos.map(c => c.idCliente).sort(), a.porRuta[j].clientesInactivos.map(c => c.idCliente).sort());
      });
    } catch (e) {
      falla.add('P1: los activos y la última compra no cambian');
      if (process.env.DEPURAR && !propiedades.yaMostro) { // DEPURAR=1: enseña el primer caso que falla
        propiedades.yaMostro = true;
        const resumen = (x) => JSON.stringify(x.porRuta.map(q => ({ ruta: q.idVendedor, act: q.clientesActivos, sin: q.clientesSinActivar, ids: q.clientes.map(c => c.idCliente + '@' + c.ultimaCompra).sort() })));
        console.log('\n  --- primer caso que falla (P1) ---\n  motivo: ' + String(e.message).split('\n')[0] + '\n  filtros: ' + JSON.stringify(f) + '\n  antes: ' + resumen(a) + '\n  ahora: ' + resumen(r) + '\n  filas: ' + JSON.stringify(aplica(sales, f).map(s => [s.idVendedor, s.idCliente, s.monto, s.cajas, s.fecha.slice(8)])) + '\n  cartera: ' + JSON.stringify(cartera.map(c => [c.idVendedor, c.idCliente])));
      }
    }
    // P2: el monto y las cajas de cada ruta que sale = suma de TODAS las filas de esa ruta (la cuenta de la pantalla principal)
    const porRuta = new Map();
    aplica(sales, f).forEach(s => { const k = normalizeId(s.idVendedor) || 'S/N'; const o = porRuta.get(k) || { monto: 0, cajas: 0 }; o.monto += s.monto; o.cajas += s.cajas; porRuta.set(k, o); });
    try { r.porRuta.forEach(x => { const e = porRuta.get(normalizeId(x.idVendedor) || 'S/N') || { monto: 0, cajas: 0 }; cerca(x.monto, e.monto); cerca(x.cajas, e.cajas); }); } catch (e) { falla.add('P2: la ruta suma todas sus filas'); }
    // P3: cada cliente activo muestra su monto y cajas netos, y lo que falta en la lista está en devolucionesSinCompra
    const porCliente = new Map();
    aplica(sales, f).forEach(s => { const k = (normalizeId(s.idVendedor) || 'S/N') + '||' + (normalizeId(s.idCliente) || s.idCliente || 'S/N'); const o = porCliente.get(k) || { monto: 0, cajas: 0 }; o.monto += s.monto; o.cajas += s.cajas; porCliente.set(k, o); });
    try {
      r.porRuta.forEach(x => {
        let sm = 0, sc = 0;
        x.clientes.forEach(c => { const e = porCliente.get((normalizeId(x.idVendedor) || 'S/N') + '||' + (normalizeId(c.idCliente) || c.idCliente)); cerca(c.monto, e.monto); cerca(c.cajas, e.cajas); sm += c.monto; sc += c.cajas; });
        cerca(x.monto - sm, x.devolucionesSinCompra.monto); cerca(x.cajas - sc, x.devolucionesSinCompra.cajas);
      });
    } catch (e) { falla.add('P3: cada cliente neto y las devoluciones sin compra'); }
  }
  return [...falla];
}

console.log('\n1) Sin devoluciones ni datos raros: el resultado es IDÉNTICO al de antes');
prueba('3.000 casos inventados con solo ventas -> mismo resultado exacto', () => {
  for (let i = 0; i < 3000; i++) {
    const { sales, cartera } = genera(false); const f = filtrosAzar();
    const n = JSON.stringify(quitaCampoNuevo(nueva(sales, cartera, f))), a = JSON.stringify(quitaCampoNuevo(antes(sales, cartera, f)));
    if (n !== a) { let k = 0; while (k < n.length && n[k] === a[k]) k++; throw new Error(`caso ${i}: difieren desde el carácter ${k}\n nueva: ...${n.slice(Math.max(0, k - 80), k + 120)}\n antes: ...${a.slice(Math.max(0, k - 80), k + 120)}`); }
  }
});

console.log('\n2) Con datos sucios (devoluciones, signos mezclados, ceros, códigos con y sin ceros, "S/N")');
prueba('3.000 casos: se cumplen las tres propiedades (activos intactos, ruta = suma de todo, cliente neto)', () => {
  const fallas = propiedades(nueva, 3000);
  assert.deepStrictEqual(fallas, [], 'propiedades que fallan: ' + fallas.join(' | '));
});

console.log('\n3) La prueba sirve: detecta errores introducidos a propósito (mutantes)');
const textoFuncion = fs.readFileSync(SALIDA, 'utf8');
const mutantes = [
  ['una devolución activa al cliente', 'if (monto > 0 || cajas > 0) { // solo una venta activa', 'if (true) { // solo una venta activa'],
  ['la ruta solo suma lo que muestra la lista', 'monto: montoRuta,', 'monto: montoRuta - devMonto,'],
  ['las devoluciones suman en vez de restar', 'a.monto += monto;', 'a.monto += Math.abs(monto);'],
  ['las cajas de la ruta no incluyen devoluciones de clientes sin compra', 'cajas: cajasRuta,', 'cajas: cajasRuta - devCajas,'],
  ['una devolución mueve la fecha de la última compra', "if (fechaStr > a.ultimaCompra) a.ultimaCompra = fechaStr;\n                }", "}\n                if (fechaStr > a.ultimaCompra) a.ultimaCompra = fechaStr;"],
];
mutantes.forEach(([nombre, de, a], i) => {
  prueba('detecta el error: ' + nombre, () => {
    const deConEol = textoFuncion.includes(de) ? de : de.split('\n').join('\r\n');
    assert.ok(textoFuncion.includes(deConEol), 'no encontré en la función el trozo que se iba a estropear: ' + de.slice(0, 50));
    const ruta = path.join(__dirname, `activacion_mutante_${i}.js`);
    fs.writeFileSync(ruta, textoFuncion.replace(deConEol, () => (deConEol === de ? a : a.split('\n').join('\r\n'))));
    try {
      const mutante = require(ruta).agregarActivacionPorProducto;
      const fallas = propiedades(mutante, 600);
      assert.ok(fallas.length > 0, 'la prueba NO detectó este error: no protege de él');
    } finally { try { fs.unlinkSync(ruta); } catch (e) { /* ya no está */ } delete require.cache[require.resolve(ruta)]; }
  });
});

console.log('\n4) Casos concretos');
const filaBase = { source: 'currMonth', fecha: '2026-11-10', idVendedor: '053', vendedor: 'RUTA 53', grupo: 'A', subgrupo: 'A1', articulo: 'X1', unidades: 1, kilos: 1 };
const venta = (idCliente, monto, cajas, extra) => Object.assign({}, filaBase, { idCliente, cliente: 'CLIENTE ' + idCliente, monto, cajas, tipoDoc: monto < 0 ? 'DV' : 'FA' }, extra || {});
const cartera = [{ idCliente: '000001', cliente: 'CLIENTE 000001', idVendedor: '053', vendedorNombre: 'RUTA 53' }, { idCliente: '000002', cliente: 'CLIENTE 000002', idVendedor: '053', vendedorNombre: 'RUTA 53' }, { idCliente: '000003', cliente: 'CLIENTE 000003', idVendedor: '053', vendedorNombre: 'RUTA 53' }];
prueba('ventas 1.000 y devolución -200 del mismo cliente: la ruta muestra 800 y el cliente 800', () => {
  const r = nueva([venta('000001', 1000, 100), venta('000001', -200, -20)], cartera, {}).porRuta[0];
  cerca(r.monto, 800); cerca(r.cajas, 80); cerca(r.clientes[0].monto, 800); cerca(r.clientes[0].cajas, 80);
});
prueba('un cliente que devolvió todo sigue contando como activo, con monto 0', () => {
  const res = nueva([venta('000001', 500, 50), venta('000001', -500, -50)], cartera, {});
  assert.strictEqual(res.porRuta[0].clientesActivos, 1); cerca(res.porRuta[0].clientes[0].monto, 0); cerca(res.porRuta[0].monto, 0);
});
prueba('devolución de un cliente que NO compró este mes: no sale en la lista ni lo activa, pero resta en el total de la ruta', () => {
  const res = nueva([venta('000001', 1000, 100), venta('000002', -300, -30)], cartera, {});
  const r = res.porRuta[0];
  assert.strictEqual(r.clientesActivos, 1); assert.strictEqual(r.clientes.length, 1); cerca(r.monto, 700); cerca(r.cajas, 70);
  cerca(r.devolucionesSinCompra.monto, -300); cerca(r.devolucionesSinCompra.cajas, -30);
  assert.strictEqual(r.clientesSinActivar, 2);
});
prueba('la fecha de la última compra no la mueve una devolución posterior', () => {
  const r = nueva([venta('000001', 1000, 100, { fecha: '2026-11-05' }), venta('000001', -100, -10, { fecha: '2026-11-18' })], cartera, {}).porRuta[0];
  assert.strictEqual(r.clientes[0].ultimaCompra, '2026-11-05');
});
prueba('con filtro de artículo, solo restan las devoluciones de ese artículo', () => {
  const rows = [venta('000001', 1000, 100, { articulo: 'X1' }), venta('000001', -200, -20, { articulo: 'X1' }), venta('000001', -50, -5, { articulo: 'X2' })];
  cerca(nueva(rows, cartera, { articulo: 'X1' }).porRuta[0].monto, 800); cerca(nueva(rows, cartera, {}).porRuta[0].monto, 750);
});
prueba('fila con monto positivo y cajas negativas: cuenta como venta y resta sus cajas', () => {
  const r = nueva([venta('000001', 500, -3)], cartera, {}).porRuta[0];
  assert.strictEqual(r.clientesActivos, 1); cerca(r.monto, 500); cerca(r.cajas, -3);
});
prueba('el mismo cliente con código "000001" en ventas y "1" en cartera es uno solo', () => {
  const r = nueva([venta('000001', 100, 10)], [{ idCliente: '1', cliente: 'C', idVendedor: '53', vendedorNombre: 'RUTA 53' }], {}).porRuta[0];
  assert.strictEqual(r.clientesActivos, 1); assert.strictEqual(r.clientesSinActivar, 0);
});
prueba('sin ventas ni devoluciones: la ruta sale con 0 activos y toda su cartera pendiente, como antes', () => {
  const r = nueva([], cartera, {}).porRuta[0];
  assert.strictEqual(r.clientesActivos, 0); assert.strictEqual(r.clientesSinActivar, 3); cerca(r.monto, 0); cerca(r.cajas, 0);
});

console.log(`\n${ok} pruebas bien, ${mal} con falla`);
process.exit(mal === 0 ? 0 : 1);
