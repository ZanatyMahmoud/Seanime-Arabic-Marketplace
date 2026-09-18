type Anime4UpServerData = { name?: string; link?: string; order?: string; icon?: boolean };

class Provider {
  private baseUrl = cleanBaseUrl("{{baseUrl}}", "https://w1.anime4up.rest");

  getSettings(): Settings {
    return { episodeServers: this.getEpisodeServers(), supportsDub: false };
  }

  getEpisodeServers(): string[] {
    return ["default", "VidYard", "OK.ru", "MP4Upload", "Uqload", "VOE", "4Shared", "Dood", "VidBom", "StreamWish", "GDrivePlayer"];
  }

  async search(opts: SearchOptions): Promise<SearchResult[]> {
    const all: SearchResult[] = [];
    for (const query of buildCandidateQueries(opts, 4)) {
      const url = `${this.baseUrl}/?search_param=animes&s=${encodeURIComponent(query)}`;
      try {
        const html = await fetchText(url, `${this.baseUrl}/`);
        const $ = LoadDoc(html);
        $("div.anime-list-content div.anime-card-poster > div.hover").each((_i, el) => {
          const link = el.find("a").first();
          const img = el.find("img").first();
          const href = absoluteUrl(this.baseUrl, link.attr("href") || "");
          const title = normalizeWhitespace(img.attr("alt") || link.attr("title") || el.text());
          if (href && title) all.push({ id: href, title, url: href, subOrDub: "sub" });
        });
        const ranked = rankResults(all, opts, 5);
        if (ranked[0] && similarity(ranked[0].title, query) >= 0.75) break;
      } catch (error) {
        console.warn(`Anime4Up search failed for ${query}: ${String(error)}`);
      }
    }
    return rankResults(all, opts);
  }

  async findEpisodes(id: string): Promise<EpisodeDetails[]> {
    const animeUrl = absoluteUrl(this.baseUrl, id);
    const html = await fetchText(animeUrl, `${this.baseUrl}/`);
    const $ = LoadDoc(html);
    const episodes: EpisodeDetails[] = [];
    $("div.ehover6 > div.episodes-card-title > h3 > a, ul.all-episodes-list li > a").each((index, el) => {
      const href = absoluteUrl(this.baseUrl, el.attr("href") || "");
      const title = normalizeWhitespace(el.text());
      if (!href) return;
      episodes.push({ id: href, number: parseEpisodeNumber(title, index + 1), url: href, title });
    });
    return dedupeBy(episodes, (e) => e.url).sort((a, b) => a.number - b.number);
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

  async findEpisodeServer(episode: EpisodeDetails, requestedServer: string): Promise<EpisodeServer> {
    const html = await fetchText(episode.url, `${this.baseUrl}/`);
    const $ = LoadDoc(html);
    const servers: HostServer[] = [
      ...this.decodeServerInput($(".WatchServersEmbed form input[name='watch_fhd']").first().attr("value") || "", "1080p"),
      ...this.decodeServerInput($(".WatchServersEmbed form input[name='watch_hd']").first().attr("value") || "", "720p"),
      ...this.decodeServerInput($(".WatchServersEmbed form input[name='watch_SD']").first().attr("value") || "", "480p"),
    ];
    const dedupedServers = dedupeBy(servers, (s) => `${s.name}|${s.url}`);
    const wanted = requestedServer === "default"
      ? dedupedServers
      : dedupedServers.filter((s) => s.name.toLowerCase().includes(requestedServer.toLowerCase()));
    const videoSources: VideoSource[] = [];
    for (const server of (wanted.length ? wanted : dedupedServers).slice(0, 12)) {
      const extracted = await safeExtract(server.url, { referer: episode.url, quality: server.quality });
      videoSources.push(...extracted.map((v) => ({
        ...v,
        quality: v.quality === "auto" && server.quality ? server.quality : v.quality,
        label: v.label || server.name,
      })));
    }
    const cleanSources = dedupeBy(videoSources.filter((v) => validMediaUrl(v.url)), (v) => v.url);
    if (!cleanSources.length) throw new Error("Anime4Up: no playable mp4/m3u8 source found");
    return {
      server: requestedServer === "default" ? "Anime4Up" : requestedServer,
      headers: standardHeaders(episode.url),
      videoSources: cleanSources,
    };
  }
}
