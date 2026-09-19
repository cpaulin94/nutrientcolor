# Macrocolore — come metterlo online e installarlo

Non serve comprare un dominio. Le opzioni sotto danno un indirizzo HTTPS gratuito,
che è il requisito che mancava per l'installazione.

## Opzione 1 — Netlify Drop (la più veloce, da computer)

1. Scompatta `macrocolore-pwa.zip`: ottieni una cartella con dentro
   `index.html`, `manifest.webmanifest`, `sw.js` e le tre icone.
2. Vai su https://app.netlify.com/drop
3. Trascina la **cartella** (non i singoli file) nel riquadro.
4. Ottieni un indirizzo tipo `https://nome-casuale.netlify.app`.
   Creando un account gratuito puoi rinominarlo e il sito resta permanente.

## Opzione 2 — GitHub Pages (funziona anche da telefono)

1. Crea un repository pubblico nuovo, per esempio `macrocolore`.
2. Carica i sei file nella radice del repository (Add file → Upload files).
3. Settings → Pages → Source: `Deploy from a branch`, branch `main`, cartella `/ (root)`.
4. Dopo un paio di minuti il sito è su `https://<tuonome>.github.io/macrocolore/`.

## Opzione 3 — Cloudflare Pages

Stesso principio: crea un progetto, carica la cartella, ottieni un `.pages.dev`.

## Installare su Android

1. Apri l'indirizzo HTTPS in Chrome.
2. Menu ⋮ → **Installa app** (se non compare, usa "Aggiungi a schermata Home").
3. L'icona appare nel drawer e l'app si apre a schermo intero, senza barra del browser.

Se la voce "Installa app" non compare subito, ricarica la pagina una volta:
Chrome deve prima registrare il service worker.

## Note

- Al primo utilizzo l'OCR scarica circa 15 MB di modello linguistico.
  Il service worker lo mette in cache, quindi dalla seconda volta funziona offline.
- I valori salvati restano nel `localStorage` del telefono. Disinstallare l'app
  o cancellare i dati del sito li elimina.
- Per aggiornare l'app dopo una modifica, cambia `CACHE = "macrocolore-v1"`
  in `sw.js` (per esempio `-v2`), altrimenti il browser continua a servire
  la versione vecchia dalla cache.

## File

| File | A cosa serve |
|---|---|
| `index.html` | L'app: fotocamera, OCR, calcolo, colore, glifo, barra, lista |
| `manifest.webmanifest` | Nome, icone, colori e modalità a schermo intero |
| `sw.js` | Cache offline dell'app e del motore OCR |
| `icon-192.png`, `icon-512.png` | Icone dell'app |
| `icon-maskable.png` | Icona adattiva per Android |
