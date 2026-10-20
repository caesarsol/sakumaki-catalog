import { cms, loginAnonymous, setDefaultProxy } from "./api";
import { COUNTRIES } from "./countries";
import { randomProxy } from "./nordvpn";

// Sonda: per le prime 100 serie per V Bayes disponibili in Italia, quante stagioni e puntate restituisce
// l'API dall'Italia rispetto ai conteggi del catalogo. Stampa solo dati pubblici, mai host o token.
type Row = { id: string; title: string; countries: string[]; rating_weighted: number; series_metadata: { season_count: number; episode_count: number } };
type Season = { id: string; season_sequence_number: number; number_of_episodes: number; title: string };

const scored: Row[] = (await Bun.file("data/catalog-scored.ndjson").text()).trim().split("\n").map((l) => JSON.parse(l));
const top = scored.filter((s) => s.countries.includes("IT")).slice(0, 100);
const it = COUNTRIES.find((c) => c.iso2 === "IT")!;
const proxy = (await randomProxy(it.nordId)).url;
const token = await loginAnonymous(proxy);
setDefaultProxy(proxy);
console.log(`l'API ci vede in ${token.country}; ${top.length} serie, dalla ${top[0].title} (${top[0].rating_weighted}) alla ${top.at(-1)!.title} (${top.at(-1)!.rating_weighted})`);

let full = 0, partial = 0, failed = 0;
const lines: string[] = [];
for (const [i, s] of top.entries()) {
  try {
    const seasons = await cms<Season>(token, `series/${s.id}/seasons`);
    const eps = seasons.reduce((a, x) => a + x.number_of_episodes, 0);
    const m = s.series_metadata;
    if (eps >= m.episode_count) full++;
    else {
      partial++;
      lines.push(`  #${String(i + 1).padStart(3)} ${s.title}: in Italia ${seasons.length}/${m.season_count} stagioni, ${eps}/${m.episode_count} puntate — ci sono: ${seasons.sort((a, b) => a.season_sequence_number - b.season_sequence_number).map((x) => `"${x.title}" (${x.number_of_episodes})`).join(", ")}`);
    }
  } catch (e) {
    failed++;
    lines.push(`  #${i + 1} ${s.title}: ${(e as Error).message}`);
  }
  await Bun.sleep(300);
}
console.log(`complete in Italia: ${full}; parziali: ${partial}; non lette: ${failed}`);
for (const l of lines) console.log(l);
