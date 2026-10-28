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
irraggiungibile. Funzionano invece la lettura di run e job (`gh run list/view`, `gh api`) e dei log con l'MCP,
anche senza token perché il repo è pubblico. In quel caso si ripiega su dati sintetici della stessa forma,
**dicendolo esplicitamente** invece di far passare l'anteprima per dati reali.

La scorciatoia che funziona: chi lavora con Claude scarica lo zip dell'artifact dalla pagina di Actions e
lo carica in chat. L'artifact `github-pages` contiene `artifact.tar` con la pagina intera, e le righe
stanno in JSON dentro `<script id="data">`: da lì si legge tutto, id e stato watchlist compresi.

## Interrogare l'API vera: il ramo della sonda

Da Claude Code sul web l'API del servizio, AniList, Jikan e NordVPN sono irraggiungibili, il dispatch dei
workflow risponde 403 sia via MCP sia con `gh workflow run` (anche annullare un run: `gh run cancel`), e
`gh run view --log` è rifiutato dal proxy. Funzionano due cose: il push su
un ramo `claude/…` e la lettura dei log con l'MCP (`get_job_logs`, con l'id del job da
`gh api repos/caesarsol/sakumaki-catalog/actions/runs/<run>/jobs`). Per questo esiste il ramo
**`claude/probe-tmp`**, da tenere: il suo `.github/workflows/probe.yml` parte a ogni push sul ramo, con i
secret del repo (`AUTH_COOKIE`, `API_BASE`, `NORD_USER`, `NORD_PASS`). **Ogni domanda sull'API reale passa
da lì** invece di indovinare la forma di una risposta:

- uno script di sonda in `src/` sul ramo (`bun run src/probe.ts`), che chiama l'API e stampa quel che serve;
- `gh workflow run <workflow>.yml --ref main -R "$R"` per lanciare un workflow su main, con `actions: write`
  fra i permessi (anche `gh run watch` per aspettarlo dentro lo stesso job);
- `gh run download` di un artifact più `jq`, per leggere i dati veri di watchlist, catalogo o voti.

Prima di usarlo lo si riallinea a main (`git fetch origin main claude/probe-tmp`,
`git checkout -B claude/probe-tmp origin/claude/probe-tmp`, `git merge origin/main`), si cambiano gli step,
si fa commit e push sul ramo; su main non si fa mai merge del ramo, così la sua storia resta fuori. Il ramo
non si può cancellare dalla sessione, ma non serve: è lì apposta.

**I log di Actions sono pubblici**: la sonda stampa solo esiti, conteggi, nomi di campi e dati che sono già
pubblici nella pagina o negli artifact (id, titoli, avanzamento), mai host, account, token o cookie. Il
workflow va scritto con i comandi in blocchi `run: |`: un `: ` in una riga non quotata rende il file YAML
non valido e il run fallisce senza job.

## Convenzioni

- Commenti e messaggi di commit in italiano. I commenti dicono il perché, non il cosa.
- Un ramo entra in `main` con un merge `--no-ff`, mai con un fast-forward. Il pull si fa sempre con `--rebase`.
- Le librerie della pagina (Tom Select, SortableJS) sono dipendenze npm con versione fissata: `table.ts` ne
  copia i file da `node_modules` dentro la pagina, che resta un file unico e non chiama nessun CDN.
- La tabella è virtualizzata (TanStack Virtual, `page-vendor.ts` impacchettato da `table.ts`): nella pagina
  ci sono solo le righe visibili più un margine. Le righe devono restare tutte alte uguali, `ROW_H` nello
  script e l'altezza di `th, tbody td` nel CSS; una riga "metro" invisibile tiene ferme le larghezze.
- I voti sono tutti in decimi: le stelline di Crunchyroll per 2, AniList (centesimi) diviso 10, MAL com'è. È la scala
  in cui si leggono MAL e AniList, e un 8,6 si confronta col sito senza conti; le stelline restano solo nelle
  distribuzioni e nel voto personale (`my`, 1–5).
- Le colonne dei voti (V Crunchy, V Crunchy Bayes, V AniList, V MAL) hanno dietro al numero una barra da 2 (una stella)
  a 10, del colore della fonte (arancio Crunchyroll, azzurro AniList, blu scuro MAL, i `--src-*` del CSS), e sotto in
  piccolo i votanti; i votanti e le quote per stella si ordinano dal pannello, senza colonna.
- Le formule (scheda ƒ) ordinano o filtrano con un'espressione sui dati della riga: voti `v v_al v_mal v_bayes`
  in decimi, votanti `n n_al n_mal`, quote `s1`…`s5`, `sd` delle stelle e gli altri in `FX_VARS`. Il motore
  sta in `src/formula.ts`, non nello script della pagina, per provarlo con `bun test` (`src/formula.test.ts`):
  `page-vendor.ts` lo espone come globale `Formula`. Il testo si legge con un piccolo parser in un albero di
  funzioni, senza eval: può nominare solo i nomi di `FX_VARS`/`FX_FUNCS`, così una formula incollata non esegue
  codice. Un dato che manca è NaN e si propaga come NULL in SQL, anche nei confronti, in `and`/`or`/`not` e in
  `avg sum min max`; solo `ifnull(x, 0)` lo sostituisce. `not` vale per tutto il confronto che segue, come in SQL.
  Senza risultato una serie non passa il filtro e nell'ordinamento va in fondo in entrambi i versi. La colonna
  ƒ, subito dopo il titolo, c'è solo quando una formula ordina.
