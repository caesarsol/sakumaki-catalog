import { cms, type AnonToken } from "./api";

/**
 * Le stagioni di ogni serie come le vede un paese. Il catalogo dà `season_count` ed `episode_count` uguali
 * ovunque, ma non sono quelli guardabili: dall'Italia Gintama ha 5 stagioni su 12 (dalla puntata 266) e
 * Attack on Titan non ha la prima. L'elenco delle stagioni chiesto da un paese è invece già filtrato.
 * Le risposte si tengono intere, non solo i conteggi: servono a ricostruire uno storico di qualsiasi campo.
 */
export type Season = { id: string; title: string; season_sequence_number: number; number_of_episodes: number; [k: string]: unknown };

const SPACING_MS = 250; // fra una partenza e l'altra; misurato il 20 ottobre 2026: 4 al secondo per paese, nessun rifiuto
const WORKERS = 2; // chiamate in volo: la risposta via proxy impiega circa mezzo secondo

/** Stagioni per serie; una serie che non si riesce a leggere resta fuori, e nella pagina vale come "non so". */
export async function seasonsByCountry(token: AnonToken, seriesIds: string[], proxy: string, iso2: string): Promise<Map<string, Season[]>> {
  const out = new Map<string, Season[]>();
  const errors: Record<string, number> = {};
  const count = (k: string | number) => (errors[k] = (errors[k] ?? 0) + 1);
  let next = 0;
  let i = 0;
  const t0 = Date.now();
  const worker = async () => {
    while (i < seriesIds.length) {
      const id = seriesIds[i++]!;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const slot = Math.max(Date.now(), next);
        next = slot + SPACING_MS;
        await Bun.sleep(slot - Date.now());
        try {
          out.set(id, await cms<Season>(token, `series/${id}/seasons`, "en-US", proxy));
          break;
        } catch (e) {
          const err = e as { status?: number; code?: string; name?: string };
          count(err.status ?? err.code ?? err.name ?? "?"); // 407: il proxy rifiuta l'autenticazione
          if (err.status === 404) break; // serie sparita fra il browse e adesso: non c'è niente da ritentare
          await Bun.sleep(5000 * attempt);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  const bytes = [...out.values()].reduce((a, s) => a + JSON.stringify(s).length, 0);
  console.log(
    `${iso2}: stagioni di ${out.size}/${seriesIds.length} serie in ${Math.round((Date.now() - t0) / 1000)} s, ` +
      `${(bytes / 1e6).toFixed(1)} MB di risposte, errori ${JSON.stringify(errors)}`,
  );
  return out;
}
