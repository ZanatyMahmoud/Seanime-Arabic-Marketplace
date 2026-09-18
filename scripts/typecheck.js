const { spawnSync } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
const providers = ['AnimeBlkom', 'Anime4Up', 'WitAnime', 'Anime3rb'];
let failed = false;
for (const name of providers) {
  const args = ['--noEmit','--strict','--skipLibCheck','--target','ES2020','--module','none','--lib','ES2020,DOM',
    path.join(root,'types/onlinestream-provider.d.ts'), path.join(root,'types/core.d.ts'), path.join(root,`dist/${name}/provider.ts`)];
  const result = spawnSync('tsc', args, { encoding:'utf8' });
  if (result.status !== 0) {
    failed = true;
    console.error(`TYPECHECK FAILED: ${name}\n${result.stdout}${result.stderr}`);
  } else console.log(`TYPECHECK OK: ${name}`);
}
if (failed) process.exit(1);