- Il dettaglio di una serie (distribuzioni dei voti di tutte le fonti su 5 fasce in un solo grafico, matrice stagioni × paesi, voci AniList/MAL) è un
  pannello che si apre dal basso toccando la riga (il titolo no: è il link alla serie).
  Il grafico (un'area per fonte, che scende a zero una colonna prima di 1★ e una dopo 5★) è la prima riga della tabella
  delle distribuzioni, largo quanto la tabella e disegnato in pixel sulle colonne misurate, così ogni punto sta
  sopra il suo numero. Non una riga che si allarga perché con la virtualizzazione le
  righe devono restare alte uguali, e sul telefono una matrice dentro una riga non si leggerebbe.
- `data/` è gitignored: è tutta roba generata o scaricata.
- Gli host dell'API e del sito stanno nei secret, non nel repo: i log di Actions sono pubblici.
- Il repo è pubblico, quindi lo sono anche artifact e pagina: fuori da lì tenere tutto ciò che non
  serve a costruire la tabella (la watchlist completa non esce dal runner, ne esce solo l'avanzamento).

## Workflow

| workflow | quando | cosa fa |
|---|---|---|
| `catalog.yml` | sabato 02:00 UTC | catalogo per paese via NordVPN, 5 paesi alla volta con i login scaglionati, con le stagioni di ogni serie viste da ogni paese e, dall'Italia, la data dell'ultima puntata → artifact `catalog`, poi lancia `watchlist.yml` e `ratings.yml` |
| `watchlist.yml` | domenica–venerdì 02:00 UTC | watchlist dell'account, letta dall'Italia via NordVPN, più ultime puntate delle serie in watchlist e voti personali in stelline (`watchlist-extra.json`; il sabato, lanciato da catalog con `full_ratings`, i voti di tutto il catalogo) → artifact `watchlist`, poi lancia `deploy.yml` |
| `ratings.yml` | a fine catalog | voti AniList e MAL abbinati per id alle serie → artifact `ratings`, poi lancia `deploy.yml` |
| `deploy.yml` | push su `main` che tocca `src/**`, o a fine watchlist e ratings | `bun test`, scarica gli artifact, genera la pagina, pubblica su Pages |
| `test.yml` | push che tocca `src/**`, su qualsiasi ramo | `bun test` e typecheck |

02:00 UTC sono le 04:00 a Roma d'estate e le 03:00 d'inverno: il cron di Actions è in UTC e non segue
l'ora legale. In pratica però GitHub fa partire i cron con ore di ritardo: nella settimana del 7 ottobre
2026 `watchlist` è partito ogni giorno fra le 07:37 e le 08:24 UTC, cioè verso le **10:00 di Roma**.
La pagina riflette la watchlist di quell'ora: ciò che cambia dopo compare il giorno seguente.

## Storico: il ramo `history`

A fine `catalog.yml` e `ratings.yml`, `src/history.ts` copia i file di dati nel ramo **`history`** (senza
niente in comune con main) e ne fa un commit: elenchi e stagioni di ogni paese (`catalog-<ISO2>.ndjson`,
`catalog-seasons-<ISO2>.ndjson`, risposte intere) e i voti esterni (`ratings-external.json`). Le righe sono
ordinate per id, così git salva solo cosa cambia; il ramo non scade come gli artifact (90 giorni) e non
dipende dai workflow programmati, che GitHub spegne dopo 60 giorni senza attività su un repo pubblico.
Qualsiasi dato a qualsiasi data: `git log history`, `git show <commit>:catalog-seasons-IT.ndjson`.
Su main non si fa mai merge di `history`.

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

## Ultima puntata e voti personali

- La colonna "Ultima puntata" è la `premium_available_date` più recente fra le puntate (`latest-episode.ts`):
  quando la puntata arriva sul servizio, non quando va in onda, e i doppiaggi non la spostano. `last_public`
  della serie non va bene da solo, perché lo spostano anche i doppiaggi, ma si sposta sempre quando arriva una
  puntata: le serie col `last_public` invariato non si rileggono. Il catalogo la legge ogni sabato per tutte le
  serie, la watchlist ogni giorno per le sue; la pagina prende la più recente.
- Il voto in stelline dell'account: `/content-reviews/v2/user/<account>/rating/series/<id>`, campo `rating`
  ("5s"… o vuoto). Un voto si cambia di rado: ogni giorno quelli già noti si tengono senza rileggerli e si
  chiedono solo quelli delle serie in watchlist ancora senza voto; il run lanciato dal catalogo, una volta a
  settimana, rilegge tutto il catalogo (`full_ratings`) e riparte da zero, così voti cambiati o tolti si correggono.
- Nella pagina watchlist e voto sono simboli in fondo al titolo (segnalibro, pieno se preferita; stelline),
  e restano criteri di ordinamento nel pannello.

## MAL: i timeout sono blocchi

La sonda del 21 ottobre 2026: l'API ufficiale risponde in 82 ms di mediana (0,6 s al massimo), ma dopo circa 88
chiamate in 44 s smette di rispondere a tutte per meno di un minuto, senza 429. Per questo il timeout è 2 s e i
ritentativi aspettano 5, 10, 15, 20 s; il log dei voti riporta tempi di risposta e durata dei blocchi.
L'API v2 dà `mean`, `rank`, `popularity`, `num_scoring_users`, `num_list_users`, `num_favorites` e
`statistics.status`, non la distribuzione dei voti (solo Jikan, irraggiungibile dal runner).
