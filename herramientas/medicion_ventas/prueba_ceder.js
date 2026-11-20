'use strict';
// Prueba de la cesión del hilo al procesar archivos de ventas (cederElHilo): con la página en segundo plano el navegador
// frena requestAnimationFrame (≈ 1 cuadro por segundo, o lo pausa) y cada cesión con yieldToBrowser esperaba ese cuadro.
// Aquí se SIMULA ese freno en Node (un requestAnimationFrame falso que tarda 100 ms y cuenta cuántas veces lo llaman) y se
// comprueba que (1) la lectura del CSV ya NO depende de requestAnimationFrame (no lo llama ni una vez), (2) da exactamente las
// mismas filas que la versión anterior y (3) cederElHilo cumple lo que debe (cada llamada se resuelve, en orden, sin esperar).
// Se cuentan llamadas y no segundos para que la prueba no dependa de lo ocupada que esté la computadora; los tiempos solo se
// muestran. Corre en Node, sin navegador, sin red y con datos inventados.
//
//   node herramientas/medicion_ventas/prueba_ceder.js
//
// Compara con la copia congelada del 12-nov-2026 (baseline_12nov.js), que cede el hilo con requestAnimationFrame.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SALIDA = path.join(__dirname, 'ceder_extraido.js');
execFileSync(process.execPath, [path.join(__dirname, 'extraer.js'), '--extra', 'yieldToBrowser', '--salida', SALIDA], { stdio: 'inherit' });

let ok = 0, mal = 0;
const prueba = async (nombre, fn) => { try { await fn(); ok++; console.log('  ok    ' + nombre); } catch (e) { mal++; console.log('  FALLA ' + nombre + '\n        ' + String(e.message).split('\n').slice(0, 4).join('\n        ')); } };
let rafLlamadas = 0;
const cargar = (conDocumento, ruta) => {
  // Entorno de "navegador" simulado: con documento (usa MessageChannel) y un requestAnimationFrame frenado que cuenta llamadas.
  if (conDocumento) globalThis.document = {}; else delete globalThis.document;
  rafLlamadas = 0;
  globalThis.requestAnimationFrame = (f) => { rafLlamadas++; setTimeout(f, 100); };
  const r = ruta || SALIDA;
  delete require.cache[require.resolve(r)];
  return require(r);
};
const mide = async (fn) => { const t = process.hrtime.bigint(); const r = await fn(); return { r, ms: Number(process.hrtime.bigint() - t) / 1e6 }; };

// CSV de ventas inventado: ≈ 6 MB para que ceda ≈ 10 veces (cada 600.000 caracteres)
function csv(filas) {
  const out = ['Fecha;Mes;Id Cliente;Supervisor;Cliente;Grupo;Tipo Cli.;Id Vendedor;Vendedor;Tipo Doc.;Numero;Id Articulo;Subgrupo;Articulo;Linea;Cajas;Unidades;Kgs/Lts;Monto;Impuesto;Total'];
  for (let i = 0; i < filas; i++) out.push(`${String(1 + (i % 28)).padStart(2, '0')}/11/2026;11;${String(1000 + (i % 3000)).padStart(6, '0')};SUP;CLIENTE INVENTADO ${i % 3000} C.A.;GRUPO ${i % 7};T;${String(50 + (i % 5)).padStart(3, '0')};VENDEDOR ${i % 5};FA;${900000 + i};A${i % 40};SUB ${i % 9};ARTICULO INVENTADO NUMERO ${i % 40} 24X500GR;LINEA ${i % 6};${(i % 9) + 1};${(i % 9) * 12 + 12};${(i % 9) * 3 + 2};${(10 + (i % 90)).toFixed(2).replace('.', ',')};0;${(10 + (i % 90)).toFixed(2).replace('.', ',')}`);
  return out.join('\r\n');
}
const flujo = (texto) => { const b = Buffer.from(texto, 'utf8'); let pos = 0; return new ReadableStream({ pull(c) { if (pos >= b.length) { c.close(); return; } const n = Math.min(65536, b.length - pos); c.enqueue(new Uint8Array(b.subarray(pos, pos + n))); pos += n; } }); };
const TEXTO = csv(40000);
const MB = Buffer.byteLength(TEXTO) / 1048576;
const leer = (m) => m.streamCsvSalesRows({ body: flujo(TEXTO) }, { type: 'currMonth', url: 'x' }, () => false, null);
const ser = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' && (!Number.isFinite(x) || Object.is(x, -0))) ? '#' + (Object.is(x, -0) ? '-0' : String(x)) : x);

