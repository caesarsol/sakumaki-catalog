import { fetchBookmarks, fetchWatchlist, login } from "./api";
import { episodePositions } from "./watchlist-position";

const etpRt = Bun.env.AUTH_COOKIE;
if (!etpRt) throw new Error("AUTH_COOKIE mancante: copia il cookie di sessione in .env (vedi .env.example)");

const token = await login(etpRt);
const data = await fetchWatchlist(token);
// Chi è in watchlist lo dicono i segnalibri; la lista discover serve per la puntata da cui riprendere.
const bookmarks = await fetchBookmarks(token);
const marked = new Set(bookmarks.map((b) => b.id));
// Il token vale `expires_in` secondi (300): il conteggio delle puntate dura di più, e lo si rinnova con un margine.
let fresh = { token, at: Date.now() };
const current = async () => {
  if (Date.now() - fresh.at > (fresh.token.expires_in - 60) * 1000) fresh = { token: await login(etpRt), at: Date.now() };
  return fresh.token;
};
const positions = await episodePositions(current, data.filter((w) => marked.has(w.panel.episode_metadata?.series_id ?? "")));
const out = `${import.meta.dir}/../data/watchlist.json`;
await Bun.write(out, JSON.stringify({ fetched_at: new Date().toISOString(), total: data.length, data, bookmarks, positions }, null, 2));
console.log(`${data.length} titoli e ${bookmarks.length} segnalibri salvati in ${out}`);
