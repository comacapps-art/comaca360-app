'use strict';
// Prueba de las visitas a clientes (BIT-011): la cola del teléfono para trabajar sin señal, la clave de los clientes,
// la ubicación de cada cliente, la alerta de distancia y quién ve qué. Se extraen del index.html las funciones de
// primer nivel y se corren en Node con un Firestore FALSO (setDoc que se puede dejar colgado como sin señal, resolver o
// fallar; getDoc y transacciones sobre documentos en memoria) y un localStorage en memoria. Comprueba que:
//   - la visita se guarda en la cola ANTES de intentar enviarla y sale de la cola solo cuando el servidor la confirma;
//   - NUNCA se da por confirmada una visita que el servidor no confirmó (aunque el almacenamiento del teléfono falle);
//   - sin señal se informa "pendiente" sin perderla, y se quita sola cuando la confirmación llega tarde;
//   - reintentar no duplica escrituras en vuelo, reenvía con el MISMO id y con merge (no borra la validación del
//     administrador), y reintenta las colas de TODOS los vendedores que dejaron pendientes en el teléfono;
//   - la cola sobrevive a "cerrar la app" y una cola dañada o un localStorage bloqueado no rompen nada;
//   - la clave de un cliente (cartera o nuevo, por vendedor y sin chocar con otro), la distancia, la alerta de más de
//     50 m con el margen de error del GPS (y sus bordes), la ubicación del cliente que fija SOLO la primera visita manual;
//   - quién ve a quién (administrador todo; gerente su equipo, directo o a través de gerentes a su cargo);
//   - el GPS con su propio tiempo de espera y errores con código; un documento mal formado no tumba la pantalla;
//   - en el index.html, el pedido de un vendedor deja su visita sin poder frenarlo, marcar nunca se bloquea por la
//     distancia, solo el administrador valida, y no quedan mapas de CARTO ni marcas de tilde "crudas" en el código.
// Termina comprobando que la propia prueba detecta errores introducidos a propósito (mutantes). Un mutante que no se pueda
// aplicar (porque el código cambió) cuenta como FALLA de esta prueba, no como detectado. Sin navegador, sin red y con
// datos inventados: NO sustituye la prueba en el emulador ni en un teléfono real.
//
//   node herramientas/medicion_ventas/prueba_visitas.js
process.env.TZ = 'America/Caracas';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SALIDA = path.join(__dirname, 'visitas_extraido.js');
const INDEX = path.join(__dirname, '..', '..', 'index.html');
const FUNCIONES = ['diaLocal', 'horaCorta', 'escaparHtml', 'RESULTADOS_VISITA', 'resultadoVisita', 'obtenerUbicacionVisita', 'obtenerUbicacionVisitaConReintento',
  'EVENTO_COLA_VISITAS', 'PREFIJO_COLA_VISITAS', 'claveColaVisitas', 'leerColaVisitas', 'guardarColaVisitas', 'quitarDeColaVisitas',
  'vendedoresConColaVisitas', 'UMBRAL_LEJOS_METROS', 'PRECISION_MAXIMA_REFERENCIA', 'MARCAS_DIACRITICAS', 'textoParaClave', 'resumenCorto',
  'claveClienteVisita', 'etiquetaClienteVisita', 'puntoValido', 'distanciaMetros', 'evaluarDistanciaVisita', 'resumenVerificacion',
  'visitaValidada', 'datosRevisionVisita', 'datosUbicacionAdministrador', 'visitaEsDeMiEquipo', 'restarDiasVisita', 'limpiarVisitaLeida',
  'asegurarUbicacionCliente', 'visitasEnVuelo', 'enviarVisita', 'nuevaIdVisita', 'registrarVisita', 'reintentarColaVisitas',
  'reintentarTodasLasColasVisitas', 'visitaDePedido'];
execFileSync(process.execPath, [path.join(__dirname, 'extraer.js'), '--extra', FUNCIONES.join(','), '--salida', SALIDA], { stdio: 'inherit' });
const TEXTO = fs.readFileSync(SALIDA, 'utf8').replace(/\r\n/g, '\n');

// ---- entorno simulado: Firestore falso, localStorage en memoria, window con eventos
const esperar = (ms) => new Promise(r => setTimeout(r, ms));
const clonar = (x) => JSON.parse(JSON.stringify(x));
const crearEntorno = () => {
  const almacen = new Map();
  const ent = {
    escrituras: [], // visitas: { ruta, datos, opciones, colaAlEscribir }
    ubicaciones: [], // escrituras a clientesUbicacion: { ruta, datos }
    documentos: new Map(), // ruta -> datos (lo que "hay en el servidor")
    modo: 'ok', // 'ok' | 'colgado' | 'falla' (solo para las visitas)
    sinRed: false, // getDoc y transacciones fallan
    colgadas: [],
    eventos: 0,
    bloquearStorage: false,
    almacen
  };
  globalThis.localStorage = {
    get length() { if (ent.bloquearStorage) throw new Error('bloqueado'); return almacen.size; },
    key: (i) => { if (ent.bloquearStorage) throw new Error('bloqueado'); const k = [...almacen.keys()][i]; return k === undefined ? null : k; },
    getItem: (k) => { if (ent.bloquearStorage) throw new Error('bloqueado'); return almacen.has(k) ? almacen.get(k) : null; },
    setItem: (k, v) => { if (ent.bloquearStorage) throw new Error('bloqueado'); almacen.set(k, String(v)); },
    removeItem: (k) => { if (ent.bloquearStorage) throw new Error('bloqueado'); almacen.delete(k); }
  };
  globalThis.window = { dispatchEvent: () => { ent.eventos++; } };
  console.warn = () => {}; // los avisos de "visita sin enviar" son esperados aquí
  globalThis.Event = class { constructor(t) { this.type = t; } };
  globalThis.db = {};
  globalThis.getCollectionPath = (c) => c;
  globalThis.serverTimestamp = () => '<<servidor>>';
  let n = 0;
  globalThis.collection = (_db, ruta) => ({ ruta });
  // doc(collection(...)) da un id nuevo; doc(db, ruta, id) apunta a ese documento.
  globalThis.doc = (a, ruta, id) => {
    if (a && a.ruta && ruta === undefined) { n++; return { ruta: a.ruta + '/auto' + n, id: 'auto' + n }; }
    return { ruta: ruta + '/' + id, id };
  };
  globalThis.getDoc = (ref) => {
    if (ent.sinRed) return Promise.reject(new Error('client is offline'));
    const d = ent.documentos.get(ref.ruta);
    return Promise.resolve({ exists: () => d !== undefined, data: () => d });
  };
  globalThis.setDoc = (ref, datos, opciones) => {
    if (ref.ruta.startsWith('clientesUbicacion/')) {
      ent.ubicaciones.push({ ruta: ref.ruta, datos: clonar(datos) });
      ent.documentos.set(ref.ruta, clonar(datos));
      return Promise.resolve();
    }
    ent.escrituras.push({ ruta: ref.ruta, datos: clonar(datos), opciones: opciones || null, colaAlEscribir: [...almacen.values()].join('') });
    const aplicar = () => {
      const previo = ent.documentos.get(ref.ruta) || {};
      ent.documentos.set(ref.ruta, opciones && opciones.merge ? { ...previo, ...clonar(datos) } : clonar(datos));
    };
    if (ent.modo === 'ok') { aplicar(); return Promise.resolve(); }
    if (ent.modo === 'falla') return Promise.reject(new Error('sin conexión'));
    return new Promise((resolve, reject) => ent.colgadas.push({ resolve: () => { aplicar(); resolve(); }, reject }));
  };
  // Transacción simplificada: lee con getDoc y aplica lo escrito al final (la atomicidad real es del SDK).
  globalThis.runTransaction = async (_db, fn) => {
    if (ent.sinRed) throw new Error('client is offline');
    const pendientes = [];
    const tx = { get: (ref) => globalThis.getDoc(ref), set: (ref, datos) => { pendientes.push([ref, datos]); } };
    const r = await fn(tx);
    for (const [ref, datos] of pendientes) await globalThis.setDoc(ref, datos);
    return r;
  };
  return ent;
};
let contador = 0;
const cargar = (codigo) => {
  const ruta = path.join(__dirname, `visitas_mod_${process.pid}_${contador++}.js`);
  fs.writeFileSync(ruta, codigo);
  try { return require(ruta); } finally { fs.unlinkSync(ruta); }
};
const visitaBase = (extra = {}) => ({
  vendedorId: '052', vendedorNombre: 'Vendedor Inventado', clienteId: '001052', clienteNombre: 'CLIENTE INVENTADO 1052 C.A.',
  ciudad: 'CIUDAD 8', fecha: '2026-11-23T19:12:18.698Z', dia: '2026-11-23', resultado: 'no-compro', nota: 'nota',
  ubicacion: { lat: 10.491, lng: -66.879, precision: 18 }, origen: 'manual', pedidoId: null, ...extra
});
const cola = (M, v = '052') => M.leerColaVisitas(v);

