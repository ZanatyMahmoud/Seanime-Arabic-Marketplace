const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const owner = process.argv[2] || 'ZanatyMahmoud';
const repo = process.argv[3] || 'Seanime-Arabic-Marketplace';
const targets = [
  ...['AnimeBlkom','Anime4Up','WitAnime','Anime3rb'].map(n => path.join(root,`src/online-streaming/${n}/manifest.json`)),
];
for (const file of targets) {
  let text = fs.readFileSync(file,'utf8');
  text = text.replaceAll('__GITHUB_OWNER__', owner).replaceAll('__GITHUB_REPO__', repo);
  text = text.replace(/raw\.githubusercontent\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/main\/src\/online-streaming/g, `raw.githubusercontent.com/${owner}/${repo}/main/src/online-streaming`);
  text = text.replace(/raw\.githubusercontent\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/main\/dist/g, `raw.githubusercontent.com/${owner}/${repo}/main/dist`);
  fs.writeFileSync(file,text);
}
console.log(`Configured repository URLs for ${owner}/${repo}`);
