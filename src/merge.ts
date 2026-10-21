import type { SeriesObject } from "./api";
import type { Season } from "./catalog-seasons";
import { COUNTRIES } from "./countries";

/**
 * Fonde i data/catalog-<ISO2>.ndjson presenti in data/catalog.ndjson: una riga per serie,
 * con `countries` = paesi in cui è disponibile. I paesi senza file sono saltati con un avviso.
 *
 * Dai data/catalog-seasons-<ISO2>.ndjson, quando ci sono, aggiunge `availability`: per ogni paese le
 * stagioni e le puntate guardabili lì e quelle che mancano rispetto all'unione dei paesi, e `union` con
 * i totali dell'unione. Le stagioni si confrontano per titolo dentro la stessa serie, non per id: la
 * stessa stagione può avere id diversi da un paese all'altro ("Bunny Girl Senpai" in Italia e negli USA).
 */
export type Availability = { seasons: number; episodes: number; missing: [title: string, episodes: number][] };
/** Per il dettaglio di una serie: le stagioni dell'unione in ordine, e per ogni paese le puntate di ciascuna (0 se lì manca). */
export type SeasonMatrix = { seasons: [title: string, episodes: number][]; by: Record<string, number[]> };
const dataDir = `${import.meta.dir}/../data`;
const readNdjson = async <T>(path: string): Promise<T[]> => (await Bun.file(path).text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const merged = new Map<string, SeriesObject & { countries: string[]; availability?: Record<string, Availability>; union?: { seasons: number; episodes: number }; matrix?: SeasonMatrix; latest_episode?: string | null }>();
const seasonsBy = new Map<string, Map<string, Season[]>>(); // serie → paese → stagioni
let found = 0;
for (const { iso2 } of COUNTRIES) {
  const file = Bun.file(`${dataDir}/catalog-${iso2}.ndjson`);
  if (!(await file.exists())) {
    console.warn(`${iso2}: catalog-${iso2}.ndjson mancante, saltato`);
    continue;
  }
  found++;
  for (const s of await readNdjson<SeriesObject>(`${dataDir}/catalog-${iso2}.ndjson`)) {
    const m = merged.get(s.id);
    if (m) m.countries.push(iso2);
    else merged.set(s.id, { ...s, countries: [iso2] });
  }
  const seasonsFile = Bun.file(`${dataDir}/catalog-seasons-${iso2}.ndjson`);
  if (!(await seasonsFile.exists())) continue; // artifact di prima delle stagioni per paese: la pagina userà i conteggi del catalogo
  for (const { id, seasons } of await readNdjson<{ id: string; seasons: Season[] }>(`${dataDir}/catalog-seasons-${iso2}.ndjson`)) {
    if (!seasonsBy.has(id)) seasonsBy.set(id, new Map());
    seasonsBy.get(id)!.set(iso2, seasons);
  }
}
if (!found) throw new Error("nessun catalog-<ISO2>.ndjson in data/");

const key = (title: string) => title.trim().toLowerCase();
let partial = 0;
for (const [id, byCountry] of seasonsBy) {
  const s = merged.get(id);
  if (!s) continue;
  const union = new Map<string, [title: string, episodes: number]>();
  const order = new Map<string, number>(); // il primo posto in cui la stagione compare, fra i paesi
  for (const seasons of byCountry.values())
    for (const x of seasons) {
      if ((union.get(key(x.title))?.[1] ?? -1) < x.number_of_episodes) union.set(key(x.title), [x.title, x.number_of_episodes]);
      order.set(key(x.title), Math.min(order.get(key(x.title)) ?? Infinity, x.season_sequence_number));
    }
  const unionEpisodes = [...union.values()].reduce((a, [, n]) => a + n, 0);
  s.union = { seasons: union.size, episodes: unionEpisodes };
  s.availability = {};
  for (const [iso2, seasons] of byCountry) {
    const have = new Set(seasons.map((x) => key(x.title)));
    const missing = [...union].filter(([k]) => !have.has(k)).map(([, v]) => v);
    s.availability[iso2] = { seasons: seasons.length, episodes: seasons.reduce((a, x) => a + x.number_of_episodes, 0), missing };
    if (missing.length) partial++;
  }
  const keys = [...union.keys()].sort((a, b) => order.get(a)! - order.get(b)!);
  s.matrix = {
    seasons: keys.map((k) => union.get(k)!),
    by: Object.fromEntries([...byCountry].map(([iso2, seasons]) => {
      const eps = new Map(seasons.map((x) => [key(x.title), x.number_of_episodes]));
      return [iso2, keys.map((k) => eps.get(k) ?? 0)];
    })),
  };
}
// L'ultima puntata, letta da catalog.ts solo dall'Italia (vedi latest-episode.ts); assente negli artifact di prima.
const latestFile = Bun.file(`${dataDir}/catalog-latest-IT.ndjson`);
if (await latestFile.exists())
  for (const { id, latest } of await readNdjson<{ id: string; latest: string | null }>(`${dataDir}/catalog-latest-IT.ndjson`)) {
    const s = merged.get(id);
    if (s) s.latest_episode = latest;
  }
const all = [...merged.values()];
await Bun.write(`${dataDir}/catalog.ndjson`, all.map((s) => JSON.stringify(s)).join("\n") + "\n");
console.log(
  `${all.length} serie da ${found} paesi salvate in ${dataDir}/catalog.ndjson; ` +
    `stagioni per paese per ${seasonsBy.size} serie, ${partial} coppie serie-paese con stagioni mancanti`,
);
