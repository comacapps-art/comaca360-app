'use strict';
// PRUEBA de la decisión "¿hace falta volver a bajar este archivo?" (index.html: _puedeReusarArchivo, _longitudRemota,
// _normalizarUrlVentas y la firma guardada por usuario). Corre en Node, sin navegador, sin red externa y sin datos reales:
// la parte de red usa un servidor local de mentira.
//
//   node herramientas/medicion_ventas/prueba_descarga.js
//
// Qué NO cubre: el bucle de React que usa estas funciones (fetchGitHubData); eso se comprueba con la app abierta.
const path = require('path');
const http = require('http');
const assert = require('assert');
const { execFileSync } = require('child_process');

const salida = path.join(__dirname, 'actual_extraido_descarga.js');
const nombres = ['SYNC_ARCHIVO_PREFIX', 'SYNC_ARCHIVO_VERSION', 'SYNC_ARCHIVO_MAX_DIAS', '_leerFirmaArchivo', '_guardarFirmaArchivo', '_normalizarUrlVentas', '_longitudRemota', '_puedeReusarArchivo'];
execFileSync(process.execPath, [path.join(__dirname, 'extraer.js'), '--salida', salida, '--extra', nombres.join(',')], { stdio: 'inherit' });

// localStorage de mentira (en el navegador es el de verdad)
const almacen = new Map();
global.localStorage = { getItem: (k) => (almacen.has(k) ? almacen.get(k) : null), setItem: (k, v) => almacen.set(k, String(v)), removeItem: (k) => almacen.delete(k) };
const m = require(salida);

let ok = 0, fallos = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); ok++; console.log('  ok    ' + nombre); } catch (e) { fallos++; console.log('  FALLA ' + nombre + '\n        ' + (e && e.message)); }
};

