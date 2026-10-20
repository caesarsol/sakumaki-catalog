import { loginAnonymous, REQUEST_TIMEOUT_MS, type AnonToken } from "./api";
import { COUNTRIES } from "./countries";
import { randomProxy } from "./nordvpn";

// Sonda: per le prime 100 serie per V Bayes disponibili in Italia, le stagioni viste dall'Italia e dagli USA,
// con i due paesi in parallelo (un proxy ciascuno) per misurare i tempi. Stampa solo dati pubblici del
// catalogo, mai host o token.
type Row = { id: string; title: string; countries: string[]; rating_weighted: number; series_metadata: { season_count: number; episode_count: number } };
type Season = { id: string; season_sequence_number: number; number_of_episodes: number; title: string };
const BASE = Bun.env.API_BASE!;
const N = Number(Bun.argv[2] ?? 100);
const SPACING_MS = 250; // fra una partenza e l'altra, per paese
const WORKERS = 2; // chiamate in volo per paese

const scored: Row[] = (await Bun.file("data/catalog-scored.ndjson").text()).trim().split("\n").map((l) => JSON.parse(l));
const top = scored.filter((s) => s.countries.includes("IT")).slice(0, N);

async function country(iso2: string) {
  const c = COUNTRIES.find((x) => x.iso2 === iso2)!;
  const proxy = (await randomProxy(c.nordId)).url;
  const token: AnonToken = await loginAnonymous(proxy);
  if (token.country !== iso2) throw new Error(`${iso2}: visti come ${token.country}`);
  const out = new Map<string, Season[]>();
  const errors: Record<string, number> = {};
  let next = 0, i = 0;
  const t0 = Date.now();
  const worker = async () => {
    while (i < top.length) {
      const s = top[i++];
      const slot = Math.max(Date.now(), next);
      next = slot + SPACING_MS;
      await Bun.sleep(slot - Date.now());
      const url = new URL(`${BASE}/content/v2/cms/series/${s.id}/seasons`);
      url.search = new URLSearchParams({ locale: "en-US" }).toString();
      try {
        const res = await fetch(url, { proxy, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Authorization: `Bearer ${token.access_token}` } });
        if (!res.ok) { errors[res.status] = (errors[res.status] ?? 0) + 1; continue; }
        out.set(s.id, ((await res.json()) as { data: Season[] }).data);
      } catch (e) {
        const k = (e as { code?: string }).code ?? (e as Error).name;
        errors[k] = (errors[k] ?? 0) + 1;
      }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  const secs = (Date.now() - t0) / 1000;
  console.log(`${iso2}: ${out.size}/${top.length} serie lette in ${secs.toFixed(0)} s (${(secs / top.length).toFixed(2)} s a serie), errori ${JSON.stringify(errors)}`);
  return out;
}

const [itMap, usMap] = await Promise.all([country("IT"), country("US")]);
const eps = (ss: Season[]) => ss.reduce((a, x) => a + x.number_of_episodes, 0);
let full = 0;
const partial: string[] = [];
for (const [i, s] of top.entries()) {
  const it = itMap.get(s.id), us = usMap.get(s.id);
  if (!it || !us) { partial.push(`  #${i + 1} ${s.title}: non letta (IT ${!!it}, US ${!!us})`); continue; }
  const itIds = new Set(it.map((x) => x.id)), usIds = new Set(us.map((x) => x.id));
  const missing = us.filter((x) => !itIds.has(x.id)), onlyIt = it.filter((x) => !usIds.has(x.id));
  if (eps(it) >= s.series_metadata.episode_count && !missing.length) { full++; continue; }
  partial.push(
    `  #${String(i + 1).padStart(3)} ${s.title}: catalogo ${s.series_metadata.episode_count}, IT ${eps(it)}, US ${eps(us)} puntate` +
      (missing.length ? `; mancano in IT: ${missing.map((x) => `"${x.title}" (${x.number_of_episodes})`).join(", ")}` : "") +
      (onlyIt.length ? `; solo in IT: ${onlyIt.map((x) => `"${x.title}" (${x.number_of_episodes})`).join(", ")}` : "") +
      (eps(us) < s.series_metadata.episode_count ? `; manca qualcosa anche negli USA` : ""),
  );
}
console.log(`\ncomplete in Italia: ${full}; parziali o non lette: ${partial.length}`);
for (const l of partial) console.log(l);
