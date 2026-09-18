import type { SeriesObject } from "./api";
import { COUNTRIES } from "./countries";

/**
 * Fonde i data/catalog-<ISO2>.ndjson presenti in data/catalog.ndjson: una riga per serie,
 * con `countries` = paesi in cui è disponibile. I paesi senza file sono saltati con un avviso.
 */
const dataDir = `${import.meta.dir}/../data`;
const merged = new Map<string, SeriesObject & { countries: string[] }>();
let found = 0;
for (const { iso2 } of COUNTRIES) {
  const file = Bun.file(`${dataDir}/catalog-${iso2}.ndjson`);
  if (!(await file.exists())) {
    console.warn(`${iso2}: catalog-${iso2}.ndjson mancante, saltato`);
    continue;
  }
  found++;
  const series: SeriesObject[] = (await file.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const s of series) {
    const m = merged.get(s.id);
    if (m) m.countries.push(iso2);
    else merged.set(s.id, { ...s, countries: [iso2] });
  }
}
if (!found) throw new Error("nessun catalog-<ISO2>.ndjson in data/");
const all = [...merged.values()];
await Bun.write(`${dataDir}/catalog.ndjson`, all.map((s) => JSON.stringify(s)).join("\n") + "\n");
console.log(`${all.length} serie da ${found} paesi salvate in ${dataDir}/catalog.ndjson`);
