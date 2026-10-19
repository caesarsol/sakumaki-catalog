import type { SeriesObject } from "./api";

/**
 * Voti da AniList e MyAnimeList per le serie del catalogo, in data/ratings-external.json.
 *
 * L'abbinamento è per id anche qui: AniList elenca fra i link esterni di ogni anime la pagina della serie
 * sul servizio, e da quel link si prende l'id (o, per i link vecchi, lo slug, che è comunque un
 * identificativo del sito e non un titolo). Nessuna ricerca per nome. AniList e MAL hanno una voce per
 * stagione o film, il catalogo una per serie: il voto della serie è la media delle voci abbinate pesata
 * sul numero di voti di ciascuna.
 *
 * MAL: senza chiave passa da Jikan, che rilegge le pagine di MAL; con `MAL_CLIENT_ID` (si registra un
 * client su myanimelist.net/apiconfig) usa l'API ufficiale. Tutto con il proprio ritmo, sotto i limiti
 * dichiarati: AniList 30 richieste al minuto da anonimi, Jikan 60. Il 18 ottobre 2026 Jikan ha rifiutato
 * la connessione dal runner di Actions: se le prime richieste falliscono tutte MAL si salta, e la pagina
 * lascia la colonna vuota invece di segnare ogni serie come non abbinata.
 */
const dataDir = `${import.meta.dir}/../data`;
const MAL_CLIENT_ID = Bun.env.MAL_CLIENT_ID;
const ANILIST_PAUSE_MS = 2100;
// MAL non dichiara un limite e a chi esagera risponde 403: meglio un'ora di run che un client bloccato.
const MAL_PAUSE_MS = MAL_CLIENT_ID ? 800 : 1100;

type Entry = { id: number; idMal: number | null; meanScore: number | null; votes: number };
export type ExternalRating = { score: number; votes: number; entries: number };
export type ExternalRatings = { mal_available: boolean; series: Record<string, { al?: ExternalRating; mal?: ExternalRating }> };

const catalog: SeriesObject[] = (await Bun.file(`${dataDir}/catalog.ndjson`).text()).trim().split("\n").map((l) => JSON.parse(l));
const ids = new Set(catalog.map((s) => s.id));
// I link vecchi hanno lo slug con i trattini compressi ("rezero-starting-life-in-another-world" contro
// "rezero--starting-life-in-another-world-"): si confrontano normalizzati, e uno slug ambiguo non abbina.
const normSlug = (s: string) => s.toLowerCase().replace(/-+/g, "-").replace(/^-|-$/g, "");
const bySlug = new Map<string, string | null>();
for (const s of catalog) {
  const k = normSlug(s.slug_title);
  bySlug.set(k, bySlug.has(k) ? null : s.id);
}

/** L'id della serie del catalogo a cui punta un link di AniList, se ce n'è una. */
function seriesOf(url: string): string | undefined {
  const id = url.match(/\/series\/(G[A-Z0-9]+)/i)?.[1]?.toUpperCase();
  if (id) return ids.has(id) ? id : undefined;
  const slug = url.match(/crunchyroll\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?([a-z0-9-]+)\/?$/i)?.[1];
  return (slug && bySlug.get(normSlug(slug))) || undefined;
}

