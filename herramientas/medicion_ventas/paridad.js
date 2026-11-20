'use strict';
// PRUEBA DE PARIDAD: el código que lee las ventas debe dar EXACTAMENTE las mismas filas que la versión congelada del
// 12-nov-2026 (baseline_12nov.js), con cualquier cabecera, formato de fecha o de número, separador, comillas, saltos de
// línea y tamaño de bloque de lectura. Es la red de seguridad de cualquier cambio en la lectura de ventas: si hay una
// sola diferencia, el cambio no es válido (o es una decisión consciente que hay que documentar).
//
//   node herramientas/medicion_ventas/paridad.js [--candidato ruta.js] [--filas 60000] [--casos-csv 400] [--semilla 1]
//
// Sin --candidato se vuelve a extraer el código actual del index.html de la raíz (extraer.js).
// Con --candidato se prueba otro módulo que exporte las mismas funciones (ver ejemplo/candidato_ejemplo.js).
// Todos los datos son inventados y la semilla es fija: la misma semilla repite exactamente los mismos casos.
//
// Qué compara:  A) mapGitHubSalesRow fila por fila (cabeceras con alias/mayúsculas/tildes/colisiones, fechas, números)
//               B) streamCsvSalesRows: CSV completo con comillas, saltos CRLF/LF, líneas vacías, filas cortas/largas,
//                  cabeceras repetidas y lectura en bloques de 1 byte hasta 64 KB, con y sin filtro de vendedor
//               C) parseExcelRowsChunked con filas a las que les faltan celdas (como entrega SheetJS)
//               D) parseJsonSalesChunked
// Compara también fileObj.maxFecha (la fecha más reciente que alimenta "Ventas hasta").
// Quirk conocido que NO se prueba a propósito: un BOM UTF-8 deja "ï»¿" pegado a la primera cabecera (ver guía A9).
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (n, def) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : def; };
const FILAS = parseInt(opt('filas', '60000'), 10);
const CASOS_CSV = parseInt(opt('casos-csv', '400'), 10);
const SEMILLA = parseInt(opt('semilla', '1'), 10) >>> 0;
const rutaCand = opt('candidato', null);

const base = require('./baseline_12nov.js');
let cand;
if (rutaCand) cand = require(path.resolve(rutaCand));
else { execFileSync(process.execPath, [path.join(__dirname, 'extraer.js')], { stdio: 'inherit' }); cand = require('./actual_extraido.js'); }

// ---------- generador pseudoaleatorio con semilla ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEMILLA);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const ser = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' && (!Number.isFinite(x) || Object.is(x, -0))) ? '#' + (Object.is(x, -0) ? '-0' : String(x)) : x);

