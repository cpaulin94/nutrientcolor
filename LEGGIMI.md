# Macrocolore

L'app è online su **https://cpaulin94.github.io/nutrientcolor/** e da lì si installa
sul telefono. Le istruzioni sotto servono se vuoi pubblicarne un'altra copia.

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

1. Crea un repository pubblico nuovo, per esempio `nutrientcolor`.
2. Carica i sette file nella radice del repository (Add file → Upload files).
3. Settings → Pages → Source: `Deploy from a branch`, branch `main`, cartella `/ (root)`.
4. Dopo un paio di minuti il sito è su `https://<tuonome>.github.io/nutrientcolor/`.

## Opzione 3 — Cloudflare Pages

Stesso principio: crea un progetto, carica la cartella, ottieni un `.pages.dev`.

## Installare su Android

1. Apri l'indirizzo HTTPS in Chrome.
2. Menu ⋮ → **Installa app** (se non compare, usa "Aggiungi a schermata Home").
3. L'icona appare nel drawer e l'app si apre a schermo intero, senza barra del browser.

Se la voce "Installa app" non compare subito, ricarica la pagina una volta:
Chrome deve prima registrare il service worker.

## Come legge l'etichetta

Le tabelle nutrizionali hanno forme molto diverse: una colonna sola per 100 g,
due o tre colonne (100 g, porzione, % AR), tabelle orizzontali con i nomi in
testa e i numeri sotto, il formato lineare tutto in un paragrafo. Anche l'ordine
cambia: parecchie confezioni mettono le proteine prima dei carboidrati.

Per questo `ocr.js` non cerca i numeri nel testo piatto, ma lavora sulle
coordinate delle parole:

- ricostruisce le righe visive e le divide in celle, così `di cui acidi grassi
  saturi` non viene scambiato per la riga dei grassi;
- riconosce la colonna "per 100 g" dall'intestazione e scarta le colonne di
  percentuali;
- scarta i numeri con unità sbagliata: un valore in `kcal` o in `mg` non può
  essere un macronutriente;
- **verifica il risultato contro le calorie dichiarate.** Se dai valori letti
  escono calorie molto diverse da quelle in etichetta, la lettura viene
  scartata e ne prova un'altra. È questo che impedisce di prendere le kcal
  totali come grammi di proteine.

Quando la lettura non torna, l'app lo dice invece di far finta di niente.
I valori restano sempre modificabili a mano.

## Note

- Al primo utilizzo l'OCR scarica circa 15 MB di modello linguistico.
  Il service worker lo mette in cache, quindi dalla seconda volta funziona offline.
- I valori salvati restano nel `localStorage` del telefono. Disinstallare l'app
  o cancellare i dati del sito li elimina.
- Per aggiornare l'app dopo una modifica, cambia `CACHE = "macrocolore-v2"`
  in `sw.js` (per esempio `-v3`), altrimenti il browser continua a servire
  la versione vecchia dalla cache.
- Foto da vicino e ben illuminate: sotto i ~30 px di altezza del carattere
  l'OCR attacca l'unità alla cifra e legge `8,5 g` come `859`.

## File

| File | A cosa serve |
|---|---|
| `index.html` | L'app: fotocamera, calcolo, colore, glifo, barra, lista |
| `ocr.js` | Lettura della tabella nutrizionale dalla foto |
| `manifest.webmanifest` | Nome, icone, colori e modalità a schermo intero |
| `sw.js` | Cache offline dell'app e del motore OCR |
| `icon-192.png`, `icon-512.png` | Icone dell'app |
| `icon-maskable.png` | Icona adattiva per Android |
