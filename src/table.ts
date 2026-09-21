import type { SeriesObject, WatchlistItem } from "./api";
import { COUNTRIES } from "./countries";
const SITE_BASE = Bun.env.SITE_BASE;
if (!SITE_BASE) throw new Error("SITE_BASE mancante in .env (vedi .env.example)");

/**
 * Da data/catalog.ndjson (opzionalmente filtrato per voto medio >= MIN_RATING) produce:
 * - data/catalog-scored.ndjson: oggetto serie intatto + `rating_fine`, `rating_weighted`, `in_watchlist`
 * - data/index.html: tabella autonoma, ordinabile e filtrabile (template in src/table.html)
 */
const MIN_RATING = Number(Bun.env.MIN_RATING ?? 0); // sull'average a un decimale dell'API
const WEIGHT_VOTES = Number(Bun.env.WEIGHT_VOTES ?? 10_000); // `m` della media bayesiana (formula IMDb)
const dataDir = `${import.meta.dir}/../data`;

const readNdjson = async <T>(path: string): Promise<T[]> =>
  (await Bun.file(path).text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const catalog = await readNdjson<SeriesObject & { countries: string[] }>(`${dataDir}/catalog.ndjson`);
const countries = COUNTRIES.filter((c) => catalog.some((s) => s.countries.includes(c.iso2))); // solo i paesi presenti nei dati: un download fallito non lascia una colonna vuota
const inWatchlist = new Set<string>();
const idsFile = Bun.file(`${dataDir}/watchlist-ids.json`); // in CI arriva solo questo elenco di id (vedi watchlist-ids.ts)
const watchlistFile = Bun.file(`${dataDir}/watchlist.json`); // in locale di solito c'è la watchlist intera
if (await idsFile.exists()) {
  for (const id of (await idsFile.json()) as string[]) inWatchlist.add(id);
} else if (await watchlistFile.exists()) {
  const { data }: { data: WatchlistItem[] } = await watchlistFile.json();
  for (const w of data) if (w.panel.episode_metadata) inWatchlist.add(w.panel.episode_metadata.series_id);
}

/** Media e deviazione standard dai conteggi per stella ("94.8K" ha 3 cifre significative; la somma coincide col totale entro lo 0,2 %). */
function starStats(s: SeriesObject): { mean: number; sd: number } {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (const stars of [1, 2, 3, 4, 5] as const) {
    const b = s.rating[`${stars}s`];
    const count = parseFloat(b.displayed) * (b.unit === "K" ? 1e3 : b.unit === "M" ? 1e6 : 1);
    sum += stars * count;
    sumSq += stars * stars * count;
    n += count;
  }
  if (!n) return { mean: Number(s.rating.average), sd: 0 };
  const mean = sum / n;
  return { mean, sd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
}
const fineRating = (s: SeriesObject) => starStats(s).mean;
/** Limite inferiore dell'intervallo di confidenza al 95 % della media: scende con pochi voti, non sale mai. Tagliato a 1. */
function lowerBound(s: SeriesObject): number {
  const { mean, sd } = starStats(s);
  return Math.max(1, mean - 1.96 * (sd / Math.sqrt(s.rating.total || 1)));
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

const rated = catalog.filter((s) => s.rating?.total > 0);
const catalogMean = rated.reduce((acc, s) => acc + fineRating(s), 0) / rated.length;
const weighted = (s: SeriesObject) => {
  const v = s.rating.total;
  return (v * fineRating(s) + WEIGHT_VOTES * catalogMean) / (v + WEIGHT_VOTES);
};

const top = catalog
  .filter((s) => Number(s.rating?.average) >= MIN_RATING)
  .map((s) => ({
    ...s,
    rating_fine: round3(fineRating(s)),
    rating_weighted: round3(weighted(s)),
    rating_lcb: round3(lowerBound(s)),
    in_watchlist: inWatchlist.has(s.id),
  }))
  .sort((a, b) => b.rating_weighted - a.rating_weighted);

await Bun.write(`${dataDir}/catalog-scored.ndjson`, top.map((s) => JSON.stringify(s)).join("\n") + "\n");

const rows = top.map((s) => ({
  id: s.id,
  title: s.title,
  url: `${SITE_BASE}/series/${s.id}/${s.slug_title}`,
  rating: s.rating_fine,
  lcb: s.rating_lcb,
  votes: s.rating.total,
  stars: ([1, 2, 3, 4, 5] as const).map((k) => ({ pct: s.rating[`${k}s`].percentage, shown: s.rating[`${k}s`].displayed + s.rating[`${k}s`].unit })),
  year: s.series_metadata.series_launch_year,
  seasons: s.series_metadata.season_count,
  episodes: s.series_metadata.episode_count,
  genres: s.series_metadata.tenant_categories ?? [],
  maturity: s.series_metadata.maturity_ratings.join(", "),
  simulcast: s.series_metadata.is_simulcast,
  dubbed: s.series_metadata.is_dubbed,
  in_watchlist: s.in_watchlist,
  countries: s.countries,
}));
const template = await Bun.file(`${import.meta.dir}/table.html`).text();
const html = template
  .replaceAll("__SUBTITLE__", MIN_RATING > 0 ? `serie con voto ≥ ${MIN_RATING}` : "catalogo serie")
  .replace("__M__", String(WEIGHT_VOTES))
  .replace("__COUNTRIES__", JSON.stringify(countries))
  .replace("__C__", String(round3(catalogMean)))
  .replace("__ROWS__", JSON.stringify(rows).replaceAll("</", "<\\/"));
await Bun.write(`${dataDir}/index.html`, html);
console.log(`${top.length} serie su ${catalog.length} (voto >= ${MIN_RATING}): data/catalog-scored.ndjson, data/index.html`);
