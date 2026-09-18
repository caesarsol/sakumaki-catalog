/**
 * Client minimale per le API web del servizio (le stesse usate dal sito).
 * Auth: il cookie di sessione `etp_rt` viene scambiato con un bearer token
 * tramite il grant `etp_rt_cookie`; il client id è quello pubblico del sito web.
 */
// Gli host stanno in .env / nei secret di CI (API_BASE, SITE_BASE): il nome del servizio non deve comparire nel repo.
const BASE = Bun.env.API_BASE;
if (!BASE) throw new Error("API_BASE mancante in .env (vedi .env.example)");

const WEB_CLIENT_BASIC = "bm9haWhkZXZtXzZpeWcwYThsMHE6"; // base64("noaihdevm_6iyg0a8l0q:")
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export type Token = {
  access_token: string;
  expires_in: number;
  account_id: string;
  profile_id: string;
  country: string;
};

export type EpisodeMetadata = {
  series_id: string;
  series_title: string;
  season_number: number;
  episode_number: number | null;
  [k: string]: unknown;
};

export type WatchlistItem = {
  panel: { id: string; type: string; title: string; episode_metadata?: EpisodeMetadata; [k: string]: unknown };
  new: boolean;
  is_favorite: boolean;
  fully_watched: boolean;
  never_watched: boolean;
  playhead: number;
};

export async function login(etpRt: string): Promise<Token> {
  const res = await fetch(`${BASE}/auth/v1/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${WEB_CLIENT_BASIC}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: `etp_rt=${etpRt}`,
      "User-Agent": UA,
    },
    body: new URLSearchParams({
      grant_type: "etp_rt_cookie",
      device_type: "Chrome",
      device_id: crypto.randomUUID(),
    }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`); // niente body nei log: nei run pubblici di CI mostrerebbe l'host
  return res.json();
}

export async function fetchWatchlist(token: Token, locale = "en-US"): Promise<WatchlistItem[]> {
  const items: WatchlistItem[] = [];
  const pageSize = 100;
  for (let start = 0; ; start += pageSize) {
    const url = new URL(`${BASE}/content/v2/discover/${token.account_id}/watchlist`);
    url.search = new URLSearchParams({
      order: "desc",
      n: String(pageSize),
      start: String(start),
      preferred_audio_language: "ja-JP",
      locale,
    }).toString();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token.access_token}`, "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`watchlist failed: ${res.status}`);
    const page: { total: number; data: WatchlistItem[] } = await res.json();
    items.push(...page.data);
    if (page.data.length === 0 || items.length >= page.total) return items;
  }
}

type StarBucket = { displayed: string; unit: string; percentage: number };
export type Rating = Record<"1s" | "2s" | "3s" | "4s" | "5s", StarBucket> & {
  average: string;
  total: number;
};

export type SeriesObject = {
  id: string;
  type: "series";
  title: string;
  slug_title: string;
  description: string;
  rating: Rating;
  series_metadata: {
    episode_count: number;
    season_count: number;
    series_launch_year: number | null;
    is_simulcast: boolean;
    is_dubbed: boolean;
    is_subbed: boolean;
    tenant_categories?: string[];
    maturity_ratings: string[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

/** Oggetti CMS (serie, stagioni, episodi) in blocco; con `ratings=true` ogni serie include `rating`. */
export async function fetchObjects(token: Token, ids: string[], locale = "en-US"): Promise<SeriesObject[]> {
  const url = new URL(`${BASE}/content/v2/cms/objects/${ids.join(",")}`);
  url.search = new URLSearchParams({ ratings: "true", locale }).toString();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token.access_token}`, "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`objects failed: ${res.status}`);
  const body: { data: SeriesObject[] } = await res.json();
  return body.data;
}

/** Intero catalogo serie (browse, ordinato per popolarità), con `rating` su ogni serie. */
export async function fetchCatalog(token: Token, locale = "en-US"): Promise<SeriesObject[]> {
  const items: SeriesObject[] = [];
  const pageSize = 100; // massimo accettato dall'API
  for (let start = 0; ; start += pageSize) {
    const url = new URL(`${BASE}/content/v2/discover/browse`);
    url.search = new URLSearchParams({
      type: "series",
      sort_by: "popularity",
      ratings: "true",
      n: String(pageSize),
      start: String(start),
      locale,
    }).toString();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token.access_token}`, "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`browse failed: ${res.status}`);
    const page: { total: number; data: SeriesObject[] } = await res.json();
    items.push(...page.data);
    if (page.data.length === 0 || items.length >= page.total) return items;
  }
}
