const fs = require('fs');
const babel = require('@babel/core');

try {
    const html = fs.readFileSync('index.html', 'utf-8');
    const match = html.match(/<script type="text\/babel" data-type="module" data-presets="react">([\s\S]*?)<\/script>/);
    if (!match) {
        console.log("No script block found.");
        process.exit(1);
    }
    const code = match[1];
    babel.transformSync(code, {
        presets: ['@babel/preset-react'],
        filename: 'index.jsx'
    });
    console.log("No syntax errors found!");
} catch (e) {
    console.error("Syntax Error found:");
    console.error(e.message);
}
