class Provider {
  private baseUrl = cleanBaseUrl("{{baseUrl}}", "https://animeblkom.net");

  getSettings(): Settings {
    return { episodeServers: this.getEpisodeServers(), supportsDub: false };
  }

  getEpisodeServers(): string[] {
    return ["default", "Blkom", "OK.ru", "MP4Upload"];
  }

  async search(opts: SearchOptions): Promise<SearchResult[]> {
    const all: SearchResult[] = [];
    for (const query of buildCandidateQueries(opts, 4)) {
      const url = `${this.baseUrl}/search?query=${encodeURIComponent(query)}&page=1`;
      try {
        const html = await fetchText(url, this.baseUrl);
        const $ = LoadDoc(html);
        $("div.contents div.poster > a").each((_i, el) => {
          const href = absoluteUrl(this.baseUrl, el.attr("href") || "");
          const img = el.find("img").first();
          const title = normalizeWhitespace((img.attr("alt") || el.attr("title") || el.text()).replace(/\s+poster$/i, ""));
          if (href && title) all.push({ id: href, title, url: href, subOrDub: "sub" });
        });
        if (rankResults(all, opts, 5)[0] && similarity(rankResults(all, opts, 5)[0].title, query) >= 0.75) break;
      } catch (error) {
        console.warn(`AnimeBlkom search failed for ${query}: ${String(error)}`);
      }
    }
    return rankResults(all, opts);
  }

  async findEpisodes(id: string): Promise<EpisodeDetails[]> {
    const animeUrl = absoluteUrl(this.baseUrl, id);
    const html = await fetchText(animeUrl, this.baseUrl);
    const $ = LoadDoc(html);
    const episodes: EpisodeDetails[] = [];
    $("ul.episodes-links li a").each((index, el) => {
      const href = absoluteUrl(this.baseUrl, el.attr("href") || "");
      const title = normalizeWhitespace(el.text());
      if (!href) return;
      episodes.push({ id: href, number: parseEpisodeNumber(title, index + 1), url: href, title });
    });
    if (!episodes.length) {
      const title = normalizeWhitespace($("div.name.col-xs-12 span h1, div.name span h1").first().text());
      episodes.push({ id: animeUrl, number: 1, url: animeUrl, title: title || undefined });
    }
    return episodes.sort((a, b) => a.number - b.number);
  }

  async findEpisodeServer(episode: EpisodeDetails, requestedServer: string): Promise<EpisodeServer> {
    const html = await fetchText(episode.url, this.baseUrl);
    const $ = LoadDoc(html);
    const servers: HostServer[] = [];
    $("span.server a").each((_i, el) => {
      const name = normalizeWhitespace(el.text()) || "Blkom";
      const raw = el.attr("data-src") || el.attr("href") || "";
      const url = absoluteUrl(this.baseUrl, raw.replace(/^http:\/\//i, "https://"));
      if (url) servers.push({ name, url });
    });
    const wanted = requestedServer === "default"
      ? servers
      : servers.filter((s) => s.name.toLowerCase().includes(requestedServer.toLowerCase()));
    const videoSources: VideoSource[] = [];
    for (const server of (wanted.length ? wanted : servers).slice(0, 8)) {
      try {
        const extracted = await safeExtract(server.url, { referer: episode.url });
        videoSources.push(...extracted.map((v) => ({ ...v, label: v.label || server.name })));
      } catch (error) {
        console.warn(`AnimeBlkom server ${server.name} failed: ${String(error)}`);
      }
    }
    const cleanSources = dedupeBy(videoSources.filter((v) => validMediaUrl(v.url)), (v) => v.url);
    if (!cleanSources.length) throw new Error("AnimeBlkom: no playable mp4/m3u8 source found");
    return {
      server: requestedServer === "default" ? "AnimeBlkom" : requestedServer,
      headers: standardHeaders(episode.url),
      videoSources: cleanSources,
    };
  }
}
