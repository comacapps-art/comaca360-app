// Compila index.html (JSX + Babel en el navegador) -> PARA SUBIR/index.html (JSX precompilado).
//
// Por qué: en la raíz el JSX se compila en el propio teléfono con @babel/standalone en cada
// carga. Son ~380 KB de JSX que Safari en iPhone tiene que transformar antes de pintar nada.
// Precompilando aquí, la versión de PARA SUBIR arranca sin Babel y sin ese trabajo.
//
// Uso:  node build.js
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const SRC = 'index.html';
const OUT = path.join('PARA SUBIR', 'index.html');

const SCRIPT_RE = /([ \t]*)<script type="text\/babel" data-type="module" data-presets="react">([\s\S]*?)<\/script>/;
// La etiqueta de Babel sobra en el build: ya no hay nada que compilar en el navegador.
// El archivo usa saltos CRLF, de ahí los \r? en el patrón.
// Se lleva también la línea en blanco que queda detrás, para no dejar huecos.
const BABEL_TAG_RE = /[ \t]*<!--[^\r\n]*-->\r?\n[ \t]*<script src="https:\/\/unpkg\.com\/@babel\/standalone\/babel\.min\.js"><\/script>\r?\n\r?\n/;

const html = fs.readFileSync(SRC, 'utf-8');

const match = html.match(SCRIPT_RE);
if (!match) {
    console.error('ERROR: no se encontró el bloque <script type="text/babel"> en ' + SRC);
    process.exit(1);
}

const [fullBlock, indent, jsx] = match;

let compiled;
try {
    compiled = babel.transformSync(jsx, {
        // runtime clásico -> React.createElement, igual que el build original.
        // Con el runtime automático saldrían _jsx() y cambiaría todo el archivo.
        presets: [['@babel/preset-react', { runtime: 'classic' }]],
        filename: 'index.jsx',
        compact: false,
        comments: false,
        retainLines: false
    }).code;
} catch (e) {
    console.error('ERROR de sintaxis en el JSX — no se generó nada:\n');
    console.error(e.message);
    process.exit(1);
}

// OJO: el reemplazo va como función a propósito. Si se pasa como string, replace()
// interpreta $$, $&, $` y $' dentro del código compilado y destroza el archivo
// (los `$${...}` de los precios pierden el dólar y los '$' se expanden al resto del HTML).
const replacement = indent + '<script type="module">\n' + compiled + '\n' + indent + '</script>';
let out = html.replace(fullBlock, () => replacement);

if (BABEL_TAG_RE.test(out)) {
    out = out.replace(BABEL_TAG_RE, '');
} else {
    console.warn('AVISO: no se pudo quitar la etiqueta de @babel/standalone; revísala a mano.');
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, 'utf-8');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log('OK  ' + SRC + ' (' + kb(html.length) + ')  ->  ' + OUT + ' (' + kb(out.length) + ')');
console.log('    ' + (out.match(/React\.createElement/g) || []).length + ' React.createElement generados');
