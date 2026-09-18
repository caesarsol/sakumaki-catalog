import { fetchCatalog, loginAnonymous, type SeriesObject } from "./api";
import { COUNTRIES, type Country } from "./countries";
import { randomProxy } from "./nordvpn";

/**
 * Legge il catalogo da ogni paese in COUNTRIES con un token anonimo attraverso un proxy NordVPN e salva
 * data/catalog-<ISO2>.ndjson (la fusione la fa merge.ts). Un paese fallito non ferma gli altri: esce con 1 alla fine.
 */
const dataDir = `${import.meta.dir}/../data`;
const ndjson = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
// Fra un paese e l'altro e fra due tentativi: dopo una raffica di autenticazioni il backend dei proxy Nord ha risposto 407 per ~25 minuti.
const COUNTRY_PAUSE_MS = Number(Bun.env.COUNTRY_PAUSE_S || 300) * 1000;

/** Due server diversi, con la pausa lunga in mezzo: Nord può non rispondere, un proxy rifiutare, o l'API vederci in un paese diverso da quello atteso. */
async function catalogFrom(country: Country): Promise<SeriesObject[]> {
  for (let attempt = 1; ; attempt++) {
    let host = "?";
    try {
      const proxy = await randomProxy(country.nordId);
      host = proxy.host;
      const token = await loginAnonymous(proxy.url);
      if (token.country !== country.iso2) throw new Error(`visti come ${token.country}`);
      return await fetchCatalog(token, "en-US", proxy.url);
    } catch (e) {
      console.warn(`${country.iso2} via ${host}, tentativo ${attempt}: ${(e as Error).message}`);
      if (attempt === 2) throw e;
      await Bun.sleep(COUNTRY_PAUSE_MS);
    }
  }
}

const only = Bun.argv.slice(2); // es. `bun run catalog IN AU` per rifare solo alcuni paesi
const targets = only.length ? COUNTRIES.filter((c) => only.includes(c.iso2)) : COUNTRIES;
const failed: string[] = [];
for (const country of targets) {
  try {
    const series = await catalogFrom(country);
    await Bun.write(`${dataDir}/catalog-${country.iso2}.ndjson`, ndjson(series));
    console.log(`${country.iso2}: ${series.length} serie`);
  } catch {
    failed.push(country.iso2);
  }
  await Bun.sleep(COUNTRY_PAUSE_MS);
}
if (failed.length) {
  console.error(`paesi falliti: ${failed.join(", ")}`);
  process.exit(1);
}
