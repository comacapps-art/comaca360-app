const fs = require('fs');

function patchFile(path) {
  let content = fs.readFileSync(path, 'utf8');
  let originalLength = content.length;
  
  // Patch: let t=new Date(e.fecha) -> let t=new Date(typeof e.fecha==='string'?e.fecha.replace(/-/g,'/'):e.fecha)
  content = content.replace(/new Date\(([a-zA-Z0-9_]+)\.fecha\)/g, "new Date(typeof $1.fecha==='string'?$1.fecha.replace(/-/g,'/'):$1.fecha)");
  
  // Patch: new Date(c+`T00:00:00`) -> new Date((c).replace(/-/g,'/')+' 00:00:00')
  content = content.replace(/new Date\(([a-zA-Z0-9_]+)\+\`T00:00:00\`\)/g, "new Date(($1).replace(/-/g,'/')+' 00:00:00')");
  
  // Patch: new Date(u+`T23:59:59`) -> new Date((u).replace(/-/g,'/')+' 23:59:59')
  content = content.replace(/new Date\(([a-zA-Z0-9_]+)\+\`T23:59:59\`\)/g, "new Date(($1).replace(/-/g,'/')+' 23:59:59')");
  
  // Also patch the new Date(e) where it's used with toLocaleDateString, to prevent the timezone shift bug in Safari
  // We don't want to blindly replace all new Date(e), only where it might be a date string.
  // We'll leave new Date(e) since it is already caught by the isNaN check, but to LocaleDateString might shift by a day.
  // Actually, replacing just the above 3 fixes the "app not opening / filtering out everything" bug.
  
  fs.writeFileSync(path, content, 'utf8');
  console.log(path + ' length changed from ' + originalLength + ' to ' + content.length);
}

patchFile('index-CTLUqjn3.js');
patchFile('index-BoS0Ai79.js');