// ---- batería: devuelve la lista de fallas (vacía si todo está bien)
const bateria = async (codigo, mostrar) => {
  const fallas = [];
  const prueba = async (nombre, fn) => {
    try { await fn(); if (mostrar) console.log('  ok    ' + nombre); }
    catch (e) { fallas.push(nombre); if (mostrar) console.log('  FALLA ' + nombre + '\n        ' + String(e.message).split('\n')[0]); }
  };
  const nuevo = () => { const ent = crearEntorno(); const M = cargar(codigo); return { ent, M }; };

  await prueba('con señal: se envía con merge, se confirma y sale de la cola', async () => {
    const { ent, M } = nuevo();
    const r = await M.registrarVisita(visitaBase(), 2000);
    assert.strictEqual(r.confirmado, true);
    assert.strictEqual(r.guardadaEnTelefono, true);
    assert.strictEqual(ent.escrituras.length, 1);
    assert.ok(ent.escrituras[0].ruta.startsWith('visitas/'), 'ruta ' + ent.escrituras[0].ruta);
    assert.ok(!('id' in ent.escrituras[0].datos), 'el id no debe ir dentro del documento');
    assert.strictEqual(ent.escrituras[0].datos.clienteId, '001052');
    assert.strictEqual(ent.escrituras[0].datos.enviadaEn, '<<servidor>>', 'lleva la hora del servidor');
    assert.deepStrictEqual(ent.escrituras[0].opciones, { merge: true }, 'sin merge un reintento borraría la validación');
    assert.strictEqual(cola(M).length, 0);
  });

  await prueba('el aviso de la cola se emite al encolar y al quitar (refresca "Pendiente de enviar")', async () => {
    const { ent, M } = nuevo();
    await M.registrarVisita(visitaBase(), 2000);
    assert.ok(ent.eventos >= 2, 'eventos emitidos: ' + ent.eventos);
  });

  await prueba('se guarda en el teléfono ANTES de intentar enviarla', async () => {
    const { ent, M } = nuevo();
    await M.registrarVisita(visitaBase({ nota: 'MARCA-UNICA' }), 2000);
    assert.ok(ent.escrituras[0].colaAlEscribir.includes('MARCA-UNICA'), 'al escribir en Firestore la visita no estaba en la cola');
  });

  await prueba('sin señal: responde "pendiente", queda en la cola y cada una sale sola al confirmarse tarde', async () => {
    const { ent, M } = nuevo();
    ent.modo = 'colgado';
    const r = await M.registrarVisita(visitaBase(), 300);
    assert.strictEqual(r.confirmado, false);
    assert.strictEqual(r.guardadaEnTelefono, true);
    await M.registrarVisita(visitaBase({ clienteId: '001053' }), 20);
    assert.strictEqual(cola(M).length, 2);
    ent.colgadas[0].resolve();
    await esperar(20);
    assert.deepStrictEqual(cola(M).map(v => v.clienteId), ['001053'], 'solo debía salir la confirmada');
    ent.colgadas[1].resolve();
    await esperar(20);
    assert.strictEqual(cola(M).length, 0, 'tras la confirmación tardía debía salir de la cola');
  });

  await prueba('con el almacenamiento roto NUNCA se da por confirmada una visita que el servidor no confirmó', async () => {
    const { ent, M } = nuevo();
    ent.bloquearStorage = true;
    ent.modo = 'colgado';
    const r = await M.registrarVisita(visitaBase(), 100);
    assert.strictEqual(r.guardadaEnTelefono, false, 'debe avisar que no quedó en el teléfono');
    assert.strictEqual(r.confirmado, false, 'sin señal y sin cola no hay confirmación posible');
    ent.colgadas[0].resolve(); // llega tarde la confirmación: no debe romper nada
    await esperar(10);
    ent.modo = 'ok';
    ent.bloquearStorage = true;
    const r2 = await M.registrarVisita(visitaBase({ clienteId: '001053' }), 2000);
    assert.strictEqual(r2.confirmado, true, 'con señal sí se confirma aunque no haya almacenamiento');
    assert.strictEqual(r2.guardadaEnTelefono, false);
  });

  await prueba('reintentar con una escritura en vuelo no escribe dos veces', async () => {
    const { ent, M } = nuevo();
    ent.modo = 'colgado';
    await M.registrarVisita(visitaBase(), 50);
    M.reintentarColaVisitas('052'); M.reintentarColaVisitas('052');
    await esperar(10);
    assert.strictEqual(ent.escrituras.length, 1);
  });

  await prueba('tras un fallo se reintenta con el MISMO id (no duplica la visita)', async () => {
    const { ent, M } = nuevo();
    ent.modo = 'falla';
    const r = await M.registrarVisita(visitaBase(), 100);
    assert.strictEqual(r.confirmado, false);
    assert.strictEqual(cola(M).length, 1, 'tras el fallo debe seguir en la cola');
    ent.modo = 'ok';
    M.reintentarColaVisitas('052');
    await esperar(20);
    assert.strictEqual(ent.escrituras.length, 2);
    assert.strictEqual(ent.escrituras[0].ruta, ent.escrituras[1].ruta);
    assert.strictEqual(cola(M).length, 0);
  });

  await prueba('un reenvío no borra la validación del administrador (merge)', async () => {
    const { ent, M } = nuevo();
    ent.documentos.set('visitas/V1', { ...visitaBase(), revision: { estado: 'validada', por: 'admin1' } });
    await M.registrarVisita(visitaBase({ id: 'V1' }), 2000);
    assert.strictEqual(ent.documentos.get('visitas/V1').revision.estado, 'validada');
  });

  await prueba('la cola sobrevive a cerrar y abrir la app', async () => {
    const ent = crearEntorno();
    ent.modo = 'colgado';
    const M1 = cargar(codigo);
    await M1.registrarVisita(visitaBase(), 50);
    const guardado = new Map(ent.almacen);
    const ent2 = crearEntorno(); // "otra sesión": mismo almacenamiento, Firestore nuevo
    guardado.forEach((v, k) => ent2.almacen.set(k, v));
    const M2 = cargar(codigo);
    assert.strictEqual(M2.leerColaVisitas('052').length, 1);
    M2.reintentarColaVisitas('052');
    await esperar(20);
    assert.strictEqual(ent2.escrituras.length, 1);
    assert.strictEqual(M2.leerColaVisitas('052').length, 0);
  });

  await prueba('la cola es por vendedor y se reintentan las de todos los que dejaron pendientes en el teléfono', async () => {
    const { ent, M } = nuevo();
    ent.modo = 'falla';
    await M.registrarVisita(visitaBase(), 20);
    await M.registrarVisita(visitaBase({ vendedorId: 77 }), 20);
    assert.strictEqual(M.leerColaVisitas('052').length, 1);
    assert.strictEqual(M.leerColaVisitas('77').length, 1);
    assert.strictEqual(M.leerColaVisitas('77')[0].vendedorId, '77', 'vendedorId debe guardarse como texto');
    assert.deepStrictEqual(M.vendedoresConColaVisitas().sort(), ['052', '77']);
    ent.modo = 'ok';
    M.reintentarTodasLasColasVisitas(); // entra "otra persona" con el mismo equipo
    await esperar(30);
    assert.strictEqual(M.leerColaVisitas('052').length, 0);
    assert.strictEqual(M.leerColaVisitas('77').length, 0);
    assert.strictEqual(ent.escrituras.length, 4);
  });

  await prueba('cola dañada o almacenamiento bloqueado no rompen nada', async () => {
    const { ent, M } = nuevo();
    ent.almacen.set(M.claveColaVisitas('052'), '{no es json');
    assert.deepStrictEqual(M.leerColaVisitas('052'), []);
    ent.almacen.set(M.claveColaVisitas('052'), JSON.stringify([null, { sinId: 1 }, { id: 'x1', vendedorId: '052' }]));
    assert.strictEqual(M.leerColaVisitas('052').length, 1);
    ent.bloquearStorage = true;
    assert.deepStrictEqual(M.leerColaVisitas('052'), []);
    assert.deepStrictEqual(M.vendedoresConColaVisitas(), []);
    await M.registrarVisita(visitaBase(), 50); // no debe lanzar
    assert.strictEqual(ent.escrituras.length, 1, 'aun sin almacenamiento debe intentar enviarla');
  });

  await prueba('el día es el del teléfono, no el de Greenwich; restar días respeta meses y años', async () => {
    const { M } = nuevo();
    assert.strictEqual(M.diaLocal(new Date('2026-11-24T01:30:00Z')), '2026-11-23'); // 9:30 p. m. en Caracas
    assert.strictEqual(M.diaLocal(new Date('2026-11-23T04:30:00Z')), '2026-11-23'); // 12:30 a. m.
    assert.strictEqual(M.diaLocal('no es fecha'), '');
    assert.strictEqual(M.restarDiasVisita('2026-11-23', 6), '2026-11-17');
    assert.strictEqual(M.restarDiasVisita('2026-12-03', 6), '2026-11-27');
    assert.strictEqual(M.restarDiasVisita('2027-01-02', 6), '2026-12-27');
    assert.strictEqual(M.restarDiasVisita('2024-03-02', 3), '2024-02-28');
    assert.strictEqual(M.restarDiasVisita('2026-11-23', 0), '2026-11-23');
    assert.strictEqual(M.restarDiasVisita('', 6), '');
    assert.strictEqual(M.restarDiasVisita('mañana', 6), '');
  });

  await prueba('la visita de un pedido lleva cliente, punto GPS, precisión y el pedido', async () => {
    const { M } = nuevo();
    const v = M.visitaDePedido({ currentUser: { id: 52, nombre: 'Vendedor Inventado' }, client: { idCliente: '002013', cliente: 'CLIENTE X', ciudad: 'C1' },
      pedidoId: 'P1', ubicacion: { lat: 10.48, lng: -66.9 }, precision: 9.6, fecha: '2026-11-24T01:00:00.000Z' });
    assert.deepStrictEqual(v, { vendedorId: '52', vendedorNombre: 'Vendedor Inventado', clienteId: '002013', clienteNombre: 'CLIENTE X', ciudad: 'C1', clienteNuevo: false,
      fecha: '2026-11-24T01:00:00.000Z', dia: '2026-11-23', resultado: 'vendio', nota: '', ubicacion: { lat: 10.48, lng: -66.9, precision: 10 },
      origen: 'pedido', pedidoId: 'P1' });
    const sin = M.visitaDePedido({ currentUser: { id: '052' }, client: {}, pedidoId: undefined, ubicacion: null, precision: null, fecha: '2026-11-23T12:00:00Z' });
    assert.strictEqual(sin.ubicacion, null);
    assert.strictEqual(sin.pedidoId, null);
    assert.strictEqual(sin.clienteId, 'S/N');
    assert.ok(!Object.values(sin).includes(undefined), 'Firestore rechaza campos undefined');
  });

  await prueba('la clave del cliente: cartera normalizada; nuevos por vendedor y nombre sin tildes ni símbolos', async () => {
    const { M } = nuevo();
    assert.strictEqual(M.claveClienteVisita('002052', 'X', '052'), '2052');
    assert.strictEqual(M.claveClienteVisita(' 000123 ', 'X'), '123');
    assert.strictEqual(M.claveClienteVisita('', 'Bodega Ñandú  La Esquina!', '052'), 'N-52-bodega-nandu-la-esquina');
    assert.strictEqual(M.claveClienteVisita('S/N', 'Bodega Ñandú  La Esquina!', '052'), 'N-52-bodega-nandu-la-esquina');
    assert.strictEqual(M.claveClienteVisita('', 'Bodega Ñandú  La Esquina!'), 'N-bodega-nandu-la-esquina', 'sin vendedor no lo lleva');
    assert.notStrictEqual(M.claveClienteVisita('', 'Bodega La Esquina', '052'), M.claveClienteVisita('', 'Bodega La Esquina', '077'),
      'dos vendedores con un cliente del mismo nombre no pueden compartir ubicación');
    assert.strictEqual(M.claveClienteVisita('N-52-bodega-x', 'otro', '99'), 'N-52-bodega-x');
    assert.strictEqual(M.claveClienteVisita('S/N', '???', '052'), '');
    assert.strictEqual(M.claveClienteVisita('', '', '052'), '');
    assert.ok(!M.claveClienteVisita('N-a/b/c', 'x').includes('/'), 'la clave no puede llevar /');
    assert.ok(!M.claveClienteVisita('', 'a/b/c', '1').includes('/'), 'la clave no puede llevar /');
    const largo1 = 'Distribuidora de alimentos y bebidas La Esquina del Norte Sucursal Uno';
    const largo2 = 'Distribuidora de alimentos y bebidas La Esquina del Norte Sucursal Dos';
    const k1 = M.claveClienteVisita('', largo1, '052'); const k2 = M.claveClienteVisita('', largo2, '052');
    assert.notStrictEqual(k1, k2, 'dos nombres largos distintos no deben chocar al acortarse');
    assert.ok(k1.length <= 70 && k2.length <= 70, 'largo ' + k1.length);
    assert.strictEqual(k1, M.claveClienteVisita('', largo1.toUpperCase(), '052'), 'mayúsculas no cambian la clave');
    assert.strictEqual(M.textoParaClave('PANADERÍA  El Trigo!'), M.textoParaClave('panaderia el trigo'));
    assert.strictEqual(M.etiquetaClienteVisita({ clienteNuevo: true, clienteId: 'N-x' }), 'Nuevo');
    assert.strictEqual(M.etiquetaClienteVisita({ clienteId: '002052' }), '002052');
    assert.strictEqual(M.etiquetaClienteVisita({}), 'S/N');
  });

  await prueba('la distancia entre dos puntos sale en metros', async () => {
    const { M } = nuevo();
    const d = M.distanciaMetros({ lat: 10.4910, lng: -66.8790 }, { lat: 10.4915, lng: -66.8790 });
    assert.ok(d > 55 && d < 56.2, 'esperaba ≈ 55,6 m y salió ' + d);
    assert.strictEqual(M.distanciaMetros({ lat: 10.5, lng: -66.9 }, { lat: 10.5, lng: -66.9 }), 0);
    const e = M.distanciaMetros({ lat: 10.4910, lng: -66.8790 }, { lat: 10.4910, lng: -66.8785 });
    assert.ok(e > 54 && e < 56, 'en longitud ≈ 54,7 m y salió ' + e);
  });

  await prueba('alerta solo si pasa de 50 m aun descontando el margen del GPS (y sus bordes)', async () => {
    const { M } = nuevo();
    const ref = { lat: 10.4910, lng: -66.8790, visitaId: 'V0' };
    const visita = (lat, precision, id = 'V1') => ({ id, ubicacion: { lat, lng: -66.8790, precision } });
    assert.strictEqual(M.evaluarDistanciaVisita(visita(10.49124, 10), ref).estado, 'cerca'); // ≈ 27 m
    assert.strictEqual(M.evaluarDistanciaVisita(visita(10.4915, 5), ref).estado, 'lejos'); // ≈ 56 m con ± 5
    assert.strictEqual(M.evaluarDistanciaVisita(visita(10.4915, 20), ref).estado, 'cerca'); // 56 < 50 + 20
    assert.strictEqual(M.evaluarDistanciaVisita(visita(10.4925, 20), ref).estado, 'lejos'); // ≈ 167 m
    assert.strictEqual(M.evaluarDistanciaVisita(visita(10.4925, 500), ref).estado, 'lejos', 'el margen tiene tope de 100 m');
    assert.strictEqual(M.evaluarDistanciaVisita(visita(10.4915, undefined), ref).estado, 'lejos', 'sin precisión no hay margen');
    const borde = M.evaluarDistanciaVisita(visita(10.49145, 0), ref); // ≈ 50,0 m: justo en el umbral NO alerta
    assert.strictEqual(borde.metros, 50);
    assert.strictEqual(borde.estado, 'cerca', 'exactamente 50 m no es "más de 50"');
    assert.strictEqual(M.evaluarDistanciaVisita(visita(10.49147, 0), ref).estado, 'lejos', '≈ 52 m sí');
    const l = M.evaluarDistanciaVisita(visita(10.4925, 20), ref);
    assert.ok(l.metros > 160 && l.metros < 170 && l.margen === 20, JSON.stringify(l));
    assert.strictEqual(M.evaluarDistanciaVisita(visita(10.4925, 20, 'V0'), ref).estado, 'es-referencia');
    assert.strictEqual(M.evaluarDistanciaVisita(visita(10.4925, 20), null).estado, 'sin-referencia');
    assert.strictEqual(M.evaluarDistanciaVisita(visita(10.4925, 20), { visitaId: 'V0' }).estado, 'sin-referencia');
    assert.strictEqual(M.evaluarDistanciaVisita({ id: 'V9', ubicacion: null }, ref).estado, 'sin-gps');
    assert.strictEqual(M.evaluarDistanciaVisita({ id: 'V9' }, ref).estado, 'sin-gps');
    assert.strictEqual(M.evaluarDistanciaVisita({ id: 'V9', ubicacion: { lat: 10.5, lng: NaN } }, ref).estado, 'sin-gps', 'longitud inválida');
    assert.strictEqual(M.evaluarDistanciaVisita({ id: 'V9', ubicacion: { lat: NaN, lng: -66.9 } }, ref).estado, 'sin-gps', 'latitud inválida');
    assert.strictEqual(M.puntoValido({ lat: 0, lng: 0 }), true);
    assert.strictEqual(M.puntoValido({ lat: 1, lng: undefined }), false);
  });

  await prueba('el resumen de verificación cuenta cada estado', async () => {
    const { M } = nuevo();
    const ev = (estado) => ({ ev: { estado } });
    assert.deepStrictEqual(M.resumenVerificacion([ev('cerca'), ev('cerca'), ev('lejos'), ev('es-referencia'), ev('sin-referencia'), ev('sin-gps'), ev('rarito')]),
      { cerca: 2, lejos: 1, referencia: 1, sinReferencia: 1, sinGps: 2 });
    assert.deepStrictEqual(M.resumenVerificacion(undefined), { cerca: 0, lejos: 0, referencia: 0, sinReferencia: 0, sinGps: 0 });
  });

  await prueba('la primera visita manual fija la ubicación del cliente y las siguientes no la pisan', async () => {
    const { ent, M } = nuevo();
    assert.strictEqual((await M.registrarVisita(visitaBase(), 2000)).confirmado, true);
    await esperar(15);
    assert.strictEqual(ent.ubicaciones.length, 1);
    const u = ent.ubicaciones[0];
    assert.strictEqual(u.ruta, 'clientesUbicacion/1052', 'se identifica con el código normalizado (sin ceros a la izquierda)');
    const idVisita = ent.escrituras[0].ruta.split('/')[1];
    assert.deepStrictEqual(u.datos, { clienteId: '001052', clienteNombre: 'CLIENTE INVENTADO 1052 C.A.', lat: 10.491, lng: -66.879, precision: 18,
      visitaId: idVisita, fuente: 'primera-visita', fecha: '2026-11-23T19:12:18.698Z', fijadaPor: '052' });
    await M.registrarVisita(visitaBase({ ubicacion: { lat: 10.6, lng: -66.7, precision: 5 } }), 2000);
    await esperar(15);
    assert.strictEqual(ent.ubicaciones.length, 1, 'la segunda visita no debe pisar la ubicación');
    assert.strictEqual(ent.documentos.get('clientesUbicacion/1052').lat, 10.491);
  });

  await prueba('un pedido NO fija la ubicación del cliente (solo la visita manual)', async () => {
    const { ent, M } = nuevo();
    await M.registrarVisita(visitaBase({ origen: 'pedido', pedidoId: 'P1' }), 2000);
    await esperar(15);
    assert.strictEqual(ent.ubicaciones.length, 0);
    assert.strictEqual(await M.asegurarUbicacionCliente({ ...visitaBase({ origen: 'pedido' }), id: 'X' }), false);
  });

  await prueba('no se fija la ubicación con GPS malo, sin GPS o sin red; sí con cliente nuevo; el borde de 100 m', async () => {
    const { ent, M } = nuevo();
    await M.registrarVisita(visitaBase({ ubicacion: { lat: 10.5, lng: -66.9, precision: 250 } }), 2000);
    await M.registrarVisita(visitaBase({ clienteId: '001053', ubicacion: null }), 2000);
    await M.registrarVisita(visitaBase({ clienteId: '001055', ubicacion: { lat: 10.5, lng: -66.9, precision: 101 } }), 2000);
    await esperar(15);
    assert.strictEqual(ent.ubicaciones.length, 0, 'GPS de 101 m o más, o ausente, no sirve de referencia');
    await M.registrarVisita(visitaBase({ clienteId: '001056', ubicacion: { lat: 10.5, lng: -66.9, precision: 100 } }), 2000);
    await esperar(15);
    assert.strictEqual(ent.ubicaciones.length, 1, 'justo 100 m sí se acepta');
    ent.sinRed = true;
    await M.registrarVisita(visitaBase({ clienteId: '001054' }), 2000); // la transacción falla: no debe romper ni perder la visita
    await esperar(15);
    assert.strictEqual(ent.ubicaciones.length, 1);
    assert.strictEqual(cola(M).length, 0, 'la visita se confirmó igual');
    ent.sinRed = false;
    await M.registrarVisita(visitaBase({ clienteId: 'N-52-bodega-la-esquina', clienteNombre: 'Bodega La Esquina', clienteNuevo: true }), 2000);
    await esperar(15);
    assert.strictEqual(ent.ubicaciones.length, 2);
    assert.strictEqual(ent.ubicaciones[1].ruta, 'clientesUbicacion/N-52-bodega-la-esquina');
  });

  await prueba('visitas de un cliente sin código: la clave lleva al vendedor (no chocan entre vendedores)', async () => {
    const { ent, M } = nuevo();
    await M.registrarVisita(visitaBase({ clienteId: 'S/N', clienteNombre: 'Abasto Central', vendedorId: '052' }), 2000);
    await M.registrarVisita(visitaBase({ clienteId: 'S/N', clienteNombre: 'Abasto Central', vendedorId: '077', ubicacion: { lat: 8.6, lng: -71.1, precision: 10 } }), 2000);
    await esperar(15);
    assert.deepStrictEqual(ent.ubicaciones.map(u => u.ruta).sort(), ['clientesUbicacion/N-52-abasto-central', 'clientesUbicacion/N-77-abasto-central']);
  });

  await prueba('quién ve a quién: administrador todo; gerente su equipo directo y el de los gerentes a su cargo', async () => {
    const { M } = nuevo();
    const users = [
      { id: 'admin1', rol: 'admin' }, { id: 'g1', rol: 'gerente', supervisor: 'admin1' }, { id: 'g2', rol: 'gerente', supervisor: 'g1' },
      { id: '052', rol: 'vendedor', supervisor: 'g1' }, { id: 'v2', rol: 'vendedor', supervisor: 'g2' }, { id: 'v3', rol: 'vendedor', supervisor: 'g9' },
      { id: 'v4', rol: 'vendedor' }, { id: 'v5', rol: 'vendedor', supervisor: 'v2' }
    ];
    const g1 = users[1]; const g2 = users[2]; const admin = users[0]; const vend = users[3];
    for (const id of ['052', 'v2', 'v3', 'v4', 'v5', 'fantasma', 'g1']) assert.strictEqual(M.visitaEsDeMiEquipo(id, users, admin), true, 'admin ve ' + id);
    assert.strictEqual(M.visitaEsDeMiEquipo('052', users, g1), true, 'directo (id con ceros frente a id sin ceros)');
    assert.strictEqual(M.visitaEsDeMiEquipo('52', users, g1), true, 'mismo vendedor escrito sin ceros');
    assert.strictEqual(M.visitaEsDeMiEquipo(52, users, g1), true, 'id numérico');
    assert.strictEqual(M.visitaEsDeMiEquipo('v2', users, g1), true, 'a través de un gerente a su cargo');
    assert.strictEqual(M.visitaEsDeMiEquipo('v3', users, g1), false, 'supervisor desconocido');
    assert.strictEqual(M.visitaEsDeMiEquipo('v4', users, g1), false, 'sin supervisor');
    assert.strictEqual(M.visitaEsDeMiEquipo('v5', users, g1), false, 'nieto por un vendedor: no es su equipo');
    assert.strictEqual(M.visitaEsDeMiEquipo('fantasma', users, g1), false, 'usuario que ya no existe');
    assert.strictEqual(M.visitaEsDeMiEquipo('g1', users, g1), true, 'las propias');
    assert.strictEqual(M.visitaEsDeMiEquipo('052', users, g2), false, 'otro gerente no ve el equipo de su jefe');
    assert.strictEqual(M.visitaEsDeMiEquipo('v2', users, g2), true);
    assert.strictEqual(M.visitaEsDeMiEquipo('v2', users, vend), false, 'un vendedor no ve a otros');
    assert.strictEqual(M.visitaEsDeMiEquipo('052', users, null), false);
  });

  await prueba('validar y "ubicar cliente aquí" guardan quién y cuándo', async () => {
    const { M } = nuevo();
    const ahora = new Date('2026-11-24T16:00:00.000Z');
    assert.deepStrictEqual(M.datosRevisionVisita({ id: 'admin1' }, ahora), { revision: { estado: 'validada', por: 'admin1', fecha: '2026-11-24T16:00:00.000Z' } });
    const v = { id: 'V7', clienteId: '001052', clienteNombre: 'C', ubicacion: { lat: 10.5, lng: -66.9, precision: 22 } };
    assert.deepStrictEqual(M.datosUbicacionAdministrador(v, { id: 'admin1' }, ahora), { clienteId: '001052', clienteNombre: 'C', lat: 10.5, lng: -66.9, precision: 22,
      visitaId: 'V7', fuente: 'administrador', fecha: '2026-11-24T16:00:00.000Z', fijadaPor: 'admin1' });
    assert.strictEqual(M.datosUbicacionAdministrador({ ...v, ubicacion: { lat: 1, lng: 2 } }, { id: 'a' }, ahora).precision, null);
    assert.strictEqual(M.visitaValidada({ revision: { estado: 'validada' } }), true);
    assert.strictEqual(M.visitaValidada({ revision: { estado: 'otra' } }), false);
    assert.strictEqual(M.visitaValidada({}), false);
    assert.strictEqual(M.visitaValidada(null), false);
  });

  await prueba('una visita mal formada se sanea y no tumba la pantalla', async () => {
    const { M } = nuevo();
    const v = M.limpiarVisitaLeida({ id: 5, vendedorId: 52, vendedorNombre: { raro: 1 }, clienteId: null, clienteNombre: ['a'], nota: 7, fecha: { s: 1 }, dia: undefined,
      ubicacion: { lat: 'x', lng: -66.9 } });
    assert.strictEqual(typeof v.vendedorNombre, 'string');
    assert.strictEqual(v.vendedorId, '52');
    assert.strictEqual(v.clienteId, '');
    assert.strictEqual(v.nota, '7');
    assert.strictEqual(v.id, '5');
    assert.strictEqual(v.dia, '');
    assert.strictEqual(v.ubicacion, null, 'ubicación inválida -> null');
    assert.doesNotThrow(() => v.vendedorNombre.localeCompare('a'));
    assert.deepStrictEqual(M.limpiarVisitaLeida({ id: 'V1', ubicacion: { lat: 1, lng: 2, precision: 'mucha' } }).ubicacion, { lat: 1, lng: 2, precision: null });
    assert.doesNotThrow(() => M.limpiarVisitaLeida(null));
    assert.doesNotThrow(() => M.limpiarVisitaLeida('texto'));
  });

  await prueba('el GPS tiene su propio tiempo de espera y errores con código', async () => {
    const { M } = nuevo();
    const poner = (geo) => Object.defineProperty(globalThis, 'navigator', { value: geo, configurable: true, writable: true });
    poner({ geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: 10.5, longitude: -66.9, accuracy: 12.6 } }) } });
    assert.deepStrictEqual(await M.obtenerUbicacionVisita(50), { lat: 10.5, lng: -66.9, precision: 13 });
    poner({ geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: 10.5, longitude: -66.9, accuracy: NaN } }) } });
    assert.strictEqual((await M.obtenerUbicacionVisita(50)).precision, null);
    poner({ geolocation: { getCurrentPosition: (ok, err) => err({ code: 1, message: 'denegado' }) } });
    await assert.rejects(M.obtenerUbicacionVisita(50), (e) => e.code === 1);
    poner({});
    await assert.rejects(M.obtenerUbicacionVisita(50), (e) => e.code === 0);
    let respuestaTardia = null;
    poner({ geolocation: { getCurrentPosition: (ok) => { respuestaTardia = ok; } } }); // nunca responde a tiempo
    const inicio = Date.now();
    await assert.rejects(M.obtenerUbicacionVisita(10), (e) => e.code === 3);
    assert.ok(Date.now() - inicio < 1000, 'debe rendirse por su cuenta');
    respuestaTardia({ coords: { latitude: 1, longitude: 2, accuracy: 3 } }); // una respuesta tardía no debe romper nada
  });

  await prueba('el GPS en frío se reintenta UNA vez (tiempo agotado o posición no disponible), no así el permiso denegado', async () => {
    const { M } = nuevo();
    const poner = (geo) => Object.defineProperty(globalThis, 'navigator', { value: geo, configurable: true, writable: true });
    const ok = { coords: { latitude: 10.5, longitude: -66.9, accuracy: 9 } };
    // primer intento sin respuesta (tiempo agotado), el segundo responde
    let llamadas = 0; let avisos = 0;
    poner({ geolocation: { getCurrentPosition: (res) => { llamadas++; if (llamadas === 2) res(ok); } } });
    const u = await M.obtenerUbicacionVisitaConReintento(10, () => { avisos++; });
    assert.strictEqual(u.precision, 9);
    assert.strictEqual(llamadas, 2);
    assert.strictEqual(avisos, 1, 'avisa una vez que reintenta');
    // posición no disponible (2) y luego responde
    llamadas = 0;
    poner({ geolocation: { getCurrentPosition: (res, err) => { llamadas++; if (llamadas === 1) err({ code: 2 }); else res(ok); } } });
    assert.strictEqual((await M.obtenerUbicacionVisitaConReintento(10)).precision, 9);
    assert.strictEqual(llamadas, 2);
    // permiso denegado (1): no se reintenta
    llamadas = 0;
    poner({ geolocation: { getCurrentPosition: (res, err) => { llamadas++; err({ code: 1 }); } } });
    await assert.rejects(M.obtenerUbicacionVisitaConReintento(10), (e) => e.code === 1);
    assert.strictEqual(llamadas, 1, 'permiso denegado: un solo intento');
    // no soportado (0): no se reintenta
    poner({});
    await assert.rejects(M.obtenerUbicacionVisitaConReintento(10), (e) => e.code === 0);
    // dos fallos seguidos: rinde con el último error y solo dos intentos
    llamadas = 0;
    poner({ geolocation: { getCurrentPosition: () => { llamadas++; } } });
    await assert.rejects(M.obtenerUbicacionVisitaConReintento(10), (e) => e.code === 3);
    assert.strictEqual(llamadas, 2, 'solo un reintento');
  });

  await prueba('textos del mapa escapados y resultados conocidos', async () => {
    const { M } = nuevo();
    assert.strictEqual(M.escaparHtml(`<b onclick="x">'&`), '&lt;b onclick=&quot;x&quot;&gt;&#39;&amp;');
    assert.strictEqual(M.escaparHtml(55), '55');
    assert.strictEqual(M.resultadoVisita('vendio').label, 'Vendió');
    assert.strictEqual(M.resultadoVisita('inventado').id, 'otro');
  });
  return fallas;
};

