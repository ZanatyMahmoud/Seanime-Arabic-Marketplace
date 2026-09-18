/// <reference path="../../types/onlinestream-provider.d.ts" />
/// <reference path="../../types/core.d.ts" />

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

type ExtractContext = { referer?: string; origin?: string; quality?: string };
type HostServer = { name: string; url: string; quality?: string };

function cleanBaseUrl(configured: string, fallback: string): string {
  const value = configured && !configured.includes("{{") ? configured : fallback;
  return value.replace(/\/+$/, "");
}

function standardHeaders(referer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.8,en;q=0.7",
  };
  if (referer) headers.Referer = referer;
  return headers;
}

async function fetchText(url: string, referer?: string): Promise<string> {
  const response = await fetch(url, { method: "GET", headers: standardHeaders(referer) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.text();
}

function absoluteUrl(base: string, value: string): string {
  const input = (value || "").trim();
  if (!input) return "";
  if (/^https?:\/\//i.test(input)) return input.replace(/^http:\/\//i, "https://");
  if (input.startsWith("//")) return `https:${input}`;
  if (input.startsWith("/")) return `${base.replace(/\/+$/, "")}${input}`;
  return `${base.replace(/\/+$/, "")}/${input.replace(/^\/+/, "")}`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTitle(value: string): string {
  return normalizeWhitespace(
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[’'"\`~!@#$%^&*()_+={}\[\]|\\:;,.<>/?،؛؟]/g, " ")
      .replace(/\b(?:season|part|cour)\b/gi, " ")
      .replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, "$1")
  );
}

function seasonToken(value: string): number | null {
  const explicit = value.match(/\bseason\s*(\d+)\b/i) || value.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i);
  if (explicit) return Number(explicit[1]);
  return null;
}

function similarity(a: string, b: string): number {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.86;
  const aWords = new Set(left.split(" ").filter(Boolean));
  const bWords = new Set(right.split(" ").filter(Boolean));
  let common = 0;
  aWords.forEach((word) => { if (bWords.has(word)) common += 1; });
  const union = new Set([...Array.from(aWords), ...Array.from(bWords)]).size || 1;
  return common / union;
}

function buildCandidateQueries(opts: SearchOptions, max = 4): string[] {
  const raw = [
    opts.query,
    opts.media?.englishTitle || "",
    opts.media?.romajiTitle || "",
    ...(opts.media?.synonyms || []),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const trimmed = normalizeWhitespace(item || "");
    const key = normalizeTitle(trimmed);
    if (!trimmed || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function rankResults(results: SearchResult[], opts: SearchOptions, max = 12): SearchResult[] {
  const candidates = buildCandidateQueries(opts, 6);
  const requestedSeason = seasonToken(opts.query) ?? seasonToken(opts.media?.englishTitle || "") ?? seasonToken(opts.media?.romajiTitle || "");
  const deduped = dedupeBy(results, (r) => r.id || r.url);
  return deduped
    .map((result) => {
      let score = 0;
      for (const candidate of candidates) score = Math.max(score, similarity(result.title, candidate));
      const resultSeason = seasonToken(result.title);
      if (requestedSeason !== null && resultSeason !== null && requestedSeason !== resultSeason) score -= 0.4;
      if (opts.year && result.title.includes(String(opts.year))) score += 0.05;
      return { result, score };
    })
    .sort((a, b) => b.score - a.score)
    .filter((x, index) => x.score >= 0.35 || index < 3)
    .slice(0, max)
    .map((x) => x.result);
}

function dedupeBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function decodeBase64(value: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let input = value.replace(/[^A-Za-z0-9+/=]/g, "");
  let output = "";
  let i = 0;
  while (i < input.length) {
    const e1 = chars.indexOf(input.charAt(i++));
    const e2 = chars.indexOf(input.charAt(i++));
    const e3 = chars.indexOf(input.charAt(i++));
    const e4 = chars.indexOf(input.charAt(i++));
    const c1 = (e1 << 2) | (e2 >> 4);
    const c2 = ((e2 & 15) << 4) | (e3 >> 2);
    const c3 = ((e3 & 3) << 6) | e4;
    output += String.fromCharCode(c1);
    if (e3 !== 64 && e3 !== -1) output += String.fromCharCode(c2);
    if (e4 !== 64 && e4 !== -1) output += String.fromCharCode(c3);
  }
  try { return decodeURIComponent(Array.from(output).map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")); }
  catch { return output; }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function maybeDecodeBase64(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("//") || trimmed.startsWith("/")) return trimmed;
  try {
    const decoded = decodeBase64(trimmed);
    return /^https?:\/\//i.test(decoded) || decoded.startsWith("//") || decoded.startsWith("/") ? decoded : trimmed;
  } catch { return trimmed; }
}

function extractQuotedBase64(value: string): string {
  const match = (value || "").match(/['"]([^'"]+)['"]/);
  return match ? maybeDecodeBase64(match[1]) : "";
}

function qualityFromText(value: string, fallback = "auto"): string {
  const match = (value || "").match(/(?:^|[^0-9])(2160|1440|1080|720|576|540|480|380|360|240)(?:p)?(?:[^0-9]|$)/i);
  return match ? `${match[1]}p` : fallback;
}

function videoType(url: string): VideoSourceType {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".m3u8")) return "m3u8";
  if (clean.endsWith(".mp4") || clean.includes(".mp4/")) return "mp4";
  return "unknown";
}

function source(url: string, quality = "auto", label?: string): VideoSource {
  return { url, type: videoType(url), quality, label, subtitles: [] };
}

function validMediaUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && (videoType(url) !== "unknown" || /(?:manifest|playlist|stream|video)/i.test(url));
}

async function expandHls(url: string, headers: Record<string, string>): Promise<VideoSource[]> {
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return [source(url, "auto")];
    const body = await response.text();
    if (!body.trimStart().startsWith("#EXTM3U")) return [];
    const lines = body.split(/\r?\n/);
    const variants: VideoSource[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
      const res = lines[i].match(/RESOLUTION=\d+x(\d+)/i);
      const next = (lines[i + 1] || "").trim();
      if (!next || next.startsWith("#")) continue;
      variants.push(source(absoluteUrl(url.substring(0, url.lastIndexOf("/")), next), res ? `${res[1]}p` : "auto"));
    }
    return variants.length ? variants : [source(url, "auto")];
  } catch { return [source(url, "auto")]; }
}

function directSourcesFromHtml(html: string, base: string): VideoSource[] {
  const $ = LoadDoc(html);
  const out: VideoSource[] = [];
  $("source").each((_i, el) => {
    const raw = el.attr("src") || "";
    const url = absoluteUrl(base, raw);
    if (!url) return;
    out.push(source(url, qualityFromText(el.attr("label") || el.attr("data-quality") || ""), el.attr("label") || undefined));
  });
  return dedupeBy(out, (x) => x.url);
}

async function extractVidYard(url: string, ctx: ExtractContext): Promise<VideoSource[]> {
  const id = url.split("com/").pop()?.split(/[?#]/)[0] || "";
  if (!id) return [];
  const playerUrl = `https://play.vidyard.com/player/${id}.json`;
  const body = await fetchText(playerUrl, "https://play.vidyard.com/");
  const urls = Array.from(body.matchAll(/"profile"\s*:\s*"([^"]+)"[\s\S]{0,400}?"url"\s*:\s*"([^"]+)"/g));
  return dedupeBy(urls.map((m) => source(m[2].replace(/\\\//g, "/"), qualityFromText(m[1]), `VidYard ${m[1]}`)), (x) => x.url);
}

async function extractSoraPlay(url: string, ctx: ExtractContext): Promise<VideoSource[]> {
  const html = await fetchText(url, ctx.referer || "https://yonaplay.org/");
  const out: VideoSource[] = [];
  const sourceBlock = html.match(/sources\s*:\s*\[([\s\S]*?)\]\s*[,}]/i)?.[1] || "";
  const files = Array.from(sourceBlock.matchAll(/["']?file["']?\s*:\s*["']([^"']+)["'][\s\S]{0,160}?["']?label["']?\s*:\s*["']([^"']*)["']/gi));
  for (const match of files) out.push(source(match[1].replace(/\\\//g, "/"), qualityFromText(match[2]), `SoraPlay ${match[2]}`));
  if (out.length) return dedupeBy(out, (x) => x.url);
  const $ = LoadDoc(html);
  const mirrors: string[] = [];
  $(".OD li").each((_i, el) => {
    const onclick = el.attr("onclick") || "";
    const match = onclick.match(/go_to_player\(['"]([^'"]+)['"]\)/i);
    if (match) mirrors.push(absoluteUrl(url, match[1]));
  });
  for (const mirror of mirrors.slice(0, 6)) {
    try { out.push(...await safeExtract(mirror, { referer: url })); } catch { }
  }
  return dedupeBy(out, (x) => x.url);
}

async function extractOkRu(url: string, ctx: ExtractContext): Promise<VideoSource[]> {
  const html = await fetchText(url, ctx.referer);
  const decoded = decodeHtmlEntities(html);
  const match = decoded.match(/"videos"\s*:\s*(\[[\s\S]*?\])/i);
  if (!match) return [];
  try {
    const data = JSON.parse(match[1]) as Array<Record<string, unknown>>;
    return dedupeBy(data.map((item) => {
      const mediaUrl = String(item.url || item.src || "").replace(/\\\//g, "/");
      const name = String(item.name || item.quality || "auto");
      return source(mediaUrl, qualityFromText(name), `OK.ru ${name}`);
    }).filter((x) => validMediaUrl(x.url)), (x) => x.url);
  } catch { return []; }
}

async function extractMp4Upload(url: string, ctx: ExtractContext): Promise<VideoSource[]> {
  const html = await fetchText(url, ctx.referer);
  const urls = Array.from(html.matchAll(/https?:\\?\/\\?\/[^"'\s]+?\.mp4(?:\?[^"'\s]*)?/gi))
    .map((m) => m[0].replace(/\\\//g, "/"));
  return dedupeBy(urls.map((u) => source(u, qualityFromText(u), "MP4Upload")), (x) => x.url);
}

async function extractGenericMedia(url: string, ctx: ExtractContext): Promise<VideoSource[]> {
  const html = await fetchText(url, ctx.referer);
  const base = url.substring(0, url.lastIndexOf("/"));
  const fromTags = directSourcesFromHtml(html, base);
  const regexUrls = Array.from(html.matchAll(/https?:\\?\/\\?\/[^"'\s]+?(?:\.m3u8|\.mp4)(?:\?[^"'\s]*)?/gi))
    .map((m) => m[0].replace(/\\\//g, "/"));
  return dedupeBy([...fromTags, ...regexUrls.map((u) => source(u, qualityFromText(u), "mirror"))], (x) => x.url);
}

async function safeExtract(url: string, ctx: ExtractContext = {}): Promise<VideoSource[]> {
  const clean = absoluteUrl(ctx.referer || url, url);
  if (!clean) return [];
  if (videoType(clean) === "mp4") return [source(clean, ctx.quality || qualityFromText(clean))];
  if (videoType(clean) === "m3u8") return await expandHls(clean, standardHeaders(ctx.referer));
  try {
    if (/vidyard/i.test(clean)) return await extractVidYard(clean, ctx);
    if (/ok\.ru/i.test(clean)) return await extractOkRu(clean, ctx);
    if (/mp4upload/i.test(clean)) return await extractMp4Upload(clean, ctx);
    if (/soraplay|yonaplay/i.test(clean)) return await extractSoraPlay(clean, ctx);
    return await extractGenericMedia(clean, ctx);
  } catch (error) {
    console.warn(`Extractor failed for ${clean}: ${String(error)}`);
    return [];
  }
}

function parseEpisodeNumber(value: string, fallback: number): number {
  const western = value.match(/(?:episode|ep|الحلقة)?\s*([0-9]+(?:\.[0-9]+)?)/i);
  return western ? Number(western[1]) : fallback;
}

function idFromUrl(url: string): string {
  try { return url.split(/[?#]/)[0].replace(/\/+$/, "").split("/").pop() || url; }
  catch { return url; }
}


type Anime3rbSource = { src?: string; url?: string; file?: string; res?: string | number; label?: string; type?: string; premium?: boolean };

class Provider {
  private baseUrl = cleanBaseUrl("{{baseUrl}}", "https://anime3rb.com");

  getSettings(): Settings {
    return { episodeServers: this.getEpisodeServers(), supportsDub: false };
  }

  getEpisodeServers(): string[] {
    return ["default", "Anime3rb Player"];
  }

  async search(opts: SearchOptions): Promise<SearchResult[]> {
    const all: SearchResult[] = [];
    for (const query of buildCandidateQueries(opts, 4)) {
      const endpoints = [
        `${this.baseUrl}/titles/list?q=${encodeURIComponent(query)}`,
        `${this.baseUrl}/search?q=${encodeURIComponent(query)}&page=1`,
      ];
      let parsedAny = false;
      for (const url of endpoints) {
        try {
          const html = await fetchText(url, this.baseUrl);
          const $ = LoadDoc(html);
          $(".title-card").each((_i, card) => {
            const link = card.find("a").first();
            const href = absoluteUrl(this.baseUrl, link.attr("href") || "");
            const title = normalizeWhitespace(card.find("h2, h4").first().text() || link.attr("title") || card.text());
            if (href && title) { all.push({ id: href, title, url: href, subOrDub: "sub" }); parsedAny = true; }
          });
          if (!parsedAny) {
            $("a[href*='/titles/']").each((_i, link) => {
              const rawHref = link.attr("href") || "";
              if (!rawHref || rawHref.includes("/titles/list")) return;
              const href = absoluteUrl(this.baseUrl, rawHref);
              const img = link.find("img").first();
              const title = normalizeWhitespace((img.attr("alt") || link.find("h2, h4").first().text() || link.text()).replace(/^بوستر\s+/i, ""));
              if (href && title) { all.push({ id: href, title, url: href, subOrDub: "sub" }); parsedAny = true; }
            });
          }
          if (parsedAny) break;
        } catch (error) {
          console.warn(`Anime3rb search endpoint failed: ${String(error)}`);
        }
      }
      const ranked = rankResults(all, opts, 5);
      if (ranked[0] && similarity(ranked[0].title, query) >= 0.75) break;
    }
    return rankResults(all, opts);
  }

  async findEpisodes(id: string): Promise<EpisodeDetails[]> {
    const animeUrl = absoluteUrl(this.baseUrl, id);
    const html = await fetchText(animeUrl, this.baseUrl);
    const $ = LoadDoc(html);
    const episodes: EpisodeDetails[] = [];
    $("a[href*='/episode/']").each((index, el) => {
      const href = absoluteUrl(this.baseUrl, el.attr("href") || "");
      if (!href) return;
      const m = href.match(/\/episode\/[^/]+\/(\d+(?:\.\d+)?)(?:\/|$|\?)/i);
      const title = normalizeWhitespace(el.text());
      const number = m ? Number(m[1]) : parseEpisodeNumber(title, index + 1);
      episodes.push({ id: href, number, url: href, title: title || undefined });
    });
    return dedupeBy(episodes, (e) => e.url).sort((a, b) => a.number - b.number);
  }

  private parseVideoSourceArray(html: string): VideoSource[] {
    const block = html.match(/var\s+video_sources\s*=\s*(\[[\s\S]*?\])\s*;/i)?.[1];
    if (!block) return [];
    try {
      const parsed = JSON.parse(block.replace(/\\\//g, "/")) as Anime3rbSource[];
      return parsed
        .filter((item) => !item.premium)
        .map((item) => {
          const url = String(item.src || item.url || item.file || "");
          const quality = qualityFromText(String(item.res || item.label || ""));
          return source(url, quality, item.label ? `Anime3rb ${item.label}` : "Anime3rb");
        })
        .filter((item) => validMediaUrl(item.url));
    } catch (error) {
      console.warn(`Anime3rb video_sources JSON parse failed: ${String(error)}`);
      return [];
    }
  }

  private playerCandidates(html: string): string[] {
    const urls: string[] = [];
    const $ = LoadDoc(html);
    $("button[data-source], [data-source]").each((_i, el) => {
      const raw = el.attr("data-source") || "";
      if (raw) urls.push(absoluteUrl(this.baseUrl, maybeDecodeBase64(raw)));
    });
    for (const match of Array.from(html.matchAll(/wire:snapshot=["']([^"']+)["']/gi))) {
      try {
        const parsed = JSON.parse(decodeHtmlEntities(match[1])) as { data?: Record<string, unknown> };
        const candidate = parsed?.data?.video_url;
        if (typeof candidate === "string" && candidate) urls.push(absoluteUrl(this.baseUrl, candidate));
      } catch { }
    }
    const iframeMatches = Array.from(html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi));
    for (const match of iframeMatches) urls.push(absoluteUrl(this.baseUrl, match[1]));
    return dedupeBy(urls.filter(Boolean), (u) => u);
  }

  async findEpisodeServer(episode: EpisodeDetails, requestedServer: string): Promise<EpisodeServer> {
    const html = await fetchText(episode.url, this.baseUrl);
    const sources: VideoSource[] = this.parseVideoSourceArray(html);
    for (const candidate of this.playerCandidates(html).slice(0, 8)) {
      if (videoType(candidate) !== "unknown") {
        sources.push(...await safeExtract(candidate, { referer: episode.url }));
        continue;
      }
      try {
        const playerHtml = await fetchText(candidate, episode.url);
        const parsed = this.parseVideoSourceArray(playerHtml);
        if (parsed.length) sources.push(...parsed);
        else sources.push(...await safeExtract(candidate, { referer: episode.url }));
      } catch (error) {
        console.warn(`Anime3rb player candidate failed: ${String(error)}`);
      }
    }
    const cleanSources = dedupeBy(sources.filter((v) => validMediaUrl(v.url)), (v) => v.url);
    if (!cleanSources.length) throw new Error("Anime3rb: no playable mp4/m3u8 source found without browser/challenge bypass");
    return {
      server: requestedServer === "default" ? "Anime3rb Player" : requestedServer,
      headers: standardHeaders(episode.url),
      videoSources: cleanSources,
    };
  }
}