(async () => {
  console.log(`\n1) cederElHilo, con documento (como en el navegador, vía MessageChannel)`);
  await prueba('5.000 cesiones seguidas se resuelven sin llamar nunca a requestAnimationFrame', async () => {
    const m = cargar(true);
    for (let i = 0; i < 5000; i++) await m.cederElHilo();
    assert.strictEqual(rafLlamadas, 0);
  });
  await prueba('varias llamadas a la vez se resuelven todas, en el orden en que se pidieron', async () => {
    const m = cargar(true);
    const orden = []; await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(i => m.cederElHilo().then(() => orden.push(i))));
    assert.deepStrictEqual(orden, [0, 1, 2, 3, 4, 5, 6, 7]);
  });
  await prueba('de verdad cede el hilo: una tarea ya programada corre antes de que termine la cesión', async () => {
    const m = cargar(true);
    let corrio = false; setTimeout(() => { corrio = true; }, 0);
    await new Promise(r => setTimeout(r, 5)); // deja que el temporizador de 0 ms venza
    await m.cederElHilo();
    assert.ok(corrio, 'la tarea programada no llegó a correr');
  });
  await prueba('yieldToBrowser (el de antes) SÍ llama a requestAnimationFrame (así se comprueba que la simulación vale)', async () => {
    const m = cargar(true);
    for (let i = 0; i < 3; i++) await m.yieldToBrowser();
    assert.strictEqual(rafLlamadas, 3);
  });

  console.log(`\n2) Sin documento (Node, pruebas): usa setTimeout y no llama a requestAnimationFrame`);
  await prueba('cederElHilo se resuelve sin documento', async () => {
    const m = cargar(false); await m.cederElHilo(); await m.cederElHilo();
    assert.strictEqual(rafLlamadas, 0);
  });

  console.log(`\n3) Lectura del CSV de ${MB.toFixed(1)} MB con requestAnimationFrame frenado (100 ms por cuadro)`);
  const base = require('./baseline_12nov.js');
  let filasAntes = null;
  await prueba('la versión anterior llama a requestAnimationFrame en cada cesión (y se frena)', async () => {
    cargar(true); // el baseline también lee requestAnimationFrame del entorno global
    const { r, ms } = await mide(() => base.streamCsvSalesRows({ body: flujo(TEXTO) }, { type: 'currMonth', url: 'x' }, () => false, null));
    filasAntes = r;
    console.log(`        antes: ${(ms / 1000).toFixed(2)} s para ${r.length} filas, ${rafLlamadas} esperas de cuadro`);
    assert.ok(rafLlamadas >= 5, 'solo llamó ' + rafLlamadas + ' veces a requestAnimationFrame');
  });
  await prueba('la versión nueva NO espera ningún cuadro y da EXACTAMENTE las mismas filas', async () => {
    const m = cargar(true);
    const { r, ms } = await mide(() => leer(m));
    console.log(`        ahora: ${(ms / 1000).toFixed(2)} s para ${r.length} filas, ${rafLlamadas} esperas de cuadro`);
    assert.strictEqual(rafLlamadas, 0, 'esperó ' + rafLlamadas + ' cuadros');
    assert.strictEqual(r.length, filasAntes.length);
    for (let i = 0; i < r.length; i++) if (ser(r[i]) !== ser(filasAntes[i])) throw new Error('la fila ' + i + ' difiere');
  });

  console.log(`\n4) La prueba sirve: detecta errores introducidos a propósito (mutantes)`);
  const texto = fs.readFileSync(SALIDA, 'utf8');
  const mutantes = [
    ['la lectura del CSV vuelve a ceder con requestAnimationFrame', 'await cederElHilo(); }', 'await yieldToBrowser(); }'],
    ['cederElHilo espera al siguiente cuadro de pantalla', 'return () => new Promise((resolve) => { esperando.push(resolve); canal.port2.postMessage(0); });', 'return () => new Promise((resolve) => { requestAnimationFrame(() => resolve()); });'],
    ['cederElHilo no avisa al navegador (la lectura se quedaría esperando)', 'canal.port2.postMessage(0); });', '/* sin aviso */ });'],
  ];
  for (let i = 0; i < mutantes.length; i++) {
    const [nombre, de, a] = mutantes[i];
    await prueba('detecta el error: ' + nombre, async () => {
      const deEol = texto.includes(de) ? de : de.split('\n').join('\r\n');
      assert.ok(texto.includes(deEol), 'no encontré en el código el trozo que se iba a estropear: ' + de.slice(0, 60));
      const ruta = path.join(__dirname, `ceder_mutante_${i}.js`);
      fs.writeFileSync(ruta, texto.replace(deEol, () => a));
      let detectado = false;
      try {
        const m = cargar(true, ruta);
        // Con un mutante que no avisa la lectura nunca termina: se corta a los 3 s y eso cuenta como detectado.
        const resultado = await Promise.race([leer(m).then(() => 'termino'), new Promise(r => setTimeout(() => r('colgado'), 3000))]);
        detectado = resultado === 'colgado' || rafLlamadas > 0;
      } finally { try { fs.unlinkSync(ruta); } catch (e) { /* ya no está */ } }
      assert.ok(detectado, 'la prueba NO detectó este error: no protege de él');
    });
  }

  console.log(`\n${ok} pruebas bien, ${mal} con falla`);
  try { fs.unlinkSync(SALIDA); } catch (e) { /* ya no está */ }
  process.exit(mal === 0 ? 0 : 1);
})();