const estatico = () => {
  const html = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
  const fallas = [];
  const chequear = (nombre, cond) => { console.log((cond ? '  ok    ' : '  FALLA ') + nombre); if (!cond) fallas.push(nombre); };
  const i = html.indexOf("const pedidoRef = await addDoc(collection(db, getCollectionPath('pedidos')), pedido);");
  const trozo = i >= 0 ? html.slice(i, i + 800) : '';
  chequear('el pedido registra su visita DESPUÉS de guardarse', i >= 0 && /registrarVisita\(visitaDePedido\(/.test(trozo));
  chequear('la visita del pedido solo la deja un vendedor, no se espera y sus errores no frenan el pedido',
    /if \(currentUser\.rol === 'vendedor'\) \{\n\s+try \{\n\s+registrarVisita\(visitaDePedido\([^\n]+\), 0\)\.catch\(\(\) => \{\}\);\n\s+\} catch \(e\)/.test(trozo) && !/await registrarVisita/.test(trozo));
  chequear('el pedido sigue guardando solo lat y lng en su ubicación', /position => \{\n\s+precisionGps = position\.coords\.accuracy;\n\s+resolve\(\{ lat: position\.coords\.latitude, lng: position\.coords\.longitude \}\);/.test(html));
  chequear('pantalla, menú, pestaña del teléfono y permiso de "visitas-vendedor"',
    html.includes("globalActiveTab === 'visitas-vendedor' && hasPerm('visitas-vendedor') && <VisitasVendedorView") &&
    html.includes('<NavBtn id="visitas-vendedor"') && html.includes("[['visitas-vendedor', 'Visitas']]") &&
    html.includes("if (id === 'visitas-vendedor') return rol === 'vendedor';") && html.includes("case 'visitas-vendedor': return { cartera: propio };"));
  chequear('el mapa lee las visitas de la semana (alertas) y, si el día es más viejo, solo ese día',
    /query\(collection\(db, getCollectionPath\('visitas'\)\), where\('dia', '>=', desdeSemana\)\)/.test(html) &&
    /query\(collection\(db, getCollectionPath\('visitas'\)\), where\('dia', '==', dia\)\)/.test(html));
  chequear('el vendedor lee solo sus visitas de hoy', /where\('vendedorId', '==', vendedorId\), where\('dia', '==', hoy\)/.test(html));
  chequear('se reintenta la cola de todos al abrir, al volver la señal y cada 2 minutos', /reintentarTodasLasColasVisitas\(\)[\s\S]{0,200}addEventListener\('online', reintentar\)[\s\S]{0,120}setInterval\(reintentar, 120000\)/.test(html));
  const iMarcar = html.indexOf('const marcar = async () => {');
  const marcarTxt = iMarcar >= 0 ? html.slice(iMarcar, html.indexOf('const precisionTexto', iMarcar)) : '';
  chequear('marcar una visita lejos del cliente NO se bloquea (la alerta es solo en el tablero)', marcarTxt.length > 100 && !/distanciaMetros|evaluarDistanciaVisita|UMBRAL_LEJOS/.test(marcarTxt));
  chequear('marcar usa el GPS con reintento y avisa mientras reintenta', marcarTxt.includes('obtenerUbicacionVisitaConReintento(15000, () => setEstadoGuardado('));
  chequear('cliente nuevo: botón, formulario, cruce con la cartera sin tildes y marca en la visita',
    html.includes('Cliente nuevo (no está en mi cartera)') && html.includes('clienteNuevo: !!cliente.nuevo,') && html.includes('textoParaClave(c.cliente) === textoParaClave(nombreNuevo)'));
  chequear('solo el administrador valida alertas y corrige la ubicación', html.includes("const esAdmin = currentUser.rol === 'admin';") && /\{esAdmin && \(\s+<div className="flex gap-2 shrink-0">\s+<button onClick=\{\(\) => validar\(v\)\}[\s\S]{0,400}ubicarClienteAqui\(v\)/.test(html));
  chequear('el mapa lee la ubicación de cada cliente con getDoc y marca la alerta', /getDoc\(doc\(db, getCollectionPath\('clientesUbicacion'\), c\)\)/.test(html) && html.includes("filter(x => x.ev.estado === 'lejos' && !visitaValidada(x.v))"));
  chequear('la ubicación del cliente se fija en una transacción (sin pisar) y solo con visitas manuales', /runTransaction\(db, async \(tx\) => \{\n\s+const existente = await tx\.get\(ref\);\n\s+if \(existente\.exists\(\)\) return false;/.test(html) && html.includes("if (visita.origen === 'pedido') return false;"));
  chequear('el globo del mapa de pedidos escapa los textos', html.includes("[${escaparHtml(p.clienteId || 'S/N')}] ${escaparHtml(p.clienteNombre)}") && html.includes('Vendedor: ${escaparHtml(p.vendedorNombre)}'));
  const crudas = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']');
  chequear('no quedan marcas de tilde "crudas" en el código (se escriben con String.fromCharCode)', !crudas.test(html));
  chequear('no quedan mapas de CARTO (ahora pide clave)', !html.includes('basemaps.cartocdn.com') && (html.match(/agregarFondoMapa\(mapRef\.current\)/g) || []).length === 2);
  return fallas;
};

(async () => {
  console.log('\n1) Cola sin señal, claves, ubicación del cliente, alerta y roles (versión actual del index.html)');
  const fallas = await bateria(TEXTO, true);
  console.log('\n2) Comprobaciones en el index.html');
  const fallasEst = estatico();

  console.log('\n3) La prueba sirve: detecta errores introducidos a propósito (mutantes)');
  const cambiar = (de, a) => () => { if (!TEXTO.includes(de)) throw new Error('no encontré: ' + de.slice(0, 70)); return TEXTO.replace(de, a); };
  const mutantes = [
    ['día con la hora de Greenwich', cambiar('const d = fecha instanceof Date ? fecha : new Date(fecha);', 'const d0 = fecha instanceof Date ? fecha : new Date(fecha); const d = { getTime: () => d0.getTime(), getFullYear: () => d0.getUTCFullYear(), getMonth: () => d0.getUTCMonth(), getDate: () => d0.getUTCDate() };')],
    ['no se quita de la cola al confirmarse', cambiar('                        quitarDeColaVisitas(visita.vendedorId, id);\n', '')],
    ['se envía antes de guardarla en la cola', cambiar("const guardadaEnTelefono = guardarColaVisitas(completa.vendedorId, [...leerColaVisitas(completa.vendedorId).filter(v => v.id !== completa.id), completa]);\n            const confirmado = await enviarVisita(completa, timeoutMs);", "const promesa = enviarVisita(completa, timeoutMs);\n            const guardadaEnTelefono = guardarColaVisitas(completa.vendedorId, [...leerColaVisitas(completa.vendedorId).filter(v => v.id !== completa.id), completa]);\n            const confirmado = await promesa;")],
    ['reintento sin control de escrituras en vuelo', cambiar('if (!envio) {', 'if (true) {')],
    ['id nuevo en cada intento', cambiar("doc(db, getCollectionPath('visitas'), id)", "doc(db, getCollectionPath('visitas'), id + Math.random())")],
    ['quitar de la cola borra todas', cambiar('const resto = lista.filter(v => v.id !== id);', 'const resto = [];')],
    ['cola dañada lanza error', cambiar("} catch (e) { return []; }", "} catch (e) { throw e; }")],
    ['el id viaja dentro del documento', cambiar('const { id, ...datos } = visita;', 'const { id } = visita; const datos = visita;')],
    ['vendedorId como número', cambiar('vendedorId: String(visita.vendedorId) };', 'vendedorId: visita.vendedorId };')],
    ['visita de pedido sin precisión', cambiar('precision: Number.isFinite(precision) ? Math.round(precision) : null', 'precision: null')],
    ['escape incompleto', cambiar(".replace(/'/g, '&#39;')", '')],
    ['umbral de 500 m en vez de 50', cambiar('const UMBRAL_LEJOS_METROS = 50;', 'const UMBRAL_LEJOS_METROS = 500;')],
    ['alerta sin descontar el margen del GPS', cambiar('metros > UMBRAL_LEJOS_METROS + margen ?', 'metros > UMBRAL_LEJOS_METROS ?')],
    ['alerta con >= en el borde de 50 m', cambiar('metros > UMBRAL_LEJOS_METROS + margen ?', 'metros >= UMBRAL_LEJOS_METROS + margen ?')],
    ['el margen del GPS no tiene tope', cambiar('Math.min(Number.isFinite(visita.ubicacion.precision) ? visita.ubicacion.precision : 0, PRECISION_MAXIMA_REFERENCIA)', 'Number.isFinite(visita.ubicacion.precision) ? visita.ubicacion.precision : 0')],
    ['la visita que fijó la ubicación se alerta a sí misma', cambiar("if (ref.visitaId && ref.visitaId === visita.id) return { estado: 'es-referencia' };", '')],
    ['la ubicación del cliente se pisa en cada visita', cambiar('if (existente.exists()) return false;', '')],
    ['ubicación del cliente con GPS malo', cambiar('if (Number.isFinite(u.precision) && u.precision > PRECISION_MAXIMA_REFERENCIA) return false;', '')],
    ['GPS de justo 100 m rechazado (>= en vez de >)', cambiar('u.precision > PRECISION_MAXIMA_REFERENCIA', 'u.precision >= PRECISION_MAXIMA_REFERENCIA')],
    ['un pedido fija la ubicación del cliente', cambiar("if (visita.origen === 'pedido') return false;\n", '')],
    ['clave de cartera sin normalizar', cambiar('const n = normalizeId(id);\n                if (n) return n;', 'return id;')],
    ['nombre con tildes sin limpiar', cambiar(".normalize('NFD').replace(MARCAS_DIACRITICAS, '')", '')],
    ['la clave de cliente nuevo no lleva al vendedor', cambiar("return 'N-' + (vend ? vend + '-' : '') + cuerpo;", "return 'N-' + cuerpo;")],
    ['nombres largos cortados sin resumen', cambiar("slug.length > 48 ? slug.slice(0, 48) + '-' + resumenCorto(slug) : slug", 'slug.slice(0, 48)')],
    ['clave N- con barras', cambiar("id.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 120)", 'id')],
    ['distancia con el radio mal', cambiar('2 * 6371000 *', '2 * 6371 *')],
    ['la visita de pedido sin la marca de cliente nuevo', cambiar('            clienteNuevo: false,\n', '')],
    ['reenvío sin merge', cambiar(", { merge: true })", ')')],
    ['confirma sin esperar al servidor', cambiar('if (!(timeoutMs > 0)) return envio;', 'if (!(timeoutMs > 0)) return envio;\n            return Promise.resolve(true);')],
    ['no avisa que falló el almacenamiento', cambiar('} catch (e) { guardada = false; }', '} catch (e) { }')],
    ['sin aviso de cambio de la cola', cambiar('try { window.dispatchEvent(new Event(EVENTO_COLA_VISITAS)); } catch (e) {}', '')],
    ['solo se reintenta la cola de un vendedor', cambiar('vendedoresConColaVisitas().forEach(reintentarColaVisitas);', '')],
    ['la ubicación sin longitud cuenta como válida', cambiar('Number.isFinite(u.lat) && Number.isFinite(u.lng)', 'Number.isFinite(u.lat)')],
    ['el gerente ve todo', cambiar("if (currentUser.rol === 'admin') return true;\n            const yo", 'return true;\n            const yo')],
    ['el gerente no ve a los de sus gerentes', cambiar("return lista.some(u => u.rol === 'gerente' && normalizeId(u.supervisor) === yo && normalizeId(u.id) === jefe);", 'return false;')],
    ['restar días suma', cambiar('Number(m[3]) - n)', 'Number(m[3]) + n)')],
    ['visita mal formada deja la ubicación inválida', cambiar('ubicacion: puntoValido(u) ? {', 'ubicacion: u ? {')],
    ['visita mal formada sin textos', cambiar('vendedorNombre: txt(base.vendedorNombre),', '')],
    ['validar sin decir quién', cambiar('por: String(usuario.id), ', '')],
    ['GPS sin tiempo de espera propio', cambiar('temporizador = setTimeout(', 'temporizador = null && setTimeout(')],
    ['el GPS no se reintenta', cambiar('if (!err || (err.code !== 2 && err.code !== 3)) throw err;', 'throw err;')],
    ['el GPS se reintenta aunque el permiso esté denegado', cambiar('if (!err || (err.code !== 2 && err.code !== 3)) throw err;', 'if (!err) throw err;')],
    ['GPS sin código de error de permiso', cambiar('err => fin(reject, err),', 'err => fin(reject, new Error("x")),')]
  ];
  let detectados = 0;
  let noAplicables = 0;
  for (const [nombre, hacer] of mutantes) {
    let codigo;
    try { codigo = hacer(); } catch (e) {
      noAplicables++;
      console.log(`  FALLA mutante "${nombre}" NO SE PUDO APLICAR (el código cambió): ${e.message}`);
      continue;
    }
    let f;
    try {
      f = await Promise.race([bateria(codigo, false), new Promise((_, rej) => setTimeout(() => rej(new Error('tope de tiempo de 60 s')), 60000))]);
    } catch (e) { f = ['la batería falló: ' + e.message]; }
    f = f.filter(n => !fallas.includes(n)); // lo que la base ya falla no prueba nada
    const ok = f.length > 0;
    if (ok) detectados++;
    console.log(`  ${ok ? 'ok   ' : 'FALLA'} mutante "${nombre}" ${ok ? 'detectado por: ' + f[0] : 'NO detectado'}`);
  }

  const total = fallas.length + fallasEst.length + (mutantes.length - detectados - noAplicables) + noAplicables;
  console.log(`\n${total === 0 ? 'Todo bien' : 'HAY FALLAS'}: ${fallas.length} fallas de la cola y las reglas, ${fallasEst.length} del index.html, ${detectados}/${mutantes.length} mutantes detectados` + (noAplicables ? `, ${noAplicables} no aplicables` : '') + '.');
  try { fs.unlinkSync(SALIDA); } catch (e) {}
  process.exit(total === 0 ? 0 : 1);
})();
