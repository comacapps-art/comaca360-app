'use strict';
// Prueba de la cesión del hilo al procesar archivos de ventas (cederElHilo): con la página en segundo plano el navegador
// frena o pausa requestAnimationFrame y cada cesión con yieldToBrowser esperaba ese cuadro (≈ 1 s por cesión, ≈ 250 cesiones
// con el archivo del año). Aquí se SIMULA ese freno en Node (un requestAnimationFrame falso que tarda 100 ms y cuenta cuántas
// veces lo llaman, y un MessageChannel que cuenta los avisos) y se comprueba que:
//   - los lectores de CSV, Excel y JSON ya NO esperan ningún cuadro, ceden el hilo tantas veces como corresponde y dan
//     exactamente las mismas filas que la versión anterior;
//   - cederElHilo cede de verdad el hilo al bucle de eventos (no es solo una microtarea), en orden y sin esperar;
//   - en el index.html, los seis sitios que procesan datos usan cederElHilo y solo quedan con yieldToBrowser los dos de la
//     matriz en PDF (que necesitan pintar entre pasos).
// Se cuentan llamadas y no segundos para que la prueba no dependa de lo ocupada que esté la computadora; los tiempos solo se
// muestran. Corre en Node, sin navegador, sin red y con datos inventados. NO sustituye una prueba en un navegador real.
//
//   node herramientas/medicion_ventas/prueba_ceder.js
//
// Compara con la copia congelada del 12-nov-2026 (baseline_12nov.js), que cede el hilo con requestAnimationFrame.
// El canal de cederElHilo queda abierto en Node mientras vive el proceso: por eso la prueba termina con process.exit.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SALIDA = path.join(__dirname, 'ceder_extraido.js');
const INDEX = path.join(__dirname, '..', '..', 'index.html');
execFileSync(process.execPath, [path.join(__dirname, 'extraer.js'), '--extra', 'yieldToBrowser', '--salida', SALIDA], { stdio: 'inherit' });

let ok = 0, mal = 0;
const prueba = async (nombre, fn) => { try { await fn(); ok++; console.log('  ok    ' + nombre); } catch (e) { mal++; console.log('  FALLA ' + nombre + '\n        ' + String(e.message).split('\n').slice(0, 4).join('\n        ')); } };

// ---- entorno de "navegador" simulado
const MCReal = globalThis.MessageChannel;
let rafLlamadas = 0, avisos = 0;
class MCContado { // MessageChannel que cuenta los postMessage del puerto 2 (los avisos de cederElHilo)
  constructor() { const mc = new MCReal(); this.port1 = mc.port1; this.port2 = new Proxy(mc.port2, { get(t, k) { if (k === 'postMessage') return (...a) => { avisos++; return t.postMessage(...a); }; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } }); }
}
const cargar = (conDocumento, ruta) => {
  if (conDocumento) globalThis.document = {}; else delete globalThis.document;
  rafLlamadas = 0; avisos = 0;
  globalThis.requestAnimationFrame = (f) => { rafLlamadas++; setTimeout(f, 100); };
  globalThis.MessageChannel = MCContado;
  const r = ruta || SALIDA;
  delete require.cache[require.resolve(r)];
  return require(r);
};
const mide = async (fn) => { const t = process.hrtime.bigint(); const r = await fn(); return { r, ms: Number(process.hrtime.bigint() - t) / 1e6 }; };
const conLimite = (p, ms) => Promise.race([p.then(v => ({ v })), new Promise(r => setTimeout(() => r({ colgado: true }), ms))]);
const ser = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' && (!Number.isFinite(x) || Object.is(x, -0))) ? '#' + (Object.is(x, -0) ? '-0' : String(x)) : x);

