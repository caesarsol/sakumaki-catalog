// Sonda MAL: quanto ci mette davvero l'API ufficiale, e i "timeout" (uno ogni 12 chiamate nei voti del 20 ottobre)
// sono risposte lente che arrivano dopo 10 s o connessioni morte che non rispondono mai? Timeout a 60 s, nessun
// ritentativo, stesso ritmo dei voti (4 cicli, una partenza ogni 0,5 s). Due giri: connessioni riusate (come
// ora) e connessione nuova a ogni chiamata. Stampa solo tempi ed esiti.
const MAL_CLIENT_ID = Bun.env.MAL_CLIENT_ID;
if (!MAL_CLIENT_ID) throw new Error("MAL_CLIENT_ID mancante");

const ids: number[] = [];
for (let page = 1; page <= 16; page++) {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: `{ Page(page: ${page}, perPage: 50) { media(type: ANIME, sort: POPULARITY_DESC) { idMal } } }` }),
  });
  const b: any = await res.json();
  for (const m of b.data.Page.media) if (m.idMal) ids.push(m.idMal);
  await Bun.sleep(2100);
}
console.log(`${ids.length} id MAL da AniList`);

const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
async function round(label: string, list: number[], keepalive: boolean) {
  let next = 0;
  let i = 0;
  const ok: number[] = [];
  const slow: string[] = [];
  const outcome: Record<string, number> = {};
  const t0 = Date.now();
  const worker = async (w: number) => {
    while (i < list.length) {
      const id = list[i++]!;
      const slot = Math.max(Date.now(), next);
      next = slot + 500;
      await Bun.sleep(slot - Date.now());
      const s = Date.now();
      try {
        const res = await fetch(`https://api.myanimelist.net/v2/anime/${id}?fields=mean,num_scoring_users`, {
          headers: { "X-MAL-CLIENT-ID": MAL_CLIENT_ID! },
          signal: AbortSignal.timeout(60_000),
          keepalive,
        });
        await res.arrayBuffer();
        const ms = Date.now() - s;
        outcome[res.status] = (outcome[res.status] ?? 0) + 1;
        if (res.ok) ok.push(ms);
        if (ms > 3000) slow.push(`${ms} ms (HTTP ${res.status}, ciclo ${w}, al secondo ${Math.round((s - t0) / 1000)})`);
      } catch (e) {
        const name = (e as Error).name;
        outcome[name] = (outcome[name] ?? 0) + 1;
        slow.push(`${name} dopo ${Date.now() - s} ms (ciclo ${w}, al secondo ${Math.round((s - t0) / 1000)})`);
      }
    }
  };
  await Promise.all([0, 1, 2, 3].map(worker));
  ok.sort((a, b) => a - b);
  const buckets = [500, 1000, 2000, 3000, 5000, 10_000, 20_000, 60_000];
  const hist = buckets.map((b, k) => `≤${b / 1000}s:${ok.filter((x) => x <= b && (k === 0 || x > buckets[k - 1]!)).length}`).join(" ");
  console.log(`\n== ${label}: ${list.length} chiamate in ${Math.round((Date.now() - t0) / 1000)} s, esiti ${JSON.stringify(outcome)}`);
  console.log(`risposte ok: p50 ${q(ok, 0.5)} ms, p90 ${q(ok, 0.9)}, p95 ${q(ok, 0.95)}, p99 ${q(ok, 0.99)}, max ${ok.at(-1)}`);
  console.log(`istogramma: ${hist}`);
  console.log(`oltre 3 s (${slow.length}):\n  ${slow.join("\n  ")}`);
}
const half = Math.floor(ids.length / 2);
await round("connessioni riusate", ids.slice(0, half), true);
await round("connessione nuova a ogni chiamata", ids.slice(half), false);
export {};
