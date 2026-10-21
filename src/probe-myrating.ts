import { fetchBookmarks, fetchObjects, login } from "./api";

// Sonda voto personale: dove sta il voto in stelline che l'account ha dato a una serie? Prova le chiamate
// di recensione/voto e l'oggetto serie letto col token dell'account. Stampa stati, nomi di campi e conteggi.
const BASE = Bun.env.API_BASE!;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const token = await login(Bun.env.AUTH_COOKIE!);
const ids = (await fetchBookmarks(token)).map((b) => b.id);
const get = async (path: string) => {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token.access_token}`, "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body };
};
const shape = (b: any) => (b && typeof b === "object" ? Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === "object" && v ? Object.keys(v).slice(0, 8) : typeof v])) : b);
const variants = [
  (id: string) => `/content-reviews/v2/user/${token.account_id}/rating/series/${id}`,
  (id: string) => `/content-reviews/v2/en-US/user/${token.account_id}/rating/series/${id}`,
  (id: string) => `/content-reviews/v3/user/${token.account_id}/rating/series/${id}`,
  (id: string) => `/content-reviews/v2/rating/series/${id}`,
];
let working: ((id: string) => string) | undefined;
for (const [k, v] of variants.entries()) {
  const r = await get(v(ids[0]!));
  console.log(`variante ${k}: HTTP ${r.status}, forma ${JSON.stringify(shape(r.body))}`);
  if (r.status === 200 && !working) working = v;
  await Bun.sleep(500);
}
const objs = await fetchObjects(token, ids.slice(0, 3));
console.log(`oggetto serie col token dell'account, campi di rating: ${JSON.stringify(Object.keys((objs[0] as any)?.rating ?? {}))}`);
if (working) {
  // Quale campo porta il voto personale: conta i valori di ogni campo testuale su tutti i segnalibri.
  const counts: Record<string, Record<string, number>> = {};
  const t0 = Date.now();
  for (const id of ids) {
    const r = await get(working(id));
    for (const [k, v] of Object.entries(r.body ?? {}))
      if (typeof v !== "object" || v === null) {
        const key = /average|total/.test(k) ? "(numero)" : String(v);
        (counts[k] ??= {})[key] = ((counts[k] ??= {})[key] ?? 0) + 1;
      }
    await Bun.sleep(150);
  }
  console.log(`${ids.length} segnalibri in ${Math.round((Date.now() - t0) / 1000)} s; valori per campo: ${JSON.stringify(counts)}`);
}
