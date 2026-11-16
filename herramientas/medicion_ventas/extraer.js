'use strict';
// Extrae del index.html las funciones que leen las ventas y las guarda como módulo de Node, para poder medirlas y
// compararlas sin abrir el navegador.
//
//   node herramientas/medicion_ventas/extraer.js [--fuente ruta/index.html] [--salida archivo.js] [--extra a,b,c] [--congelado]
//
// Por defecto lee el index.html de la raíz y escribe actual_extraido.js (no se versiona: se recrea en cada medición).
// Si agregas funciones auxiliares que usen estas, pásalas con --extra=nombre1,nombre2 (declaraciones de primer nivel).
// Usa el mismo analizador de @babel/core que build.js, así que no se confunde con comillas, regex ni llaves.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const babel = require('@babel/core');

const args = process.argv.slice(2);
const opt = (n, def) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : def; };
const SRC = path.resolve(opt('fuente', path.join(__dirname, '..', '..', 'index.html')));
const OUT = path.resolve(opt('salida', path.join(__dirname, 'actual_extraido.js')));
const CONGELADO = args.includes('--congelado');

// Funciones del index.html (versión del 12-nov-2026) que intervienen al leer un archivo de ventas.
const BASE = ['normalizeId', 'parseNum', 'yieldToBrowser', 'mapGitHubSalesRow', 'buildVendorFilter', 'notaFechaVenta',
  'parseExcelRowsChunked', 'parseJsonSalesChunked', 'streamCsvSalesRows'];
const EXTRA = String(opt('extra', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const NOMBRES = [...BASE, ...EXTRA];

const buf = fs.readFileSync(SRC);
const html = buf.toString('utf8');
const m = html.match(/<script type="text\/babel" data-type="module" data-presets="react">([\s\S]*?)<\/script>/);
if (!m) { console.error('No encontré el bloque <script type="text/babel"> en ' + SRC); process.exit(1); }
const jsx = m[1];

const ast = babel.parseSync(jsx, { presets: [['@babel/preset-react', { runtime: 'classic' }]], filename: 'index.jsx', sourceType: 'module' });
const quiero = new Set(NOMBRES);
const trozos = new Map();
for (const nodo of ast.program.body) {
  let nombre = null;
  if (nodo.type === 'FunctionDeclaration' && nodo.id) nombre = nodo.id.name;
  else if (nodo.type === 'VariableDeclaration' && nodo.declarations.length === 1 && nodo.declarations[0].id && nodo.declarations[0].id.type === 'Identifier') nombre = nodo.declarations[0].id.name;
  if (nombre && quiero.has(nombre)) trozos.set(nombre, jsx.slice(nodo.start, nodo.end));
}
const faltan = NOMBRES.filter(n => !trozos.has(n));
if (faltan.length) { console.error('No encontré estas declaraciones de primer nivel en ' + path.basename(SRC) + ': ' + faltan.join(', ')); process.exit(1); }

const sha = crypto.createHash('sha256').update(buf).digest('hex');
const cabecera = CONGELADO
  ? `// CONGELADO: copia exacta de estas funciones tal como están en el index.html del 12-nov-2026 (sha256 ${sha}).\n// Es la referencia contra la que se comparan los cambios: NO la modifiques.\n`
  : `// GENERADO por extraer.js desde ${path.basename(SRC)} (sha256 ${sha}). No lo edites: se vuelve a crear en cada medición.\n`;
const cuerpo = [...trozos.values()].join('\n\n');
fs.writeFileSync(OUT, cabecera + "'use strict';\n\n" + cuerpo + '\n\nmodule.exports = { ' + [...trozos.keys()].join(', ') + ' };\n');
console.log(`Extraídas ${trozos.size} declaraciones de ${path.basename(SRC)} -> ${path.relative(process.cwd(), OUT) || OUT}`);
