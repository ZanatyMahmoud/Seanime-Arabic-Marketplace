# Seanime Arabic Enhanced Marketplace

Marketplace مخصص لـ **Seanime** يجمع إضافات المجتمع مع إضافات عربية يجري تطويرها واختبارها هنا.

> **Repository target:** `https://github.com/ZanatyMahmoud/Seanime-Arabic-Marketplace`  
> **Marketplace URL after publishing:** `https://raw.githubusercontent.com/ZanatyMahmoud/Seanime-Arabic-Marketplace/main/marketplace/marketplace.json`

**Important:** the repository URL above is the configured publication target. It does not become usable until the GitHub repository actually exists and these files are pushed to `main`.

## Install in Seanime

1. Open **Seanime**.
2. Go to **Extensions → Marketplace → Change Repository**.
3. Paste:
   `https://raw.githubusercontent.com/ZanatyMahmoud/Seanime-Arabic-Marketplace/main/marketplace/marketplace.json`
4. **Save**.
5. **Refresh** the Marketplace.

## Categories

- Plugins
- Manga Providers
- Online Streaming Providers
- Anime Torrent Providers
- Custom Sources

The checked-in offline fallback currently contains **40 entries**: 11 plugins, 9 manga providers, 10 online streaming providers, 7 anime torrent providers, and 3 custom sources. On a networked machine, `npm run marketplace` downloads the current community marketplace, removes duplicates/deprecated/broken/non-working entries when those status flags are present, preserves upstream metadata, then merges our Arabic providers and 3asq.

## Arabic streaming provider status

| Provider | Search | Episodes | Streaming | Version | workingTag |
|---|---|---|---|---|---|
| AnimeBlkom | Unverified — external validator gets HTTP 403 | Unverified | Unverified | 0.1.0 | false |
| Anime4Up | Unverified — Cloudflare verification encountered during live browser test | Unverified | Unverified | 0.1.0 | false |
| WitAnime | Unverified — external validator gets HTTP 403 | Unverified | Unverified | 0.1.0 | false |
| Anime3rb | Unverified — homepage reachable, automated search bot-blocked | Unverified | Unverified | 0.1.0 | false |

`workingTag` is intentionally **false** until search → episode list → playable MP4/M3U8 succeeds. See [`TEST_REPORT.md`](TEST_REPORT.md).

## Provider implementation notes

The current Seanime online-stream contract used by this project includes:

- `getSettings()`
- `getEpisodeServers()`
- `search(query)`
- `findEpisodes(id)`
- `findEpisodeServer(episode, server)`

The providers use only runtime-safe APIs such as `fetch()` and `LoadDoc()`. They do not depend on axios, Puppeteer, Playwright or jsdom inside Seanime. The build concatenates shared helpers and each provider into a self-contained TypeScript payload under `dist/<Provider>/provider.ts`.

Implemented host/extraction support includes direct MP4/HLS parsing plus best-effort handlers for VidYard, OK.ru, MP4Upload, SoraPlay/YonaPlay and generic `<source>` / exposed media URLs. One failed mirror does not abort the entire server search.

## Dynamic domains

Each Arabic provider exposes `userConfig.baseUrl`. This is required because these sites change domains frequently. Fallback-domain metadata is retained in each manifest, but the code does not silently route through obsolete domains.

## Build and validation

```bash
npm ci
npm run build
npm run typecheck
npm run marketplace
npm run validate
npm run health
```

To target a different GitHub account/repository before publishing:

```bash
node scripts/configure-repo.js <GITHUB_OWNER> <REPOSITORY_NAME>
npm run marketplace
npm run build
npm run test
```

## Marketplace source policy

The Bas1874 Community Marketplace README states that its `/Marketplace` JSON may be consumed by Seanime but must remain hosted in that repository; this project therefore does **not** clone/re-host that JSON wholesale. The builder uses the current Seanime community marketplace replacement source and preserves original `manifestURI`/`payloadURI` values so third-party extension code remains hosted by its original authors.

## Security / access-control policy

No provider in this repository attempts to defeat CAPTCHA, Turnstile, DRM, authentication or other access controls. When a site requires such a mechanism, the provider remains unverified/broken until a normal public endpoint is available.

## License

Project-owned code is MIT licensed. Third-party extensions remain under their original repositories and licenses; this marketplace normally references them by manifest URL rather than copying their code.
