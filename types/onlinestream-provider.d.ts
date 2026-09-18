type SubOrDub = "sub" | "dub" | "both";
type VideoSourceType = "mp4" | "m3u8" | "unknown";

interface FuzzyDate {
  year: number;
  month?: number;
  day?: number;
}

interface Media {
  id: number;
  idMal?: number;
  status?: string;
  format?: string;
  englishTitle?: string;
  romajiTitle?: string;
  episodeCount?: number;
  synonyms: string[];
  isAdult: boolean;
  startDate?: FuzzyDate;
}

interface SearchOptions {
  media: Media;
  query: string;
  dub: boolean;
  year: number;
}

interface Settings {
  episodeServers: string[];
  supportsDub: boolean;
}

interface SearchResult {
  id: string;
  title: string;
  url: string;
  subOrDub: SubOrDub;
}

interface EpisodeDetails {
  provider?: string;
  id: string;
  number: number;
  url: string;
  title?: string;
}

interface VideoSubtitle {
  id: string;
  url: string;
  language: string;
  isDefault: boolean;
}

interface VideoSource {
  url: string;
  type: VideoSourceType;
  label?: string;
  quality: string;
  subtitles: VideoSubtitle[];
}

interface EpisodeServer {
  provider?: string;
  server: string;
  headers: Record<string, string>;
  videoSources: VideoSource[];
}
