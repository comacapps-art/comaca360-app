// PRUEBA DE CONCEPTO (NO está integrada en index.html). Único cambio respecto a baseline_12nov.js: la función
// mapGitHubSalesRow (compara con `diff baseline_12nov.js ejemplo/candidato_ejemplo.js`). Sirve para ver el cambio mínimo
// del Paso 1 y para probar que paridad.js y bench.js funcionan:
//     node herramientas/medicion_ventas/paridad.js --candidato herramientas/medicion_ventas/ejemplo/candidato_ejemplo.js
//     node --expose-gc herramientas/medicion_ventas/bench.js ventas_sint.csv --candidato herramientas/medicion_ventas/ejemplo/candidato_ejemplo.js
// Quedan fuera de este ejemplo (son parte del trabajo): el tokenizador CSV (sigue leyendo carácter por carácter), la
// resolución de columnas una sola vez por archivo en vez de por firma por fila, y todo lo del Paso 2.
'use strict';

const normalizeId = (id) => {
            if (id === undefined || id === null) return "";
            const str = String(id).replace(/[^0-9A-Za-z]/g, '');
            return str.replace(/^0+(?=[1-9A-Za-z])/g, '') || str;
        };

const parseNum = (val) => {
            if (val === undefined || val === null || val === '') return 0;
            if (typeof val === 'number') return val;
            let str = String(val).trim().replace(/[^0-9.,-]/g, '');
            if (!str) return 0;
            if (!str.includes(',') && !str.includes('.')) return Number(str) || 0;
            const lastComma = str.lastIndexOf(',');
            const lastDot = str.lastIndexOf('.');
            if (lastComma !== -1 && lastDot !== -1) {
                if (lastComma > lastDot) str = str.replace(/\./g, '').replace(',', '.');
                else str = str.replace(/,/g, '');
            } else if (lastComma !== -1) {
                if (str.split(',').length > 2) str = str.replace(/,/g, '');
                else str = str.replace(',', '.');
            } else if (lastDot !== -1) {
                if (str.split('.').length > 2) str = str.replace(/\./g, '');
            }
            return Number(str) || 0;
        };

const yieldToBrowser = () => new Promise((resolve) => {
            if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => resolve());
            else setTimeout(resolve, 0);
        });

