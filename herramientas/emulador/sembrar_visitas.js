#!/usr/bin/env node
'use strict';

const HOST_POR_DEFECTO = '127.0.0.1:8080';
const PROYECTO_POR_DEFECTO = 'demo-comaca-prueba';
const MAX_ESCRITURAS_POR_COMMIT = 400;
const TOTAL_CLIENTES_CARTERA = 1200;

const NOTAS_INVENTADAS = [
  'Nota inventada: cliente solicita seguimiento la proxima semana',
  'Nota inventada: local en inventario durante la visita',
  'Nota inventada: encargado ausente al momento de llegar',
  'Nota inventada: pendiente confirmacion de transferencia',
  'Nota inventada: se entrego lista de precios actualizada',
  'Nota inventada: cliente evalua pedido para fin de mes',
  'Nota inventada: se coordino proxima visita en horario matutino',
];

function mulberry32(semilla) {
  let a = semilla >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeId(id) {
  const str = String(id).replace(/[^0-9A-Za-z]/g, '');
  return str.replace(/^0+(?=[1-9A-Za-z])/g, '') || str;
}

function diaVenezuela(fecha) {
  const ms = (fecha instanceof Date ? fecha.getTime() : Date.parse(fecha)) - 4 * 3600 * 1000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sumarDiasIso(diaIso, deltaDias) {
  const [y, m, d] = diaIso.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d + deltaDias));
  const yy = fecha.getUTCFullYear();
  const mm = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function esDomingo(diaIso) {
  const [y, m, d] = diaIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}

function validarEntorno(host, proyecto) {
  const h = String(host || '').trim();
  const p = String(proyecto || '').trim();

  if (!h) {
    throw new Error('Host del emulador vacío. Debe ser 127.0.0.1, localhost o [::1].');
  }
  if (/[\s/@?#]/.test(h)) {
    throw new Error(`Host rechazado por seguridad ("${h}"): solo se permite 127.0.0.1, localhost o [::1] con puerto opcional.`);
  }

  let hostValido = false;
  if (h.startsWith('[')) {
    const m = /^\[::1\](?::(\d+))?$/.exec(h);
    if (m) {
      const puerto = m[1] ? Number(m[1]) : 8080;
      hostValido = puerto >= 1 && puerto <= 65535;
    }
  } else {
    const partes = h.split(':');
    if (partes.length === 1 || partes.length === 2) {
      const nombre = partes[0].toLowerCase();
      const puertoOk = partes.length === 1 || (/^\d+$/.test(partes[1]) && Number(partes[1]) >= 1 && Number(partes[1]) <= 65535);
      hostValido = (nombre === '127.0.0.1' || nombre === 'localhost') && puertoOk;
    }
  }

  if (!hostValido) {
    throw new Error(`Host rechazado por seguridad ("${h}"): esta herramienta solo puede conectarse al emulador local (127.0.0.1, localhost o [::1]).`);
  }

  if (!p.startsWith('demo-') || p.length <= 5 || /[\s/?#]/.test(p)) {
    throw new Error(`Proyecto rechazado por seguridad ("${p}"): el nombre del proyecto debe empezar por "demo-".`);
  }

  return { host: h, proyecto: p };
}

function construirVendedores() {
  const lista = [];
  for (let i = 1; i <= 38; i++) {
    const id = String(i).padStart(3, '0');
    lista.push({ id, nombre: `Vendedor Inventado ${id}` });
  }
  lista.push({ id: '052', nombre: 'Vendedor Test' });
  return lista;
}

function casaDeCliente(indiceCliente) {
  const rng = mulberry32((indiceCliente + 1) * 2654435761);
  const lat = Number((10.0 + rng() * 0.6).toFixed(6));
  const lng = Number((-71.5 + rng() * 0.6).toFixed(6));
  return { lat, lng };
}

function construirCartera(vendedoresTodos) {
  const vendIds = vendedoresTodos.map((v) => v.id);
  const clientes = [];
  const porVendedor = new Map();
  for (const id of vendIds) porVendedor.set(id, []);

  for (let i = 0; i < TOTAL_CLIENTES_CARTERA; i++) {
    const vendedorId = vendIds[i % 39];
    const cliente = {
      indice: i,
      idCliente: String(1000 + i).padStart(6, '0'),
      nombre: `CLIENTE INVENTADO ${i} C.A.`,
      ciudad: `CIUDAD ${i % 12}`,
      vendedorId,
      casa: casaDeCliente(i),
    };
    clientes.push(cliente);
    porVendedor.get(vendedorId).push(cliente);
  }

  return { clientes, porVendedor };
}

function desplazarCoordenadas(lat0, lng0, distanciaMetros, rumboRad) {
  const dLat = (distanciaMetros * Math.cos(rumboRad)) / 111320;
  const dLng = (distanciaMetros * Math.sin(rumboRad)) / (111320 * Math.cos((lat0 * Math.PI) / 180));
  return {
    lat: Number((lat0 + dLat).toFixed(6)),
    lng: Number((lng0 + dLng).toFixed(6)),
  };
}

function haversineMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (g) => (g * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function elegirResultadoManual(u) {
  if (u < 0.25) return 'vendio';
  if (u < 0.55) return 'no-compro';
  if (u < 0.75) return 'cerrado';
  if (u < 0.90) return 'cobro';
  return 'otro';
}

function cantidadVisitasDia(porDia, domingo, rng) {
  if (porDia <= 0) return 0;
  if (domingo) {
    const r = rng();
    if (r < 0.90) return 0;
    if (r < 0.98) return 1;
    return 2;
  }
  const delta = Math.floor(porDia * 0.4);
  const min = Math.max(0, porDia - delta);
  const max = porDia + delta;
  return min + Math.floor(rng() * (max - min + 1));
}

function generarDatos(opciones = {}) {
  const dias = opciones.dias ?? 60;
  const porDia = opciones.porDia ?? 12;
  const numVendedores = opciones.vendedores ?? 39;
  const semilla = opciones.semilla ?? 1;
  const fechaReferencia = opciones.fechaReferencia ? new Date(opciones.fechaReferencia) : new Date();

  const rng = mulberry32(semilla);
  const todosVendedores = construirVendedores();
  const vendedoresActivos = todosVendedores.slice(0, numVendedores);
  const { porVendedor } = construirCartera(todosVendedores);

  const diaFin = diaVenezuela(fechaReferencia);
  const diaInicio = sumarDiasIso(diaFin, -(dias - 1));

  const listaDias = [];
  for (let d = 0; d < dias; d++) {
    listaDias.push(sumarDiasIso(diaInicio, d));
  }

  const visitas = [];
  const primeraManualValidaPorCliente = new Map();
  const contadorNuevoPorVendedor = new Map();

  for (const diaIso of listaDias) {
    const domingo = esDomingo(diaIso);
    const [y, m, d] = diaIso.split('-').map(Number);
    const baseInicioDiaUtcMs = Date.UTC(y, m - 1, d, 11, 30, 0); // 07:30 VE = 11:30 UTC
    const diaCompacto = diaIso.replace(/-/g, '');

    for (const vendedor of vendedoresActivos) {
      const cartera = porVendedor.get(vendedor.id) || [];
      const nVisitas = cantidadVisitasDia(porDia, domingo, rng);
      if (nVisitas === 0) continue;

      const offsets = [];
      for (let i = 0; i < nVisitas; i++) {
        offsets.push(Math.floor(rng() * 36001)); // 07:30 a 17:30 VE (600 min = 36000 s)
      }
      offsets.sort((a, b) => a - b);

      for (let idx = 0; idx < nVisitas; idx++) {
        const docId = `sem-${vendedor.id}-${diaCompacto}-${String(idx + 1).padStart(3, '0')}`;
        const fechaMs = baseInicioDiaUtcMs + offsets[idx] * 1000;
        const fechaIso = new Date(fechaMs).toISOString();
        const enviadaEn = new Date(fechaMs + Math.floor(rng() * 91) * 1000);

        const esPedido = rng() < 0.30;
        const origen = esPedido ? 'pedido' : 'manual';
        const resultado = esPedido ? 'vendio' : elegirResultadoManual(rng());
        const pedidoId = esPedido ? `sem-ped-${docId}` : null;

        const esClienteNuevo = rng() < 0.05;
        let clienteId;
        let clienteNombre;
        let ciudad;
        let casa = null;

        if (esClienteNuevo) {
          const k = (contadorNuevoPorVendedor.get(vendedor.id) || 0) + 1;
          contadorNuevoPorVendedor.set(vendedor.id, k);
          clienteId = `N-${vendedor.id}-negocio-nuevo-${k}`;
          clienteNombre = `NEGOCIO NUEVO INVENTADO ${k}`;
          ciudad = '';
        } else {
          const cli = cartera[Math.floor(rng() * cartera.length)];
          clienteId = cli.idCliente;
          clienteNombre = cli.nombre;
          ciudad = cli.ciudad;
          casa = cli.casa;
        }

        const nota = rng() < 0.15 ? NOTAS_INVENTADAS[Math.floor(rng() * NOTAS_INVENTADAS.length)] : '';

        const sinGps = rng() < 0.03;
        let ubicacion = null;
        let esLejana = false;

        if (!sinGps) {
          const bajaPrecision = rng() < 0.05;
          const precision = bajaPrecision
            ? 101 + Math.floor(rng() * 50) // 101..150
            : 5 + Math.floor(rng() * 56); // 5..60

          if (esClienteNuevo) {
            ubicacion = {
              lat: Number((10.0 + rng() * 0.6).toFixed(6)),
              lng: Number((-71.5 + rng() * 0.6).toFixed(6)),
              precision,
            };
          } else {
            const yaTieneRef = primeraManualValidaPorCliente.has(clienteId);
            const seraPrimeraRef = origen === 'manual' && precision <= 100 && !yaTieneRef;

            if (origen === 'manual' && !seraPrimeraRef && rng() < 0.055) {
              esLejana = true;
              const dist = 205 + rng() * 690; // 205..895 m -> garantizado 200..900 m tras redondeo
              const rumbo = rng() * Math.PI * 2;
              const coords = desplazarCoordenadas(casa.lat, casa.lng, dist, rumbo);
              ubicacion = { lat: coords.lat, lng: coords.lng, precision };
            } else {
              const dist = rng() * 29.5; // 0..29.5 m -> garantizado <= 30 m tras redondeo
              const rumbo = rng() * Math.PI * 2;
              const coords = desplazarCoordenadas(casa.lat, casa.lng, dist, rumbo);
              ubicacion = { lat: coords.lat, lng: coords.lng, precision };
            }
          }
        }

        const doc = {
          vendedorId: vendedor.id,
          vendedorNombre: vendedor.nombre,
          clienteId,
          clienteNombre,
          ciudad,
          clienteNuevo: esClienteNuevo,
          fecha: fechaIso,
          dia: diaVenezuela(fechaIso),
          resultado,
          nota,
          ubicacion,
          origen,
          pedidoId,
          enviadaEn,
          sembrado: true,
        };

        if (esLejana && rng() < 0.20) {
          const fechaRev = new Date(fechaMs + (3600 + Math.floor(rng() * 72000)) * 1000).toISOString();
          doc.revision = {
            estado: 'validada',
            por: 'admin1',
            fecha: fechaRev,
          };
        }

        const registro = { id: docId, data: doc, _meta: { esLejana, casa } };
        visitas.push(registro);

        if (!esClienteNuevo && origen === 'manual' && ubicacion !== null && ubicacion.precision <= 100) {
          if (!primeraManualValidaPorCliente.has(clienteId)) {
            primeraManualValidaPorCliente.set(clienteId, registro);
          }
        }
      }
    }
  }

  const clientesUbicacion = [];
  const clientesOrdenados = Array.from(primeraManualValidaPorCliente.keys()).sort();
  for (const clienteId of clientesOrdenados) {
    if (rng() < 0.70) {
      const primera = primeraManualValidaPorCliente.get(clienteId);
      const d = primera.data;
      clientesUbicacion.push({
        id: normalizeId(clienteId),
        data: {
          clienteId: d.clienteId,
          clienteNombre: d.clienteNombre,
          lat: d.ubicacion.lat,
          lng: d.ubicacion.lng,
          precision: d.ubicacion.precision,
          visitaId: primera.id,
          fuente: 'primera-visita',
          fecha: d.fecha,
          fijadaPor: d.vendedorId,
          sembrado: true,
        },
      });
    }
  }

  const resumen = calcularResumen(visitas, clientesUbicacion, diaInicio, diaFin);
  return { visitas, clientesUbicacion, resumen, diaInicio, diaFin };
}

function calcularResumen(visitas, clientesUbicacion, diaInicio, diaFin) {
  const porResultado = { vendio: 0, 'no-compro': 0, cerrado: 0, cobro: 0, otro: 0 };
  let conPedido = 0;
  let sinGps = 0;
  let clientesNuevos = 0;
  let lejanas = 0;
  let lejanasValidadas = 0;

  for (const v of visitas) {
    const d = v.data;
    porResultado[d.resultado] = (porResultado[d.resultado] || 0) + 1;
    if (d.origen === 'pedido') conPedido++;
    if (d.ubicacion === null) sinGps++;
    if (d.clienteNuevo) clientesNuevos++;
    if (v._meta && v._meta.esLejana) {
      lejanas++;
      if (d.revision && d.revision.estado === 'validada') lejanasValidadas++;
    }
  }

  return {
    diaInicio,
    diaFin,
    totalVisitas: visitas.length,
    porResultado,
    conPedido,
    sinGps,
    clientesNuevos,
    lejanas,
    lejanasValidadas,
    ubicacionesCliente: clientesUbicacion.length,
  };
}

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    return { mapValue: { fields: toFirestoreFields(val) } };
  }
  throw new Error(`Tipo de valor no soportado para Firestore: ${typeof val}`);
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return fields;
}

function parsearArgumentos(argv) {
  const opciones = {
    dias: 60,
    porDia: 12,
    vendedores: 39,
    semilla: 1,
    limpiar: false,
    ayuda: false,
  };

  for (const arg of argv) {
    if (arg === '--ayuda' || arg === '--help' || arg === '-h') {
      opciones.ayuda = true;
    } else if (arg === '--limpiar') {
      opciones.limpiar = true;
    } else if (arg.startsWith('--dias=')) {
      const n = Number(arg.slice('--dias='.length));
      if (!Number.isInteger(n) || n < 1 || n > 120) {
        throw new Error(`Valor inválido para --dias: "${arg}". Debe ser un entero entre 1 y 120.`);
      }
      opciones.dias = n;
    } else if (arg.startsWith('--por-dia=')) {
      const n = Number(arg.slice('--por-dia='.length));
      if (!Number.isInteger(n) || n < 0 || n > 200) {
        throw new Error(`Valor inválido para --por-dia: "${arg}". Debe ser un entero entre 0 y 200.`);
      }
      opciones.porDia = n;
    } else if (arg.startsWith('--vendedores=')) {
      const n = Number(arg.slice('--vendedores='.length));
      if (!Number.isInteger(n) || n < 1 || n > 39) {
        throw new Error(`Valor inválido para --vendedores: "${arg}". Debe ser un entero entre 1 y 39.`);
      }
      opciones.vendedores = n;
    } else if (arg.startsWith('--semilla=')) {
      const n = Number(arg.slice('--semilla='.length));
      if (!Number.isInteger(n)) {
        throw new Error(`Valor inválido para --semilla: "${arg}". Debe ser un número entero.`);
      }
      opciones.semilla = n;
    } else {
      throw new Error(`Opción desconocida: "${arg}". Usa --ayuda para ver las opciones válidas.`);
    }
  }

  return opciones;
}

function textoAyuda() {
  return [
    'Uso: node herramientas/emulador/sembrar_visitas.js [opciones]',
    '',
    'Siembra visitas inventadas y ubicaciones de clientes en el emulador local de Firestore.',
    '',
    'Opciones:',
    '  --dias=60          Días a generar hacia atrás incluyendo hoy (1 a 120; defecto: 60)',
    '  --por-dia=12       Promedio de visitas por vendedor en día laborable (defecto: 12)',
    '  --vendedores=39    Cantidad de vendedores de la lista (1 a 39; defecto: 39)',
    '  --semilla=1        Semilla entera para generación determinista (defecto: 1)',
    '  --limpiar          Borra SOLO documentos con id "sem-" o sembrado=true y sale',
    '  --ayuda            Muestra esta ayuda y sale',
    '',
    'Variables de entorno:',
    `  FIRESTORE_EMULATOR_HOST   Host del emulador local (defecto: ${HOST_POR_DEFECTO})`,
    `  PROYECTO                  Proyecto demo-* (defecto: ${PROYECTO_POR_DEFECTO})`,
  ].join('\n');
}

async function fetchEmulador(url, init, host) {
  try {
    const res = await globalThis.fetch(url, init);
    if (!res.ok) {
      const texto = await res.text().catch(() => '');
      throw new Error(`Error HTTP ${res.status} del emulador en ${url}: ${texto.slice(0, 300)}`);
    }
    return res.json();
  } catch (err) {
    if (err && err.message && err.message.startsWith('Error HTTP ')) {
      throw err;
    }
    const e = new Error(`No se pudo conectar con el emulador. ¿Está encendido el emulador en ${host}?`);
    e.cause = err;
    throw e;
  }
}

async function ejecutarCommits(base, writes, host) {
  const commitUrl = `${base.replace('/documents', '')}/documents:commit`;
  for (let i = 0; i < writes.length; i += MAX_ESCRITURAS_POR_COMMIT) {
    const lote = writes.slice(i, i + MAX_ESCRITURAS_POR_COMMIT);
    await fetchEmulador(
      commitUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({ writes: lote }),
      },
      host
    );
  }
}

async function listarDocumentos(base, coleccion, host) {
  const docs = [];
  let pageToken = null;
  do {
    const qs = pageToken
      ? `?pageSize=300&pageToken=${encodeURIComponent(pageToken)}`
      : '?pageSize=300';
    const data = await fetchEmulador(
      `${base}/${coleccion}${qs}`,
      {
        method: 'GET',
        headers: { Authorization: 'Bearer owner' },
      },
      host
    );
    if (Array.isArray(data.documents)) {
      docs.push(...data.documents);
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return docs;
}

function esDocumentoSembrado(doc) {
  const nombre = String(doc.name || '');
  const id = nombre.slice(nombre.lastIndexOf('/') + 1);
  if (id.startsWith('sem-')) return true;
  if (doc.fields && doc.fields.sembrado && doc.fields.sembrado.booleanValue === true) return true;
  return false;
}

async function limpiarColecciones(host, proyecto) {
  const { host: h, proyecto: p } = validarEntorno(host, proyecto);
  const base = `http://${h}/v1/projects/${p}/databases/(default)/documents`;
  const borrados = { visitas: 0, clientesUbicacion: 0 };

  for (const col of ['visitas', 'clientesUbicacion']) {
    const docs = await listarDocumentos(base, col, h);
    const aBorrar = docs.filter(esDocumentoSembrado);
    if (aBorrar.length > 0) {
      const writes = aBorrar.map((d) => ({ delete: d.name }));
      await ejecutarCommits(base, writes, h);
    }
    borrados[col] = aBorrar.length;
  }

  return borrados;
}

async function consultarUltimos7Dias(base, diaDesde, host) {
  const url = `${base}:runQuery`;
  const respuesta = await fetchEmulador(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'visitas' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'dia' },
              op: 'GREATER_THAN_OR_EQUAL',
              value: { stringValue: diaDesde },
            },
          },
        },
      }),
    },
    host
  );
  if (!Array.isArray(respuesta)) return 0;
  return respuesta.filter((item) => item && item.document).length;
}

