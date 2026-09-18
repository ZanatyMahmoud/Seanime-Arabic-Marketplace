const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname,'..');
const providers = ['AnimeBlkom','Anime4Up','WitAnime','Anime3rb'];
const required = ['id','name','version','author','description','type','language','lang','manifestURI','payloadURI'];
let bad = false;
for (const name of providers) {
  const file = path.join(root,`src/online-streaming/${name}/manifest.json`);
  const m = JSON.parse(fs.readFileSync(file,'utf8'));
  const missing = required.filter((k)=>!m[k]);
  if (missing.length) { console.error(`${name}: missing ${missing.join(', ')}`); bad=true; }
  if (m.type !== 'onlinestream-provider') { console.error(`${name}: wrong type`); bad=true; }
  if (!/^[a-zA-Z][a-zA-Z0-9-]*[a-zA-Z0-9]$/.test(m.id) || m.id.length < 3 || m.id.length > 40) { console.error(`${name}: invalid Seanime extension id`); bad=true; }
  if (m.name.length > 50) { console.error(`${name}: extension name is too long`); bad=true; }
  if (m.author.length > 25) { console.error(`${name}: extension author is too long`); bad=true; }
  if (m.lang !== 'ar') { console.error(`${name}: lang must be ar`); bad=true; }
  if (!/^https:\/\//.test(m.manifestURI) || !/^https:\/\//.test(m.payloadURI)) { console.error(`${name}: invalid URI`); bad=true; }
  if (m.workingTag !== false) { console.error(`${name}: must remain workingTag=false until live search+episodes+stream passes`); bad=true; }
  console.log(`MANIFEST OK: ${name} ${m.version}`);
}
if (bad) process.exit(1);
