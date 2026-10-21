import { cms, fetchCatalog, loginAnonymous } from "./api";
import { COUNTRIES } from "./countries";
import { randomProxy } from "./nordvpn";

// Sonda date: il catalogo ha `last_public`, ma vuol dire "uscita una puntata nuova" o cambia anche per un
// doppiaggio o un sottotitolo? Dall'Italia, per alcune serie note, confronta last_public con le date delle
// ultime puntate (stagioni e puntate per intero, solo i campi che sembrano date). Stampa solo dati pubblici.
const proxy = (await randomProxy(COUNTRIES.find((c) => c.iso2 === "IT")!.nordId)).url;
const token = await loginAnonymous(proxy);
const series = await fetchCatalog(token, "en-US", proxy);
console.log(`IT: ${series.length} serie; campi di primo livello: ${Object.keys(series[0]!).join(",")}`);
const dateKeys = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([k, v]) => /date|public|updated|_at$|new|simulcast|starts|ends/i.test(k) && typeof v !== "object"));

const wanted = [/^Frieren/, /^One Piece$/, /^DAN DA DAN$/, /^SPY x FAMILY$/, /^Gachiakuta$/, /^Dr\. STONE$/];
const recent = [...series].sort((a, b) => String(b.last_public).localeCompare(String(a.last_public))).slice(0, 6);
const picks = [...series.filter((s) => wanted.some((r) => r.test(s.title))), ...recent];
let shownKeys = false;
for (const s of picks) {
  console.log(`\n### ${s.title} (${s.id}) last_public ${s.last_public}, altri: ${JSON.stringify(dateKeys(s as never))}, meta: ${JSON.stringify(dateKeys((s as any).series_metadata ?? {}))}`);
  const seasons = await cms<any>(token, `series/${s.id}/seasons`, "en-US", proxy);
  if (!shownKeys) console.log(`campi stagione: ${Object.keys(seasons[0] ?? {}).join(",")}`);
  for (const x of seasons) console.log(`  stagione ${x.season_sequence_number} "${x.title}" ${x.number_of_episodes} pt, audio ${x.audio_locale ?? x.audio_locales}, ${JSON.stringify(dateKeys(x))}`);
  const last = [...seasons].sort((a, b) => b.season_sequence_number - a.season_sequence_number).slice(0, 2);
  for (const x of last) {
    const eps = await cms<any>(token, `seasons/${x.id}/episodes`, "en-US", proxy);
    if (!shownKeys) {
      console.log(`campi puntata: ${Object.keys(eps[0] ?? {}).join(",")}`);
      shownKeys = true;
    }
    for (const e of eps.slice(-3))
      console.log(`    pt ${e.sequence_number} "${String(e.title).slice(0, 30)}" audio ${e.audio_locale}, versioni ${(e.versions ?? []).length}, ${JSON.stringify(dateKeys(e))}`);
    const versionDates = eps.at(-1)?.versions?.map((v: any) => `${v.audio_locale}${v.original ? "*" : ""}`).join(" ");
    if (versionDates) console.log(`    versioni dell'ultima: ${versionDates}`);
    await Bun.sleep(300);
  }
}
