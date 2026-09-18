const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname,'..');
const providers = ['AnimeBlkom','Anime4Up','WitAnime','Anime3rb'];
const requiredMethods = ['getSettings','getEpisodeServers','search','findEpisodes','findEpisodeServer'];
const forbidden = [/\baxios\b/i,/\bpuppeteer\b/i,/\bplaywright\b/i,/\bjsdom\b/i,/\brequire\s*\(/,/\bimport\s+.+from\b/];
let bad=false;
for (const name of providers) {
  const text = fs.readFileSync(path.join(root,`dist/${name}/provider.ts`),'utf8');
  for (const method of requiredMethods) if (!new RegExp(`\\b${method}\\s*\\(`).test(text)) { console.error(`${name}: missing ${method}`); bad=true; }
  for (const re of forbidden) if (re.test(text)) { console.error(`${name}: forbidden runtime dependency/pattern ${re}`); bad=true; }
  if (!/class\s+Provider\b/.test(text)) { console.error(`${name}: class Provider missing`); bad=true; }
  console.log(`STATIC AUDIT OK: ${name}`);
}
if (bad) process.exit(1);
