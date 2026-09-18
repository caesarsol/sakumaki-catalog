import { fetchObjects, login, type WatchlistItem } from "./api";

/**
 * Arricchisce le serie della watchlist con voto medio, numero di votanti e distribuzione,
 * e scrive data/watchlist-votes.ndjson: una riga per serie, con l'oggetto serie completo
 * (rating incluso) più un riassunto della voce di watchlist (prossimo episodio, playhead).
 */
const etpRt = Bun.env.AUTH_COOKIE;
if (!etpRt) throw new Error("AUTH_COOKIE mancante: copia il cookie di sessione in .env (vedi .env.example)");

const dataDir = `${import.meta.dir}/../data`;
const watchlist: { data: WatchlistItem[] } = await Bun.file(`${dataDir}/watchlist.json`).json();

const bySeries = new Map<string, WatchlistItem>();
for (const item of watchlist.data) {
  const seriesId = item.panel.episode_metadata?.series_id;
  if (seriesId && !bySeries.has(seriesId)) bySeries.set(seriesId, item);
}

const token = await login(etpRt);
const ids = [...bySeries.keys()];
const lines: string[] = [];
for (let i = 0; i < ids.length; i += 50) {
  const objects = await fetchObjects(token, ids.slice(i, i + 50));
  for (const s of objects) {
    const w = bySeries.get(s.id)!;
    const ep = w.panel.episode_metadata!;
    lines.push(
      JSON.stringify({
        ...s,
        watchlist: {
          episode_id: w.panel.id,
          episode_title: w.panel.title,
          season_number: ep.season_number,
          episode_number: ep.episode_number,
          playhead: w.playhead,
          fully_watched: w.fully_watched,
          never_watched: w.never_watched,
          is_favorite: w.is_favorite,
        },
      }),
    );
  }
}
const out = `${dataDir}/watchlist-votes.ndjson`;
await Bun.write(out, lines.join("\n") + "\n");
console.log(`${lines.length} serie (da ${watchlist.data.length} voci) salvate in ${out}`);
