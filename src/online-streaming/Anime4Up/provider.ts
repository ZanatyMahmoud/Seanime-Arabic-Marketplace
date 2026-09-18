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
