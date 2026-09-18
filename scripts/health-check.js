const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname,'..');
const providers = ['AnimeBlkom','Anime4Up','WitAnime','Anime3rb'];

async function probe(url, timeout=12000) {
  const c = new AbortController();
  const t = setTimeout(()=>c.abort(), timeout);
  try {
    const r = await fetch(url,{method:'GET',headers:{'User-Agent':'Mozilla/5.0 Seanime-Arabic-Marketplace-Health/1.0','Range':'bytes=0-2047'},signal:c.signal,redirect:'follow'});
    return {ok:r.ok,status:r.status,finalUrl:r.url};
  } catch(e) { return {ok:false,status:0,error:String(e)}; }
  finally { clearTimeout(t); }
}

(async()=>{
  let failures=0;
  for (const name of providers) {
    const m=JSON.parse(fs.readFileSync(path.join(root,`src/online-streaming/${name}/manifest.json`),'utf8'));
    const base=m.userConfig?.fields?.find((x)=>x.name==='baseUrl')?.default;
    const [site,manifest,payload]=await Promise.all([probe(base),probe(m.manifestURI),probe(m.payloadURI)]);
    const state = site.ok && manifest.ok && payload.ok ? 'OK' : site.ok ? 'WARNING' : 'BROKEN';
    if (state==='BROKEN') failures++;
    console.log(`${name.padEnd(14)} ${state.padEnd(8)} site=${site.status||'ERR'} manifest=${manifest.status||'ERR'} payload=${payload.status||'ERR'}`);
  }
  process.exitCode = failures ? 2 : 0;
})();
