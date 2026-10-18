import type { WatchlistItem } from "./api";

/**
 * L'avanzamento personale che finisce nella tabella, una voce per serie: la puntata a cui sei
 * arrivato e in che stato è. Il `playhead`, cioè i secondi già visti di quella puntata, resta
 * fuori: non dice quante puntate hai visto e non serve a nessuna colonna.
 */
export type Progress = {
  // Titolo e tipo servono solo al log del deploy. Una voce senza riga in catalogo è quasi sempre un film,
  // ma il tipo non lo dice: i film sono serie con un episodio solo e il `panel.type` è "episode" anche per
  // loro. È il titolo a riconoscerli ("Movie", "Recap", il nome del film).
  title: string;
  type: string;
  // -1: serie con il segnalibro ma senza voce nella lista discover, quindi senza puntata da cui riprendere
  season: number;
  episode: number | null;
  fully_watched: boolean;
  never_watched: boolean;
  is_favorite: boolean;
};

/**
 * Le serie in watchlist sono quelle con il segnalibro. Una voce della lista discover senza segnalibro è il
 * film o il seguito che il servizio propone a serie finita ("given: on the other hand" al posto di "given"):
 * non la si è messa in watchlist, quindi resta fuori. Senza segnalibri (watchlist.json di prima di questa
 * modifica) vale la lista discover come prima.
 */
export function progressBySeries(
  data: WatchlistItem[],
  bookmarks?: { id: string; is_favorite: boolean }[],
): Record<string, Progress> {
  const marked = bookmarks && new Map(bookmarks.map((b) => [b.id, b]));
  const out: Record<string, Progress> = {};
  for (const w of data) {
    const ep = w.panel.episode_metadata;
    if (!ep || out[ep.series_id]) continue; // una voce per serie: vince la prima, come in watchlist-votes.ts
    if (marked && !marked.has(ep.series_id)) continue;
    out[ep.series_id] = {
      title: ep.series_title,
      type: w.panel.type,
      season: ep.season_number,
      episode: ep.episode_number,
      fully_watched: w.fully_watched,
      never_watched: w.never_watched,
      is_favorite: marked?.get(ep.series_id)?.is_favorite ?? w.is_favorite,
    };
  }
  for (const b of bookmarks ?? []) {
    if (out[b.id]) continue;
    out[b.id] = { title: "", type: "bookmark", season: -1, episode: null, fully_watched: false, never_watched: false, is_favorite: b.is_favorite };
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
  const { data, bookmarks }: { data: WatchlistItem[]; bookmarks?: { id: string; is_favorite: boolean }[] } =
    await Bun.file(`${dataDir}/watchlist.json`).json();
  const progress = progressBySeries(data, bookmarks);
  const out = `${dataDir}/watchlist-progress.json`;
  await Bun.write(out, JSON.stringify(progress));
  const v = Object.values(progress);
  const n = (f: (p: Progress) => boolean) => v.filter(f).length;
  // Il riepilogo finisce nel log del workflow, che si legge anche da fuori: l'artifact no.
  console.log(
    `${v.length} serie salvate in ${out}: ${n((p) => p.fully_watched)} con la puntata finita, ` +
      `${n((p) => p.never_watched)} mai iniziate, ${n((p) => !p.fully_watched && !p.never_watched && p.season >= 0)} a metà, ` +
      `${n((p) => p.season < 0)} col segnalibro ma fuori dalla lista discover, ${n((p) => p.is_favorite)} preferite`,
  );
}
