# Medición y paridad de la lectura de ventas

Todo corre en Node: **sin navegador, sin red y sin datos reales** (los datos son inventados y la semilla es fija).

## Para qué sirve

La lectura de los archivos de ventas (`mapGitHubSalesRow`, `streamCsvSalesRows`, `parseExcelRowsChunked`, `parseJsonSalesChunked`) es donde se pierde casi todo el tiempo de la carga (ver `docs/TAREA_VELOCIDAD_VENTAS.md`). Estas herramientas permiten:

1. **Medir** cuánto tarda la versión del 12-nov y cuánto tarda la tuya (`bench.js`).
2. **Garantizar** que tu cambio produce exactamente las mismas filas (`paridad.js`).

## Comandos (desde la raíz del repositorio)

| Comando | Qué hace |
|---|---|
| `npm run medicion:datos` | Crea `ventas_sint.csv` (150.000 filas ≈ 24 MB, inventadas; no se versiona). Para 88 MB: `node herramientas/medicion_ventas/gen_csv_sintetico.js 540000 herramientas/medicion_ventas/ventas_sint.csv`. |
| `npm run medicion:bench` | Lee ese CSV con la versión congelada y con tu `index.html`, muestra tiempos y comprueba que las filas sean iguales. Añade `--repeticiones 3` para estabilizar. |
| `npm run medicion:paridad` | ≈ 63.000 casos aleatorios: cabeceras (alias, mayúsculas, tildes, colisiones), formatos de fecha y número, CSV con comillas, saltos CRLF/LF, líneas vacías, filas cortas y largas, cabeceras repetidas, lectura en bloques de 1 byte a 64 KB, con y sin filtro de vendedor; filas de Excel con celdas faltantes; JSON. Compara también `fileObj.maxFecha`. Termina con código 1 si hay una sola diferencia. |
| `npm run medicion:memoria` | Mide la **memoria retenida** (no solo el tiempo) tras leer el CSV con la versión congelada y con tu `index.html`, en dos casos: administrador (todas las filas) y vendedor (≈ 3 % repartido). Corre antes `node herramientas/medicion_ventas/extraer.js`. Para un archivo realista: `node herramientas/medicion_ventas/gen_csv_sintetico.js 900000 ventas_145mb.csv` y pásalo como argumento de `memoria.js`. |

Con otro módulo en vez del `index.html`: `--candidato ruta.js` (debe exportar las mismas funciones). Ejemplo incluido:

```bash
node herramientas/medicion_ventas/paridad.js --candidato herramientas/medicion_ventas/ejemplo/candidato_ejemplo.js
node --expose-gc herramientas/medicion_ventas/bench.js herramientas/medicion_ventas/ventas_sint.csv --candidato herramientas/medicion_ventas/ejemplo/candidato_ejemplo.js
```

## Archivos

| Archivo | Qué es |
|---|---|
| `baseline_12nov.js` | **Congelado.** Copia exacta de las funciones del `index.html` del 12-nov-2026. Es la referencia: no se modifica. |
| `extraer.js` | Extrae esas funciones de tu `index.html` actual (con el analizador de Babel) a `actual_extraido.js`. Si agregas funciones auxiliares que usen estas, pásalas con `--extra=nombre1,nombre2` (declaraciones de primer nivel). Si renombras o mueves las nueve funciones base, tendrás que ajustar la lista `BASE`. |
| `gen_csv_sintetico.js` | Generador de CSV de ventas inventado (formato tipo ERP). |
| `bench.js` / `paridad.js` | Medición y prueba de paridad. |
| `ejemplo/candidato_ejemplo.js` | Prueba de concepto **no integrada en la app**: igual que la versión congelada salvo `mapGitHubSalesRow` (columnas resueltas una vez por firma de claves). Pasa `paridad.js` y da 4–7× en `bench.js`. Compáralo con `diff`. |

## Qué NO cubre

- Red, descarga, `saveToCache` / `loadFromCache` (IndexedDB), React ni la memoria en un iPhone real (`memoria.js` mide la memoria retenida en Node con V8, que es solo una referencia): en un teléfono los tiempos son varias veces mayores. Mide esas partes aparte.
- Un BOM UTF-8 al inicio del CSV (deja `ï»¿` pegado a la primera cabecera): es un defecto conocido de la versión actual (guía A9); `paridad.js` no lo prueba para no marcar como error una corrección intencional.
- El camino de Excel con archivos reales (`XLSX.read`): solo se prueban filas ya convertidas a objetos.
- Que la lectura sea idéntica no garantiza por sí sola que las pantallas lo sean: compara también los números visibles con los mismos archivos antes de entregar.
