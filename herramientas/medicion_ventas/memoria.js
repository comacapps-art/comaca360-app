'use strict';
// Mide la MEMORIA que queda retenida tras leer un CSV de ventas con la versión congelada del 12-nov y con tu versión.
// Cada medición corre en un proceso aparte para que no se contaminen. Datos inventados; sin red.
//
//   node --expose-gc herramientas/medicion_ventas/memoria.js <archivo.csv>
//
// Antes: npm run medicion:extraer (o node herramientas/medicion_ventas/extraer.js) para que actual_extraido.js sea el de tu index.html.
// Para un archivo de ≈ 145 MB inventado:  node herramientas/medicion_ventas/gen_csv_sintetico.js 900000 ventas_145mb.csv
//
// Dos casos: "todo" (administrador: se conservan todas las filas) y "vendedor" (se conserva ≈ 3 % de las filas,
// repartidas por todo el archivo). Por qué importa: una subcadena de V8 o de Safari mantiene vivo el bloque
// descargado del que salió, y un vendedor con filas repartidas retenía casi todo el CSV (ver BIT-010).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [, , FILE, VERSION, MODO] = process.argv;
if (!FILE || !fs.existsSync(FILE)) {
  console.error('Uso: node --expose-gc herramientas/medicion_ventas/memoria.js <archivo.csv>');
  process.exit(1);
}

if (!VERSION) {
  const filas = [];
  for (const modo of ['todo', 'vendedor']) {
    for (const v of ['base', 'nueva']) {
      const r = spawnSync(process.execPath, ['--expose-gc', __filename, FILE, v, modo], { encoding: 'utf8', maxBuffer: 1 << 26 });
      const linea = (r.stdout || '').trim().split('\n').pop();
      try { filas.push(JSON.parse(linea)); } catch (e) { console.log('fallo', v, modo, (r.stderr || '').slice(0, 300)); }
    }
  }
  console.log('\nversión   modo       filas      heap retenido (MB)   rss final (MB)   pico rss (MB)   tiempo (s)');
  for (const f of filas) console.log(`${f.version.padEnd(9)} ${f.modo.padEnd(10)} ${String(f.filas).padStart(8)}   ${String(f.heapRetenidoMB).padStart(18)}   ${String(f.rssFinalMB).padStart(14)}   ${String(f.picoRssMB).padStart(13)}   ${f.seg}`);
  console.log('\n"nueva" no debería retener más que "base" (y el vendedor debería quedar en pocos MB).');
  process.exit(0);
}

(async () => {
  const mod = VERSION === 'base' ? require('./baseline_12nov.js') : require('./actual_extraido.js');
  const fd = fs.openSync(FILE, 'r'); const size = fs.fstatSync(fd).size; let pos = 0;
  const flujo = new ReadableStream({
    pull(c) {
      if (pos >= size) { c.close(); fs.closeSync(fd); return; }
      const len = Math.min(65536, size - pos); const buf = Buffer.allocUnsafe(len);
      fs.readSync(fd, buf, 0, len, pos); pos += len; c.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, len));
    },
  });
  let contador = 0;
  const filtro = MODO === 'vendedor' ? (() => (contador++ % 33) === 0) : null;
  global.gc(); const antes = process.memoryUsage().heapUsed;
  let pico = 0; const t = setInterval(() => { pico = Math.max(pico, process.memoryUsage().rss); }, 200);
  const t0 = process.hrtime.bigint();
  const salida = await mod.streamCsvSalesRows({ body: flujo }, { type: 'currYear', url: 'x' }, () => false, filtro);
  const seg = (Number(process.hrtime.bigint() - t0) / 1e9).toFixed(1);
  clearInterval(t);
  global.gc(); global.gc();
  const m = process.memoryUsage();
  console.log(JSON.stringify({ version: VERSION, modo: MODO, filas: salida.length, heapRetenidoMB: Math.round((m.heapUsed - antes) / 1048576), rssFinalMB: Math.round(m.rss / 1048576), picoRssMB: Math.round(Math.max(pico, m.rss) / 1048576), seg }));
})();