// --- PRUEBA DE CONCEPTO: las columnas se resuelven UNA vez por "firma" de claves, no en cada fila -----------------
        // Antes, getVal() recorría las claves de la fila y calculaba normalize('NFD') + 2 regex por clave y por alias, en
        // cada fila (~25 veces por fila). Ahora se calcula una vez por cada combinación distinta de claves (en un CSV es
        // una sola; en Excel puede haber varias porque SheetJS omite las celdas vacías) y cada fila solo lee valores.
        const _normalizarClave = (key) => String(key).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
        const _ALIAS = {
            cliente: ['Cliente', 'Client', 'NombreCliente', 'RazonSocial'],
            articulo: ['Articulo', 'Article', 'Producto', 'Descripcion', 'Item'],
            fecha: ['Fecha', 'Date', 'Emision', 'Dia'],
            mes: ['Mes', 'Month'],
            ano: ['Año', 'Ano', 'Year', 'Ao', 'Aao'],
            idCliente: ['IdCliente', 'CodigoCliente', 'CodCliente', 'Id Cliente', 'ID_Cliente'],
            grupo: ['Grupo', 'Subgrupo', 'Linea', 'Marca'],
            subgrupo: ['Subgrupo', 'Sub Grupo', 'SubGrupo', 'Sub-Grupo', 'SubLinea', 'Sub Linea'],
            linea: ['Linea', 'Line'],
            idVendedor: ['IdVendedor', 'CodigoVendedor', 'CodVendedor'],
            vendedor: ['Vendedor', 'Venedor', 'NombreVendedor'],
            supervisor: ['Supervisor', 'Gerente'],
            tipoDoc: ['TipoDoc', 'TipoDocumento', 'Documento'],
            numero: ['Numero', 'Factura', 'Nro'],
            cajas: ['Cajas', 'Cj', 'Bultos', 'Caixes'],
            unidades: ['Unidades', 'Und', 'Piezas', 'Unitats'],
            monto: ['Monto', 'Importe', 'Total', 'Venta', 'Neto', 'Import'],
            kilos: ['Kgs/Lts', 'Kilos/Litros', 'Kilos', 'Kgs', 'Lts', 'Volumen', 'KilosLitros', 'KILOS', 'KGS', 'Kg', 'Lt', 'Kilo', 'Litro', 'KILOS/LITROS', 'KGS/LTS']
        };
        const _ALIAS_NORM = {};
        for (const campo in _ALIAS) _ALIAS_NORM[campo] = _ALIAS[campo].map(_normalizarClave);
        const _columnasPorFirma = new Map();
        function _columnasDe(row) {
            const claves = Object.keys(row);
            const firma = claves.join('\u0001');
            let cols = _columnasPorFirma.get(firma);
            if (cols) return cols;
            const norm = claves.map(_normalizarClave);
            cols = {};
            for (const campo in _ALIAS_NORM) {
                let encontrada; // misma regla que antes: gana el primer alias (en orden) cuya columna exista; si hay varias columnas equivalentes, la primera
                for (const t of _ALIAS_NORM[campo]) { const i = norm.indexOf(t); if (i !== -1) { encontrada = claves[i]; break; } }
                cols[campo] = encontrada;
            }
            if (_columnasPorFirma.size > 500) _columnasPorFirma.clear();
            _columnasPorFirma.set(firma, cols);
            return cols;
        }

        function mapGitHubSalesRow(row, fileObj) {
            const cols = _columnasDe(row);
            const g = (c) => (c === undefined ? undefined : row[c]);
            const clienteVal = String(g(cols.cliente) || '').trim().toUpperCase();
            const articuloVal = String(g(cols.articulo) || '').trim().toUpperCase();
            if (!clienteVal || !articuloVal) return null;
            if (clienteVal === 'TOTAL' || clienteVal === 'TOTAL GENERAL' || articuloVal === 'TOTAL' || articuloVal === 'TOTAL GENERAL') return null;

            let fechaVal = g(cols.fecha);
            if (fechaVal) {
                if (typeof fechaVal === 'string') {
                    let fStr = String(fechaVal).trim().split(' ')[0];
                    const sep = fStr.includes('/') ? '/' : (fStr.includes('-') ? '-' : null);
                    if (sep) {
                        const parts = fStr.split(sep);
                        if (parts.length === 3) {
                            let y, m, d;
                            if (parts[0].length === 4) { y = parts[0]; m = parts[1]; d = parts[2]; }
                            else if (parts[2].length === 4) { y = parts[2]; m = parts[1]; d = parts[0]; }
                            if (y) fechaVal = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                            else fechaVal = fStr;
                        }
                    } else {
                        fechaVal = fStr;
                    }
                } else if (typeof fechaVal === 'number') {
                    const dateObj = new Date(Math.round((fechaVal - 25569) * 86400 * 1000));
                    fechaVal = dateObj.toISOString().split('T')[0];
                }
            } else if (g(cols.mes)) {
                const mesNum = parseInt(String(g(cols.mes)).replace(/[^0-9]/g, ''), 10) || 1;
                const mesStr = String(mesNum).padStart(2, '0');
                let yearVal = g(cols.ano);
                let finalYear;
                if (yearVal) {
                    finalYear = parseInt(String(yearVal).replace(/[^0-9]/g, ''), 10);
                    if (isNaN(finalYear) || finalYear < 1900 || finalYear > 2100) finalYear = null;
                }
                if (!finalYear) {
                    const currentYear = new Date().getFullYear();
                    finalYear = fileObj.type === 'prevYear' ? currentYear - 1 : currentYear;
                }
                fechaVal = `${finalYear}-${mesStr}-01`;
            } else {
                fechaVal = new Date().toISOString().split('T')[0];
            }
            return {
                source: fileObj.type,
                fecha: fechaVal,
                idCliente: (() => { const rawId = String(g(cols.idCliente) || 'S/N').trim(); return /^\d+$/.test(rawId) ? rawId.padStart(6, '0') : rawId; })(),
                cliente: clienteVal,
                grupo: String(g(cols.grupo) || 'GENERAL').trim().toUpperCase(),
                subgrupo: String(g(cols.subgrupo) || '').trim().toUpperCase(),
                linea: String(g(cols.linea) || '').trim().toUpperCase(),
                idVendedor: String(g(cols.idVendedor) || 'S/N').trim(),
                vendedor: String(g(cols.vendedor) || 'Sin Asignar').trim().toUpperCase(),
                supervisor: String(g(cols.supervisor) || 'Sin Asignar').trim().toUpperCase(),
                tipoDoc: String(g(cols.tipoDoc) || 'FA').trim().toUpperCase(),
                numero: String(g(cols.numero) || 'S/N').trim(),
                articulo: articuloVal,
                cajas: parseNum(g(cols.cajas)),
                unidades: parseNum(g(cols.unidades)),
                monto: parseNum(g(cols.monto)),
                kilos: parseNum(g(cols.kilos))
            };
        }

function buildVendorFilter(user) {
            if (!user || user.rol !== 'vendedor') return null;
            const normUserId = normalizeId(user.id);
            const uid = String(user.id);
            return (m) => {
                if (!m) return false;
                const sId = normalizeId(m.idVendedor);
                if (sId === normUserId) return true;
                const v = m.vendedor;
                return typeof v === 'string' && (v.startsWith(uid + " ") || v.startsWith(uid + "-") || v === uid);
            };
        }

const notaFechaVenta = (fileObj, fecha) => {
            if (typeof fecha !== 'string') return;
            const f = fecha.substring(0, 10);
            if (f > (fileObj.maxFecha || '') && /^\d{4}-\d{2}-\d{2}$/.test(f)) fileObj.maxFecha = f;
        };

