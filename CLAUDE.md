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
reindirizza a `blob.core.windows.net`, che il proxy dell'ambiente rifiuta; anche il sito pubblicato
(`caesarsol.github.io`) è irraggiungibile. In quel caso si ripiega su dati sintetici della stessa forma,
**dicendolo esplicitamente** invece di far passare l'anteprima per dati reali.

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
l'ora legale.