// ---------- reservas de cabeceras y valores ----------
const CAB = {
  fecha: ['Fecha', 'FECHA', 'fecha', 'Date', 'Emision', 'EMISIÓN', 'Dia', 'Día'],
  mes: ['Mes', 'MES', 'Month'],
  ano: ['Año', 'AÑO', 'Ano', 'Year', 'ano'],
  idCliente: ['IdCliente', 'ID_Cliente', 'Id Cliente', 'CodigoCliente', 'CodCliente', 'id_cliente', 'ID CLIENTE'],
  cliente: ['Cliente', 'CLIENTE', 'Client', 'NombreCliente', 'Razon Social', 'RazonSocial', 'NOMBRE CLIENTE'],
  grupo: ['Grupo', 'GRUPO', 'Subgrupo', 'Linea', 'Marca'],
  subgrupo: ['Subgrupo', 'Sub Grupo', 'SubGrupo', 'Sub-Grupo', 'SubLinea', 'Sub Linea'],
  linea: ['Linea', 'LINEA', 'Línea', 'Line'],
  idVendedor: ['IdVendedor', 'CodigoVendedor', 'CodVendedor', 'Id Vendedor', 'id_vendedor'],
  vendedor: ['Vendedor', 'VENDEDOR', 'Venedor', 'NombreVendedor', 'Nombre Vendedor'],
  supervisor: ['Supervisor', 'Gerente'],
  tipoDoc: ['TipoDoc', 'Tipo Doc', 'TipoDocumento', 'Documento'],
  numero: ['Numero', 'Número', 'Factura', 'Nro', 'NRO.'],
  articulo: ['Articulo', 'Artículo', 'ARTICULO', 'Article', 'Producto', 'Descripcion', 'Descripción', 'Item'],
  cajas: ['Cajas', 'Cj', 'Bultos', 'Caixes'],
  unidades: ['Unidades', 'Und', 'Piezas', 'Unitats'],
  monto: ['Monto', 'Importe', 'Total', 'Venta', 'Neto', 'Import'],
  kilos: ['Kgs/Lts', 'Kilos/Litros', 'Kilos', 'Kgs', 'Lts', 'Volumen', 'KilosLitros', 'KILOS', 'KGS', 'Kg', 'Lt', 'Kilo', 'Litro', 'KILOS/LITROS', 'KGS/LTS', 'kgs_lts'],
  ruido: ['Observacion', 'Zona', 'Ruta', 'Region', 'Canal', 'Ciudad', 'x', '1', ''],
};
const T_CLIENTE = ['Bodegón La Esperanza C.A.', '  abastos el ángel  ', 'TOTAL', 'total general', 'Ñandú, S.R.L.', 'Charcutería "La 20"', 'Calle 5\nLocal 3; piso 2',
  '', ' ', 'x', '""', '"Q" "R"', 'x""y', 'Bodega 5, "Central"\r\nPiso 2', 'Mercado "El Sol"; local 7', 'Abastos Ñ'];
const T_ARTICULO = ['Mayonesa 400g', ' salsa de tomate 1kg ', 'TOTAL', 'Total General', 'Café Premium', '', 'Aceite ñ', 'ÁÉÍÓÚ ü', 'Pasta "corta", 500g', 'Salsa ""picante"" 1L', 'Café; tostado'];
const FECHAS = ['05/11/2026', '5-11-2026', '2026-11-05', '2026-6-3', '2026/06/03', '2026-11-05 10:30:00', '2026-11-05T10:30:00', '06/30/2026', '15/11/26',
  '20261105', '3/4/2026 08:00 a. m.', ' 2026-11-05 ', 'abc', '', '12/2026', '1-2-3'];
const FECHAS_NUM = [46000, 46000.75, 45292, 0, 25569, 60000];
const MESES = ['3', '03', 'Marzo', '12', '13', '0', 'Mes 5', '', 'x'];
const ANOS = ['2025', '25', '2026', '1899', '2101', 'abc', ''];
const IDS = ['1041', '001041', 'A-100', '  77 ', '', '0', 'S/N', '0053'];
const NUMS = ['12', '1.234,56', '1,234.56', '59,51', '1,234', '1.234', '1.234.567', '-3', '(5)', '', 'abc', ' 7 ', '$ 1.234,50', '0', '1e3', '12,5%', '--4', '1,2,3', '.5', ',5'];
const TIPOS = ['FA', 'fa', 'DV', 'nc', '', ' dv ', 'Nota'];
const VENDEDORES = ['053 PEREZ JOSE', '53-Perez', 'Sin Asignar', '', 'ÁNGEL 090', '090', '90 - X'];
const SUPERVISORES = ['Gerente 1', '', 'x'];
const TIPOS_ARCHIVO = ['prevYear', 'currYear', 'currMonth'];
const txt = (v) => (v === undefined || v === null ? '' : String(v));
function valorNum() { const r = rnd(); if (r < 0.25) return Math.round(rnd() * 1000) / 10; if (r < 0.3) return undefined; if (r < 0.33) return null; return pick(NUMS); }

