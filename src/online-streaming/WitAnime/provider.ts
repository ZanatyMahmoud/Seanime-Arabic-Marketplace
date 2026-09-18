class Provider {
  private baseUrl = cleanBaseUrl("{{baseUrl}}", "https://witanime.cyou");

  getSettings(): Settings {
    return { episodeServers: this.getEpisodeServers(), supportsDub: false };
  }

  getEpisodeServers(): string[] {
    return ["default", "YonaPlay", "SoraPlay", "Dood", "4Shared", "Dropbox", "Dailymotion", "OK.ru", "MP4Upload", "VidBom"];
  }

  private elementUrl(el: DocSelection): string {
    const dataUrl = el.attr("data-url") || "";
    if (dataUrl) return absoluteUrl(this.baseUrl, maybeDecodeBase64(dataUrl));
    const href = el.attr("href") || "";
    if (href && !href.toLowerCase().startsWith("javascript:")) return absoluteUrl(this.baseUrl, href);
    return absoluteUrl(this.baseUrl, extractQuotedBase64(el.attr("onclick") || ""));
  }

  async search(opts: SearchOptions): Promise<SearchResult[]> {
    const all: SearchResult[] = [];
    for (const query of buildCandidateQueries(opts, 4)) {
      const url = `${this.baseUrl}/?search_param=animes&s=${encodeURIComponent(query)}`;
      try {
        const html = await fetchText(url, this.baseUrl);
        const $ = LoadDoc(html);
        $("div.anime-list-content div.row div.anime-card-poster div.ehover6").each((_i, el) => {
          const link = el.find("a").first();
          const img = el.find("img").first();
          const href = this.elementUrl(link);
          const title = normalizeWhitespace(img.attr("alt") || link.attr("title") || el.text());
          if (href && title) all.push({ id: href, title, url: href, subOrDub: "sub" });
        });
        const ranked = rankResults(all, opts, 5);
        if (ranked[0] && similarity(ranked[0].title, query) >= 0.75) break;
      } catch (error) {
        console.warn(`WitAnime search failed for ${query}: ${String(error)}`);
      }
    }
    return rankResults(all, opts);
  }

  private async resolveAnimeHtml(url: string): Promise<{ html: string; url: string }> {
    const first = await fetchText(url, this.baseUrl);
    const $ = LoadDoc(first);
    const real = $("div.anime-page-link a").first().attr("href") || "";
    if (!real) return { html: first, url };
    const realUrl = absoluteUrl(this.baseUrl, real);
    return { html: await fetchText(realUrl, this.baseUrl), url: realUrl };
  }

  async findEpisodes(id: string): Promise<EpisodeDetails[]> {
    const animeUrl = absoluteUrl(this.baseUrl, id);
    const resolved = await this.resolveAnimeHtml(animeUrl);
    const $ = LoadDoc(resolved.html);
    const episodes: EpisodeDetails[] = [];
    $("div.ehover6 > div.episodes-card-title > h3 a").each((index, el) => {
      const href = this.elementUrl(el);
      const title = normalizeWhitespace(el.text());
      if (!href) return;
      episodes.push({ id: href, number: parseEpisodeNumber(title, index + 1), url: href, title });
    });
    return dedupeBy(episodes, (e) => e.url).sort((a, b) => a.number - b.number);
  }

  async findEpisodeServer(episode: EpisodeDetails, requestedServer: string): Promise<EpisodeServer> {
    const html = await fetchText(episode.url, this.baseUrl);
    const $ = LoadDoc(html);
    const servers: HostServer[] = [];
    $("ul#episode-servers li a").each((_i, el) => {
      const name = normalizeWhitespace(el.text()).split(" -")[0] || "mirror";
      const url = this.elementUrl(el);
      if (url) servers.push({ name, url });
    });
    const unique = dedupeBy(servers, (s) => `${s.name}|${s.url}`);
    const wanted = requestedServer === "default" ? unique : unique.filter((s) => s.name.toLowerCase().includes(requestedServer.toLowerCase()));
    const videoSources: VideoSource[] = [];
    for (const server of (wanted.length ? wanted : unique).slice(0, 10)) {
      if (/dropbox/i.test(server.url) && videoType(server.url) !== "unknown") {
        videoSources.push(source(server.url, qualityFromText(server.name), server.name));
        continue;
      }
      const extracted = await safeExtract(server.url, { referer: episode.url });
      videoSources.push(...extracted.map((v) => ({ ...v, label: v.label || server.name })));
    }
    const cleanSources = dedupeBy(videoSources.filter((v) => validMediaUrl(v.url)), (v) => v.url);
    if (!cleanSources.length) throw new Error("WitAnime: no playable mp4/m3u8 source found");
    return {
      server: requestedServer === "default" ? "WitAnime" : requestedServer,
      headers: standardHeaders(episode.url),
      videoSources: cleanSources,
    };
  }
}