// ---- datos inventados
const CABECERA = 'Fecha;Mes;Id Cliente;Supervisor;Cliente;Grupo;Tipo Cli.;Id Vendedor;Vendedor;Tipo Doc.;Numero;Id Articulo;Subgrupo;Articulo;Linea;Cajas;Unidades;Kgs/Lts;Monto;Impuesto;Total'.split(';');
const fila = (i) => [`${String(1 + (i % 28)).padStart(2, '0')}/11/2026`, '11', String(1000 + (i % 3000)).padStart(6, '0'), 'SUP', `CLIENTE INVENTADO ${i % 3000} C.A.`, `GRUPO ${i % 7}`, 'T', String(50 + (i % 5)).padStart(3, '0'), `VENDEDOR ${i % 5}`, 'FA', String(900000 + i), `A${i % 40}`, `SUB ${i % 9}`, `ARTICULO INVENTADO NUMERO ${i % 40} 24X500GR`, `LINEA ${i % 6}`, String((i % 9) + 1), String((i % 9) * 12 + 12), String((i % 9) * 3 + 2), (10 + (i % 90)).toFixed(2).replace('.', ','), '0', (10 + (i % 90)).toFixed(2).replace('.', ',')];
const csv = (n) => [CABECERA.join(';'), ...Array.from({ length: n }, (_, i) => fila(i).join(';'))].join('\r\n');
const filasExcel = (n) => Array.from({ length: n }, (_, i) => Object.fromEntries(CABECERA.map((k, j) => [k, fila(i)[j]])));
const datosJson = (n) => Array.from({ length: n }, (_, i) => ({ fecha: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`, idVendedor: String(50 + (i % 5)), vendedor: `VENDEDOR ${i % 5}`, cliente: 'X' + (i % 100), articulo: 'Y' + (i % 30), monto: 10 + (i % 90), cajas: 1, unidades: 1, kilos: 1 }));
const flujo = (texto) => { const b = Buffer.from(texto, 'utf8'); let pos = 0; return new ReadableStream({ pull(c) { if (pos >= b.length) { c.close(); return; } const n = Math.min(65536, b.length - pos); c.enqueue(new Uint8Array(b.subarray(pos, pos + n))); pos += n; } }); };
const TEXTO = csv(40000), EXCEL = filasExcel(5000), JSONES = datosJson(9000);
const MB = Buffer.byteLength(TEXTO) / 1048576, CARACTERES = TEXTO.length;
const leerCsv = (m) => m.streamCsvSalesRows({ body: flujo(TEXTO) }, { type: 'currMonth', url: 'x' }, () => false, null);
const leerExcel = (m) => m.parseExcelRowsChunked(EXCEL, { type: 'currMonth' }, () => false, null);
const leerJson = (m) => m.parseJsonSalesChunked(JSONES, 'currMonth', () => false, null, { type: 'currMonth' });
// Cesiones que se esperan: CSV cada 600.000 caracteres (en trozos de 64 KB), Excel cada 1.200 filas, JSON cada 4.000.
const ESPERADAS = { csv: [Math.floor(CARACTERES / 700000), Math.ceil(CARACTERES / 600000) + 1], excel: [Math.ceil(EXCEL.length / 1200), Math.ceil(EXCEL.length / 1200)], json: [Math.ceil(JSONES.length / 4000), Math.ceil(JSONES.length / 4000)] };

// ---- batería: lo que debe cumplir un módulo (el bueno, y cada mutante debe fallar en algo). Devuelve los motivos de falla.
async function bateria(ruta) {
  const fallas = [];
  for (const [nombre, leer, rango] of [['CSV', leerCsv, ESPERADAS.csv], ['Excel', leerExcel, ESPERADAS.excel], ['JSON', leerJson, ESPERADAS.json]]) {
    const m = cargar(true, ruta);
    const res = await conLimite(leer(m), 4000);
    if (res.colgado) { fallas.push(`${nombre}: la lectura se quedó esperando`); continue; }
    if (rafLlamadas > 0) fallas.push(`${nombre}: esperó ${rafLlamadas} cuadros de requestAnimationFrame`);
    if (avisos < rango[0] || avisos > rango[1]) fallas.push(`${nombre}: cedió ${avisos} veces y se esperaban entre ${rango[0]} y ${rango[1]}`);
  }
  // cede de verdad el hilo al bucle de eventos: un temporizador pendiente dispara mientras se encadenan cesiones
  {
    const m = cargar(true, ruta); let disparo = false; setTimeout(() => { disparo = true; }, 5);
    const t0 = performance.now(); let i = 0;
    const r = await conLimite((async () => { while (!disparo && performance.now() - t0 < 2000 && i < 200000) { await m.cederElHilo(); i++; } })(), 4000);
    if (r.colgado) fallas.push('cederElHilo: se quedó esperando');
    else if (!disparo) fallas.push('cederElHilo: no deja correr a los temporizadores (es solo una microtarea)');
  }
  return fallas;
}

(async () => {
  console.log(`\n1) cederElHilo, con documento (como en el navegador, vía MessageChannel)`);
  await prueba('5.000 cesiones seguidas se resuelven sin llamar nunca a requestAnimationFrame', async () => {
    const m = cargar(true);
    for (let i = 0; i < 5000; i++) await m.cederElHilo();
    assert.strictEqual(rafLlamadas, 0); assert.strictEqual(avisos, 5000);
  });
  await prueba('varias llamadas a la vez se resuelven todas, en el orden en que se pidieron', async () => {
    const m = cargar(true);
    const orden = []; await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(i => m.cederElHilo().then(() => orden.push(i))));
    assert.deepStrictEqual(orden, [0, 1, 2, 3, 4, 5, 6, 7]);
  });
  await prueba('cede de verdad el hilo: un temporizador pendiente dispara mientras se encadenan cesiones', async () => {
    const fallas = (await bateria()).filter(f => f.startsWith('cederElHilo'));
    assert.deepStrictEqual(fallas, []);
  });
  await prueba('yieldToBrowser (el de antes) SÍ llama a requestAnimationFrame (así se comprueba que la simulación vale)', async () => {
    const m = cargar(true);
    for (let i = 0; i < 3; i++) await m.yieldToBrowser();
    assert.strictEqual(rafLlamadas, 3);
  });

  console.log(`\n2) Sin documento (Node, pruebas): usa setTimeout, no llama a requestAnimationFrame ni abre canales`);
  await prueba('cederElHilo se resuelve sin documento', async () => {
    const m = cargar(false); await m.cederElHilo(); await m.cederElHilo();
    assert.strictEqual(rafLlamadas, 0); assert.strictEqual(avisos, 0);
  });

  console.log(`\n3) Los tres lectores con requestAnimationFrame frenado (100 ms por cuadro): ni un cuadro esperado, mismas filas que antes`);
  const base = require('./baseline_12nov.js');
  const comparar = async (nombre, leerBase, leerNuevo, rango) => {
    cargar(true);
    const a = await mide(leerBase); const esperasAntes = rafLlamadas;
    const m = cargar(true);
    const b = await mide(() => leerNuevo(m));
    console.log(`        ${nombre}: antes ${(a.ms / 1000).toFixed(2)} s con ${esperasAntes} esperas de cuadro; ahora ${(b.ms / 1000).toFixed(2)} s con ${rafLlamadas} y ${avisos} cesiones`);
    assert.ok(a.r.length > 0 && a.r.length === b.r.length, 'distinta cantidad de filas: ' + a.r.length + ' y ' + b.r.length);
    assert.ok(esperasAntes >= 2, 'la versión anterior casi no esperó cuadros (' + esperasAntes + '): la simulación no vale');
    assert.strictEqual(rafLlamadas, 0, 'la versión nueva esperó ' + rafLlamadas + ' cuadros');
    assert.ok(avisos >= rango[0] && avisos <= rango[1], `cedió ${avisos} veces y se esperaban entre ${rango[0]} y ${rango[1]}`);
    for (let i = 0; i < a.r.length; i++) if (ser(a.r[i]) !== ser(b.r[i])) throw new Error('la fila ' + i + ' difiere');
  };
  await prueba(`CSV de ${MB.toFixed(1)} MB: igual y sin esperar cuadros`, () => comparar('CSV', () => base.streamCsvSalesRows({ body: flujo(TEXTO) }, { type: 'currMonth', url: 'x' }, () => false, null), leerCsv, ESPERADAS.csv));
  await prueba(`Excel de ${EXCEL.length} filas: igual y sin esperar cuadros`, () => comparar('Excel', () => base.parseExcelRowsChunked(EXCEL, { type: 'currMonth' }, () => false, null), leerExcel, ESPERADAS.excel));
  await prueba(`JSON de ${JSONES.length} filas: igual y sin esperar cuadros`, () => comparar('JSON', () => base.parseJsonSalesChunked(JSONES, 'currMonth', () => false, null, { type: 'currMonth' }), leerJson, ESPERADAS.json));

  console.log(`\n4) En el index.html: seis sitios de datos con cederElHilo; solo la matriz en PDF conserva yieldToBrowser`);
  const html = fs.readFileSync(INDEX, 'utf8').split(/\r?\n/);
  await prueba('hay exactamente 6 "await cederElHilo()" (Excel, JSON, CSV, dos del Excel descargado y el bucle de archivos)', () => {
    const n = html.filter(l => l.includes('await cederElHilo()')).length; assert.strictEqual(n, 6, 'hay ' + n);
  });
  await prueba('los únicos "await yieldToBrowser()" que quedan son los dos de la matriz en PDF', () => {
    const idx = html.map((l, i) => l.includes('await yieldToBrowser()') ? i : -1).filter(i => i >= 0);
    assert.strictEqual(idx.length, 2, 'quedan ' + idx.length + ': ' + idx.map(i => i + 1).join(', '));
    for (const i of idx) assert.ok(/setProgresoMatriz/.test(html[i + 1] || '') || /if \(p > 0\)/.test(html[i]), 'la línea ' + (i + 1) + ' no es de la matriz en PDF');
  });

  console.log(`\n5) La prueba sirve: detecta errores introducidos a propósito (mutantes)`);
  await prueba('el código bueno pasa la batería sin ninguna falla', async () => { assert.deepStrictEqual(await bateria(), []); });
  const texto = fs.readFileSync(SALIDA, 'utf8');
  const enFuncion = (funcion, de, a) => { // cambia la PRIMERA aparición de `de` después del inicio de `funcion`
    const ini = texto.indexOf(funcion); assert.ok(ini >= 0, 'no encontré ' + funcion);
    const pos = texto.indexOf(de, ini); assert.ok(pos >= 0, 'no encontré en ' + funcion + ': ' + de.slice(0, 50));
    return texto.slice(0, pos) + a + texto.slice(pos + de.length);
  };
  const mutantes = [
    ['el lector de CSV vuelve a ceder con requestAnimationFrame', () => enFuncion('async function streamCsvSalesRows', 'await cederElHilo()', 'await yieldToBrowser()')],
    ['el lector de Excel vuelve a ceder con requestAnimationFrame', () => enFuncion('async function parseExcelRowsChunked', 'await cederElHilo()', 'await yieldToBrowser()')],
    ['el lector de JSON vuelve a ceder con requestAnimationFrame', () => enFuncion('async function parseJsonSalesChunked', 'await cederElHilo()', 'await yieldToBrowser()')],
    ['el lector de CSV deja de ceder el hilo', () => enFuncion('async function streamCsvSalesRows', 'await cederElHilo()', '/* sin ceder */')],
    ['el lector de CSV cede cada 600 millones de caracteres (casi nunca)', () => enFuncion('async function streamCsvSalesRows', 'sinceYield > 600000', 'sinceYield > 600000000')],
    ['el lector de CSV no reinicia el contador y cede en cada trozo', () => enFuncion('async function streamCsvSalesRows', 'sinceYield = 0; await cederElHilo()', 'await cederElHilo()')],
    ['cederElHilo espera al siguiente cuadro de pantalla', () => texto.replace('return () => new Promise((resolve) => { esperando.push(resolve); canal.port2.postMessage(0); });', 'return () => new Promise((resolve) => { requestAnimationFrame(() => resolve()); });')],
    ['cederElHilo no avisa al navegador (la lectura se quedaría esperando)', () => texto.replace('canal.port2.postMessage(0); });', '/* sin aviso */ });')],
    ['cederElHilo es solo una microtarea (no deja correr al bucle de eventos)', () => texto.replace('return () => new Promise((resolve) => { esperando.push(resolve); canal.port2.postMessage(0); });', 'return () => Promise.resolve();')],
  ];
  for (let i = 0; i < mutantes.length; i++) {
    const [nombre, hacer] = mutantes[i];
    await prueba('detecta el error: ' + nombre, async () => {
      const codigo = hacer(); assert.notStrictEqual(codigo, texto, 'el mutante no cambió nada');
      const ruta = path.join(__dirname, `ceder_mutante_${i}.js`);
      fs.writeFileSync(ruta, codigo);
      try {
        const fallas = await bateria(ruta);
        assert.ok(fallas.length > 0, 'la prueba NO detectó este error: no protege de él');
        if (process.env.DEPURAR) console.log('        detectado por: ' + fallas.join(' | '));
      } finally { try { fs.unlinkSync(ruta); } catch (e) { /* ya no está */ } }
    });
  }

  console.log(`\n${ok} pruebas bien, ${mal} con falla`);
  try { fs.unlinkSync(SALIDA); } catch (e) { /* ya no está */ }
  process.exit(mal === 0 ? 0 : 1);
})();