// En un archivo real TODAS las filas comparten las mismas cabeceras: cada archivo de prueba elige una ortografía por campo.
// (Para la prueba A, fila por fila, no se pasa y cada fila usa ortografías distintas, lo que ejercita los alias y colisiones.)
function nuevaOrtografia() {
  const o = {};
  for (const campo of Object.keys(CAB)) o[campo] = pick(CAB[campo]);
  o.ruido = [pick(CAB.ruido), pick(CAB.ruido)];
  return o;
}
// Una fila "como la entrega el lector de archivos": claves = cabeceras; soloTexto = como en CSV (todo texto).
function filaAleatoria(soloTexto, orto) {
  const par = [];
  const nombre = (campo) => (orto ? orto[campo] : pick(CAB[campo]));
  const poner = (campo, valor, p) => { if (chance(p)) par.push([nombre(campo), soloTexto ? txt(valor) : valor]); };
  poner('cliente', pick(T_CLIENTE), 0.97);
  poner('articulo', pick(T_ARTICULO), 0.97);
  if (chance(0.8)) poner('fecha', chance(0.12) ? pick(FECHAS_NUM) : pick(FECHAS), 1);
  else { poner('mes', pick(MESES), 0.7); poner('ano', chance(0.5) ? pick(ANOS) : 2026, 0.5); }
  poner('idCliente', pick(IDS), 0.85);
  poner('grupo', pick(['Mayonesas', 'salsas', '', 'Café']), 0.8);
  poner('subgrupo', pick(['Light', '', 'x']), 0.5);
  poner('linea', pick(['TANG', '', 'Mayonesa']), 0.4);
  poner('idVendedor', pick(['53', '053', '0053', '90', 'S/N', '']), 0.85);
  poner('vendedor', pick(VENDEDORES), 0.85);
  poner('supervisor', pick(SUPERVISORES), 0.4);
  poner('tipoDoc', pick(TIPOS), 0.7);
  poner('numero', pick(['N00032100', ' 55 ', '', 'S/N']), 0.7);
  for (const c of ['cajas', 'unidades', 'monto', 'kilos']) poner(c, valorNum(), 0.85);
  for (let i = 0, n = Math.floor(rnd() * 3); i < n; i++) par.push([orto ? orto.ruido[i % 2] : pick(CAB.ruido), 'z']);
  for (let i = par.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [par[i], par[j]] = [par[j], par[i]]; } // orden de columnas aleatorio
  const row = {};
  for (const [k, v] of par) row[k] = v;
  return row;
}

