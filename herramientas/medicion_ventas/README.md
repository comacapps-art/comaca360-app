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
| `npm run medicion:activacion` | Prueba la pantalla "Activación por Producto": que sus montos y cajas **descuenten las devoluciones** como la pantalla principal, sin cambiar quién cuenta como activo. Compara con la versión anterior congelada (`activacion_congelada_20nov.js`) y comprueba que la propia prueba detecta errores introducidos a propósito. |
| `npm run medicion:cartera` | Prueba el "Resumen de Cartera" del administrador y el gerente: que el cálculo nuevo (con índices) dé **exactamente** el mismo resultado que el anterior (cruce clientes × filas), con datos sucios y errores introducidos a propósito, y mide la velocidad con el tamaño real (3.034 clientes; 16.264 y 62.000 filas). Compara con la copia congelada `cartera_congelada_20nov.js`. |
| `npm run medicion:ceder` | Prueba la cesión del hilo al leer archivos de ventas (`cederElHilo`): con la página en segundo plano el navegador frena o pausa `requestAnimationFrame` y cada cesión con `yieldToBrowser` esperaba ese cuadro (≈ 1 s por cesión, ≈ 250 cesiones con el archivo del año). SIMULA ese freno en Node (cuenta llamadas, no segundos) y comprueba que los lectores de CSV, Excel y JSON no esperan ningún cuadro, ceden el hilo las veces esperadas y dan exactamente las mismas filas que la versión anterior; que los seis sitios de datos del `index.html` usan `cederElHilo` y solo la matriz en PDF conserva `yieldToBrowser`; y que detecta 9 errores introducidos a propósito. No sustituye una prueba en un navegador real.|
| `npm run medicion:visitas` | Prueba las visitas a clientes con un Firestore y un almacenamiento simulados: la cola del teléfono para marcar sin señal (se guarda antes de enviarse; **nunca se da por confirmada** una visita que el servidor no confirmó, aunque falle el almacenamiento; reenvío con el mismo id y con merge para no borrar la validación; reintento de las colas de todos los vendedores del teléfono; sobrevive a cerrar la app), el día con la hora del teléfono, la clave de los clientes (de cartera y nuevos, por vendedor y sin chocar), la distancia, la alerta de más de 50 m con el margen del GPS y sus bordes, la ubicación del cliente que fija solo la primera visita manual (sin pisar), quién ve a quién (administrador, gerente y gerentes a su cargo), el GPS con su propio tiempo de espera y un reintento (el primer GPS en frío puede tardar) y la limpieza de documentos mal formados. En el `index.html` comprueba que el pedido de un vendedor no se frena, que marcar nunca se bloquea por la distancia, que solo el administrador valida, que no quedan mapas de CARTO ni marcas de tilde crudas. Detecta 43 errores introducidos a propósito; un mutante que no se pueda aplicar o que ya falle en la base no cuenta como detectado. No sustituye la prueba en el emulador ni en un teléfono. |

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
