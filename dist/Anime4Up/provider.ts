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

function mediaPath(url: string): string {
  const normalized = String(url || "").replace(/\\\//g, "/");
  const match = normalized.match(/^https?:\/\/[^/?#]+([^?#]*)/i);
  return (match?.[1] || "").toLowerCase();
}

function videoType(url: string): VideoSourceType {
  const path = mediaPath(url);
  if (!path) return "unknown";
  if (path.endsWith(".m3u8") || path.includes(".m3u8/")) return "m3u8";
  if (path.endsWith(".mp4") || path.includes(".mp4/")) return "mp4";
  return "unknown";
}

function source(url: string, quality = "auto", label?: string): VideoSource {
  return { url, type: videoType(url), quality, label, subtitles: [] };
}

function validMediaUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (videoType(url) !== "unknown") return true;
  const path = mediaPath(url);
  return /(?:^|\/)(?:manifest|playlist|stream|video)(?:[\/_\-.]|$)/i.test(path);
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

function unbasePacker(value: string, base: number): number {
  if (base >= 2 && base <= 36) {
    const parsed = parseInt(value, base);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const selector = base > 62 ? 95 : base > 54 ? 62 : base > 52 ? 54 : 52;
  const alphabets: Record<number, string> = {
    52: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP",
    54: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQR",
    62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    95: " !\\\"#$%&\\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
  };
  const alphabet = alphabets[selector] || alphabets[52];
  let out = 0;
  const chars = value.split("").reverse();
  for (let i = 0; i < chars.length; i += 1) {
    const digit = alphabet.indexOf(chars[i]);
    out += Math.pow(base, i) * (digit >= 0 ? digit : 0);
  }
  return out;
}

function unpackPacker(script: string): string[] {
  if (!/eval\(function\(p,a,c,k,e,[rd]?/im.test(script)) return [];
  const extract = /}\s*\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/gim;
  const out: string[] = [];
  for (const match of script.matchAll(extract)) {
    const payload = match[1];
    const radix = Number(match[2]) || 10;
    const count = Number(match[3]) || 0;
    const symtab = match[4].split("|");
    if (!payload || !count || symtab.length !== count) continue;
    out.push(payload.replace(/\b\w+\b/g, (word) => {
      const index = unbasePacker(word, radix);
      return symtab[index] || word;
    }));
  }
  return out;
}

function extractPlayerSrc(script: string): string {
  const candidates = [
    script.match(/\.src\(\s*["']([^"']+)["']\s*\)/i)?.[1] || "",
    script.match(/\.src\(\s*\{[\s\S]{0,300}?src\s*:\s*["']([^"']+)["']/i)?.[1] || "",
    script.match(/\bsrc\s*:\s*["']([^"']+\.mp4(?:\?[^"']*)?)["']/i)?.[1] || "",
  ].filter(Boolean);
  return candidates[0] ? candidates[0].replace(/\\\//g, "/") : "";
}

async function extractMp4Upload(url: string, ctx: ExtractContext): Promise<VideoSource[]> {
  const html = await fetchText(url, "https://mp4upload.com/");
  const scripts = Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)).map((m) => m[1]);
  const out: VideoSource[] = [];

  for (const block of scripts) {
    const candidates = /player\.src/i.test(block)
      ? [block]
      : unpackPacker(block);

    for (const script of candidates) {
      const videoUrl = extractPlayerSrc(script);
      if (!videoUrl || videoType(videoUrl) !== "mp4") continue;
      const height = script.match(/\WHEIGHT=(\d+)/i)?.[1] || "";
      out.push(source(videoUrl, height ? `${height}p` : qualityFromText(videoUrl), "MP4Upload"));
    }
  }

  return dedupeBy(out.filter((x) => validMediaUrl(x.url)), (x) => x.url);
}

async function extractGenericMedia(url: string, ctx: ExtractContext): Promise<VideoSource[]> {
  const html = await fetchText(url, ctx.referer);
  const base = url.substring(0, url.lastIndexOf("/"));
  const fromTags = directSourcesFromHtml(html, base).filter((x) => validMediaUrl(x.url));
  const regexUrls = Array.from(html.matchAll(/https?:\\?\/\\?\/[^"'\s/]+\/[^"'\s]*?(?:\.m3u8|\.mp4)(?:\?[^"'\s]*)?/gi))
    .map((m) => m[0].replace(/\\\//g, "/"))
    .filter((u) => validMediaUrl(u));
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


type Anime4UpServerData = { name?: string; link?: string; order?: string; icon?: boolean };

class Provider {
  private baseUrl = cleanBaseUrl("{{baseUrl}}", "https://w1.anime4up.rest");

  getSettings(): Settings {
    return { episodeServers: this.getEpisodeServers(), supportsDub: false };
  }

  getEpisodeServers(): string[] {
    return ["default", "VidYard", "OK.ru", "MP4Upload", "Uqload", "VOE", "4Shared", "Dood", "VidBom", "StreamWish", "GDrivePlayer"];
  }

  private assertSearchPage(html: string, url: string): void {
    const lower = html.toLowerCase();
    if (
      lower.includes("cf-chl-") ||
      lower.includes("challenge-platform") ||
      lower.includes("just a moment") ||
      lower.includes("attention required") ||
      lower.includes("verify you are human")
    ) {
      throw `Anime4Up search blocked by Cloudflare/challenge at ${url}`;
    }
  }

  private parseSearchResults(html: string): SearchResult[] {
    const $ = LoadDoc(html);
    const out: SearchResult[] = [];

    const pushFromLink = (link: DocSelection, container?: DocSelection) => {
      const rawHref = link.attr("href") || "";
      const href = absoluteUrl(this.baseUrl, rawHref);
      if (!href || !/\/anime\//i.test(href)) return;

      const scope = container || link;
      const img = scope.find("img").first();
      const heading = scope.find("h1, h2, h3, h4, .anime-card-title, .title").first();
      const title = normalizeWhitespace(
        img.attr("alt") ||
        link.attr("title") ||
        heading.text() ||
        link.text() ||
        scope.text()
      );
      if (!title) return;

      const dubbed = /مدبلج|dub(?:bed)?/i.test(title);
      out.push({
        id: href,
        title,
        url: href,
        subOrDub: dubbed ? "dub" : "sub",
      });
    };

    $("div.anime-list-content div.anime-card-poster > div.hover").each((_i, el) => {
      pushFromLink(el.find("a").first(), el);
    });

    if (!out.length) {
      $("a[href*='/anime/']").each((_i, link) => {
        pushFromLink(link, link);
      });
    }

    return dedupeBy(out, (x) => x.id || x.url);
  }

  private slugifyQuery(query: string): string {
    return query
      .trim()
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-");
  }

  private async tryDirectAnimePage(query: string): Promise<SearchResult | null> {
    const slug = this.slugifyQuery(query);
    if (!slug) return null;

    const url = `${this.baseUrl}/anime/${slug}/`;
    try {
      const html = await fetchText(url, `${this.baseUrl}/`);
      this.assertSearchPage(html, url);
      const $ = LoadDoc(html);

      const title = normalizeWhitespace(
        $("h1.anime-details-title").first().text() ||
        $("meta[property='og:title']").first().attr("content") ||
        $("title").first().text()
      );

      const hasAnimeStructure =
        $("h1.anime-details-title").length > 0 ||
        $("ul.all-episodes-list li > a").length > 0 ||
        $("div.ehover6 > div.episodes-card-title > h3 > a").length > 0;

      if (!hasAnimeStructure || !title) return null;

      const score = similarity(title, query);
      if (score < 0.45 && !normalizeTitle(title).includes(normalizeTitle(query))) return null;

      return {
        id: url,
        title,
        url,
        subOrDub: /مدبلج|dub(?:bed)?/i.test(title) ? "dub" : "sub",
      };
    } catch (_error) {
      return null;
    }
  }

  async search(opts: SearchOptions): Promise<SearchResult[]> {
    const all: SearchResult[] = [];
    const errors: string[] = [];

    for (const query of buildCandidateQueries(opts, 4)) {
      const direct = await this.tryDirectAnimePage(query);
      if (direct) {
        all.push(direct);
        const rankedDirect = rankResults(all, opts, 5);
        if (rankedDirect[0] && similarity(rankedDirect[0].title, query) >= 0.75) break;
      }

      const url = `${this.baseUrl}/?search_param=animes&s=${encodeURIComponent(query)}`;
      try {
        const html = await fetchText(url, `${this.baseUrl}/`);
        this.assertSearchPage(html, url);

        const parsed = this.parseSearchResults(html);
        all.push(...parsed);

        const ranked = rankResults(all, opts, 5);
        if (ranked[0] && similarity(ranked[0].title, query) >= 0.75) break;
      } catch (error) {
        const message = `Anime4Up search failed for "${query}": ${String(error)}`;
        console.error(message);
        errors.push(message);
      }
    }

    const ranked = rankResults(all, opts);
    if (ranked.length) return ranked;

    const debugMessage = errors.length
      ? errors[errors.length - 1]
      : "Anime4Up search returned no parseable anime results; site layout may have changed";

    // Manual-search diagnostics: Seanime/Goja formats rejected Promise reasons as map[],
    // so return a visible synthetic result when there is no media context.
    if (!opts.media || !opts.media.id) {
      return [{
        id: "__anime4up_debug__",
        title: `[DEBUG] ${debugMessage}`,
        url: this.baseUrl,
        subOrDub: "sub",
      }];
    }

    throw debugMessage;
  }

  private originOf(url: string): string {
    const match = (url || "").match(/^(https?:\/\/[^/]+)/i);
    return match ? match[1] : this.baseUrl;
  }

  private episodeNumberFromLink(title: string, href: string, fallback: number): number {
    const fromTitle = title.match(/(?:episode|ep|الحلقة)?\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (fromTitle) return Number(fromTitle[1]);

    const fromUrl =
      href.match(/(?:episode|ep)[-_/]?([0-9]+(?:\.[0-9]+)?)(?:[-_/]|$|\?)/i) ||
      href.match(/[-_/]([0-9]+(?:\.[0-9]+)?)(?:[-_/]?(?: مترجمة|مدبلجة)?\/?$|\/?$)/i);

    return fromUrl ? Number(fromUrl[1]) : fallback;
  }

  async findEpisodes(id: string): Promise<EpisodeDetails[]> {
    const animeUrl = absoluteUrl(this.baseUrl, id);
    const pageOrigin = this.originOf(animeUrl);
    const html = await fetchText(animeUrl, `${pageOrigin}/`);
    const $ = LoadDoc(html);
    const episodes: EpisodeDetails[] = [];

    const collect = (selector: string) => {
      $(selector).each((index, el) => {
        const rawHref = el.attr("href") || "";
        if (!rawHref || !/\/episode\//i.test(rawHref)) return;

        const href = absoluteUrl(pageOrigin, rawHref);
        const title = normalizeWhitespace(
          el.attr("title") ||
          el.find("h1, h2, h3, h4, span").first().text() ||
          el.text()
        );
        if (!href) return;

        const number = this.episodeNumberFromLink(title, href, index + 1);
        episodes.push({
          id: href,
          number,
          url: href,
          title: title || `Episode ${number}`,
        });
      });
    };

    collect("div.ehover6 > div.episodes-card-title > h3 > a, ul.all-episodes-list li > a");

    if (!episodes.length) {
      collect("a[href*='/episode/']");
    }

    return dedupeBy(episodes, (e) => e.url)
      .filter((e) => Number.isFinite(e.number) && e.number >= 0)
      .sort((a, b) => a.number - b.number);
  }

  private decodeServerInput(value: string, quality: string): HostServer[] {
    if (!value) return [];
    try {
      const decoded = decodeBase64(value);
      const parsed = JSON.parse(decoded) as Anime4UpServerData[];
      return parsed
        .filter((item) => typeof item.link === "string" && item.link)
        .map((item) => ({ name: item.name || "mirror", url: String(item.link), quality }));
    } catch (error) {
      console.warn(`Anime4Up server payload decode failed: ${String(error)}`);
      return [];
    }
  }

  private serverNameFromUrl(url: string): string {
    const lower = url.toLowerCase();
    if (lower.includes("ok.ru")) return "OK.ru";
    if (lower.includes("mp4upload")) return "MP4Upload";
    if (lower.includes("uqload")) return "Uqload";
    if (lower.includes("voe")) return "VOE";
    if (lower.includes("4shared")) return "4Shared";
    if (lower.includes("dood")) return "Dood";
    if (lower.includes("vidbom")) return "VidBom";
    if (lower.includes("streamwish")) return "StreamWish";
    if (lower.includes("vidyard")) return "VidYard";
    if (lower.includes("gdrive")) return "GDrivePlayer";
    try {
      return url.replace(/^https?:\/\//i, "").split("/")[0] || "mirror";
    } catch {
      return "mirror";
    }
  }

  private collectVisibleServers(html: string, pageUrl: string): HostServer[] {
    const $ = LoadDoc(html);
    const out: HostServer[] = [];
    const pageOrigin = this.originOf(pageUrl);
    const push = (raw: string, quality = "auto", name = "") => {
      const value = normalizeWhitespace(raw || "");
      if (!value || /^(javascript:|#)/i.test(value)) return;
      const url = absoluteUrl(pageOrigin, value);
      if (!url || url === pageUrl) return;
      if (!/^https?:\/\//i.test(url)) return;
      out.push({ name: name || this.serverNameFromUrl(url), url, quality });
    };

    $(".WatchServersEmbed iframe[src], iframe[src], video[src], source[src]").each((_i, el) => {
      push(el.attr("src") || "", el.attr("data-quality") || el.attr("label") || "auto");
    });

    $("[data-src], [data-url], [data-link], [data-embed]").each((_i, el) => {
      const name = normalizeWhitespace(el.attr("data-name") || el.attr("title") || el.text());
      push(
        el.attr("data-src") || el.attr("data-url") || el.attr("data-link") || el.attr("data-embed") || "",
        el.attr("data-quality") || "auto",
        name,
      );
    });

    $(".WatchServersEmbed a[href], .servers a[href], [class*='server'] a[href]").each((_i, el) => {
      push(el.attr("href") || "", el.attr("data-quality") || "auto", normalizeWhitespace(el.text()));
    });

    const knownHostUrls = Array.from(html.matchAll(/https?:\\?\/\\?\/[^"'\s<>]+/gi))
      .map((m) => m[0].replace(/\\\//g, "/"))
      .filter((url) => /ok\.ru|mp4upload|uqload|voe|4shared|dood|vidbom|streamwish|vidyard|gdrive/i.test(url));

    for (const url of knownHostUrls) push(url);

    return dedupeBy(out, (s) => s.url);
  }

  private playbackHeaders(serverName: string, serverUrl: string, episodeUrl: string): Record<string, string> {
    const headers = standardHeaders(episodeUrl);
    const haystack = `${serverName} ${serverUrl}`.toLowerCase();

    if (haystack.includes("mp4upload")) {
      headers.Referer = "https://mp4upload.com/";
    }

    return headers;
  }

  async findEpisodeServer(episode: EpisodeDetails, requestedServer: string): Promise<EpisodeServer> {
    const episodeUrl = episode.url || episode.id;
    if (!episodeUrl) throw new Error("Anime4Up: episode URL is missing");

    const pageOrigin = this.originOf(episodeUrl);
    const html = await fetchText(episodeUrl, `${pageOrigin}/`);
    const $ = LoadDoc(html);

    const encodedServers: HostServer[] = [
      ...this.decodeServerInput($(".WatchServersEmbed form input[name='watch_fhd']").first().attr("value") || "", "1080p"),
      ...this.decodeServerInput($(".WatchServersEmbed form input[name='watch_hd']").first().attr("value") || "", "720p"),
      ...this.decodeServerInput($(".WatchServersEmbed form input[name='watch_SD']").first().attr("value") || "", "480p"),
    ];

    const visibleServers = this.collectVisibleServers(html, episodeUrl);
    const dedupedServers = dedupeBy([...encodedServers, ...visibleServers], (s) => s.url);

    const extractFrom = async (server: HostServer): Promise<VideoSource[]> => {
      const extracted = await safeExtract(server.url, { referer: episodeUrl, quality: server.quality });
      return dedupeBy(
        extracted
          .map((v) => ({
            ...v,
            quality: v.quality === "auto" && server.quality ? server.quality : v.quality,
            label: v.label || server.name,
          }))
          .filter((v) => validMediaUrl(v.url)),
        (v) => v.url,
      );
    };

    if (requestedServer === "default") {
      for (const server of dedupedServers.slice(0, 16)) {
        const sources = await extractFrom(server);
        if (!sources.length) continue;

        return {
          server: server.name || "Anime4Up",
          headers: this.playbackHeaders(server.name || "", sources[0]?.url || server.url, episodeUrl),
          videoSources: sources,
        };
      }

      const directFromPage = directSourcesFromHtml(html, pageOrigin).filter((v) => validMediaUrl(v.url));
      if (directFromPage.length) {
        return {
          server: "Anime4Up",
          headers: standardHeaders(episodeUrl),
          videoSources: dedupeBy(directFromPage, (v) => v.url),
        };
      }

      throw new Error(`Anime4Up: no playable mp4/m3u8 source found (servers discovered: ${dedupedServers.length})`);
    }

    const wanted = dedupedServers.filter((s) =>
      s.name.toLowerCase().includes(requestedServer.toLowerCase()) ||
      s.url.toLowerCase().includes(requestedServer.toLowerCase().replace(/[^a-z0-9]/g, ""))
    );

    if (!wanted.length) {
      throw new Error(`Anime4Up: requested server not found: ${requestedServer}`);
    }

    const videoSources: VideoSource[] = [];
    for (const server of wanted.slice(0, 8)) {
      videoSources.push(...await extractFrom(server));
    }

    const cleanSources = dedupeBy(videoSources, (v) => v.url);
    if (!cleanSources.length) {
      throw new Error(`Anime4Up: no playable source for server ${requestedServer}`);
    }

    return {
      server: requestedServer,
      headers: this.playbackHeaders(requestedServer, cleanSources[0]?.url || wanted[0].url, episodeUrl),
      videoSources: cleanSources,
    };
  }
}

