import { cms, type AnonToken } from "./api";

/**
 * Quando è arrivata l'ultima puntata di una serie: la `premium_available_date` più recente fra le puntate di
 * tutte le sue stagioni. È la data in cui la puntata compare sul servizio, non quella di messa in onda: Paw &
 * Palaces, cinese del 2025, arriva una puntata a settimana nell'ottobre 2026. I doppiaggi sono versioni della
 * puntata originale, non puntate nuove, e non la spostano.
 *
 * `last_public` della serie no: la sonda del 21 ottobre 2026 l'ha trovato spostato anche dai doppiaggi
 * (Gachiakuta: ultima puntata il 21 dicembre 2025, last_public il 23 settembre 2026). Però si sposta sempre
 * quando arriva una puntata, quindi fa da segnale: una serie col last_public di ieri non ha puntate nuove, e
 * le sue puntate non si rileggono. Così solo il primo run le legge tutte.
 */
export type Latest = { last_public: string; latest: string | null };
type Episode = { premium_available_date?: string };

const SPACING_MS = 250; // come le stagioni del catalogo: 4 partenze al secondo, nessun rifiuto
const WORKERS = 2;

/** La data più recente già passata: le puntate annunciate hanno la data futura, e alcune il segnaposto 9998. */
function newest(episodes: Episode[], now: number): string | null {
  let best: string | null = null;
  for (const e of episodes) {
    const d = e.premium_available_date;
    if (d && Date.parse(d) <= now && (!best || d > best)) best = d;
  }
  return best;
}

export async function latestEpisodes(
  token: () => Promise<AnonToken>,
  series: { id: string; last_public?: string }[],
  previous: Record<string, Latest>,
  opts: { proxy?: string; seasons?: Map<string, { id: string }[]>; label: string },
): Promise<Record<string, Latest>> {
  const out: Record<string, Latest> = {};
  const todo = series.filter((s) => {
    const p = previous[s.id];
    if (p && s.last_public && p.last_public === s.last_public) out[s.id] = p;
    return !out[s.id];
  });
  const errors: Record<string, number> = {};
  const now = Date.now();
  let next = 0;
  let i = 0;
  let calls = 0;
  const call = async <T>(path: string) => {
    const slot = Math.max(Date.now(), next);
    next = slot + SPACING_MS;
    await Bun.sleep(slot - Date.now());
    calls++;
    return cms<T>(await token(), path, "en-US", opts.proxy);
  };
  const worker = async () => {
    while (i < todo.length) {
      const s = todo[i++]!;
      try {
        const seasons = opts.seasons?.get(s.id) ?? (await call<{ id: string }>(`series/${s.id}/seasons`));
        let latest: string | null = null;
        for (const x of seasons) {
          const d = newest(await call<Episode>(`seasons/${x.id}/episodes`), now);
          if (d && (!latest || d > latest)) latest = d;
        }
        out[s.id] = { last_public: s.last_public ?? "", latest };
      } catch (e) {
        const err = e as { status?: number; code?: unknown; name?: string };
        const k = String(err.status ?? (typeof err.code === "string" ? err.code : err.name) ?? "?");
        errors[k] = (errors[k] ?? 0) + 1;
        // Si tiene la data vecchia ma non il suo last_public, così al prossimo run la serie si rilegge.
        if (previous[s.id]) out[s.id] = { last_public: "", latest: previous[s.id]!.latest };
      }
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, worker));
  console.log(
    `${opts.label}: ultima puntata di ${series.length} serie, ${todo.length} rilette (last_public cambiato o nuove), ` +
      `${calls} chiamate in ${Math.round((Date.now() - t0) / 1000)} s, errori ${JSON.stringify(errors)}`,
  );
  return out;
}
