const fs = require('fs');

function fixPatch(path) {
  let content = fs.readFileSync(path, 'utf8');
  let originalLength = content.length;
  
  // Replace the faulty patch with the safe one
  content = content.replace(/new Date\(\(([a-zA-Z0-9_]+)\)\.replace\(\/-\/g,'\/'\)\+' 00:00:00'\)/g, "new Date(String($1).replace(/-/g,'/')+' 00:00:00')");
  content = content.replace(/new Date\(\(([a-zA-Z0-9_]+)\)\.replace\(\/-\/g,'\/'\)\+' 23:59:59'\)/g, "new Date(String($1).replace(/-/g,'/')+' 23:59:59')");
  
  fs.writeFileSync(path, content, 'utf8');
  console.log(path + ' length changed from ' + originalLength + ' to ' + content.length);
}

fixPatch('index-CTLUqjn3.js');
fixPatch('index-BoS0Ai79.js');
