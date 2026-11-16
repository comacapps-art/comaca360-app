# COMACA 360: código fuente (rama `desarrollo`)

Aplicación de ventas, pedidos y cobranza de COMACA: un solo `index.html` con React, Firebase y Tailwind por CDN.

Esta rama (`desarrollo`) contiene el **código fuente completo** para trabajar en equipo. La app que usa la gente se publica desde la rama **`main`** (GitHub Pages: `index.html` ya compilado y la carpeta `assets/`), y **`desarrollo` nunca se fusiona en `main`**: las dos ramas tienen historiales distintos a propósito.

**Versión base:** 12-nov-2026 (`index.html` sha256 `66c976543d4ee9e6…a0112`).

## Empieza aquí

👉 **[`docs/TAREA_VELOCIDAD_VENTAS.md`](docs/TAREA_VELOCIDAD_VENTAS.md)**: la tarea actual (que la carga de ventas sea rápida), con el diagnóstico medido, el plan en 3 pasos y las reglas.

## Qué hay

| Ruta | Qué es |
|---|---|
| `index.html` | **El código fuente** (~14.000 líneas). El JSX se compila en el navegador con Babel. Es el que se edita. |
| `build.js` | Compila `index.html` → `PARA SUBIR/index.html` (JSX ya compilado, sin Babel en el navegador; necesario para que arranque bien en iPhone). |
| `PARA SUBIR/index.html` | Lo que se publica en `main`. **Lo publica el dueño.** Aquí está como referencia: con el código base, `npm run build` debe reproducirlo byte a byte. |
| `check-syntax.js` | Revisa la sintaxis del JSX. |
| `check-icons.js`, `test-page.js` | Scripts viejos del dueño; necesitan paquetes (`lucide-react`, `express`, `puppeteer`) que no están en `package.json`. |
| `GUIA/` | Manuales de usuario (administrador, vendedor y ajustes), en PDF y HTML. |
| *(guía técnica)* | La guía técnica de 60 páginas (cómo funciona todo y el plan de migración a Firebase) **no está en este repositorio** porque es público: el dueño te la entrega por privado. Las referencias "A9", "B1"… de los documentos son a esa guía. |
| `docs/` | Documentos de trabajo (la tarea actual). |
| `herramientas/medicion_ventas/` | Medición de la lectura de ventas y prueba de paridad. |

## Requisitos y comandos

Node `^22.18.0` o `>=24.11.0` (lo pide Babel 8) y `npm install`.

```bash
npm run check           # sintaxis
npm run build           # compila a "PARA SUBIR/index.html"
npm run medicion:datos  # crea datos de venta sintéticos
npm run medicion:bench  # tiempos y comparación de filas
npm run medicion:paridad
```

## Reglas (resumen; las completas están en `docs/TAREA_VELOCIDAD_VENTAS.md`)

- **`main` solo lo toca el dueño.** Trabaja en ramas que salgan de `desarrollo` y entrega con un Pull Request hacia `desarrollo`. `git pull` antes de cada sesión: el dueño también edita `index.html`.
- Nunca pruebes contra la base de Firebase real (`appcomaca`).
- Nada de datos reales ni claves en este repositorio.
- Una sola diferencia en `npm run medicion:paridad` invalida un cambio en la lectura de ventas.
