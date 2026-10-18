import { cms, fetchPlayheads, type Token, type WatchlistItem } from "./api";

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
 * Due chiamate CMS per serie, un decimo di secondo l'una: in tutto più dei 5 minuti di vita del token,
 * per questo il token lo chiede ogni volta a `token()`, che lo rinnova quando serve.
 */
type Season = { id: string; season_sequence_number: number; number_of_episodes: number; versions?: { guid: string }[] | null };
type Episode = { id: string; versions?: { guid: string }[] | null };
// started: la puntata dopo le `done` è iniziata e non finita, e nella pagina è mezza barretta
export type Position = { done: number; total: number; started: boolean };

const CMS_PAUSE_MS = 250;

async function position(token: Token, w: WatchlistItem): Promise<Position | string> {
  const ep = w.panel.episode_metadata as (WatchlistItem["panel"]["episode_metadata"] & { season_id: string; season_sequence_number: number }) | undefined;
  if (!ep) return "senza metadati";
  const seasons = (await cms<Season>(token, `series/${ep.series_id}/seasons`)).sort((a, b) => a.season_sequence_number - b.season_sequence_number);
  const total = seasons.reduce((acc, s) => acc + s.number_of_episodes, 0);
  // Il pannello porta l'id della stagione nella versione che stai guardando (di solito la giapponese,
  // "…JAJP"), l'elenco dà la stagione principale con le altre versioni in `versions`; di riserva il
  // numero d'ordine, che il pannello ha uguale.
  let i = seasons.findIndex((s) => s.id === ep.season_id || s.versions?.some((v) => v.guid === ep.season_id));
  if (i < 0) i = seasons.findIndex((s) => s.season_sequence_number === ep.season_sequence_number);
  if (i < 0) return "stagione non trovata";
  await Bun.sleep(CMS_PAUSE_MS);
  // Il pannello può essere una versione doppiata della puntata: la si riconosce fra le versioni.
  const episodes = await cms<Episode>(token, `seasons/${ep.season_id}/episodes`);
  const j = episodes.findIndex((e) => e.id === w.panel.id || e.versions?.some((v) => v.guid === w.panel.id));
  if (j < 0) return "puntata non trovata";
  const before = seasons.slice(0, i).reduce((acc, s) => acc + s.number_of_episodes, 0);
  const done = Math.min(total, before + j + (w.fully_watched ? 1 : 0));
  return { done, total, started: done < total && !w.fully_watched && !w.never_watched };
}

/**
 * La stessa posizione senza pannello, per le serie col segnalibro che la lista discover non dà o dà con il
 * film o recap che le segue (Bocchi, finita, compare come "Recap Part 2"): tutte le puntate della serie in
 * ordine, e il loro stato di visione chiesto in blocco. L'ultima puntata toccata fa da puntata da cui
 * riprendere, e quelle prima si danno per viste come nell'altro caso. Una chiamata per stagione più una
 * ogni 100 id: si usa solo dove serve.
 */
async function positionFromPlayheads(token: Token, seriesId: string): Promise<Position | string> {
  const seasons = (await cms<Season>(token, `series/${seriesId}/seasons`)).sort((a, b) => a.season_sequence_number - b.season_sequence_number);
  const episodes: string[][] = []; // per ogni puntata, i suoi id: quello principale e quelli delle versioni
  for (const s of seasons) {
    await Bun.sleep(CMS_PAUSE_MS);
    for (const e of await cms<Episode>(token, `seasons/${s.id}/episodes`)) episodes.push([e.id, ...(e.versions ?? []).map((v) => v.guid)]);
  }
  if (!episodes.length) return "nessuna puntata";
  const state = new Map<string, { playhead: number; fully_watched: boolean }>();
  const ids = [...new Set(episodes.flat())];
  for (let i = 0; i < ids.length; i += 100) {
    await Bun.sleep(CMS_PAUSE_MS);
    for (const p of await fetchPlayheads(token, ids.slice(i, i + 100))) state.set(p.content_id, p);
  }
  const touched = (ep: string[]) => ep.map((id) => state.get(id)).filter((p) => p && (p.fully_watched || p.playhead > 0));
  const last = episodes.findLastIndex((ep) => touched(ep).length > 0);
  if (last < 0) return { done: 0, total: episodes.length, started: false };
  const finished = touched(episodes[last]).some((p) => p!.fully_watched);
  return { done: last + (finished ? 1 : 0), total: episodes.length, started: !finished };
}

/**
 * Le posizioni per serie: dal pannello per le voci discover, dai playhead per le serie col segnalibro senza
 * voce (`extra`) e per quelle il cui pannello non si riesce a collocare. Una serie che non si riesce a contare
 * resta fuori, e nella pagina avrà solo le barrette grigie.
 */
export async function episodePositions(token: () => Promise<Token>, items: WatchlistItem[], extra: string[] = []): Promise<Record<string, Position>> {
  const out: Record<string, Position> = {};
  const failed: Record<string, number> = {};
  const t0 = Date.now();
  for (const w of items) {
    const id = w.panel.episode_metadata?.series_id;
    if (!id || out[id]) continue;
    let p = await position(await token(), w).catch((e: Error) => e.message);
    if (typeof p === "string") p = await positionFromPlayheads(await token(), id).catch((e: Error) => e.message);
    if (typeof p === "string") failed[p] = (failed[p] ?? 0) + 1;
    else out[id] = p;
    await Bun.sleep(CMS_PAUSE_MS);
  }
  let fromPlayheads = 0;
  for (const id of extra) {
    if (out[id]) continue;
    const p = await positionFromPlayheads(await token(), id).catch((e: Error) => e.message);
    if (typeof p === "string") failed[`segnalibro: ${p}`] = (failed[`segnalibro: ${p}`] ?? 0) + 1;
    else (out[id] = p), fromPlayheads++;
    await Bun.sleep(CMS_PAUSE_MS);
  }
  console.log(`serie col segnalibro e senza voce discover contate dai playhead: ${fromPlayheads} su ${extra.length}`);
  console.log(`puntate viste: ${Object.keys(out).length} serie contate in ${Math.round((Date.now() - t0) / 1000)} s; non contate: ${JSON.stringify(failed)}`);
  return out;
}
