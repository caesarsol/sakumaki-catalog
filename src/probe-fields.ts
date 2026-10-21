// Sonda campi MAL: quali dati della pagina "Statistics" dà l'API ufficiale v2? Chiede tutti i campi documentati
// più qualche nome non documentato, e stampa cosa torna (senza sinossi, immagini e liste lunghe).
const MAL_CLIENT_ID = Bun.env.MAL_CLIENT_ID!;
const fields = [
  "id,title,mean,rank,popularity,num_list_users,num_scoring_users,num_favorites,statistics,status,media_type,num_episodes,start_date,end_date,updated_at,created_at",
  "score_distribution,scores,score_stats,favorites,members",
];
for (const id of [52991, 5114]) {
  for (const f of fields) {
    const res = await fetch(`https://api.myanimelist.net/v2/anime/${id}?fields=${f}`, { headers: { "X-MAL-CLIENT-ID": MAL_CLIENT_ID } });
    const b: any = await res.json();
    for (const k of ["synopsis", "background", "pictures", "related_anime", "related_manga", "recommendations", "main_picture"]) delete b[k];
    console.log(`${id} [${f.slice(0, 40)}…] HTTP ${res.status}: ${JSON.stringify(b)}`);
    await Bun.sleep(1000);
  }
}
const s: any = await (await fetch(`https://api.myanimelist.net/v2/anime/52991/statistics`, { headers: { "X-MAL-CLIENT-ID": MAL_CLIENT_ID } })).text();
console.log(`/anime/52991/statistics: ${String(s).slice(0, 300)}`);
export {};