(async () => {
  console.log('\n_puedeReusarArchivo');
  const AHORA = 1_800_000_000_000;
  const base = () => ({
    forzar: false, longitud: 149753171, url: 'https://x/y.csv', usuario: 'vendedor|53', ahora: AHORA, filas: 1000,
    firma: { v: m.SYNC_ARCHIVO_VERSION, url: 'https://x/y.csv', len: 149753171, usuario: 'vendedor|53', ts: AHORA - 86400000, maxFecha: '2026-11-05', filas: 1000 },
  });
  await prueba('mismo tamaño, mismas filas, mismo usuario y enlace, reciente -> reutiliza', () => assert.strictEqual(m._puedeReusarArchivo(base()), true));
  await prueba('usuario sin filas en el archivo, con copia y firma de 0 filas -> reutiliza', () => { const d = base(); d.filas = 0; d.firma.filas = 0; d.hayCopia = true; assert.strictEqual(m._puedeReusarArchivo(d), true); });
  const casos = [
    ['"Sincronizar ahora" (forzar) -> no reutiliza', (d) => { d.forzar = true; }],
    ['el archivo pesa distinto -> no reutiliza', (d) => { d.longitud += 1; }],
    ['no se pudo saber el tamaño (null) -> no reutiliza', (d) => { d.longitud = null; }],
    ['tamaño 0 -> no reutiliza', (d) => { d.longitud = 0; }],
    ['sin firma guardada -> no reutiliza', (d) => { d.firma = null; }],
    ['otro enlace -> no reutiliza', (d) => { d.url = 'https://x/otro.csv'; }],
    ['otro usuario o rol -> no reutiliza', (d) => { d.usuario = 'admin|53'; }],
    ['otro número de filas guardadas -> no reutiliza', (d) => { d.filas = 999; }],
    ['sin filas guardadas y sin copia -> no reutiliza', (d) => { d.filas = 0; d.firma.filas = 0; }],
    ['sin filas guardadas, con copia, pero la firma tenía filas -> no reutiliza', (d) => { d.filas = 0; d.hayCopia = true; }],
    ['versión de lectura distinta -> no reutiliza', (d) => { d.firma.v = m.SYNC_ARCHIVO_VERSION + 1; }],
    ['firma de hace más de 7 días -> no reutiliza', (d) => { d.firma.ts = AHORA - (m.SYNC_ARCHIVO_MAX_DIAS * 86400000 + 1); }],
    ['firma justo en el límite de 7 días -> sí reutiliza', (d) => { d.firma.ts = AHORA - m.SYNC_ARCHIVO_MAX_DIAS * 86400000; }, true],
    ['firma con fecha en el futuro (reloj raro) -> no reutiliza', (d) => { d.firma.ts = AHORA + 1000; }],
    ['firma sin fecha -> no reutiliza', (d) => { delete d.firma.ts; }],
  ];
  for (const [nombre, cambia, esperado] of casos) await prueba(nombre, () => { const d = base(); cambia(d); assert.strictEqual(m._puedeReusarArchivo(d), !!esperado); });
  await prueba('sin datos -> no reutiliza', () => { assert.strictEqual(m._puedeReusarArchivo(null), false); assert.strictEqual(m._puedeReusarArchivo(undefined), false); });

  console.log('\nfirma guardada por usuario y archivo');
  await prueba('se guarda y se lee igual', () => { m._guardarFirmaArchivo('53', 'currYear', { a: 1 }); assert.deepStrictEqual(m._leerFirmaArchivo('53', 'currYear'), { a: 1 }); });
  await prueba('cada usuario y cada tipo tiene la suya', () => { assert.strictEqual(m._leerFirmaArchivo('54', 'currYear'), null); assert.strictEqual(m._leerFirmaArchivo('53', 'prevYear'), null); });
  await prueba('un valor dañado se trata como "sin firma"', () => { almacen.set(m.SYNC_ARCHIVO_PREFIX + '53_currYear', '{no es json'); assert.strictEqual(m._leerFirmaArchivo('53', 'currYear'), null); });
  await prueba('un valor que no es objeto se trata como "sin firma"', () => { almacen.set(m.SYNC_ARCHIVO_PREFIX + '53_currYear', '5'); assert.strictEqual(m._leerFirmaArchivo('53', 'currYear'), null); });

  console.log('\n_normalizarUrlVentas (igual que la lógica anterior de fetchGithubSalesFile)');
  const viejo = (u) => { let rawUrl = u.trim(); if (rawUrl.includes('github.com')) { if (rawUrl.includes('/blob/')) rawUrl = rawUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/'); else if (rawUrl.includes('/raw/')) rawUrl = rawUrl.replace('github.com', 'raw.githubusercontent.com').replace('/raw/', '/'); } return rawUrl; };
  const urls = [
    'https://github.com/org/repo-ventas/blob/main/ventas_mes.XLS', 'https://github.com/org/repo-ventas/raw/main/a.csv',
    'https://raw.githubusercontent.com/org/repo-ventas/datos-csv/ventas_mes.csv', 'https://raw.githubusercontent.com/org/repo-ventas/refs/heads/main/ventas_mes.XLS',
    'https://media.githubusercontent.com/media/org/repo-ventas/main/ventas_anio.csv', '  https://ejemplo.com/ventas.json  ', 'https://github.com/x/y/blob/main/a.xlsx?token=abc', 'https://ejemplo.com/a.csv?x=1',
  ];
  for (const u of urls) await prueba(u.trim().slice(0, 90), () => assert.strictEqual(m._normalizarUrlVentas(u), viejo(u)));

  console.log('\n_longitudRemota (servidor local de mentira)');
  const pedidos = [];
  const servidor = http.createServer((req, res) => {
    pedidos.push({ metodo: req.method, url: req.url });
    if (req.url.startsWith('/ok')) { res.writeHead(200, { 'Content-Length': '1234', 'Content-Type': 'text/plain' }); res.end(); }
    else if (req.url.startsWith('/sinlongitud')) { res.writeHead(200, { 'Transfer-Encoding': 'chunked' }); res.end(); }
    else if (req.url.startsWith('/cero')) { res.writeHead(200, { 'Content-Length': '0' }); res.end(); }
    else if (req.url.startsWith('/lento')) { setTimeout(() => { res.writeHead(200, { 'Content-Length': '99' }); res.end(); }, 1500); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const base_url = 'http://127.0.0.1:' + servidor.address().port;
  await prueba('devuelve el tamaño (Content-Length)', async () => assert.strictEqual(await m._longitudRemota(base_url + '/ok.csv'), 1234));
  await prueba('usa HEAD y añade un parámetro t= para saltarse cachés', () => { const p = pedidos[0]; assert.strictEqual(p.metodo, 'HEAD'); assert.ok(/[?&]t=\d+/.test(p.url), p.url); });
  await prueba('error 404 -> null', async () => assert.strictEqual(await m._longitudRemota(base_url + '/no-existe'), null));
  await prueba('sin Content-Length -> null', async () => assert.strictEqual(await m._longitudRemota(base_url + '/sinlongitud'), null));
  await prueba('tamaño 0 -> null', async () => assert.strictEqual(await m._longitudRemota(base_url + '/cero'), null));
  await prueba('servidor demasiado lento -> null en poco tiempo', async () => { const t0 = Date.now(); assert.strictEqual(await m._longitudRemota(base_url + '/lento', 300), null); assert.ok(Date.now() - t0 < 1200, 'tardó ' + (Date.now() - t0) + ' ms'); });
  await prueba('sin conexión (puerto cerrado) -> null', async () => { const libre = await new Promise(r => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); assert.strictEqual(await m._longitudRemota('http://127.0.0.1:' + libre + '/x'), null); });
  servidor.closeAllConnections && servidor.closeAllConnections();
  servidor.close();

  console.log(`\n${ok} pruebas bien, ${fallos} con falla`);
  process.exit(fallos ? 1 : 0);
})();
