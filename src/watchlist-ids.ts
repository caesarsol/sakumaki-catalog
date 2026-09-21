import type { WatchlistItem } from "./api";

/**
 * Da data/watchlist.json estrae data/watchlist-ids.json: i soli id delle serie in watchlist.
 * È tutto quello che serve alla tabella, ed è anche l'unica parte che può passare da un workflow
 * all'altro: gli artifact di un repo pubblico sono pubblici, e watchlist.json contiene pure
 * playhead, preferiti e puntata in corso.
 */
const dataDir = `${import.meta.dir}/../data`;
const { data }: { data: WatchlistItem[] } = await Bun.file(`${dataDir}/watchlist.json`).json();
const ids = [...new Set(data.map((w) => w.panel.episode_metadata?.series_id).filter((id) => !!id))];
const out = `${dataDir}/watchlist-ids.json`;
await Bun.write(out, JSON.stringify(ids));
console.log(`${ids.length} serie in watchlist salvate in ${out}`);
