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
