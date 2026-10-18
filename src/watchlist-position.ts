import { cms, type Token, type WatchlistItem } from "./api";

/**
 * Quante puntate di una serie hai visto, contate sulla lista delle sue puntate: tutte quelle prima della
 * puntata da cui riprendere, più quella se è finita. Quel che c'è prima si dà per visto, ed è quel che
 * succede davvero: la watchlist riprende sempre dall'ultima puntata toccata.
 *
 * Non si può fare con i numeri del pannello. `episode_number` a volte conta dall'inizio della serie
 * (SPY x FAMILY S3 E48), a volte dall'inizio della stagione; `season_number` salta (Solo Leveling ha le
 * stagioni 1 e 3, Hakuoki la 101) e `sequence_number` non conta gli speciali in testa alla stagione. Le
 * stagioni in ordine di `season_sequence_number`, con il loro numero di puntate, e l'indice della puntata
 * nella sua stagione sono invece esatti, e la somma delle stagioni coincide con `episode_count` del catalogo.
 * Due chiamate CMS per serie, un decimo di secondo l'una.
 */
type Season = { id: string; season_sequence_number: number; number_of_episodes: number };
type Episode = { id: string; versions?: { guid: string }[] | null };
export type Position = { done: number; total: number };

const CMS_PAUSE_MS = 250;

async function position(token: Token, w: WatchlistItem): Promise<Position | null> {
  const ep = w.panel.episode_metadata as (WatchlistItem["panel"]["episode_metadata"] & { season_id: string }) | undefined;
  if (!ep) return null;
  const seasons = (await cms<Season>(token, `series/${ep.series_id}/seasons`)).sort((a, b) => a.season_sequence_number - b.season_sequence_number);
  const total = seasons.reduce((acc, s) => acc + s.number_of_episodes, 0);
  const i = seasons.findIndex((s) => s.id === ep.season_id);
  if (i < 0) return null;
  await Bun.sleep(CMS_PAUSE_MS);
  // Il pannello può essere una versione doppiata della puntata: la si riconosce fra le versioni.
  const episodes = await cms<Episode>(token, `seasons/${ep.season_id}/episodes`);
  const j = episodes.findIndex((e) => e.id === w.panel.id || e.versions?.some((v) => v.guid === w.panel.id));
  if (j < 0) return null;
  const before = seasons.slice(0, i).reduce((acc, s) => acc + s.number_of_episodes, 0);
  return { done: Math.min(total, before + j + (w.fully_watched ? 1 : 0)), total };
}

/** Le posizioni per serie; una serie che non si riesce a contare resta fuori, e nella pagina avrà solo le barrette grigie. */
export async function episodePositions(token: Token, items: WatchlistItem[]): Promise<Record<string, Position>> {
  const out: Record<string, Position> = {};
  let failed = 0;
  const t0 = Date.now();
  for (const w of items) {
    const id = w.panel.episode_metadata?.series_id;
    if (!id || out[id]) continue;
    const p = await position(token, w).catch(() => null);
    if (p) out[id] = p;
    else failed++;
    await Bun.sleep(CMS_PAUSE_MS);
  }
  console.log(`puntate viste: ${Object.keys(out).length} serie contate, ${failed} no, in ${Math.round((Date.now() - t0) / 1000)} s`);
  return out;
}
