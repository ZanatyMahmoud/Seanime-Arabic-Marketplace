# Test Report — 2026-09-18

## Local validation

| Check | Result |
|---|---|
| Bundle build | PASS — AnimeBlkom, Anime4Up, WitAnime, Anime3rb |
| TypeScript strict compile | PASS — all four providers |
| Manifest validation | PASS |
| Marketplace validation | PASS |
| Duplicate ID check | PASS |
| Forbidden runtime dependency audit | PASS |
| Required provider methods | PASS (`getSettings`, `getEpisodeServers`, `search`, `findEpisodes`, `findEpisodeServer`) |

## Published repository validation

- Public repository: PASS
- Raw marketplace JSON: PASS
- Raw payloads for AnimeBlkom, Anime4Up, WitAnime and Anime3rb: PASS
- GitHub Actions build/typecheck/marketplace/validate: PASS

## Live provider validation

The four Arabic providers remain `workingTag=false`. A provider is not promoted to working until a live test verifies search, episode enumeration, and a playable MP4/M3U8 URL.

| Provider | Site / access | Search | Episodes | Stream | Version |
|---|---|---:|---:|---:|---|
| AnimeBlkom | HTTP 403 from external validator on known domains | UNVERIFIED | UNVERIFIED | UNVERIFIED | 0.1.0 |
| Anime4Up | Homepage reachable; interactive validation encountered Cloudflare verification and was cancelled rather than solving it | UNVERIFIED | UNVERIFIED | UNVERIFIED | 0.1.0 |
| WitAnime | HTTP 403 from external validator | UNVERIFIED | UNVERIFIED | UNVERIFIED | 0.1.0 |
| Anime3rb | Homepage reachable; automated search fetch was bot-blocked | UNVERIFIED | UNVERIFIED | UNVERIFIED | 0.1.0 |

No CAPTCHA, Turnstile, DRM, login, or anti-bot challenge was bypassed. No video was downloaded.

## Runtime limitations

The local build environment has no outbound DNS, so HTTP validation cannot be performed from the Node test runner. `scripts/health-check.js` is included for GitHub Actions / normal networked environments and performs lightweight GET probes only.
