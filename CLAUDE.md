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
| `deploy.yml` | push su `main` che tocca `src/**`, o a fine watchlist | scarica i due artifact, genera la pagina, pubblica su Pages |

02:00 UTC sono le 04:00 a Roma d'estate e le 03:00 d'inverno: il cron di Actions è in UTC e non segue
l'ora legale. In pratica però GitHub fa partire i cron con ore di ritardo: nella settimana del 7 ottobre
2026 `watchlist` è partito ogni giorno fra le 07:37 e le 08:24 UTC, cioè verso le **10:00 di Roma**.
La pagina riflette la watchlist di quell'ora: ciò che cambia dopo compare il giorno seguente.

## Come la pagina incrocia catalogo e watchlist

- L'incrocio è **per id**, mai per titolo. La watchlist non dà l'id della serie: dà l'episodio a cui
  riprendere (`panel`), e `watchlist-progress.ts` ne prende `episode_metadata.series_id`.
- Il catalogo è il browse con `type=series`: **i film non ci sono**. Una voce di watchlist di un film ha
  comunque un `series_id`, che punta all'oggetto film, e resta senza riga. Il deploy elenca nel log le
  voci senza riga in catalogo con id, tipo e titolo: con `movie` è normale, con `episode` è un'anomalia
  da guardare (serie non disponibile nei paesi scaricati, o id diverso da quello del browse).
- Il run `watchlist` scrive nel log voci raccolte, pagine e `total` dichiarato dall'API, con un avviso se
  non tornano. La paginazione avanza di quante voci arrivano davvero, non di 100 fisso.
- Al 7 ottobre 2026: 371 voci in watchlist, 362 righe segnate, 9 orfane e sono tutte film.

### Caso aperto: una serie in watchlist che l'API non restituisce

"Alya Sometimes Hides Her Feelings in Russian" (`G1XHJV0XM`) è in watchlist da un anno, con un solo
profilo e con lo stesso id della riga in catalogo, eppure nella risposta dell'API del 7 ottobre non c'era
sotto nessun id e nessuna voce era stata scartata. Le ipotesi rimaste sono la paginazione (corretta quel
giorno, da verificare dal log del run successivo) o un'omissione dell'endpoint `discover/.../watchlist`.
Se il log dice che raccolte e dichiarate coincidono e Alya manca ancora, il controllo successivo è la
pagina watchlist del sito web, che usa le stesse API del nostro client: se manca anche lì mentre nell'app
c'è, serve un altro endpoint.

## Limiti noti del punteggio

`rating_lcb` (colonna "V LimConf") è media meno 1,96 volte la deviazione standard osservata diviso la
radice dei voti. Con voti tutti uguali la deviazione è zero e il limite coincide con la media: **una serie
con un solo voto da 5 ha LCB 5**, cioè il contrario di quel che la colonna vuole dire. La correzione
proposta e non ancora fatta è un prior sulla dispersione, sd² = (n·sd² + k·σ₀²)/(n + k) con k ≈ 3 e
σ₀ ≈ 1, che pesa i pochi voti senza duplicare `rating_weighted`.
