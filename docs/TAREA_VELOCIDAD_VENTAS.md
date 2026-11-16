# Tarea: que la carga de ventas sea rápida

**Versión base:** `index.html` del 12-nov-2026 — 1.136.838 bytes, sha256 `66c976543d4ee9e6…a0112` · compilado `PARA SUBIR/index.html` — 830.211 bytes, sha256 `ee5cd27a6626ad6e…b340`.
Con Babel 8.0.1, `npm run build` reproduce ese compilado byte a byte (verificado el 16-nov-2026). Los números de línea de este documento son de esa versión.

**Estado:** escrito el 16-nov-2026 por el dueño del sistema y su asistente (Claude). Nada de lo que propone el plan está implementado en el código de la app. Lo único construido son las herramientas de medición y un ejemplo del Paso 1 en `herramientas/medicion_ventas/`.

**La guía técnica no está en este repositorio** (es público): el dueño te la entrega por privado. Las referencias "guía A9", "B1.7"… de este documento son a esa guía.

---

## 1. Qué se quiere

Hoy, cuando el dueño sube las ventas nuevas, cada equipo tarda **hasta ~10 minutos** en tenerlas listas (cifra del dueño; se nota sobre todo en teléfonos). Se quiere que sea cuestión de segundos o, como mucho, de un minuto, **sin cambiar nada de lo que ya funciona**.

El dueño ya activó el plan Blaze de Firebase (16-nov-2026). Ojo: Blaze **por sí solo no acelera nada**; quita el tope diario de Firestore y habilita Cloud Functions y Storage. La velocidad sale de cambiar *dónde* y *cuántas veces* se hace el trabajo.

## 2. Cómo llegan hoy las ventas (versión del 12-nov)

```
GitHub: 3 archivos (.csv / .xlsx / .json)          navegador de CADA equipo
  prevYear · currYear · currMonth      ──fetch──►   lee en streaming y filtra por vendedor al vuelo
  (enlaces en Firestore config/settings)             └► mapGitHubSalesRow (por fila) ► salesData (memoria) ► pantallas
                                                     └► copia por usuario en IndexedDB
```

- Enlaces: `githubSalesUrlPrevYear`, `githubSalesUrlCurrYear`, `githubSalesUrlCurrMonth` en `config/settings` (Firestore). El archivo mayor pesa **~88 MB** (comentario en `streamCsvSalesRows`). Las ventas **no están en Firestore**.
- `fetchGitHubData` (~13555) baja los archivos **uno tras otro**. Al entrar solo baja `currYear` y `currMonth`; el año anterior (el más pesado) se difiere hasta entrar a Histórico o IA (`ensurePrevYearLoaded`). "Sincronizar ahora" baja los tres.
- Un **vendedor** baja el archivo **completo** y se queda solo con sus filas (`buildVendorFilter`, ~12898); un administrador o gerente guarda todo.
- Cada fila pasa por `mapGitHubSalesRow` (~12802): normaliza cabeceras (alias), fechas y números. Las reglas exactas están en la guía técnica, sección A9.
- La copia se guarda en IndexedDB (`Comaca360Cache` / `salesCacheStore`, clave `salesData_<idUsuario>`) y la marca en `localStorage` (`githubSyncMeta_<id>`). Se vuelve a bajar pasado el corte de las 5 p.m. de Caracas o cuando el administrador pulsa "Publicar ventas" (`ventasVersion` en `config/settings`).
- Funciones clave: `fetchGithubSalesFile` (~13056), `streamCsvSalesRows` (~12965), `parseExcelRowsChunked` (~12929), `parseJsonSalesChunked` (~12945), `saveToCache` (~263), `loadFromCache` (~306), `publicarVentas` (~13255).

## 3. Diagnóstico medido

Medido en Node con un CSV **sintético** (150.000 filas, 24,2 MB, 16 columnas, `;`, latin1, números con coma), con `herramientas/medicion_ventas/`:

| Qué se mide | Tiempo en esta PC | Comentario |
|---|---|---|
| Código actual: leer + mapear cada fila | 11–15 s (≈10–13 mil filas/s) | |
| Solo leer/separar el CSV, sin mapear | 1,5–1,9 s | **≈ 85–90 % del tiempo actual es el mapeo de filas** |
| Mapeo con las columnas resueltas una vez (ejemplo) | 2–3 s | **4–7× más rápido, mismas filas** (0 diferencias) |

Proyección a ~88 MB (≈ 540.000 filas): 41–54 s → 7–10 s en una computadora. Un teléfono es varias veces más lento, de ahí los minutos. Las medidas varían ±20 % entre corridas.

**Causa:** en `mapGitHubSalesRow`, `getVal` se llama unas **16 veces por fila** y cada llamada hace `Object.keys(row)` y, por cada alias, `rowKeys.find(rk => normalizeKey(rk) === …)`; `normalizeKey` hace `toLowerCase().normalize('NFD').replace(…).replace(…)`. Son cientos de normalizaciones de texto por fila, siempre con el mismo resultado, porque las cabeceras no cambian de una fila a otra.

