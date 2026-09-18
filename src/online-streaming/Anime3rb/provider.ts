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
