const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(__dirname,'upstream.json'),'utf8'));
const seed = JSON.parse(fs.readFileSync(path.join(__dirname,'upstream-seed.json'),'utf8'));
const providerNames = ['AnimeBlkom','Anime4Up','WitAnime','Anime3rb'];
const allowed = new Set(['plugin','manga-provider','onlinestream-provider','anime-torrent-provider','custom-source']);

async function getUpstream() {
  if (process.env.OFFLINE === '1') return seed;
  try {
    const r = await fetch(config.primary, { headers: {'User-Agent':'Seanime-Arabic-Marketplace-Builder/1.0'} });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (!Array.isArray(data)) throw new Error('Upstream is not an array');
    fs.writeFileSync(path.join(__dirname,'upstream-latest.json'), JSON.stringify(data,null,2)+'\n');
    return data;
  } catch (e) {
    console.warn(`Upstream fetch failed (${String(e)}); using checked-in seed.`);
    return seed;
  }
}

function ownEntries() {
  return providerNames.map((name) => JSON.parse(fs.readFileSync(path.join(root,`src/online-streaming/${name}/manifest.json`),'utf8')));
}

(async () => {
  const upstream = await getUpstream();
  const external = upstream.filter((x) => x && allowed.has(x.type) && x.deprecatedTag !== true && x.brokenTag !== true && x.workingTag !== false);
  if (!external.some((x) => x.id === 'al-3asq')) external.push(seed.find((x)=>x.id==='al-3asq'));
  const merged = [...external, ...ownEntries()].filter(Boolean);
  const byId = new Map();
  for (const item of merged) {
    if (!item.id || !item.name || !item.type || !item.manifestURI) continue;
    byId.set(item.id, item);
  }
  const order = {'plugin':0,'manga-provider':1,'onlinestream-provider':2,'anime-torrent-provider':3,'custom-source':4};
  const output = [...byId.values()].sort((a,b) => (order[a.type]??99)-(order[b.type]??99) || (a.lang==='ar'?-1:0)-(b.lang==='ar'?-1:0) || a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(__dirname,'marketplace.json'), JSON.stringify(output,null,2)+'\n');
  const counts = output.reduce((acc,x)=>(acc[x.type]=(acc[x.type]||0)+1,acc),{});
  console.log(`Marketplace: ${output.length} entries`, counts);
})();
