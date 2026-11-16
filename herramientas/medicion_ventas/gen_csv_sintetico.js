'use strict';
// Genera un CSV de ventas SINTÉTICO (datos inventados, nada real) con los encabezados que reconoce la app.
//   node herramientas/medicion_ventas/gen_csv_sintetico.js <filas> <salida.csv> [columnasExtra]
// Formato parecido al de un ERP: separador ';', números con coma decimal, fechas D/M/AAAA, codificación latin1
// (windows-1252), saltos CRLF. 150.000 filas ≈ 24 MB; un archivo de ~88 MB serían unas 540.000 filas.
const fs = require('fs');
const N = parseInt(process.argv[2] || '150000', 10);
const OUT = process.argv[3] || 'ventas_sint.csv';
const EXTRA = parseInt(process.argv[4] || '0', 10);

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const clientes = Array.from({ length: 4000 }, (_, i) => ({
  id: String(100000 + i * 7),
  nombre: `${pick(['BODEGON', 'ABASTOS', 'SUPERMERCADO', 'CHARCUTERIA', 'MINIMARKET', 'AUTOMERCADO', 'DISTRIBUIDORA', 'COMERCIAL'])} ${pick(['LA ESPERANZA', 'EL PEÑÓN', 'SAN JOSÉ', 'LOS ANDES', 'EL ÁNGEL', 'CAÑAFÍSTOLA', 'LA CASTELLANA', 'MARÍA', 'PIÑERO', 'NUEVA ERA'])} ${i}, C.A.`,
}));
const vendedores = Array.from({ length: 40 }, (_, i) => ({
  id: String(50 + i),
  nombre: `${String(50 + i).padStart(3, '0')} ${pick(['JOSÉ', 'MARÍA', 'JESÚS', 'ÁNGEL', 'LUIS', 'CARMEN', 'NÉSTOR'])} ${pick(['PÉREZ', 'GONZÁLEZ', 'RODRÍGUEZ', 'MÁRQUEZ', 'NÚÑEZ'])}`,
}));
const grupos = ['MAYONESA', 'SALSAS', 'ADEREZOS', 'MARGARINA', 'ACEITES', 'HARINAS', 'PASTAS', 'CAFÉ', 'JUGOS', 'SNACKS'];
const articulos = Array.from({ length: 900 }, (_, i) => `${pick(grupos)} ${pick(['PREMIUM', 'CLASICA', 'LIGHT', 'FAMILIAR', 'INDIVIDUAL'])} ${pick(['200G', '400G', '1KG', '500ML', '1L', '2L'])} REF-${i}`);
const num = (x, dec) => x.toFixed(dec).replace('.', ',');
const cab = ['Fecha', 'IdCliente', 'Cliente', 'Grupo', 'Subgrupo', 'Linea', 'IdVendedor', 'Vendedor', 'Supervisor', 'TipoDoc', 'Numero', 'Articulo', 'Cajas', 'Unidades', 'Monto', 'Kgs/Lts'];
for (let e = 0; e < EXTRA; e++) cab.push('Extra' + (e + 1));

const fd = fs.openSync(OUT, 'w');
fs.writeSync(fd, Buffer.from(cab.join(';') + '\r\n', 'latin1'));
let buf = [];
for (let i = 0; i < N; i++) {
  const c = clientes[Math.floor(rnd() * clientes.length)];
  const v = vendedores[Math.floor(rnd() * vendedores.length)];
  const g = pick(grupos);
  const mes = 1 + Math.floor(rnd() * 11), dia = 1 + Math.floor(rnd() * 28);
  const fecha = `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/2026`;
  const fila = [fecha, c.id, c.nombre, g, g + ' SUB', g, v.id, v.nombre, 'GERENTE ' + (1 + (v.id % 4)), rnd() < 0.03 ? 'DV' : 'FA',
    String(900000 + Math.floor(i / 6)), pick(articulos), num(1 + Math.floor(rnd() * 40), 0), num(Math.floor(rnd() * 400), 0),
    (rnd() < 0.5 ? num(rnd() * 3000, 2) : '1.' + String(Math.floor(rnd() * 900) + 100) + ',' + String(Math.floor(rnd() * 90) + 10)),
    num(rnd() * 500, 3)];
  for (let e = 0; e < EXTRA; e++) fila.push('x' + e);
  buf.push(fila.join(';'));
  if (buf.length >= 5000) { fs.writeSync(fd, Buffer.from(buf.join('\r\n') + '\r\n', 'latin1')); buf = []; }
}
if (buf.length) fs.writeSync(fd, Buffer.from(buf.join('\r\n') + '\r\n', 'latin1'));
fs.closeSync(fd);
console.log(OUT, (fs.statSync(OUT).size / 1048576).toFixed(1) + ' MB,', N, 'filas');
