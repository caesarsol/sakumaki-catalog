import { fetchCatalog, loginAnonymous, type SeriesObject } from "./api";
import { seasonsByCountry, type Season } from "./catalog-seasons";
import { COUNTRIES, type Country } from "./countries";
import { latestEpisodes, type Latest } from "./latest-episode";
import { randomProxy } from "./nordvpn";

/**
 * Legge il catalogo da ogni paese in COUNTRIES con un token anonimo attraverso un proxy NordVPN, e per ogni
 * serie le stagioni che quel paese vede. Salva data/catalog-<ISO2>.ndjson (le serie) e
 * data/catalog-seasons-<ISO2>.ndjson (una riga per serie con le sue stagioni, risposte intere); la fusione
 * la fa merge.ts. Un paese fallito non ferma gli altri: esce con 1 alla fine.
 *
 * Cinque paesi alla volta, ognuno col suo proxy. I login invece passano uno per volta, a distanza casuale:
 * dopo una raffica di autenticazioni il backend dei proxy Nord ha risposto 407 per circa 25 minuti.
 */
const dataDir = `${import.meta.dir}/../data`;
const ndjson = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const PARALLEL = Number(Bun.env.CATALOG_PARALLEL || 5);
// Fra un login e il successivo, fra tutti i paesi: casuale, così i login non arrivano a intervalli regolari.
const LOGIN_GAP_S = [Number(Bun.env.LOGIN_GAP_MIN_S ?? 20), Number(Bun.env.LOGIN_GAP_MAX_S ?? 45)] as const;
// Prima di ritentare un paese fallito: lunga, per uscire da un eventuale blocco 407 dei proxy.
const RETRY_PAUSE_MS = Number(Bun.env.COUNTRY_PAUSE_S || 300) * 1000;

const HOME = "IT";
const latestFile = `${dataDir}/catalog-latest-${HOME}.ndjson`;
/** Le date della settimana scorsa, dall'artifact precedente: le serie col last_public invariato non si rileggono. */
async function previousLatest(): Promise<Record<string, Latest>> {
  if (!(await Bun.file(latestFile).exists())) return {};
  const rows = (await Bun.file(latestFile).text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Latest & { id: string });
  return Object.fromEntries(rows.map(({ id, ...l }) => [id, l]));
}

let nextLogin = 0;
/** Il turno per il prossimo login, condiviso da tutti i paesi in corso. */
async function loginTurn() {
  const slot = Math.max(Date.now(), nextLogin);
  const [min, max] = LOGIN_GAP_S;
  nextLogin = slot + (min + Math.random() * (max - min)) * 1000;
  await Bun.sleep(slot - Date.now());
}

/** Due server diversi, con la pausa lunga in mezzo: Nord può non rispondere, un proxy rifiutare, o l'API vederci in un paese diverso da quello atteso. */
async function catalogFrom(country: Country): Promise<{ series: SeriesObject[]; seasons: Map<string, Season[]>; latest?: Record<string, Latest> }> {
  for (let attempt = 1; ; attempt++) {
    let host = "?";
    try {
      await loginTurn();
      const proxy = await randomProxy(country.nordId);
      host = proxy.host;
      const token = await loginAnonymous(proxy.url);
      if (token.country !== country.iso2) throw new Error(`visti come ${token.country}`);
      const series = await fetchCatalog(token, "en-US", proxy.url);
      console.log(`${country.iso2}: ${series.length} serie`);
      const seasons = await seasonsByCountry(token, series.map((s) => s.id), proxy.url, country.iso2);
      // L'ultima puntata solo da casa, con le stagioni appena lette: le date sono quelle del servizio, uguali ovunque.
      const latest = country.iso2 === HOME ? await latestEpisodes(async () => token, series, await previousLatest(), { proxy: proxy.url, seasons, label: HOME }) : undefined;
      return { series, seasons, latest };
    } catch (e) {
      console.warn(`${country.iso2} via ${host}, tentativo ${attempt}: ${(e as Error).message}`);
      if (attempt === 2) throw e;
      await Bun.sleep(RETRY_PAUSE_MS);
    }
  }
}

const only = Bun.argv.slice(2); // es. `bun run catalog IN AU` per rifare solo alcuni paesi
// I file di paesi tolti da COUNTRIES (il Giappone): l'artifact della settimana prima li riporterebbe avanti per sempre.
if (!only.length)
  for (const name of await Array.fromAsync(new Bun.Glob("catalog-*.ndjson").scan(dataDir))) {
    const iso2 = name.match(/^catalog-(?:seasons-)?([A-Z]{2})\.ndjson$/)?.[1];
    if (iso2 && !COUNTRIES.some((c) => c.iso2 === iso2)) await Bun.file(`${dataDir}/${name}`).delete();
  }
const queue = [...(only.length ? COUNTRIES.filter((c) => only.includes(c.iso2)) : COUNTRIES)];
const failed: string[] = [];
const t0 = Date.now();
async function run(country: Country) {
  const { series, seasons, latest } = await catalogFrom(country);
  await Bun.write(`${dataDir}/catalog-${country.iso2}.ndjson`, ndjson(series));
  await Bun.write(`${dataDir}/catalog-seasons-${country.iso2}.ndjson`, ndjson([...seasons].map(([id, data]) => ({ id, seasons: data }))));
  if (latest) await Bun.write(latestFile, ndjson(Object.entries(latest).map(([id, l]) => ({ id, ...l }))));
}
async function worker() {
  for (let country = queue.shift(); country; country = queue.shift()) await run(country).catch(() => failed.push(country.iso2));
}
await Promise.all(Array.from({ length: PARALLEL }, worker));
// Un ultimo tentativo per i paesi falliti, da soli, quando gli altri hanno finito: il 20 ottobre 2026 l'Australia
// ha preso 407 dal proxy a metà run, con gli altri paesi ancora attivi, a entrambi i tentativi.
for (const iso2 of failed.splice(0)) {
  const country = COUNTRIES.find((c) => c.iso2 === iso2)!;
  console.log(`${iso2}: ultimo tentativo, a run finito`);
  await Bun.sleep(RETRY_PAUSE_MS);
  await run(country).catch(() => failed.push(iso2));
}
console.log(`catalogo letto in ${Math.round((Date.now() - t0) / 60000)} minuti, ${PARALLEL} paesi alla volta`);
if (failed.length) {
  console.error(`paesi falliti: ${failed.join(", ")}`);
  process.exit(1);
}
