import type { WatchlistItem } from "./api";

/**
 * L'avanzamento personale che finisce nella tabella, una voce per serie: la puntata a cui sei
 * arrivato e in che stato è. Il `playhead`, cioè i secondi già visti di quella puntata, resta
 * fuori: non dice quante puntate hai visto e non serve a nessuna colonna.
 */
export type Progress = {
  season: number;
  episode: number | null;
  fully_watched: boolean;
  never_watched: boolean;
  is_favorite: boolean;
};

export function progressBySeries(data: WatchlistItem[]): Record<string, Progress> {
  const out: Record<string, Progress> = {};
  for (const w of data) {
    const ep = w.panel.episode_metadata;
    if (!ep || out[ep.series_id]) continue; // una voce per serie: vince la prima, come in watchlist-votes.ts
    out[ep.series_id] = {
      season: ep.season_number,
      episode: ep.episode_number,
      fully_watched: w.fully_watched,
      never_watched: w.never_watched,
      is_favorite: w.is_favorite,
    };
  }
  return out;
}

/**
 * Da data/watchlist.json estrae data/watchlist-progress.json: solo i campi qui sopra.
 * È l'unico pezzo di watchlist che passa da un workflow all'altro, e sono gli stessi dati
 * che la pagina mostra: gli artifact e il sito di un repo pubblico sono pubblici, e
 * watchlist.json contiene anche id e titoli delle puntate.
 */
if (import.meta.main) {
  const dataDir = `${import.meta.dir}/../data`;
  const { data }: { data: WatchlistItem[] } = await Bun.file(`${dataDir}/watchlist.json`).json();
  const progress = progressBySeries(data);
  const out = `${dataDir}/watchlist-progress.json`;
  await Bun.write(out, JSON.stringify(progress));
  console.log(`${Object.keys(progress).length} serie salvate in ${out}`);
}
