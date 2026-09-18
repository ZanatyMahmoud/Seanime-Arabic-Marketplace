const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname,'../marketplace/marketplace.json');
const data = JSON.parse(fs.readFileSync(file,'utf8'));
const allowed = new Set(['plugin','manga-provider','onlinestream-provider','anime-torrent-provider','custom-source']);
if (!Array.isArray(data)) throw new Error('marketplace.json must be an array');
const ids = new Set();
let bad = false;
for (const x of data) {
  for (const k of ['id','name','type','language','lang','manifestURI']) {
    if (!x[k]) { console.error(`${x.id || '<unknown>'}: missing ${k}`); bad=true; }
  }
  if (ids.has(x.id)) { console.error(`duplicate id: ${x.id}`); bad=true; }
  ids.add(x.id);
  if (!allowed.has(x.type)) { console.error(`${x.id}: unsupported type ${x.type}`); bad=true; }
  if (x.deprecatedTag === true || x.brokenTag === true || x.workingTag === false && !String(x.id).startsWith('arabic-')) {
    console.error(`${x.id}: filtered status leaked into marketplace`); bad=true;
  }
}
for (const id of ['arabic-animeblkom','arabic-anime4up','arabic-witanime','arabic-anime3rb','al-3asq']) {
  if (!ids.has(id)) { console.error(`required extension missing: ${id}`); bad=true; }
}
const counts = data.reduce((a,x)=>(a[x.type]=(a[x.type]||0)+1,a),{});
console.log(`MARKETPLACE OK: ${data.length} entries`, counts);
if (bad) process.exit(1);