async function parseExcelRowsChunked(excelRows, fileObj, isCancelled, rowFilter) {
            const out = [];
            const CHUNK = 1200;
            for (let i = 0; i < excelRows.length; i += CHUNK) {
                if (isCancelled()) return out;
                const end = Math.min(i + CHUNK, excelRows.length);
                for (let j = i; j < end; j++) {
                    const m = mapGitHubSalesRow(excelRows[j], fileObj);
                    if (m) notaFechaVenta(fileObj, m.fecha);
                    if (m && (!rowFilter || rowFilter(m))) out.push(m);
                }
                await yieldToBrowser();
            }
            return out;
        }

async function parseJsonSalesChunked(data, sourceType, isCancelled, rowFilter, fileObj) {
            if (!Array.isArray(data)) return [];
            const out = [];
            const CHUNK = 4000;
            for (let i = 0; i < data.length; i += CHUNK) {
                if (isCancelled()) return out;
                const end = Math.min(i + CHUNK, data.length);
                for (let j = i; j < end; j++) {
                    const m = { ...data[j], source: sourceType };
                    if (fileObj) notaFechaVenta(fileObj, m.fecha);
                    if (!rowFilter || rowFilter(m)) out.push(m);
                }
                await yieldToBrowser();
            }
            return out;
        }

async function streamCsvSalesRows(res, fileObj, isCancelled, rowFilter) {
            const out = [];
            const decoder = new TextDecoder('windows-1252');
            let headers = null;
            let separator = null;
            let field = '';
            let row = [];
            let inQuotes = false;
            let pendingQuote = false; // una comilla quedó al final de un chunk; decidir en el siguiente
            let pending = '';        // acumulador para detectar el separador en la 1ra línea
            let sinceYield = 0;

            const finishRow = () => {
                row.push(field);
                field = '';
                if (row.length === 1 && row[0].trim() === '') { row = []; return; } // fila vacía
                if (!headers) { headers = row.map(h => h.trim()); row = []; return; }
                const obj = {};
                for (let i = 0; i < headers.length; i++) {
                    obj[headers[i]] = row[i] !== undefined ? row[i].trim() : '';
                }
                row = [];
                const m = mapGitHubSalesRow(obj, fileObj);
                if (m) notaFechaVenta(fileObj, m.fecha);
                if (m && (!rowFilter || rowFilter(m))) out.push(m);
            };

            const processText = (text) => {
                let i = 0;
                if (pendingQuote) { // resolver la comilla que quedó al final del chunk anterior
                    pendingQuote = false;
                    if (text.length === 0) { pendingQuote = true; return; }
                    if (text[0] === '"') { field += '"'; i = 1; } // era una comilla escapada ("")
                    else inQuotes = false;                         // era la comilla de cierre del campo
                }
                for (; i < text.length; i++) {
                    const char = text[i];
                    if (inQuotes) {
                        if (char === '"') {
                            if (i + 1 < text.length) { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
                            else pendingQuote = true; // último char del chunk: no se puede decidir aún
                        } else field += char;
                    } else {
                        if (char === '"') inQuotes = true;
                        else if (char === separator) { row.push(field); field = ''; }
                        else if (char === '\n') finishRow();
                        else if (char === '\r') { /* ignorar */ }
                        else field += char;
                    }
                }
            };

            // Sin soporte de streaming (raro): caer al método clásico en un solo bloque.
            if (!res.body || typeof res.body.getReader !== 'function') {
                const buf = await res.arrayBuffer();
                let text = decoder.decode(buf);
                separator = (text.split('\n')[0] || '').includes(';') ? ';' : ',';
                processText(text);
                if (field !== '' || row.length > 0) finishRow();
                return out;
            }

            const reader = res.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (isCancelled()) { try { reader.cancel(); } catch (e) {} return out; }
                if (done) break;
                let text = decoder.decode(value, { stream: true });
                if (separator === null) {
                    pending += text;
                    const nl = pending.indexOf('\n');
                    if (nl === -1 && pending.length < 8192) continue; // esperar a tener la 1ra línea
                    const sample = nl !== -1 ? pending.slice(0, nl) : pending;
                    separator = sample.includes(';') ? ';' : ',';
                    text = pending;
                    pending = '';
                }
                processText(text);
                sinceYield += text.length;
                if (sinceYield > 600000) { sinceYield = 0; await yieldToBrowser(); }
            }
            decoder.decode(new Uint8Array()); // finalizar decoder
            if (separator === null && pending) { // archivo de una sola línea sin salto final
                separator = pending.includes(';') ? ';' : ',';
                processText(pending);
            }
            if (pendingQuote) { inQuotes = false; pendingQuote = false; } // comilla de cierre al final del archivo
            if (field !== '' || row.length > 0) finishRow();
            return out;
        }

module.exports = { normalizeId, parseNum, yieldToBrowser, mapGitHubSalesRow, buildVendorFilter, notaFechaVenta, parseExcelRowsChunked, parseJsonSalesChunked, streamCsvSalesRows };
