import { fetchWatchlist, login, REQUEST_TIMEOUT_MS, type WatchlistItem } from "./api";

// Sonda temporanea: stampa solo esiti, conteggi, nomi di campi e titoli già pubblici nella pagina. Mai host, account o token.
const BASE = Bun.env.API_BASE!;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const sleep = (ms: number) => Bun.sleep(ms);
const section = (s: string) => console.log(`\n===== ${s}`);
const catalog: any[] = (await Bun.file("data/catalog.ndjson").text()).trim().split("\n").map((l) => JSON.parse(l));
const byId = new Map(catalog.map((s) => [s.id, s]));
const title = (id: string) => byId.get(id)?.title ?? "(fuori catalogo)";

const token = await login(Bun.env.AUTH_COOKIE!);
const acc = token.account_id;
async function api(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE}${path}`);
  url.search = new URLSearchParams(params).toString();
  const t0 = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Authorization: `Bearer ${token.access_token}`, "User-Agent": UA } });
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch {}
    return { status: res.status, body, ms: Math.round(performance.now() - t0), len: url.toString().length };
  } catch (e) {
    return { status: -1, body: null, ms: Math.round(performance.now() - t0), len: url.toString().length, err: (e as Error).name };
  }
}
const keys = (o: any) => (o && typeof o === "object" ? Object.keys(o).sort().join(", ") : String(o));
const idOf = (d: any) => d?.id ?? d?.content_id ?? d?.panel?.episode_metadata?.series_id ?? d?.panel?.id;

section("A. lista discover");
const wl: WatchlistItem[] = await fetchWatchlist(token);
const discover = new Set(wl.map((w) => w.panel.episode_metadata?.series_id).filter(Boolean) as string[]);
console.log(`voci ${wl.length}, serie distinte ${discover.size}, di cui in catalogo ${[...discover].filter((id) => byId.has(id)).length}`);
console.log(`campi voce: ${keys(wl[0])}`);
console.log(`campi panel: ${keys(wl[0].panel)}`);
console.log(`campi episode_metadata: ${keys(wl[0].panel.episode_metadata)}`);

section("B. segnalibro");
const control = catalog.find((s) => !discover.has(s.id))!.id;
const tests: Record<string, string> = { Alya: "G1XHJV0XM", Bocchi: "GXJHM3P19", Slime: "GYZJ43JMR", given: "GRG5WWD4R", Kabaneri: "GR24GX896", "SPY x FAMILY (in lista)": "G4PH0WXVJ", [`controllo fuori: ${title(control)}`]: control };
for (const [name, id] of Object.entries(tests)) {
  const a = await api(`/content/v2/${acc}/watchlist`, { content_ids: id, locale: "en-US" });
  const b = await api(`/content/v2/${acc}/watchlist/${id}`, { locale: "en-US" });
  console.log(`${name.padEnd(40)} ?content_ids: HTTP ${a.status} total=${a.body?.total ?? "-"} data=${a.body?.data?.length ?? "-"} ids=${JSON.stringify((a.body?.data ?? []).slice(0, 3).map(idOf))} | /watchlist/<id>: HTTP ${b.status} campi=${keys(b.body)}`);
  if (a.body?.data?.[0]) console.log(`   campi voce content_ids: ${keys(a.body.data[0])}  valori bool: ${JSON.stringify(Object.fromEntries(Object.entries(a.body.data[0]).filter(([, v]) => typeof v === "boolean")))}`);
  await sleep(500);
}
for (const n of [7, 50, 100, 200]) {
  const ids = n === 7 ? Object.values(tests) : catalog.slice(0, n).map((s) => s.id);
  const r = await api(`/content/v2/${acc}/watchlist`, { content_ids: ids.join(","), locale: "en-US" });
  const got = (r.body?.data ?? []).map(idOf);
  console.log(`batch ${n}: HTTP ${r.status} url ${r.len} car., ${got.length} tornati, tutti fra i richiesti: ${got.every((x: string) => ids.includes(x))}, ${r.ms} ms`);
  if (n === 7) console.log(`   presenti: ${got.map((x: string) => Object.entries(tests).find(([, v]) => v === x)?.[0] ?? x).join(", ")}`);
  await sleep(500);
}
const raw = await api(`/content/v2/${acc}/watchlist`, { n: "1000", locale: "en-US" });
console.log(`lista grezza senza content_ids: HTTP ${raw.status} total=${raw.body?.total ?? "-"} data=${raw.body?.data?.length ?? "-"} campi=${keys(raw.body?.data?.[0])}`);

section("B2. tutto il catalogo per segnalibro, a blocchi di 100");
const flagged = new Set<string>();
let failed = 0;
const t0 = Date.now();
for (let i = 0; i < catalog.length; i += 100) {
  const ids = catalog.slice(i, i + 100).map((s) => s.id);
  const r = await api(`/content/v2/${acc}/watchlist`, { content_ids: ids.join(","), locale: "en-US" });
  if (r.status !== 200) { failed++; continue; }
  for (const d of r.body?.data ?? []) if (ids.includes(idOf(d))) flagged.add(idOf(d));
  await sleep(500);
}
const inCat = [...discover].filter((id) => byId.has(id));
console.log(`${Math.ceil(catalog.length / 100)} chiamate in ${Math.round((Date.now() - t0) / 1000)} s, fallite ${failed}; segnalibro acceso: ${flagged.size}; discover in catalogo: ${inCat.length}`);
const extra = [...flagged].filter((id) => !discover.has(id));
const missing = inCat.filter((id) => !flagged.has(id));
console.log(`segnalibro sì ma assenti dalla lista discover (${extra.length}):`);
for (const id of extra) console.log(`   ${id} ${title(id)}`);
console.log(`nella lista discover ma senza segnalibro (${missing.length}):`);
for (const id of missing.slice(0, 30)) console.log(`   ${id} ${title(id)}`);

section("C. posizione della puntata da cui riprendere");
const sample = ["G4PH0WXVJ", "GDKHZEJ0K", "GRDK3DD4Y", "GT00251651", "GR49WNQE6", "GT00378116", "GDKHZE431", "GMTE00309893", ...[...discover].filter((id) => byId.has(id)).slice(0, 4)];
for (const id of sample) {
  const w = wl.find((x) => x.panel.episode_metadata?.series_id === id);
  if (!w) { console.log(`${id}: non in lista`); continue; }
  const ep: any = w.panel.episode_metadata;
  const s = byId.get(id);
  console.log(`\n${title(id)}  catalogo: ${s?.series_metadata.season_count} stagioni, ${s?.series_metadata.episode_count} episodi; fully_watched=${w.fully_watched} never_watched=${w.never_watched}`);
  console.log(`   panel: ${JSON.stringify({ season_id: ep.season_id, season_number: ep.season_number, season_sequence_number: ep.season_sequence_number, season_display_number: ep.season_display_number, sequence_number: ep.sequence_number, episode_number: ep.episode_number, episode: ep.episode, audio_locale: ep.audio_locale, versions: Array.isArray(ep.versions) ? ep.versions.length : ep.versions })}`);
  const seasons = await api(`/content/v2/cms/series/${id}/seasons`, { locale: "en-US" });
  console.log(`   stagioni: HTTP ${seasons.status} ${seasons.ms} ms, ${seasons.body?.data?.length ?? "?"} voci`);
  for (const x of seasons.body?.data ?? []) console.log(`     ${x.id === ep.season_id ? "▶" : " "} n=${x.season_number} seq=${x.season_sequence_number} disp=${x.season_display_number} eps=${x.number_of_episodes} audio=${x.audio_locale} versioni=${x.versions?.length ?? "-"} sub=${x.is_subbed} dub=${x.is_dubbed} "${x.title}"`);
  if (seasons.body?.data?.[0]) console.log(`     campi stagione: ${keys(seasons.body.data[0])}`);
  const eps = await api(`/content/v2/cms/seasons/${ep.season_id}/episodes`, { locale: "en-US" });
  const list = eps.body?.data ?? [];
  const idx = list.findIndex((e: any) => e.id === w.panel.id || e.versions?.some((v: any) => v.guid === w.panel.id));
  console.log(`   episodi della stagione del panel: HTTP ${eps.status} ${eps.ms} ms, ${list.length}, indice del panel ${idx}, numeri ${JSON.stringify(list.slice(0, 30).map((e: any) => e.episode_number ?? e.episode))}`);
  await sleep(300);
}

section("D. AniList");
const AQ = `query ($page: Int) { Page(page: $page, perPage: 50) { pageInfo { total lastPage hasNextPage }
  media(type: ANIME, sort: POPULARITY_DESC) { id idMal format averageScore meanScore stats { scoreDistribution { amount } } externalLinks { site url } } } }`;
const slugToId = new Map(catalog.map((s) => [s.slug_title, s.id]));
const alMatched = new Map<string, any[]>();
let withCr = 0, idForm = 0, slugForm = 0, byIdHit = 0, bySlugHit = 0, entries = 0, total = 0;
const unmatched: string[] = [];
for (let page = 1; page <= 40; page++) {
  const res = await fetch("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query: AQ, variables: { page } }) });
  if (page === 1) console.log(`rate limit: ${res.headers.get("x-ratelimit-limit")}/min, restanti ${res.headers.get("x-ratelimit-remaining")}`);
  if (res.status === 429) { const wait = Number(res.headers.get("retry-after") ?? 60); console.log(`429, attendo ${wait} s`); await sleep(wait * 1000); page--; continue; }
  if (!res.ok) { console.log(`HTTP ${res.status}`); break; }
  const { data } = (await res.json()) as any;
  total = data.Page.pageInfo.total;
  for (const m of data.Page.media) {
    entries++;
    const cr = m.externalLinks.filter((l: any) => /crunchyroll/i.test(l.site) || /crunchyroll\.com/.test(l.url));
    if (cr.length) withCr++;
    for (const l of cr) {
      const idm = l.url.match(/\/series\/(G[A-Z0-9]+)/i);
      const slug = l.url.match(/crunchyroll\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?([a-z0-9-]+)\/?$/i)?.[1];
      let hit: string | undefined;
      if (idm) { idForm++; if (byId.has(idm[1].toUpperCase())) { hit = idm[1].toUpperCase(); byIdHit++; } }
      else if (slug) { slugForm++; if (slugToId.has(slug)) { hit = slugToId.get(slug); bySlugHit++; } }
      if (hit) { if (!alMatched.has(hit)) alMatched.set(hit, []); alMatched.get(hit)!.push(m); break; }
      else if (unmatched.length < 8) unmatched.push(l.url.replace(/^https?:\/\/(www\.)?/, ""));
    }
  }
  await sleep(2100);
}
console.log(`totale anime su AniList: ${total}; esaminati ${entries} (i più popolari), con link Crunchyroll ${withCr}; link con id ${idForm} (trovati in catalogo ${byIdHit}), link con slug ${slugForm} (trovati ${bySlugHit})`);
console.log(`serie del catalogo abbinate: ${alMatched.size} su ${catalog.length}; con più voci (stagioni): ${[...alMatched.values()].filter((v) => v.length > 1).length}; con idMal: ${[...alMatched.values()].filter((v) => v.some((m) => m.idMal)).length}`);
const topCat = catalog.slice().sort((a, b) => b.rating.total - a.rating.total).slice(0, 200);
console.log(`delle 200 serie del catalogo con più voti, abbinate: ${topCat.filter((s) => alMatched.has(s.id)).length}`);
console.log(`esempi non abbinati: ${unmatched.join("  ")}`);
for (const id of ["GXJHM3P19", "GRG5WWD4R", "G4PH0WXVJ", "GYZJ43JMR"]) {
  const v = alMatched.get(id) ?? [];
  console.log(`  ${title(id)}: ${v.map((m) => `AL${m.id}/MAL${m.idMal} ${m.format} ${m.averageScore} (${m.stats.scoreDistribution.reduce((a: number, d: any) => a + d.amount, 0)} voti)`).join("; ") || "nessuna"}`);
}

section("E. Jikan (MyAnimeList)");
const malIds = [...alMatched.values()].flat().map((m) => m.idMal).filter(Boolean).slice(0, 3);
for (const id of malIds) {
  const r = await fetch(`https://api.jikan.moe/v4/anime/${id}`);
  const b: any = r.ok ? await r.json() : null;
  console.log(`MAL ${id}: HTTP ${r.status} score=${b?.data?.score} scored_by=${b?.data?.scored_by} members=${b?.data?.members}`);
  await sleep(1200);
  const st = await fetch(`https://api.jikan.moe/v4/anime/${id}/streaming`);
  const sb: any = st.ok ? await st.json() : null;
  console.log(`   streaming: HTTP ${st.status} ${JSON.stringify((sb?.data ?? []).filter((x: any) => /crunchyroll/i.test(x.name)).map((x: any) => x.url.replace(/^https?:\/\/(www\.)?/, "")))}`);
  await sleep(1200);
}
const list = await fetch("https://api.jikan.moe/v4/anime?page=1&limit=25&order_by=mal_id");
const lb: any = list.ok ? await list.json() : null;
console.log(`elenco paginato: HTTP ${list.status} pagine ${lb?.pagination?.last_visible_page} voci ${lb?.pagination?.items?.total}; campi voce con score: ${lb?.data?.[0] ? "score" in lb.data[0] && "scored_by" in lb.data[0] : "?"}`);