// ---------- CSV aleatorio (como bytes latin1) y lectura por bloques ----------
function csvAleatorio() {
  const sep = pick([';', ',']);
  const modoEol = pick(['crlf', 'lf', 'mixto']);
  const eol = () => (modoEol === 'crlf' ? '\r\n' : modoEol === 'lf' ? '\n' : pick(['\r\n', '\n']));
  const orto = chance(0.1) ? null : nuevaOrtografia(); // 10 % de los archivos mezclan ortografías (casos raros de alias repetidos)
  const filas = Array.from({ length: Math.floor(rnd() * 40) }, () => filaAleatoria(true, orto));
  const cab = [];
  for (const f of filas) for (const k of Object.keys(f)) if (!cab.includes(k)) cab.push(k);
  if (!cab.length) cab.push('Cliente', 'Articulo');
  const columnas = cab.slice();
  if (chance(0.15)) columnas.push(columnas[Math.floor(rnd() * columnas.length)]); // cabecera repetida
  const esc = (s) => { s = String(s); const q = /["\r\n]/.test(s) || s.includes(sep) || chance(0.08); return q ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lineas = [columnas.map(esc).join(sep)];
  for (const f of filas) {
    let vals = columnas.map((h, i) => (i >= cab.length ? pick(['', 'dup', 'otro']) : txt(f[h])));
    if (chance(0.05)) vals = vals.slice(0, Math.max(0, vals.length - 1 - Math.floor(rnd() * 3))); // fila corta
    else if (chance(0.03)) vals.push('sobra');                                                   // fila larga
    lineas.push(vals.map(esc).join(sep));
    if (chance(0.03)) lineas.push(pick(['', '   ']));                                            // línea vacía
  }
  let texto = '';
  lineas.forEach((l, i) => { texto += l; if (i < lineas.length - 1 || chance(0.8)) texto += eol(); });
  return Buffer.from(texto, 'latin1');
}
function flujo(buf, n) {
  let pos = 0;
  return new ReadableStream({ pull(c) { if (pos >= buf.length) { c.close(); return; } c.enqueue(new Uint8Array(buf.subarray(pos, pos + n))); pos += n; } });
}

// ---------- ejecución y comparación ----------
const totales = { A: 0, B: 0, C: 0, D: 0 };
const difs = { A: 0, B: 0, C: 0, D: 0 };
function reporta(t, titulo, detalle) { difs[t]++; if (difs[t] <= 3) console.log(`\n[${t}] DIFERENCIA en ${titulo}\n${detalle}`); }
const seguro = (f) => { try { return ser(f()); } catch (e) { return 'ERR:' + (e && e.message); } };
const seguroAsync = async (f) => { try { return ser(await f()); } catch (e) { return 'ERR:' + (e && e.message); } };
const filtroDe = (mod, id) => (id ? mod.buildVendorFilter({ rol: 'vendedor', id }) : null);

(async () => {
  const t0 = Date.now();
  // A) fila por fila
  for (let i = 0; i < FILAS; i++) {
    const row = filaAleatoria(false), fo = { type: pick(TIPOS_ARCHIVO) };
    const x = seguro(() => base.mapGitHubSalesRow(row, fo)), y = seguro(() => cand.mapGitHubSalesRow(row, fo));
    totales.A++;
    if (x !== y) reporta('A', 'mapGitHubSalesRow', `  fila:      ${JSON.stringify(row)}\n  tipo:      ${fo.type}\n  congelada: ${x}\n  tuya:      ${y}`);
  }
  // B) CSV completo
  const fijos = [Buffer.alloc(0), Buffer.from('\n'), Buffer.from('Cliente;Articulo'), Buffer.from('Cliente;Articulo\n'), Buffer.from('Cliente;Articulo\nA;B'),
    Buffer.from('Cliente,Articulo\r\n"A, S.A.","B ""x"""\r\n'), Buffer.from('Cliente;Articulo\n\n  \nA;B\n\n'), Buffer.from('Cliente;Articulo\r\n"A\r\nB";C\r\n'),
    // Tokenizador (Paso 1): comillas a mitad de campo, \r suelto, comilla sin cerrar, vacíos entre comillas, \r y \n dentro de comillas, comilla al final
    Buffer.from('Cliente;Articulo\nab"cd;ef"gh;x\n'), Buffer.from('Cliente;Articulo\nab\rcd;e\rf\r\n'), Buffer.from('Cliente;Articulo\n"sin cerrar;B\nC;D\n'),
    Buffer.from('Cliente;Articulo\n"";""\n"""";"x"""\n'), Buffer.from('Cliente;Articulo\n"a\rb";"c\nd\r\ne"\n'), Buffer.from('Cliente;Articulo\n"fin"'), Buffer.from('Cliente;Articulo\n"fin""'),
    Buffer.from('Cliente,Articulo\n"a"""b""c,d\n'), Buffer.from('Cliente;Articulo\r\r\nA;B\r\r\n')];
  const csvs = [...fijos, ...Array.from({ length: CASOS_CSV }, () => csvAleatorio())];
  for (const buf of csvs) {
    const id = pick(['53', '053', '0053', 'S/N', '90', '1', null, null]);
    for (const n of [1, 2, 3, 7, 64, 1000, 65536]) {
      const fb = { type: 'currMonth', url: 'x' }, fc = { type: 'currMonth', url: 'x' };
      const x = await seguroAsync(async () => ({ r: await base.streamCsvSalesRows({ body: flujo(buf, n) }, fb, () => false, filtroDe(base, id)), m: fb.maxFecha }));
      const y = await seguroAsync(async () => ({ r: await cand.streamCsvSalesRows({ body: flujo(buf, n) }, fc, () => false, filtroDe(cand, id)), m: fc.maxFecha }));
      totales.B++;
      if (x !== y) reporta('B', 'streamCsvSalesRows', `  bloque: ${n} bytes   filtro vendedor: ${id}\n  csv (latin1):\n${buf.toString('latin1').split('\n').slice(0, 12).map(l => '    | ' + JSON.stringify(l)).join('\n')}\n  congelada: ${x.slice(0, 600)}\n  tuya:      ${y.slice(0, 600)}`);
    }
  }
  // C) Excel: filas con celdas faltantes
  for (let c = 0; c < CASOS_CSV; c++) {
    const orto = chance(0.1) ? null : nuevaOrtografia();
    const filas = Array.from({ length: 1 + Math.floor(rnd() * 40) }, () => { const r = filaAleatoria(false, orto); for (const k of Object.keys(r)) if (chance(0.1)) delete r[k]; return r; });
    const id = pick(['53', '053', '90', null]);
    const fb = { type: pick(TIPOS_ARCHIVO) }, fc = { type: fb.type };
    const x = await seguroAsync(async () => ({ r: await base.parseExcelRowsChunked(filas, fb, () => false, filtroDe(base, id)), m: fb.maxFecha }));
    const y = await seguroAsync(async () => ({ r: await cand.parseExcelRowsChunked(filas, fc, () => false, filtroDe(cand, id)), m: fc.maxFecha }));
    totales.C++;
    if (x !== y) reporta('C', 'parseExcelRowsChunked', `  filas: ${JSON.stringify(filas).slice(0, 500)}\n  congelada: ${x.slice(0, 500)}\n  tuya:      ${y.slice(0, 500)}`);
  }
  // D) JSON ya con los nombres finales
  for (let c = 0; c < CASOS_CSV; c++) {
    const datos = chance(0.05) ? pick([{}, 'abc', null, 5]) : Array.from({ length: 1 + Math.floor(rnd() * 40) }, () => (chance(0.05) ? null : {
      fecha: pick(['2026-11-05', '2026-11-05T10:00:00', undefined, 5, '']), idVendedor: pick(['53', '053', 'S/N']), vendedor: pick(VENDEDORES), cliente: 'X', articulo: 'Y', monto: Math.round(rnd() * 100) }));
    const id = pick(['53', '053', '90', null]);
    const fb = { type: 'currMonth' }, fc = { type: 'currMonth' };
    const x = await seguroAsync(async () => ({ r: await base.parseJsonSalesChunked(datos, 'currMonth', () => false, filtroDe(base, id), fb), m: fb.maxFecha }));
    const y = await seguroAsync(async () => ({ r: await cand.parseJsonSalesChunked(datos, 'currMonth', () => false, filtroDe(cand, id), fc), m: fc.maxFecha }));
    totales.D++;
    if (x !== y) reporta('D', 'parseJsonSalesChunked', `  datos: ${JSON.stringify(datos).slice(0, 400)}\n  congelada: ${x.slice(0, 400)}\n  tuya:      ${y.slice(0, 400)}`);
  }
  const nombres = { A: 'A) mapGitHubSalesRow, fila por fila', B: 'B) CSV completo (comillas, saltos, bloques)', C: 'C) Excel (filas con celdas vacías)', D: 'D) JSON' };
  console.log(`\nParidad entre la versión congelada (12-nov) y ${rutaCand ? rutaCand : 'el index.html actual'}   (semilla ${SEMILLA}, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  let total = 0;
  for (const t of ['A', 'B', 'C', 'D']) { console.log(`  ${nombres[t].padEnd(44)} ${String(totales[t]).padStart(6)} casos   ${difs[t]} diferencias`); total += difs[t]; }
  console.log(total === 0 ? '\nRESULTADO: IGUAL. El cambio no altera ninguna fila.' : `\nRESULTADO: HAY ${total} DIFERENCIAS. No publiques este cambio sin entender cada una.`);
  process.exit(total === 0 ? 0 : 1);
})();