async function sembrarEnEmulador(host, proyecto, opciones) {
  const { host: h, proyecto: p } = validarEntorno(host, proyecto);
  const base = `http://${h}/v1/projects/${p}/databases/(default)/documents`;

  const generado = generarDatos(opciones);
  const writes = [];

  for (const v of generado.visitas) {
    writes.push({
      update: {
        name: `projects/${p}/databases/(default)/documents/visitas/${v.id}`,
        fields: toFirestoreFields(v.data),
      },
    });
  }

  for (const u of generado.clientesUbicacion) {
    writes.push({
      update: {
        name: `projects/${p}/databases/(default)/documents/clientesUbicacion/${u.id}`,
        fields: toFirestoreFields(u.data),
      },
    });
  }

  await ejecutarCommits(base, writes, h);

  const diaHace7 = sumarDiasIso(generado.diaFin, -6);
  const visitasUltimos7Dias = await consultarUltimos7Dias(base, diaHace7, h);

  return {
    ...generado,
    diaHace7,
    visitasUltimos7Dias,
  };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const inicioMs = Date.now();
  let opciones;
  try {
    opciones = parsearArgumentos(argv);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (opciones.ayuda) {
    console.log(textoAyuda());
    return;
  }

  const host = env.FIRESTORE_EMULATOR_HOST || HOST_POR_DEFECTO;
  const proyecto = env.PROYECTO || PROYECTO_POR_DEFECTO;

  try {
    validarEntorno(host, proyecto);
  } catch (err) {
    console.error(`SEGURIDAD: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    if (opciones.limpiar) {
      const borrados = await limpiarColecciones(host, proyecto);
      const ms = Date.now() - inicioMs;
      console.log(`Limpieza completada en ${host} (proyecto: ${proyecto})`);
      console.log(`  visitas borradas:           ${borrados.visitas}`);
      console.log(`  clientesUbicacion borradas: ${borrados.clientesUbicacion}`);
      console.log(`  Tiempo total:               ${(ms / 1000).toFixed(2)} s`);
      return;
    }

    const res = await sembrarEnEmulador(host, proyecto, opciones);
    const r = res.resumen;
    const ms = Date.now() - inicioMs;

    console.log(`Siembra completada en ${host} (proyecto: ${proyecto}, semilla: ${opciones.semilla})`);
    console.log(`  Rango de días (VE):         ${r.diaInicio} a ${r.diaFin} (${opciones.dias} días)`);
    console.log(`  Total visitas sembradas:    ${r.totalVisitas}`);
    console.log('  Por resultado:');
    console.log(`    vendio:                   ${r.porResultado.vendio}`);
    console.log(`    no-compro:                ${r.porResultado['no-compro']}`);
    console.log(`    cerrado:                  ${r.porResultado.cerrado}`);
    console.log(`    cobro:                    ${r.porResultado.cobro}`);
    console.log(`    otro:                     ${r.porResultado.otro}`);
    console.log(`  Con pedido:                 ${r.conPedido}`);
    console.log(`  Sin GPS:                    ${r.sinGps}`);
    console.log(`  Clientes nuevos:            ${r.clientesNuevos}`);
    console.log(`  Lejanas (200-900 m):        ${r.lejanas} (validadas: ${r.lejanasValidadas})`);
    console.log(`  Ubicaciones de cliente:     ${r.ubicacionesCliente}`);
    console.log(`  Autocomprobación runQuery (dia >= ${res.diaHace7}): ${res.visitasUltimos7Dias} visitas`);
    console.log(`  Tiempo total:               ${(ms / 1000).toFixed(2)} s`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  HOST_POR_DEFECTO,
  PROYECTO_POR_DEFECTO,
  MAX_ESCRITURAS_POR_COMMIT,
  TOTAL_CLIENTES_CARTERA,
  mulberry32,
  normalizeId,
  diaVenezuela,
  sumarDiasIso,
  esDomingo,
  validarEntorno,
  construirVendedores,
  casaDeCliente,
  construirCartera,
  desplazarCoordenadas,
  haversineMetros,
  generarDatos,
  calcularResumen,
  toFirestoreValue,
  toFirestoreFields,
  parsearArgumentos,
  esDocumentoSembrado,
  sembrarEnEmulador,
  limpiarColecciones,
  main,
};