**Lo que NO está medido** (mídelo antes de optimizar a ciegas):
- La descarga real (secuencial; hasta ~88 MB por móvil con datos).
- `saveToCache` (clonado estructurado de cientos de miles de objetos a IndexedDB) y `loadFromCache` (se lee en cada apertura).
- El recálculo de las pantallas con un `salesData` grande y la memoria pico en iPhone (Safari).
- El tiempo de Excel (`XLSX.read` + `sheet_to_json`), probablemente lo más lento si algún archivo es `.xlsx`.
- No se sabe qué formato tiene cada archivo en producción (el comentario del código habla de un CSV de ~88 MB). Pregúntaselo al dueño.

## 4. Plan en 3 pasos

### Paso 1 — Acelerar la lectura (no necesita Blaze) ← **primer entregable**

- Resolver las columnas **una vez por archivo**, no en cada fila. En CSV las cabeceras son fijas. En Excel, `sheet_to_json` omite las celdas vacías, así que las claves cambian de fila en fila: memoizar por "firma" de claves, como hace `herramientas/medicion_ventas/ejemplo/candidato_ejemplo.js`. Esta es casi toda la ganancia.
- Opcional (el siguiente ~10 %): un tokenizador CSV que corte con `indexOf` / `slice` en lugar de `field += char`.
- Opcional: medir si bajar los tres archivos en paralelo ayuda (en iPhone puede costar memoria).
- Medir y, si pesa, optimizar el guardado y la lectura de la copia local.
- **Debe conservar:** streaming y filtro por vendedor al vuelo, `yieldToBrowser`, `notaFechaVenta` ("Ventas hasta"), los tres formatos, el manejo de errores (propagar el error, nunca devolver un arreglo vacío que borre la copia) y **todas** las reglas de alias, fecha y número de la guía A9.
- **Listo cuando:** `npm run medicion:paridad` da 0 diferencias (con casos nuevos tuyos si cambias el tokenizador), `npm run medicion:bench` muestra ≥ 4× con filas iguales y, en el navegador y con los mismos archivos, las pantallas muestran los mismos números que la versión base.

### Paso 2 — Procesar una vez y publicar por vendedor (usa Blaze / Firebase)

Idea: que el trabajo pesado lo haga **un solo equipo cuando se publica**, y que cada teléfono baje solo lo suyo y ya procesado.

- Al pulsar "Publicar ventas" (administrador): leer los archivos (rápido, gracias al Paso 1), producir las filas ya normalizadas y guardarlas **comprimidas en piezas** por tipo de archivo y vendedor. Al final, publicar un documento de control con la versión: si el proceso se corta a la mitad, nadie ve piezas a medias.
- Cada equipo baja solo las piezas que le tocan (vendedor: las suyas; administrador y gerente: todas) y las descomprime en streaming.
- **La forma de `salesData` no cambia** (mismos campos y tipos), así que no se toca ninguna pantalla.
- Dónde guardar las piezas: (a) documentos de Firestore con campo `Bytes` en gzip (`CompressionStream`; ≤ ~900 KB por pieza; no añade servicios, pero cada colección nueva necesita su regla en la consola) — **recomendada para empezar**; (b) Cloud Storage (objetos grandes con CDN; requiere Blaze, otro SDK y configurar reglas y CORS). Comprobar `CompressionStream` en los iPhone reales (Safari ≥ 16.4).
- **No** guardar una fila por documento: ~540.000 documentos por descarga completa serían lentos y caros (guía B1).
- Pertenencia fila → vendedor: la regla actual (`buildVendorFilter`) tiene variantes (id con o sin ceros; nombre que empieza con `<id> ` o `<id>-`). Propuesta: repartir por `normalizeId(idVendedor)`, que el cliente baje un **superconjunto** (su pieza más la de "sin asignar") y **vuelva a aplicar `buildVendorFilter`** como hoy.
- Mantener el camino actual (GitHub) como respaldo mientras no existan las piezas.
- **Seguridad primero (guía A16 y B1.7):** las reglas actuales de Firebase no distinguen roles. Antes, o a la vez que esta migración, hay que decidir con el dueño la autenticación y las reglas de acceso a las ventas.
- Pruebas siempre en un proyecto de Firebase de pruebas, **nunca** en `appcomaca`.

### Paso 3 — Automatizar (opcional)

Una Cloud Function (2.ª generación, Node; requiere Blaze y Firebase CLI) que procese el archivo apenas se suba y escriba las piezas, de modo que nadie tenga que dejar su equipo procesando. Poner alertas de presupuesto en Google Cloud (avisan, **no** ponen tope al gasto). Costos y fases completas: guía B1.8 y B1.9.

