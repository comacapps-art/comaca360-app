'use strict';
// Mide cuánto tarda en leer un CSV de ventas (a) la versión CONGELADA del 12-nov y (b) tu versión, y comprueba que
// dan exactamente las mismas filas.
//
//   node --expose-gc herramientas/medicion_ventas/bench.js <archivo.csv> [--candidato ruta.js] [--repeticiones 1]
//
// Sin --candidato se vuelve a extraer el código actual del index.html de la raíz (extraer.js), o sea: lo que hayas
// cambiado ahí. Con --candidato se usa otro módulo que exporte las mismas funciones (ver ejemplo/).
// Mide SOLO la lectura y el mapeo de filas en Node (sin red, sin IndexedDB, sin React); en un teléfono el tiempo
// es varias veces mayor. Úsalo para comparar, no como cifra absoluta.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (n, def) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : def; };
const FILE = args.find(a => !a.startsWith('--') && a !== opt('candidato', null) && a !== opt('repeticiones', null));
if (!FILE || !fs.existsSync(FILE)) {
  console.error('Uso: node --expose-gc herramientas/medicion_ventas/bench.js <archivo.csv> [--candidato ruta.js]\nGenera uno con: npm run medicion:datos');
  process.exit(1);
}
const REP = Math.max(1, parseInt(opt('repeticiones', '1'), 10));
const rutaCand = opt('candidato', null);
const base = require('./baseline_12nov.js');
let cand;
if (rutaCand) cand = require(path.resolve(rutaCand));
else { execFileSync(process.execPath, [path.join(__dirname, 'extraer.js')], { stdio: 'inherit' }); cand = require('./actual_extraido.js'); }

function flujo(file, chunk = 65536) {
  const fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size; let pos = 0;
  return new ReadableStream({
    pull(c) {
      if (pos >= size) { c.close(); fs.closeSync(fd); return; }
      const len = Math.min(chunk, size - pos); const buf = Buffer.allocUnsafe(len);
      fs.readSync(fd, buf, 0, len, pos); pos += len; c.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, len));
    },
  });
}
async function medir(etiqueta, mod) {
  let mejor = Infinity, salida = null, fileObj = null;
  for (let i = 0; i < REP; i++) {
    if (global.gc) global.gc();
    fileObj = { type: 'currMonth', url: 'x' };
    const t0 = process.hrtime.bigint();
    salida = await mod.streamCsvSalesRows({ body: flujo(FILE) }, fileObj, () => false, null);
    mejor = Math.min(mejor, Number(process.hrtime.bigint() - t0) / 1e9);
  }
  console.log(`${etiqueta.padEnd(30)} ${mejor.toFixed(2).padStart(7)} s   ${salida.length} filas   ${Math.round(salida.length / mejor).toLocaleString('es')} filas/s`);
  return { s: mejor, out: salida, maxFecha: fileObj.maxFecha };
}
(async () => {
  const mb = fs.statSync(FILE).size / 1048576;
  console.log(`Archivo: ${mb.toFixed(1)} MB   (repeticiones: ${REP}; se muestra la mejor)\n`);
  const a = await medir('Congelada (12-nov)', base);
  const b = await medir('Tu versión', cand);
  let dif = 0;
  const ser = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' && (!Number.isFinite(x) || Object.is(x, -0))) ? '#' + (Object.is(x, -0) ? '-0' : String(x)) : x);
  if (a.out.length !== b.out.length) dif = Math.abs(a.out.length - b.out.length);
  for (let i = 0; i < Math.min(a.out.length, b.out.length); i++) if (ser(a.out[i]) !== ser(b.out[i])) { dif++; if (dif <= 3) console.log('DIFERENCIA en la fila', i, '\n  congelada:', ser(a.out[i]), '\n  tuya:     ', ser(b.out[i])); }
  if (a.maxFecha !== b.maxFecha) { dif++; console.log('DIFERENCIA en maxFecha:', a.maxFecha, b.maxFecha); }
  console.log(`\nFilas distintas: ${dif} de ${a.out.length}   ->   ${dif === 0 ? 'IGUALES (bien)' : 'HAY DIFERENCIAS: no es un cambio válido'}`);
  console.log(`Aceleración: x${(a.s / b.s).toFixed(1)}`);
  const f = 88 / mb;
  console.log(`\nProyección a un archivo de 88 MB en ESTA computadora: congelada ${(a.s * f).toFixed(0)} s -> tuya ${(b.s * f).toFixed(0)} s`);
  process.exit(dif === 0 ? 0 : 1);
})();
