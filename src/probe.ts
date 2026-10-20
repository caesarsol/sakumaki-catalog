import { cms, loginAnonymous, setDefaultProxy } from "./api";
import { COUNTRIES } from "./countries";
import { randomProxy } from "./nordvpn";

// Sonda: stagioni e puntate di una serie viste da paesi diversi, con lo stato di disponibilità delle puntate.
// Stampa solo dati pubblici del catalogo (titoli, conteggi, stati), mai host o token.
const seriesId = Bun.argv[2] ?? "GYQ4MKDZ6";
type Season = { id: string; season_number: number; season_sequence_number: number; number_of_episodes: number; title: string; availability_notes?: string };
type Episode = { id: string; episode: string; availability_status?: string; is_premium_only?: boolean; eligible_region?: string; availability_starts?: string; availability_ends?: string };

for (const iso2 of ["IT", "US"]) {
  const c = COUNTRIES.find((x) => x.iso2 === iso2)!;
  try {
    const proxy = (await randomProxy(c.nordId)).url;
    const token = await loginAnonymous(proxy);
    setDefaultProxy(proxy);
    console.log(`\n=== ${iso2}: l'API ci vede in ${token.country}`);
    const seasons = (await cms<Season>(token, `series/${seriesId}/seasons`)).sort((a, b) => a.season_sequence_number - b.season_sequence_number);
    let listed = 0, available = 0;
    for (const s of seasons) {
      const eps = await cms<Episode>(token, `seasons/${s.id}/episodes`);
      const byStatus: Record<string, number> = {};
      for (const e of eps) byStatus[e.availability_status ?? "?"] = (byStatus[e.availability_status ?? "?"] ?? 0) + 1;
      listed += eps.length;
      available += byStatus["available"] ?? 0;
      const ends = eps.map((e) => e.availability_ends).filter(Boolean).sort()[0];
      console.log(`  seq ${String(s.season_sequence_number).padStart(2)} "${s.title}": dichiarate ${s.number_of_episodes}, elencate ${eps.length}, stati ${JSON.stringify(byStatus)}${ends ? `, fine disponibilità più vicina ${ends.slice(0, 10)}` : ""}${s.availability_notes ? `, note: ${s.availability_notes}` : ""}`);
      await Bun.sleep(300);
    }
    console.log(`  totale: ${seasons.length} stagioni, ${listed} puntate elencate, ${available} disponibili`);
  } catch (e) {
    console.log(`=== ${iso2}: ${(e as Error).message}`);
  }
  setDefaultProxy(undefined);
}
