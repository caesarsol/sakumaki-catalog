# sakumaki-catalog

Una pagina sola, autonoma: `src/table.ts` + `src/table.html` generano `data/index.html`, che i workflow
pubblicano su GitHub Pages. Niente framework, niente build: JS nel template, dati incorporati nella pagina.

## Il mobile viene prima

Il desktop è il caso secondario. Ogni scelta di layout si giudica su schermo stretto, e se le due cose
sono in conflitto vince il mobile.

**Gli screenshot di verifica si fanno solo in viewport mobile** (390×844, quella di un telefono corrente).
Non produrre screenshot desktop: se serve controllare che il desktop non sia rotto, bastano i test.

## Anteprime e screenshot con dati veri

Usa i dati veri, presi dagli ultimi artifact di Actions: `catalog` (da `catalog.yml`) e `watchlist`
(da `watchlist.yml`), non dati inventati.

Limite noto: da Claude Code sul web il download degli artifact **non funziona** — l'API risponde ma
reindirizza a `blob.core.windows.net`, che il proxy dell'ambiente rifiuta (vale per `gh run download`,
per l'MCP di GitHub e per curl sul link firmato); anche il sito pubblicato (`caesarsol.github.io`) è
irraggiungibile. Funzionano invece la lettura di run, job e log (`gh run list/view`, `gh api`, l'MCP),
anche senza token perché il repo è pubblico. In quel caso si ripiega su dati sintetici della stessa forma,
**dicendolo esplicitamente** invece di far passare l'anteprima per dati reali.

La scorciatoia che funziona: chi lavora con Claude scarica lo zip dell'artifact dalla pagina di Actions e
lo carica in chat. L'artifact `github-pages` contiene `artifact.tar` con la pagina intera, e le righe
stanno in JSON dentro `<script id="data">`: da lì si legge tutto, id e stato watchlist compresi.

## Convenzioni

- Commenti e messaggi di commit in italiano. I commenti dicono il perché, non il cosa.
- Nessuna dipendenza a runtime nel repo: Tom Select e SortableJS arrivano da CDN dentro la pagina.
- `data/` è gitignored: è tutta roba generata o scaricata.
- Gli host dell'API e del sito stanno nei secret, non nel repo: i log di Actions sono pubblici.
- Il repo è pubblico, quindi lo sono anche artifact e pagina: fuori da lì tenere tutto ciò che non
  serve a costruire la tabella (la watchlist completa non esce dal runner, ne esce solo l'avanzamento).

## Workflow

| workflow | quando | cosa fa |
|---|---|---|
| `catalog.yml` | sabato 02:00 UTC | catalogo per paese via NordVPN → artifact `catalog`, poi lancia `watchlist.yml` |
| `watchlist.yml` | domenica–venerdì 02:00 UTC | watchlist dell'account → artifact `watchlist`, poi lancia `deploy.yml` |
| `ratings.yml` | a fine catalog | voti AniList e MAL abbinati per id alle serie → artifact `ratings`, poi lancia `deploy.yml` |
| `deploy.yml` | push su `main` che tocca `src/**`, o a fine watchlist e ratings | scarica gli artifact, genera la pagina, pubblica su Pages |

02:00 UTC sono le 04:00 a Roma d'estate e le 03:00 d'inverno: il cron di Actions è in UTC e non segue
l'ora legale. In pratica però GitHub fa partire i cron con ore di ritardo: nella settimana del 7 ottobre
2026 `watchlist` è partito ogni giorno fra le 07:37 e le 08:24 UTC, cioè verso le **10:00 di Roma**.
La pagina riflette la watchlist di quell'ora: ciò che cambia dopo compare il giorno seguente.

## Come la pagina incrocia catalogo e watchlist

- L'incrocio è **per id**, mai per titolo. **Chi è in watchlist lo dicono i segnalibri**
  (`/content/v2/<account>/watchlist`, solo id e preferita, una chiamata), non la lista discover: quella dà
  la puntata a cui riprendere (`panel`, da cui `watchlist-progress.ts` prende `episode_metadata.series_id`)
  e serve solo per la colonna Puntata e per le puntate viste. Una voce discover senza segnalibro è un
  sostituto (vedi sotto) e resta fuori; una serie col segnalibro e senza voce discover entra senza puntata.
- Le barrette sotto il titolo sono le puntate; quelle viste, in arancio, le conta `watchlist-position.ts`
  per le serie in watchlist: tutte quelle prima della puntata da cui riprendere, più quella se è finita.
  Conta sulla lista delle puntate (stagioni per `season_sequence_number`, indice nella stagione), non sui
  numeri del pannello, che saltano. Due chiamate CMS per serie, qualche minuto a ogni run.
- Il catalogo è il browse con `type=series`: **i film non ci sono**. Sul servizio un film è una serie
  con un episodio solo, con un suo `series_id` che il browse non elenca, e la voce di watchlist resta
  senza riga. Il deploy elenca nel log le voci senza riga in catalogo con id, tipo e titolo. Il tipo è
  `episode` anche per i film, quindi non distingue: li si riconosce dal titolo. Una serie vera in
  quell'elenco è un'anomalia da guardare (non disponibile nei paesi scaricati, o id diverso dal browse).
- Il run `watchlist` scrive nel log voci raccolte, pagine e `total` dichiarato dall'API, con un avviso se
  non tornano. La paginazione avanza di quante voci arrivano davvero, non di 100 fisso.
- Al 7 ottobre 2026: 374 voci in 4 pagine piene, 9 orfane e sono tutte film o recap (Suzume, SPY x FAMILY
  CODE: White, Sing a Bit of Harmony, Hakubo, Magical Explorer, Bokuai Kimiai Movie, Kabaneri "Life That
  Burns", Slime "Scarlet Bond", BOCCHI THE ROCK! Recap Part 2).

### Perché non basta la lista discover

La sonda del 18 ottobre 2026 (run su un ramo usa e getta) ha confrontato le due liste: 378 voci discover,
399 segnalibri, 383 dei quali su serie del catalogo. **14 serie avevano il segnalibro e nessuna voce
discover**: Alya, Barakamon, Mushi-Shi, K-ON!, Kiss Him Not Me, Anonymous Noise, SNAFU, Domestic
Girlfriend, 2.5 Dimensional Seduction, Fastest Finger First, e Bocchi, Slime, given, Kabaneri. Per queste
ultime quattro la voce discover c'è ma porta il film, il recap o il seguito che il servizio propone a serie
finita, con il suo `series_id` ("given: on the other hand" in stagione 4, cioè con la numerazione di given;
"BOCCHI THE ROCK! Recap Part 2"…): per questo nell'app la lista ordinata per titolo non le mostra. Per le
altre la lista discover semplicemente non le restituisce, e il caso di Alya, aperto dal 7 ottobre, era
questo. I segnalibri sono il dato della scheda serie e tornano tutti in una chiamata. La chiamata
`?content_ids=<id,…>` dà lo stesso dato per id scelti, anche 200 per volta.

## Limiti noti del punteggio

`rating_lcb` (colonna "V LimConf") è media meno 1,96 volte la deviazione standard osservata diviso la
radice dei voti. Con voti tutti uguali la deviazione è zero e il limite coincide con la media: **una serie
con un solo voto da 5 ha LCB 5**, cioè il contrario di quel che la colonna vuole dire. La correzione
proposta e non ancora fatta è un prior sulla dispersione, sd² = (n·sd² + k·σ₀²)/(n + k) con k ≈ 3 e
σ₀ ≈ 1, che pesa i pochi voti senza duplicare `rating_weighted`.
