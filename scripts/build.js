const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const providers = ['AnimeBlkom', 'Anime4Up', 'WitAnime', 'Anime3rb'];
const shared = fs.readFileSync(path.join(root, 'src/shared/runtime.ts'), 'utf8');
for (const name of providers) {
  const source = fs.readFileSync(path.join(root, `src/online-streaming/${name}/provider.ts`), 'utf8');
  const outDir = path.join(root, `dist/${name}`);
  fs.mkdirSync(outDir, { recursive: true });
  const bundled = `/// <reference path="../../types/onlinestream-provider.d.ts" />
/// <reference path="../../types/core.d.ts" />

${shared}

${source}
`;
  fs.writeFileSync(path.join(outDir, 'provider.ts'), bundled);
  console.log(`Built ${name}: ${bundled.length} bytes`);
}
