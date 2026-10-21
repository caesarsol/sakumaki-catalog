import { fetchBookmarks, fetchMyRating, fetchObjects, fetchWatchlist, login, setDefaultProxy, type Token } from "./api";
import { COUNTRIES } from "./countries";
import { latestEpisodes, type Latest } from "./latest-episode";
import { randomProxy } from "./nordvpn";
import { episodePositions } from "./watchlist-position";

const etpRt = Bun.env.AUTH_COOKIE;
if (!etpRt) throw new Error("AUTH_COOKIE mancante: copia il cookie di sessione in .env (vedi .env.example)");

/**
 * Dall'Italia, attraverso un proxy NordVPN, se ci sono le credenziali: dal runner l'API vede gli USA e la
 * lista discover, le stagioni e le puntate escludono le serie non disponibili là (K-ON!, Mushi-Shi,
 * Domestic Girlfriend…), che quindi restavano senza puntate contate. Se il proxy non risponde o l'API non
 * ci vede in Italia si va avanti senza, con un avviso: meglio una watchlist parziale che nessuna.
 */
async function loginFromItaly(): Promise<Token> {
  if (!Bun.env.NORD_USER) return login(etpRt!);
  const it = COUNTRIES.find((c) => c.iso2 === "IT")!;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      setDefaultProxy((await randomProxy(it.nordId)).url);
      const token = await login(etpRt!);
      if (token.country !== "IT") throw new Error(`visti come ${token.country}`);
      console.log("watchlist letta dall'Italia, via proxy");
      return token;
    } catch (e) {
      console.warn(`proxy italiano, tentativo ${attempt}: ${(e as Error).message}`);
    }
  }
  setDefaultProxy(undefined);
  const token = await login(etpRt!);
  console.warn(`proxy italiano non disponibile: watchlist letta senza, l'API ci vede in ${token.country}`);
  return token;
}

const token = await loginFromItaly();
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
const inDiscover = new Set(data.map((w) => w.panel.episode_metadata?.series_id));
const positions = await episodePositions(
  current,
  data.filter((w) => marked.has(w.panel.episode_metadata?.series_id ?? "")),
  bookmarks.map((b) => b.id).filter((id) => !inDiscover.has(id)),
);
const out = `${import.meta.dir}/../data/watchlist.json`;
await Bun.write(out, JSON.stringify({ fetched_at: new Date().toISOString(), total: data.length, data, bookmarks, positions }, null, 2));
console.log(`${data.length} titoli e ${bookmarks.length} segnalibri salvati in ${out}`);

/*
 * Ogni giorno, oltre all'avanzamento: l'ultima puntata delle serie in watchlist (il catalogo la legge solo il
 * sabato) e i tuoi voti in stelline. Finiscono in data/watchlist-extra.json, che esce dal runner con
 * l'avanzamento: sono gli stessi dati che la pagina mostra. Quello di ieri arriva dall'artifact precedente.
 */
const dataDir = `${import.meta.dir}/../data`;
type Extra = { fetched_at: string; latest: Record<string, Latest>; my_rating: Record<string, number> };
const extraFile = Bun.file(`${dataDir}/watchlist-extra.json`);
const previous: Extra | null = (await extraFile.exists()) ? await extraFile.json() : null;

const ids = bookmarks.map((b) => b.id);
const objects = [];
for (let i = 0; i < ids.length; i += 50) objects.push(...(await fetchObjects(await current(), ids.slice(i, i + 50))));
const latest = await latestEpisodes(current, objects, previous?.latest ?? {}, { label: "watchlist" });

// I voti: un voto dato si cambia di rado, quindi quelli già noti si tengono senza rileggerli (anche delle serie
// uscite dalla watchlist), e ogni giorno si chiedono solo quelli delle serie in watchlist ancora senza voto.
const myRating: Record<string, number> = { ...previous?.my_rating };
const toRate = ids.filter((id) => !myRating[id]);
const ratingErrors: Record<string, number> = {};
const t0 = Date.now();
for (const id of toRate) {
  try {
    const r = await fetchMyRating(await current(), id);
    if (r) myRating[id] = r;
  } catch (e) {
    const k = String((e as { status?: number }).status ?? (e as Error).name);
    ratingErrors[k] = (ratingErrors[k] ?? 0) + 1;
  }
  await Bun.sleep(150);
}
console.log(
  `voti personali: ${Object.keys(previous?.my_rating ?? {}).length} già noti, ${toRate.length} serie in watchlist senza voto lette in ` +
    `${Math.round((Date.now() - t0) / 1000)} s, ${Object.keys(myRating).length} votate in tutto, errori ${JSON.stringify(ratingErrors)}`,
);
await Bun.write(extraFile, JSON.stringify({ fetched_at: new Date().toISOString(), latest, my_rating: myRating } satisfies Extra));
