# Sembrador de visitas para el emulador local

Herramienta en Node 24 sin dependencias que puebla el emulador local de Firestore con visitas inventadas (`visitas`) y ubicaciones de referencia de clientes (`clientesUbicacion`) para probar la sección de monitoreo de visitas de COMACA 360 (filtros por día y período, tabla por vendedor, mapa y alertas de distancia).

## Uso

Sembrar 60 días (incluyendo hoy) con los valores por defecto (`127.0.0.1:8080`, proyecto `demo-comaca-prueba`):

```bash
node herramientas/emulador/sembrar_visitas.js --dias=60
```

Opciones disponibles:

- `--dias=60`: días hacia atrás incluyendo hoy (1 a 120; defecto `60`).
- `--por-dia=12`: promedio de visitas por vendedor en día laborable; los domingos casi no genera (defecto `12`).
- `--vendedores=39`: cantidad de vendedores de la lista (`001` a `038` más `052`, defecto `39`).
- `--semilla=1`: semilla entera determinista (defecto `1`). Con la misma semilla y opciones genera exactamente los mismos documentos e IDs (idempotente).
- `--limpiar`: borra únicamente los documentos sembrados por esta herramienta y sale.
- `--ayuda`: muestra la ayuda.

Variables de entorno opcionales:

- `FIRESTORE_EMULATOR_HOST` (defecto `127.0.0.1:8080`)
- `PROYECTO` (defecto `demo-comaca-prueba`)

## Limpieza

```bash
node herramientas/emulador/sembrar_visitas.js --limpiar
```

Lista únicamente las colecciones `visitas` y `clientesUbicacion` y elimina solo documentos cuyo ID empiece por `sem-` o tengan `sembrado == true`. No toca otras colecciones ni documentos ajenos.

## Pruebas sin red

```bash
node herramientas/emulador/prueba_sembrar.js
```

## Garantías de seguridad

- **Solo emulador local**: rechaza cualquier host que no sea `127.0.0.1`, `localhost` o `[::1]` antes de hacer ninguna petición HTTP y sale con código `1`.
- **Solo proyectos `demo-*`**: rechaza cualquier proyecto que no empiece por `demo-` antes de hacer ninguna petición HTTP y sale con código `1`.
- **Sin datos reales**: todos los nombres, clientes, ciudades y notas son inventados (`Vendedor Inventado NNN`, `Vendedor Test`, `CLIENTE INVENTADO N C.A.`, `NEGOCIO NUEVO INVENTADO N`).
- **Sin dependencias externas**: usa únicamente `fetch` nativo de Node 24 contra la API REST del emulador.
