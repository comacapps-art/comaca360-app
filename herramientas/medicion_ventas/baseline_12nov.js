// CONGELADO: copia exacta de estas funciones tal como están en el index.html del 12-nov-2026 (sha256 66c976543d4ee9e6d211146798b9b7120483d04cf75f9014fa6e4ef4ab6a0112).
// Es la referencia contra la que se comparan los cambios: NO la modifiques.
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

function mapGitHubSalesRow(row, fileObj) {
            const normalizeKey = (key) => String(key).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
            const getVal = (keys) => {
                const rowKeys = Object.keys(row);
                for (let k of keys) {
                    const targetKey = normalizeKey(k);
                    const foundKey = rowKeys.find(rk => normalizeKey(rk) === targetKey);
                    if (foundKey !== undefined) return row[foundKey];
                }
                return undefined;
            };
            const clienteVal = String(getVal(['Cliente', 'Client', 'NombreCliente', 'RazonSocial']) || '').trim().toUpperCase();
            const articuloVal = String(getVal(['Articulo', 'Article', 'Producto', 'Descripcion', 'Item']) || '').trim().toUpperCase();

            // Validar que los datos esenciales estén presentes (evitar filas vacías o basura)
            if (!clienteVal || !articuloVal) return null;

            // Quitar la restricción estricta de includes('TOTAL') pero evitar la fila de suma de totales exacta si ocurre
            if (clienteVal === 'TOTAL' || clienteVal === 'TOTAL GENERAL' || articuloVal === 'TOTAL' || articuloVal === 'TOTAL GENERAL') return null;

            let fechaVal = getVal(['Fecha', 'Date', 'Emision', 'Dia']);
            if (fechaVal) {
                if (typeof fechaVal === 'string') {
                    let fStr = String(fechaVal).trim().split(' ')[0];
                    const sep = fStr.includes('/') ? '/' : (fStr.includes('-') ? '-' : null);
                    if (sep) {
                        const parts = fStr.split(sep);
                        if (parts.length === 3) {
                            // El año es la parte de 4 dígitos, esté primero o al final; las
                            // otras dos son mes y día EN EL ORDEN en que vinieron. Antes, un
                            // formato "año primero sin ceros" (ej. "2026-6-30") no calzaba con
                            // ninguna rama y se dejaba tal cual, sin rellenar el mes/día a 2
                            // dígitos. Eso rompía la comparación de texto de los filtros por
                            // fecha: "2026-6-30" > "2026-07-01" para JavaScript (el carácter
                            // '6' pesa más que '0'), así que una venta de junio se colaba
                            // dentro de un filtro de julio.
                            let y, m, d;
                            if (parts[0].length === 4) { y = parts[0]; m = parts[1]; d = parts[2]; }
                            else if (parts[2].length === 4) { y = parts[2]; m = parts[1]; d = parts[0]; }
                            if (y) {
                                fechaVal = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                            } else {
                                fechaVal = fStr; // no se pudo identificar el año (ambiguo): se deja como venía
                            }
                        }
                    } else {
                        fechaVal = fStr;
                    }
                } else if (typeof fechaVal === 'number') {
                    const dateObj = new Date(Math.round((fechaVal - 25569) * 86400 * 1000));
                    fechaVal = dateObj.toISOString().split('T')[0];
                }
            } else if (getVal(['Mes', 'Month'])) {
                const mesNum = parseInt(String(getVal(['Mes', 'Month'])).replace(/[^0-9]/g, ''), 10) || 1;
                const mesStr = String(mesNum).padStart(2, '0');
                let yearVal = getVal(['Año', 'Ano', 'Year', 'Ao', 'Aao']);
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
                idCliente: (() => { const rawId = String(getVal(['IdCliente', 'CodigoCliente', 'CodCliente', 'Id Cliente', 'ID_Cliente']) || 'S/N').trim(); return /^\d+$/.test(rawId) ? rawId.padStart(6, '0') : rawId; })(),
                cliente: clienteVal,
                grupo: String(getVal(['Grupo', 'Subgrupo', 'Linea', 'Marca']) || 'GENERAL').trim().toUpperCase(),
                subgrupo: String(getVal(['Subgrupo', 'Sub Grupo', 'SubGrupo', 'Sub-Grupo', 'SubLinea', 'Sub Linea']) || '').trim().toUpperCase(),
                // Línea de producto (ej. MAYONESA, TANG): columna propia que hoy solo trae el archivo
                // del mes en curso. Vacía en los archivos que no la incluyen.
                linea: String(getVal(['Linea', 'Line']) || '').trim().toUpperCase(),
                idVendedor: String(getVal(['IdVendedor', 'CodigoVendedor', 'CodVendedor']) || 'S/N').trim(),
                vendedor: String(getVal(['Vendedor', 'Venedor', 'NombreVendedor']) || 'Sin Asignar').trim().toUpperCase(),
                supervisor: String(getVal(['Supervisor', 'Gerente']) || 'Sin Asignar').trim().toUpperCase(),
                tipoDoc: String(getVal(['TipoDoc', 'TipoDocumento', 'Documento']) || 'FA').trim().toUpperCase(),
                numero: String(getVal(['Numero', 'Factura', 'Nro']) || 'S/N').trim(),
                articulo: articuloVal,
                cajas: parseNum(getVal(['Cajas', 'Cj', 'Bultos', 'Caixes'])),
                unidades: parseNum(getVal(['Unidades', 'Und', 'Piezas', 'Unitats'])),
                monto: parseNum(getVal(['Monto', 'Importe', 'Total', 'Venta', 'Neto', 'Import'])),
                kilos: parseNum(getVal(['Kgs/Lts', 'Kilos/Litros', 'Kilos', 'Kgs', 'Lts', 'Volumen', 'KilosLitros', 'KILOS', 'KGS', 'Kg', 'Lt', 'Kilo', 'Litro', 'KILOS/LITROS', 'KGS/LTS']))
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
