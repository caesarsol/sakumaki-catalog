import { fetchObjects, login, REQUEST_TIMEOUT_MS, type WatchlistItem } from "./api";

/**
 * Sonda per una serie che nell'app ha il segnalibro acceso ma non compare nella lista della watchlist.
 * Interroga l'API con il cookie locale e stampa solo esiti e conteggi, mai l'host: si lancia in locale,
 * con `bun run src/watchlist-probe.ts <series_id>`. Prova la lista "discover" con parametri diversi,
 * la chiamata del segnalibro e la lista "grezza" degli id, per capire da quale parte sta la divergenza.
 */
const BASE = Bun.env.API_BASE;
const etpRt = Bun.env.AUTH_COOKIE;
if (!BASE || !etpRt) throw new Error("API_BASE e AUTH_COOKIE mancanti in .env (vedi .env.example)");
const seriesId = Bun.argv[2] ?? "G1XHJV0XM";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const token = await login(etpRt);
console.log(`token: paese ${token.country}, account e profilo presenti: ${!!token.account_id} ${!!token.profile_id}`);

const get = async (path: string, params: Record<string, string> = {}) => {
  const url = new URL(`${BASE}${path}`);
  url.search = new URLSearchParams(params).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Authorization: `Bearer ${token.access_token}`, "User-Agent": UA } });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body, size: text.length };
};

/** La lista "discover", tutta, con i parametri dati: dice se l'id c'è e quante voci dichiara. */
async function discover(label: string, params: Record<string, string>) {
  const items: WatchlistItem[] = [];
  let total = 0;
  for (let start = 0; ; ) {
    const { status, body } = await get(`/content/v2/discover/${token.account_id}/watchlist`, { n: "100", start: String(start), ...params });
    if (status !== 200) return console.log(`${label}: HTTP ${status}`);
    total = body.total;
    if (!body.data?.length) break;
    items.push(...body.data);
    if (items.length >= total) break;
    start += body.data.length;
  }
  const hit = items.find((w) => w.panel.episode_metadata?.series_id === seriesId || w.panel.id === seriesId);
  console.log(`${label}: ${items.length} voci (${total} dichiarate), ${seriesId} ${hit ? "PRESENTE: " + JSON.stringify({ type: hit.panel.type, title: hit.panel.title, ep: hit.panel.episode_metadata?.episode_number }) : "assente"}`);
}

await discover("discover come il client   ", { order: "desc", preferred_audio_language: "ja-JP", locale: "en-US" });
await discover("discover senza audio pref. ", { order: "desc", locale: "en-US" });
await discover("discover locale it-IT      ", { order: "desc", locale: "it-IT" });
await discover("discover ordine asc        ", { order: "asc", locale: "en-US" });

// Il segnalibro della scheda serie: è questa la chiamata che nell'app risulta accesa.
const flag = await get(`/content/v2/${token.account_id}/watchlist/${seriesId}`, { locale: "en-US" });
console.log(`segnalibro /watchlist/<id>: HTTP ${flag.status} ${flag.body ? JSON.stringify(flag.body).slice(0, 300) : `(${flag.size} byte non JSON)`}`);

// La lista "grezza" degli id, senza pannelli: se esiste e contiene l'id, è la lista discover a perderlo.
const raw = await get(`/content/v2/${token.account_id}/watchlist`, { n: "500", locale: "en-US" });
const rawIds: string[] = raw.body?.data?.map((d: any) => d.id ?? d.panel?.id ?? JSON.stringify(d).slice(0, 40)) ?? [];
console.log(`lista grezza /watchlist: HTTP ${raw.status}, ${rawIds.length} voci (${raw.body?.total ?? "?"} dichiarate), ${seriesId} ${rawIds.includes(seriesId) ? "PRESENTE" : "assente"}`);
if (raw.body?.data?.[0]) console.log(`  campi di una voce: ${Object.keys(raw.body.data[0]).join(", ")}`);

// L'oggetto serie visto dal token: se non si risolve o non ha stagioni visibili, la lista discover non ha un episodio da mostrare.
const objs = await fetchObjects(token, [seriesId]).catch((e) => (console.log(`oggetto serie: ${e.message}`), []));
for (const s of objs) console.log(`oggetto serie: "${s.title}", stagioni ${s.series_metadata.season_count}, episodi ${s.series_metadata.episode_count}, sub ${s.series_metadata.is_subbed}, dub ${s.series_metadata.is_dubbed}, audio ${JSON.stringify(s.series_metadata.audio_locales ?? "?")}`);
const seasons = await get(`/content/v2/cms/series/${seriesId}/seasons`, { locale: "en-US" });
console.log(`stagioni: HTTP ${seasons.status}, ${seasons.body?.data?.length ?? "?"} trovate ${seasons.body?.data ? JSON.stringify(seasons.body.data.map((x: any) => ({ id: x.id, n: x.season_number, eps: x.number_of_episodes, audio: x.audio_locale, sub: x.is_subbed, dub: x.is_dubbed }))) : ""}`);