## 5. Reglas del juego

1. **Mismas filas.** `paridad.js` es obligatorio. Una diferencia significa que el cambio no es válido, salvo decisión documentada y aprobada por el dueño.
2. **No tocar `main`.** `main` es lo que publica la app (GitHub Pages) y solo lo toca el dueño: compila y publica `PARA SUBIR/index.html`. Tú trabajas en ramas que salgan de `desarrollo` (por ejemplo `velocidad-ventas`) y entregas con un Pull Request hacia `desarrollo`; el dueño (con su asistente) revisa el diff antes de compilar. `desarrollo` nunca se fusiona en `main`.
3. **Nunca probar contra la base real.** `index.html` apunta al proyecto de Firebase `appcomaca` (producción). Mirar, medir y leer está bien; crear pedidos, pagos o usuarios, no. Pide al dueño un proyecto de pruebas o usa el emulador.
4. **Datos y claves:** nada real (ventas, clientes, cartera, contraseñas, claves) en el repositorio. `.gitignore` ya excluye `*.csv`, `*.xlsx` y `*.xls`; las pruebas usan datos sintéticos.
5. **Accesos:** a Firebase y a GitHub entras con tu propia cuenta, invitada por el dueño y con el rol mínimo. Nunca compartas ni pidas contraseñas.
6. **Coordinación:** el dueño también edita `index.html` (con Claude). Haz `git pull` antes de cada sesión y avisa qué zonas vas a tocar.
7. **iPhone:** la memoria de Safari es el límite histórico (el filtro por vendedor al vuelo y diferir el año anterior existen por eso). No cargues archivos completos en memoria.
8. **El dueño pidió no cambiar nada de lo que hoy funciona.** Si un cambio altera algo visible, consúltalo antes.

## 6. Cómo trabajar y probar

```bash
npm install                 # Babel 8 pide Node ^22.18 o >=24.11
npm run check               # revisa la sintaxis de index.html
npm run build               # compila a "PARA SUBIR/index.html"; con el código base debe dar el sha256 de arriba
npm run medicion:datos      # crea herramientas/medicion_ventas/ventas_sint.csv (datos inventados)
npm run medicion:bench      # tiempos: versión congelada vs. tu index.html, y comprueba que las filas sean iguales
npm run medicion:paridad    # ~63.000 casos (cabeceras, fechas, números, CSV con comillas, bloques de lectura…)
```

Detalles y límites de las herramientas: `herramientas/medicion_ventas/README.md`. Para entender el sistema: la guía técnica `COMACA360_Guia_Tecnica_y_Hoja_de_Ruta.pdf` (60 páginas), que **el dueño te entrega por privado** (no está en este repositorio público): A9 ventas, A15 rendimiento, A16 seguridad, B1 migración, B4 calendario y decisiones.

## 7. Cómo entregar

1. Trabaja siempre en una rama que salga de `desarrollo` (por ejemplo `velocidad-ventas`), nunca sobre `main` ni directamente sobre `desarrollo`:
   `git switch desarrollo && git pull && git switch -c velocidad-ventas`. Sube la rama y abre un Pull Request hacia `desarrollo`.
2. Incluye en la descripción: qué cambiaste, el resultado de `paridad` y `bench` (copia la salida), qué **no** probaste, y cualquier diferencia de comportamiento.
3. Para cambios que tocan Firebase (Paso 2 y 3): describe las reglas nuevas que hay que publicar, las colecciones, el costo estimado y cómo volver atrás.
4. El dueño revisa, compila y publica. Tú no publicas.

## 8. Preguntas abiertas (para el dueño)

1. Tamaño, número de filas y formato (csv/xlsx/json) de cada uno de los tres archivos, y las cabeceras reales (solo las cabeceras, sin datos).
2. Cómo y quién sube hoy los archivos a GitHub, y con qué frecuencia.
3. Cuántos equipos y usuarios simultáneos hay y qué teléfonos usan (iPhone/Android, versiones).
4. Región de Firestore y reglas de seguridad actuales (viven solo en la consola de Firebase; no están en el repositorio).
5. Presupuesto mensual y alertas de Blaze (guía B1.9).
6. Autenticación: ¿se acepta pasar a Firebase Auth real? (guía B1.7).

## 9. Notas

- La guía técnica dice que la carpeta de trabajo "no es un repositorio git y no existe package.json": era cierto al escribirla (16-nov-2026). Ahora ya lo tiene.
- `check-icons.js` y `test-page.js` son scripts viejos del dueño: necesitan paquetes (`lucide-react`, `express`, `puppeteer`) que no se usan ni están en `package.json`.
- Para validar los cambios anteriores se usó un simulador (la app real contra una base de Firebase simulada y archivos de ventas de prueba, con pruebas automáticas de pantallas y flujos). **No está en este repositorio**; si hace falta para el Paso 2, el dueño puede pedir que lo empaqueten.