async function post(query: string, variables: object): Promise<any> {
  for (;;) {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) {
      await Bun.sleep(Number(res.headers.get("retry-after") ?? 60) * 1000 + 1000);
      continue;
    }
    if (!res.ok) throw new Error(`AniList: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); // il corpo è l'errore GraphQL, niente di privato
    return (await res.json()).data;
  }
}

// Tutti gli anime di AniList, un anno di uscita per volta: l'API non sa filtrare per link esterno, e oltre
// i 5000 risultati di una stessa query (pagina 100) risponde 400. Un anno non arriva mai a 5000. Le date
// sono interi AAAAMMGG, con 0 per mese e giorno ignoti: l'intervallo li comprende.
const ANIME = `query ($page: Int, $from: FuzzyDateInt, $to: FuzzyDateInt) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage }
  media(type: ANIME, sort: ID, startDate_greater: $from, startDate_lesser: $to) { id idMal meanScore stats { scoreDistribution { amount } } externalLinks { url } } } }`;
const matched = new Map<string, Entry[]>();
let pages = 0;
const lastYear = new Date().getFullYear() + 1;
for (let year = 1917, page = 1; year <= lastYear; ) {
  const { Page } = await post(ANIME, { page, from: (year - 1) * 10000 + 9999, to: (year + 1) * 10000 });
  pages++;
  for (const m of Page.media) {
    const series = m.externalLinks.map((l: { url: string }) => seriesOf(l.url)).find(Boolean);
    if (!series) continue;
    const votes = m.stats?.scoreDistribution?.reduce((a: number, d: { amount: number }) => a + d.amount, 0) ?? 0;
    if (!matched.has(series)) matched.set(series, []);
    matched.get(series)!.push({ id: m.id, idMal: m.idMal, meanScore: m.meanScore, votes });
  }
  if (Page.pageInfo.hasNextPage) page++;
  else {
    if (year % 10 === 0) console.log(`AniList: fino al ${year}, ${pages} pagine, ${matched.size} serie abbinate`);
    year++;
    page = 1;
  }
  await Bun.sleep(ANILIST_PAUSE_MS);
}

/** Media dei voti delle voci, pesata sui loro votanti; le voci senza voti non contano. */
function weightedMean(parts: { score: number | null; votes: number }[]): ExternalRating | undefined {
  const voted = parts.filter((p) => p.score != null && p.votes > 0);
  const votes = voted.reduce((a, p) => a + p.votes, 0);
  if (!votes) return undefined;
  return { score: Math.round((voted.reduce((a, p) => a + p.score! * p.votes, 0) / votes) * 100) / 100, votes, entries: voted.length };
}

async function malScore(id: number): Promise<{ score: number | null; votes: number } | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = MAL_CLIENT_ID
      ? await fetch(`https://api.myanimelist.net/v2/anime/${id}?fields=mean,num_scoring_users`, { headers: { "X-MAL-CLIENT-ID": MAL_CLIENT_ID }, signal: AbortSignal.timeout(30_000) })
      : await fetch(`https://api.jikan.moe/v4/anime/${id}`, { signal: AbortSignal.timeout(30_000) });
    if (res.status === 404) return null;
    if (res.status === 429 || res.status === 403 || res.status >= 500) {
      await Bun.sleep(5000 * attempt);
      continue;
    }
    if (!res.ok) throw new Error(`MAL: HTTP ${res.status}`);
    const b: any = await res.json();
    return MAL_CLIENT_ID ? { score: b.mean ?? null, votes: b.num_scoring_users ?? 0 } : { score: b.data?.score ?? null, votes: b.data?.scored_by ?? 0 };
  }
  return null;
}

const malIds = [...new Set([...matched.values()].flat().map((e) => e.idMal).filter((x): x is number => !!x))];
const mal = new Map<number, { score: number | null; votes: number }>();
let malFailed = 0;
let malError = "";
for (const [i, id] of malIds.entries()) {
  const r = await malScore(id).catch((e: Error) => ((malError = e.message), null));
  if (r) mal.set(id, r);
  else malFailed++;
  if (i === 4 && mal.size === 0) break; // cinque fallimenti su cinque: la fonte non risponde, inutile insistere per un'ora
  if ((i + 1) % 250 === 0) console.log(`MAL: ${i + 1}/${malIds.length}`);
  await Bun.sleep(MAL_PAUSE_MS);
}
const malAvailable = mal.size > 0;

const out: ExternalRatings = { mal_available: malAvailable, series: {} };
for (const [series, entries] of matched) {
  const al = weightedMean(entries.map((e) => ({ score: e.meanScore, votes: e.votes })));
  const m = weightedMean(entries.flatMap((e) => (e.idMal && mal.has(e.idMal) ? [mal.get(e.idMal)!] : [])));
  out.series[series] = { ...(al && { al }), ...(m && { mal: m }) };
}
await Bun.write(`${dataDir}/ratings-external.json`, JSON.stringify(out));
const count = (k: "al" | "mal") => Object.values(out.series).filter((r) => r[k]).length;
console.log(
  `AniList: ${pages} pagine, ${matched.size} serie su ${catalog.length} abbinate, ${count("al")} con voto. ` +
    `MAL (${MAL_CLIENT_ID ? "API ufficiale" : "Jikan"}): ` +
    (malAvailable ? `${malIds.length} voci, ${malFailed} non lette, ${count("mal")} serie con voto.` : `non raggiungibile (${malError || "nessun voto"}), colonna vuota.`),
);
