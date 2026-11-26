#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  normalizeId,
  diaVenezuela,
  validarEntorno,
  haversineMetros,
  generarDatos,
  toFirestoreFields,
  esDocumentoSembrado,
  sembrarEnEmulador,
  limpiarColecciones,
  main,
} = require('./sembrar_visitas.js');

const pruebas = [];
function prueba(nombre, fn) {
  pruebas.push({ nombre, fn });
}

prueba('seguridad: rechaza host remoto y proyecto sin prefijo demo- sin llamar a fetch', async () => {
  const fetchOriginal = globalThis.fetch;
  let llamadasFetch = 0;
  globalThis.fetch = async () => {
    llamadasFetch++;
    throw new Error('NO se debía llamar a fetch');
  };

  try {
    // Hosts remotos o maliciosos rechazados
    const hostsInvalidos = [
      'firestore.googleapis.com:443',
      '192.168.1.10:8080',
      '10.0.0.1:8080',
      'localhost.atacante.com:8080',
      '127.0.0.1@atacante.com:8080',
      'http://127.0.0.1:8080',
      '',
    ];
    for (const host of hostsInvalidos) {
      assert.throws(() => validarEntorno(host, 'demo-comaca-prueba'), /Host/);
      await assert.rejects(() => sembrarEnEmulador(host, 'demo-comaca-prueba', { dias: 1 }), /Host/);
      await assert.rejects(() => limpiarColecciones(host, 'demo-comaca-prueba'), /Host/);
    }

    // Proyectos sin prefijo demo- rechazados
    const proyectosInvalidos = [
      'comaca-produccion',
      'prod-comaca-360',
      'demo',
      'demo-',
      'mi-demo-prueba',
      '',
    ];
    for (const proyecto of proyectosInvalidos) {
      assert.throws(() => validarEntorno('127.0.0.1:8080', proyecto), /Proyecto/);
      await assert.rejects(() => sembrarEnEmulador('127.0.0.1:8080', proyecto, { dias: 1 }), /Proyecto/);
      await assert.rejects(() => limpiarColecciones('127.0.0.1:8080', proyecto), /Proyecto/);
    }

    // También vía main() (debe marcar exitCode = 1 y no tocar fetch)
    const stderrOriginal = console.error;
    const mensajes = [];
    console.error = (...args) => mensajes.push(args.join(' '));
    const exitCodePrevio = process.exitCode;
    try {
      process.exitCode = 0;
      await main([], { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443', PROYECTO: 'demo-comaca-prueba' });
      assert.equal(process.exitCode, 1);

      process.exitCode = 0;
      await main([], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', PROYECTO: 'comaca-real' });
      assert.equal(process.exitCode, 1);
    } finally {
      console.error = stderrOriginal;
      process.exitCode = exitCodePrevio;
    }

    assert.equal(llamadasFetch, 0, 'fetch no debió haberse invocado nunca');

    // Hosts locales válidos + proyecto demo-* aceptados
    assert.deepEqual(validarEntorno('127.0.0.1:8080', 'demo-comaca-prueba'), {
      host: '127.0.0.1:8080',
      proyecto: 'demo-comaca-prueba',
    });
    assert.deepEqual(validarEntorno('localhost:8080', 'demo-test'), {
      host: 'localhost:8080',
      proyecto: 'demo-test',
    });
    assert.deepEqual(validarEntorno('[::1]:8080', 'demo-test'), {
      host: '[::1]:8080',
      proyecto: 'demo-test',
    });
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

prueba('diaVenezuela convierte UTC a fecha local de Venezuela (UTC-4)', () => {
  assert.equal(diaVenezuela('2026-11-26T03:30:00Z'), '2026-11-25');
  assert.equal(diaVenezuela('2026-11-26T03:30Z'), '2026-11-25');
  assert.equal(diaVenezuela('2026-11-26T05:00:00Z'), '2026-11-26');
  assert.equal(diaVenezuela('2026-11-26T05:00Z'), '2026-11-26');
  assert.equal(diaVenezuela('2026-01-01T03:59:59Z'), '2025-12-31');
  assert.equal(diaVenezuela('2026-01-01T04:00:00Z'), '2026-01-01');
});

prueba('normalizeId quita símbolos y ceros a la izquierda preservando todo-ceros', () => {
  assert.equal(normalizeId('001234'), '1234');
  assert.equal(normalizeId('000000'), '000000');
  assert.equal(normalizeId('0'), '0');
  assert.equal(normalizeId('00-12.34/A'), '1234A');
  assert.equal(normalizeId('000A1'), 'A1');
  assert.equal(normalizeId('001000'), '1000');
});

prueba('determinismo: misma semilla produce salida idéntica y otra semilla distinta', () => {
  const ref = '2026-11-26T15:00:00Z';
  const a = generarDatos({ dias: 5, porDia: 10, vendedores: 10, semilla: 42, fechaReferencia: ref });
  const b = generarDatos({ dias: 5, porDia: 10, vendedores: 10, semilla: 42, fechaReferencia: ref });
  const c = generarDatos({ dias: 5, porDia: 10, vendedores: 10, semilla: 43, fechaReferencia: ref });

  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a.visitas, c.visitas);
});

prueba('porcentajes aproximados (±3 puntos sobre ~5 000 visitas) y horarios ordenados', () => {
  // 13 días con 39 vendedores y promedio 12/día -> ~11 días laborables * 39 * 12 ≈ 5 150 visitas
  const gen = generarDatos({
    dias: 13,
    porDia: 12,
    vendedores: 39,
    semilla: 1,
    fechaReferencia: '2026-11-26T15:00:00Z',
  });
  const total = gen.visitas.length;
  assert.ok(total >= 4500 && total <= 6000, `Esperaba ~5000 visitas, salieron ${total}`);

  let pedidos = 0;
  let manuales = 0;
  const resManual = { vendio: 0, 'no-compro': 0, cerrado: 0, cobro: 0, otro: 0 };
  let conNota = 0;
  let sinGps = 0;
  let conGps = 0;
  let bajaPrecision = 0;
  let clientesNuevos = 0;
  let lejanas = 0;

  const ultimaHoraPorVendedorDia = new Map();

  for (const v of gen.visitas) {
    const d = v.data;

    // Verificar orden creciente por vendedor y día + horario 7:30..17:30 VE (11:30..21:30 UTC)
    const clave = `${d.vendedorId}|${d.dia}`;
    const ts = Date.parse(d.fecha);
    const prev = ultimaHoraPorVendedorDia.get(clave);
    if (prev !== undefined) {
      assert.ok(ts >= prev, `Horas fuera de orden en ${clave}`);
    }
    ultimaHoraPorVendedorDia.set(clave, ts);

    const [y, m, day] = d.dia.split('-').map(Number);
    const minTs = Date.UTC(y, m - 1, day, 11, 30, 0);
    const maxTs = Date.UTC(y, m - 1, day, 21, 30, 0);
    assert.ok(ts >= minTs && ts <= maxTs, `Hora fuera de 7:30-17:30 VE: ${d.fecha}`);

    // enviadaEn entre 0 y 90 s después de fecha
    assert.ok(d.enviadaEn instanceof Date);
    const deltaEnv = d.enviadaEn.getTime() - ts;
    assert.ok(deltaEnv >= 0 && deltaEnv <= 90000, `enviadaEn fuera de rango: ${deltaEnv} ms`);

    if (d.origen === 'pedido') {
      pedidos++;
      assert.equal(d.resultado, 'vendio');
      assert.equal(d.pedidoId, `sem-ped-${v.id}`);
    } else {
      manuales++;
      assert.equal(d.pedidoId, null);
      resManual[d.resultado]++;
    }

    if (d.nota !== '') conNota++;
    if (d.ubicacion === null) {
      sinGps++;
    } else {
      conGps++;
      if (d.ubicacion.precision > 100) {
        assert.ok(d.ubicacion.precision >= 101 && d.ubicacion.precision <= 150);
        bajaPrecision++;
      } else {
        assert.ok(d.ubicacion.precision >= 5 && d.ubicacion.precision <= 60);
      }
    }

    if (d.clienteNuevo) {
      clientesNuevos++;
      assert.equal(d.ciudad, '');
    }
    if (v._meta.esLejana) lejanas++;
  }

  const cercaDe = (actual, esperado, tol, etiqueta) => {
    const pct = actual * 100;
    assert.ok(
      Math.abs(pct - esperado) <= tol,
      `${etiqueta}: ${pct.toFixed(2)}% fuera de ${esperado}% ± ${tol}%`
    );
  };

  cercaDe(pedidos / total, 30, 3, 'origen=pedido');
  cercaDe(resManual.vendio / manuales, 25, 3, 'manual vendio');
  cercaDe(resManual['no-compro'] / manuales, 30, 3, 'manual no-compro');
  cercaDe(resManual.cerrado / manuales, 20, 3, 'manual cerrado');
  cercaDe(resManual.cobro / manuales, 15, 3, 'manual cobro');
  cercaDe(resManual.otro / manuales, 10, 3, 'manual otro');
  cercaDe(conNota / total, 15, 3, 'con nota');
  cercaDe(sinGps / total, 3, 3, 'sin GPS');
  cercaDe(clientesNuevos / total, 5, 3, 'clientes nuevos');
  cercaDe(bajaPrecision / conGps, 5, 3, 'baja precisión (101-150 m)');
  cercaDe(lejanas / manuales, 5, 3, 'lejanas sobre manuales');

  // Comprobar % de validadas sobre una muestra más grande (60 días) para que ~20% sea estable
  const gen60 = generarDatos({
    dias: 60,
    porDia: 12,
    vendedores: 39,
    semilla: 1,
    fechaReferencia: '2026-11-26T15:00:00Z',
  });
  cercaDe(
    gen60.resumen.lejanasValidadas / gen60.resumen.lejanas,
    20,
    3,
    'validadas sobre lejanas (60 días)'
  );
});

prueba('distancias con haversine: lejanas entre 200 y 900 m, normales <= 30 m', () => {
  const gen = generarDatos({
    dias: 15,
    porDia: 12,
    vendedores: 20,
    semilla: 7,
    fechaReferencia: '2026-11-26T15:00:00Z',
  });

  let revisadasLejanas = 0;
  let revisadasNormales = 0;

  for (const v of gen.visitas) {
    const d = v.data;
    if (d.clienteNuevo || d.ubicacion === null) continue;
    const casa = v._meta.casa;
    assert.ok(casa.lat >= 10.0 && casa.lat <= 10.6, `casa.lat fuera de rango: ${casa.lat}`);
    assert.ok(casa.lng >= -71.5 && casa.lng <= -70.9, `casa.lng fuera de rango: ${casa.lng}`);

    const dist = haversineMetros(casa.lat, casa.lng, d.ubicacion.lat, d.ubicacion.lng);
    if (v._meta.esLejana) {
      revisadasLejanas++;
      assert.ok(dist >= 200 && dist <= 900, `Visita lejana a ${dist.toFixed(2)} m (esperado 200-900 m)`);
    } else {
      revisadasNormales++;
      assert.ok(dist <= 30, `Visita normal a ${dist.toFixed(2)} m (esperado <= 30 m)`);
    }
  }

  assert.ok(revisadasLejanas > 50, `Muy pocas lejanas revisadas: ${revisadasLejanas}`);
  assert.ok(revisadasNormales > 1000, `Muy pocas normales revisadas: ${revisadasNormales}`);
});

prueba('clientesUbicacion usa la primera visita manual con GPS y precisión <= 100 m', () => {
  const gen = generarDatos({
    dias: 20,
    porDia: 12,
    vendedores: 39,
    semilla: 9,
    fechaReferencia: '2026-11-26T15:00:00Z',
  });

  // Calcular independientemente la primera visita manual con GPS y precisión <= 100 m por cliente
  const esperadaPorCliente = new Map();
  const visitasOrdenadas = [...gen.visitas].sort((a, b) => a.data.fecha.localeCompare(b.data.fecha));
  for (const v of visitasOrdenadas) {
    const d = v.data;
    if (d.clienteNuevo) continue;
    if (d.origen !== 'manual') continue;
    if (!d.ubicacion || d.ubicacion.precision > 100) continue;
    if (!esperadaPorCliente.has(d.clienteId)) {
      esperadaPorCliente.set(d.clienteId, v);
    }
  }

  assert.ok(gen.clientesUbicacion.length > 0, 'Debe generar documentos en clientesUbicacion');
  const ratio = (gen.clientesUbicacion.length / esperadaPorCliente.size) * 100;
  assert.ok(Math.abs(ratio - 70) <= 5, `Cobertura clientesUbicacion ${ratio.toFixed(2)}% fuera de 70% ± 5%`);

  for (const doc of gen.clientesUbicacion) {
    const u = doc.data;
    assert.equal(doc.id, normalizeId(u.clienteId));
    assert.equal(u.fuente, 'primera-visita');
    assert.equal(u.sembrado, true);
    assert.ok(u.precision <= 100);

    const esp = esperadaPorCliente.get(u.clienteId);
    assert.ok(esp, `Cliente ${u.clienteId} no tenía visita manual elegible`);
    assert.equal(u.visitaId, esp.id);
    assert.equal(u.lat, esp.data.ubicacion.lat);
    assert.equal(u.lng, esp.data.ubicacion.lng);
    assert.equal(u.precision, esp.data.ubicacion.precision);
    assert.equal(u.fecha, esp.data.fecha);
    assert.equal(u.fijadaPor, esp.data.vendedorId);
  }
});

prueba('ningún documento contiene nombres de personas o empresas reales', () => {
  const gen = generarDatos({
    dias: 10,
    porDia: 12,
    vendedores: 39,
    semilla: 3,
    fechaReferencia: '2026-11-26T15:00:00Z',
  });

  const reVendedor = /^(Vendedor Test|Vendedor Inventado \d{3})$/;
  const reCliente = /^(CLIENTE INVENTADO \d+ C\.A\.|NEGOCIO NUEVO INVENTADO \d+)$/;
  const reCiudad = /^(|CIUDAD \d+)$/;

  for (const v of gen.visitas) {
    const d = v.data;
    assert.match(v.id, /^sem-\d{3}-\d{8}-\d{3}$/);
    assert.match(d.vendedorNombre, reVendedor);
    assert.match(d.clienteNombre, reCliente);
    assert.match(d.ciudad, reCiudad);
    assert.equal(d.sembrado, true);
    if (d.nota !== '') {
      assert.ok(d.nota.startsWith('Nota inventada:'), `Nota inesperada: ${d.nota}`);
    }
    if (d.revision) {
      assert.equal(d.revision.por, 'admin1');
      assert.equal(d.revision.estado, 'validada');
    }
  }

  for (const u of gen.clientesUbicacion) {
    assert.match(u.data.clienteNombre, /^CLIENTE INVENTADO \d+ C\.A\.$/);
    assert.equal(u.data.sembrado, true);
  }
});

prueba('serialización Firestore y detección de documentos sembrados', () => {
  const fields = toFirestoreFields({
    texto: 'hola',
    entero: 42,
    decimal: 10.25,
    booleano: true,
    nulo: null,
    fecha: new Date('2026-11-26T12:00:00.000Z'),
    mapa: { a: 1 },
    lista: ['x', 2],
  });

  assert.deepEqual(fields.texto, { stringValue: 'hola' });
  assert.deepEqual(fields.entero, { integerValue: '42' });
  assert.deepEqual(fields.decimal, { doubleValue: 10.25 });
  assert.deepEqual(fields.booleano, { booleanValue: true });
  assert.deepEqual(fields.nulo, { nullValue: null });
  assert.deepEqual(fields.fecha, { timestampValue: '2026-11-26T12:00:00.000Z' });
  assert.deepEqual(fields.mapa, { mapValue: { fields: { a: { integerValue: '1' } } } });
  assert.deepEqual(fields.lista, { arrayValue: { values: [{ stringValue: 'x' }, { integerValue: '2' }] } });

  assert.equal(esDocumentoSembrado({ name: 'projects/demo-x/databases/(default)/documents/visitas/sem-052-20261126-001' }), true);
  assert.equal(esDocumentoSembrado({ name: 'projects/demo-x/databases/(default)/documents/clientesUbicacion/1234', fields: { sembrado: { booleanValue: true } } }), true);
  assert.equal(esDocumentoSembrado({ name: 'projects/demo-x/databases/(default)/documents/visitas/real-123', fields: {} }), false);
});

async function ejecutar() {
  let ok = 0;
  let fallos = 0;
  for (const p of pruebas) {
    try {
      await p.fn();
      console.log(`OK   ${p.nombre}`);
      ok++;
    } catch (err) {
      console.error(`FAIL ${p.nombre}`);
      console.error(err);
      fallos++;
    }
  }
  console.log(`\nResultado: ${ok} pasaron, ${fallos} fallaron (total ${pruebas.length}).`);
  if (fallos > 0) process.exitCode = 1;
}

ejecutar();
