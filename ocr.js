/* Lettura dei macronutrienti da una foto di tabella nutrizionale.

   Le etichette vere hanno forme molto diverse fra loro:
   - una colonna sola di valori per 100 g;
   - due o tre colonne (per 100 g, per porzione, % AR/GDA) in ordine variabile;
   - tabelle orizzontali, con i nomi in testa e i numeri nella riga sotto;
   - il formato lineare, tutto in un paragrafo separato da virgole;
   - l'ordine del regolamento (energia, grassi, carboidrati, proteine) non è
     sempre rispettato: molte confezioni mettono le proteine per prime.

   Per questo il parser non lavora sul testo piatto ma sulle coordinate delle
   parole, e verifica il risultato contro le calorie dichiarate: se dai
   macronutrienti letti escono calorie molto diverse, la lettura è sbagliata
   e si prova un'altra combinazione di candidati. */

var NC = (function () {
  "use strict";

  /* ---------------------------------------------------------------- testo */

  function norm(s) {
    return String(s == null ? "" : s)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[‘’´`]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Token normalizzato: restano cifre, lettere e i segni che servono a capire
  // se un numero è una percentuale o un "minore di".
  function pulisci(t) {
    return norm(t).replace(/[^a-z0-9<>%.,µ]/g, "");
  }

  // Distanza di edit con uscita anticipata: l'OCR sbaglia una lettera spesso
  // ("protelne", "carboidrall"), due raramente.
  function dist(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prec = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prec[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      var best = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prec[j] + 1, cur[j - 1] + 1,
                          prec[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prec = cur.slice();
    }
    return prec[b.length];
  }

  function simile(tok, chiave) {
    if (!tok) return false;
    if (tok === chiave) return true;
    if (chiave.length < 5) return false;          // "fat", "vet": solo esatto
    var max = chiave.length >= 9 ? 2 : 1;
    return dist(tok, chiave, max) <= max;
  }

  /* --------------------------------------------------------------- numeri */

  var UNITA = /^(g|gr|grammi|gramm|gramme|grams|mg|mcg|µg|ug|ml|cl|l|kcal|cal|kj|kJ|%)$/;

  function unitaTok(t) {
    if (!t) return "";
    var m = String(t).replace(/[.,;:]+$/, "")
                     .match(/(kcal|kj|cal|mg|mcg|µg|ug|ml|gr|grammi|g|%)$/);
    if (!m) return "";
    var u = m[1];
    if (u === "gr" || u === "grammi") u = "g";
    if (u === "ug" || u === "µg") u = "mcg";
    return u;
  }

  // Unità associata al numero in posizione k: attaccata al token stesso
  // ("8,5g") oppure nel token successivo ("8,5" "g").
  function unitaDi(tks, k) {
    var u = unitaTok(tks[k]);
    if (u && !/^[0-9]+$/.test(tks[k].replace(/[.,]/g, ""))) return u;
    if (u) return u;
    var dopo = tks[k + 1];
    if (dopo && UNITA.test(dopo)) return unitaTok(dopo) || dopo;
    return "";
  }

  function numero(raw) {
    var t = String(raw == null ? "" : raw);
    if (t.indexOf("%") >= 0) return null;                 // percentuale, non un valore
    t = t.replace(/(kcal|kj|cal|mg|mcg|µg|ug|ml|cl|gr|grammi|g)\.?$/, "");
    t = t.replace(/^[^0-9a-z]*/, "").replace(/[^0-9a-z.,]*$/, "");
    if (!t) return null;
    // Lettere scambiate per cifre, solo dentro token già quasi numerici.
    if (/[a-zµ]/.test(t)) {
      if (!/^[0-9.,olisbzgq]+$/.test(t)) return null;
      t = t.replace(/[oq]/g, "0").replace(/[li]/g, "1").replace(/s/g, "5")
           .replace(/b/g, "8").replace(/z/g, "2").replace(/g/g, "9");
    }
    if (!/^[0-9]+([.,][0-9]+)*$/.test(t)) return null;

    var sep = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
    if (sep < 0) return parseFloat(t);
    var testa = t.slice(0, sep).replace(/[.,]/g, "");
    var coda = t.slice(sep + 1);
    // Tre cifre dopo il separatore: migliaia ("1.839 kJ"), a meno che la parte
    // intera sia zero, e allora sono decimali veri ("0,006 g" di sale).
    if (coda.length === 3 && parseFloat(testa) !== 0) return parseFloat(testa + coda);
    return parseFloat(testa + "." + coda);
  }

  /* ------------------------------------------------------------- vocabolario */

  var CHIAVI = {
    P: ["proteine", "proteina", "protein", "proteins", "proteines", "proteinas",
        "eiweiss", "eiweiß", "eiwitten", "eiwit", "bialko", "bjelancevine"],
    C: ["carboidrati", "carboidrato", "carbohydrate", "carbohydrates", "carbs",
        "glucidi", "glucides", "kohlenhydrate", "koolhydraten",
        "hidratos de carbono", "carbohidratos", "hidratos", "wegloWodany"],
    G: ["grassi", "grasso", "lipidi", "lipides", "fat", "fats", "fett", "fette",
        "matieres grasses", "matiere grasse", "grasas", "gorduras", "vetten", "vet",
        "tluszcz"],
    E: ["energia", "energy", "energie", "energetico", "energetica", "energetique",
        "brennwert", "energiewert", "calorie", "calories", "kalorien", "kcal"]
  };

  // Parole che marcano una sotto-voce: se stanno appena prima del nome del
  // nutriente, la riga è "di cui ..." e il numero non è quello che cerchiamo.
  var SOTTO = ["cui", "dicui", "which", "davon", "dont", "waarvan", "cuales",
               "quais", "quali", "acidi", "acido", "saturated", "saturates",
               "saturi", "saturati", "satures", "gesattigte", "insaturi",
               "monoinsaturi", "polinsaturi", "trans", "includes", "added",
               "aggiunti", "fatty", "zuccheri", "sugars", "sucres", "zucker"];

  // Parole che chiudono il campo di ricerca del valore: dopo di loro i numeri
  // appartengono a un'altra voce. Serve soprattutto al formato lineare,
  // dove tutto sta su una riga sola.
  var STOP = SOTTO.concat(["fibre", "fibra", "fiber", "fibres", "ballaststoffe",
    "vezels", "sale", "salt", "sel", "salz", "sal", "zout", "sodio", "sodium",
    "colesterolo", "cholesterol", "polioli", "polyols", "amido", "starch",
    "alcol", "alcohol", "vitamina", "vitamin", "calcio", "ferro", "porzione",
    "portion", "serving"]);

  function eStop(tok) {
    var i;
    for (i = 0; i < STOP.length; i++) if (simile(tok, STOP[i])) return true;
    for (var k in CHIAVI) {
      if (!CHIAVI.hasOwnProperty(k)) continue;
      for (i = 0; i < CHIAVI[k].length; i++) {
        var parti = CHIAVI[k][i].split(" ");
        if (simile(tok, parti[0])) return true;
      }
    }
    return false;
  }

  function eSotto(tok) {
    for (var i = 0; i < SOTTO.length; i++) if (simile(tok, SOTTO[i])) return true;
    return false;
  }

  // Quante posizioni occupa la chiave a partire da i, 0 se non combacia.
  function frase(tks, i, chiave) {
    var parti = chiave.split(" ");
    if (parti.length === 1) return simile(tks[i], parti[0]) ? 1 : 0;
    var unito = "", n = 0;
    while (n < parti.length && i + n < tks.length) { unito += tks[i + n]; n++; }
    if (n < parti.length) return 0;
    return simile(unito, parti.join("")) ? n : 0;
  }

  /* ----------------------------------------------------------------- righe */

  // Raggruppa le parole in righe visive per sovrapposizione verticale. Non ci
  // fidiamo delle righe di Tesseract: su una tabella a più colonne a volte
  // spezza, a volte unisce.
  // "1839 kJ/436 kcal" arriva spesso come un token solo: lo spezziamo in parti
  // con riquadri proporzionali, così numero e unità restano accoppiati.
  function espandi(parole) {
    var out = [];
    parole.forEach(function (w) {
      var t = String(w.t);
      if (t.indexOf("/") < 0 && t.indexOf("|") < 0) { out.push(w); return; }
      var parti = t.split(/[\/|]/).filter(function (s) { return s !== ""; });
      if (parti.length < 2) { out.push(w); return; }
      var larg = w.b.x1 - w.b.x0, off = 0;
      parti.forEach(function (s) {
        var a = w.b.x0 + larg * (off / t.length);
        var b = w.b.x0 + larg * ((off + s.length) / t.length);
        out.push({ t: s, c: w.c, b: { x0: a, x1: b, y0: w.b.y0, y1: w.b.y1 } });
        off += s.length + 1;
      });
    });
    return out;
  }

  function righeDaParole(parole) {
    parole = espandi(parole);
    if (!parole.length) return [];
    var alt = parole.map(function (w) { return w.b.y1 - w.b.y0; })
                    .sort(function (a, b) { return a - b; });
    var h = alt[Math.floor(alt.length / 2)] || 10;
    var ord = parole.slice().sort(function (a, b) {
      return (a.b.y0 + a.b.y1) / 2 - (b.b.y0 + b.b.y1) / 2;
    });
    var R = [], cur = null;
    ord.forEach(function (w) {
      var yc = (w.b.y0 + w.b.y1) / 2;
      if (cur && yc < cur.y1 - h * 0.25) {
        cur.p.push(w);
        if (w.b.y1 > cur.y1) cur.y1 = w.b.y1;
      } else {
        cur = { p: [w], y0: w.b.y0, y1: w.b.y1 };
        R.push(cur);
      }
    });
    return R.map(function (r) { return finalizza(r, h); })
            .filter(function (r) { return r.testo.replace(/\s/g, "") !== ""; });
  }

  function finalizza(r, h) {
    r.p.sort(function (a, b) { return a.b.x0 - b.b.x0; });
    r.tks = r.p.map(function (w) { return pulisci(w.t); });
    r.testo = r.tks.join(" ");
    r.h = h;
    r.cella = celle(r, h);
    return r;
  }

  // Divide la riga in celle: cambia cella dopo un numero, dopo una virgola di
  // chiusura e in corrispondenza di uno stacco orizzontale largo. Serve a
  // capire dove finisce una voce e dove ne comincia un'altra, che è l'unico
  // modo di distinguere "di cui acidi grassi saturi" (sotto-voce dei grassi)
  // da "...zuccheri 18,5 g, Proteine" (voce nuova, le parole prima non contano).
  function celle(r, h) {
    var out = [], n = 0;
    for (var i = 0; i < r.tks.length; i++) {
      if (i > 0) {
        var gap = r.p[i].b.x0 - r.p[i - 1].b.x1;
        var prec = r.tks[i - 1];
        var eraNum = numero(prec) !== null;
        if (gap > h * 1.2 || eraNum || (!eraNum && /[,;:]$/.test(prec))) n++;
      }
      out[i] = n;
    }
    return out;
  }

  // Stesso formato a partire dal testo piatto, quando i riquadri non ci sono.
  // La posizione del carattere fa da coordinata x, così le colonne restano.
  function righeDaTesto(testo) {
    var parole = [];
    String(testo || "").split(/\r?\n/).forEach(function (riga, i) {
      var re = /\S+/g, m;
      while ((m = re.exec(riga))) {
        parole.push({
          t: m[0],
          b: { x0: m.index * 10, x1: (m.index + m[0].length) * 10,
               y0: i * 20, y1: i * 20 + 14 }
        });
      }
    });
    return righeDaParole(parole);
  }

  // v5 e v6 espongono le parole solo dentro blocks, e solo se richieste.
  function lineeDa(data) {
    var L = [];
    function riga(ws) {
      var out = [];
      (ws || []).forEach(function (w) {
        if (w && w.text && w.bbox && String(w.text).trim()) {
          out.push({ t: w.text, b: w.bbox, c: w.confidence });
        }
      });
      if (out.length) L.push(out);
    }
    (data && data.blocks || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (p) {
        (p.lines || []).forEach(function (l) { riga(l.words); });
      });
    });
    if (!L.length && data && data.words) riga(data.words);
    return L;
  }

  // Le righe di Tesseract tengono conto dell'inclinazione della foto, cosa che
  // un raggruppamento fatto solo sulle y non regge: bastano due gradi perché
  // la riga scenda più dell'altezza del carattere. Le usiamo come sono, e ci
  // limitiamo a rimettere insieme i pezzi che stanno alla stessa altezza e in
  // colonne diverse, perché sulle tabelle Tesseract a volte spezza per colonna.
  function righeDaLinee(linee) {
    var tutte = [];
    linee.forEach(function (ws) { tutte = tutte.concat(ws); });
    if (!tutte.length) return [];
    linee = linee.map(espandi);
    var alt = tutte.map(function (w) { return w.b.y1 - w.b.y0; })
                   .sort(function (a, b) { return a - b; });
    var h = alt[Math.floor(alt.length / 2)] || 10;

    var R = linee.map(function (ws) {
      var r = { p: ws.slice() };
      r.y0 = Math.min.apply(null, ws.map(function (w) { return w.b.y0; }));
      r.y1 = Math.max.apply(null, ws.map(function (w) { return w.b.y1; }));
      r.x0 = Math.min.apply(null, ws.map(function (w) { return w.b.x0; }));
      r.x1 = Math.max.apply(null, ws.map(function (w) { return w.b.x1; }));
      return r;
    }).sort(function (a, b) { return (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2; });

    var out = [];
    R.forEach(function (r) {
      for (var i = 0; i < out.length; i++) {
        var o = out[i];
        var sy = Math.min(o.y1, r.y1) - Math.max(o.y0, r.y0);
        var sx = Math.min(o.x1, r.x1) - Math.max(o.x0, r.x0);
        if (sy > Math.min(o.y1 - o.y0, r.y1 - r.y0) * 0.7 && sx < 0) {
          o.p = o.p.concat(r.p);
          o.y0 = Math.min(o.y0, r.y0); o.y1 = Math.max(o.y1, r.y1);
          o.x0 = Math.min(o.x0, r.x0); o.x1 = Math.max(o.x1, r.x1);
          return;
        }
      }
      out.push(r);
    });
    return out.map(function (r) { return finalizza(r, h); })
              .filter(function (r) { return r.testo.replace(/\s/g, "") !== ""; });
  }

  /* ------------------------------------------------------------- colonne */

  // Colonna "per 100 g" e colonne di percentuali, individuate dalle
  // intestazioni. Servono a scegliere il numero giusto quando la riga ne ha
  // più d'uno.
  function colonne(righe) {
    var c100 = null, perc = [];
    righe.forEach(function (r) {
      r.tks.forEach(function (t, i) {
        var x = (r.p[i].b.x0 + r.p[i].b.x1) / 2;
        if (/^100(g|ml|gr)?$/.test(t) ||
            (t === "100" && UNITA.test(r.tks[i + 1] || ""))) {
          if (c100 === null) c100 = x;
        }
        if (t.indexOf("%") >= 0 || simile(t, "gda") || simile(t, "vnr") ||
            simile(t, "ar") || simile(t, "ri") || simile(t, "dv")) {
          perc.push(x);
        }
      });
    });
    return { c100: c100, perc: perc };
  }

  /* ------------------------------------------------------------ estrazione */

  // Candidati per un nutriente: scorre la riga dopo il nome e raccoglie i
  // numeri plausibili, fermandosi alla voce successiva.
  // Letture possibili di un token numerico, con la loro penalità.
  //
  // Sui caratteri piccoli l'OCR sbaglia in due modi ricorrenti, spesso
  // insieme: attacca la "g" alla cifra leggendola "9" ("8,5 g" -> "8,59",
  // "22,6 g" -> "22649") e perde la virgola ("10,0 g" -> "100g"). Invece di
  // indovinare, produciamo tutte le letture plausibili e lasciamo che siano
  // la colonna e il conto delle calorie a scegliere.
  // Quando l'OCR perde le virgole le perde quasi tutte insieme, e lo si vede
  // da due segni: numeri che cominciano per zero ("0,8 g" letto "08g"), che
  // in etichetta non esistono, e più valori in grammi sopra i 100. Saperlo
  // cambia tutto: se la perdita è sistematica, rimettere la virgola è
  // un'ipotesi ragionevole; altrimenti è un azzardo che fa passare errori
  // che si compensano fra loro.
  function perditaVirgola(righe) {
    var zeri = 0, grandi = 0;
    righe.forEach(function (r) {
      r.tks.forEach(function (t, k) {
        var u = unitaDi(r.tks, k);
        if (u === "kcal" || u === "kj" || u === "cal" || u === "mg" ||
            u === "mcg" || u === "%" || t.indexOf("%") >= 0) return;
        var nudo = t.replace(/[a-zµ]+$/, "").replace(/[.,]+$/, "");
        if (!/^[0-9]+$/.test(nudo) || nudo === "100") return;
        if (/^0[0-9]/.test(nudo)) zeri++;
        if (parseFloat(nudo) > 100) grandi++;
      });
    });
    return zeri >= 1 || grandi >= 2;
  }

  function letture(t, tks, k, perdita) {
    var u = unitaDi(tks, k), out = [];
    var attaccata = /[a-zµ]/.test(t);       // "85g", "04g": unità incollata
    var basi = [{ s: t, p: 0, rotto: false }];
    // "8,5 g" letto "8,59": la g diventa un 9 attaccato alla cifra. Se è
    // successo, quel token è già compromesso e anche la virgola può mancare.
    if (!u && /9$/.test(t) && t.replace(/[^0-9]/g, "").length > 1) {
      basi.push({ s: t.replace(/9$/, "").replace(/[.,]+$/, ""), p: 0.4, rotto: true });
    }
    basi.forEach(function (b) {
      var v = numero(b.s);
      if (v === null) return;
      if (v >= 0 && v <= 100) {
        var pen = b.p;
        // Due decimali su un macronutriente non si vedono quasi mai.
        if (v >= 1 && Math.abs(v * 10 - Math.round(v * 10)) > 1e-9) pen += 0.5;
        out.push({ v: v, pen: pen });
      }
      var sep = b.s.indexOf(",") >= 0 || b.s.indexOf(".") >= 0;
      if (sep) return;
      var indizio = attaccata || b.rotto || v > 100 || perdita;
      if (indizio && v / 10 >= 0.05 && v / 10 <= 100) {
        out.push({ v: v / 10, pen: b.p + (perdita ? 0.5 : 1.6) });
      }
      // Due virgole perse nello stesso numero: molto più raro.
      if ((v > 100 || perdita) && v / 100 >= 0.05 && v / 100 <= 100) {
        out.push({ v: v / 100, pen: b.p + (perdita ? 1.4 : 2.6) });
      }
    });
    return out;
  }

  function candidatiRiga(r, i, salto, perdita) {
    var out = [], ord = 0;
    for (var k = i + salto; k < r.tks.length; k++) {
      var t = r.tks[k];
      if (!t) continue;
      if (eStop(t)) break;
      if (UNITA.test(t)) continue;               // unità sciolta
      if (t.indexOf("%") >= 0) continue;
      var u = unitaDi(r.tks, k);
      if (u === "kcal" || u === "kj" || u === "cal" || u === "%") continue;
      if (u === "mg" || u === "mcg") continue;   // sodio, vitamine
      if (numero(t) === null) continue;
      var x = (r.p[k].b.x0 + r.p[k].b.x1) / 2;
      letture(t, r.tks, k, perdita).forEach(function (l) {
        out.push({ v: l.v, x: x, ord: ord, extra: l.pen });
      });
      ord++;
      if (ord >= 4) break;
    }
    return out;
  }

  // Tabelle orizzontali: nomi in testa, numeri nella riga sotto, incolonnati.
  function candidatiSotto(righe, idx, r, i, salto, perdita) {
    var x0 = r.p[i].b.x0, x1 = r.p[i + salto - 1].b.x1;
    var largo = Math.max(x1 - x0, 20);
    var out = [];
    for (var j = idx + 1; j < righe.length && j <= idx + 3 && !out.length; j++) {
      var s = righe[j];
      for (var k = 0; k < s.tks.length; k++) {
        var xc = (s.p[k].b.x0 + s.p[k].b.x1) / 2;
        if (xc < x0 - largo * 0.4 || xc > x1 + largo * 0.4) continue;
        var u = unitaDi(s.tks, k);
        if (u === "kcal" || u === "kj" || u === "%" || u === "mg" || u === "mcg") continue;
        if (s.tks[k].indexOf("%") >= 0) continue;
        var t = s.tks[k];
        if (numero(t) === null) continue;
        var ls = letture(t, s.tks, k, perdita);
        if (!ls.length) continue;
        ls.forEach(function (l) { out.push({ v: l.v, x: xc, ord: 0, extra: l.pen }); });
        break;
      }
    }
    return out;
  }

  function energia(righe) {
    var kcal = null, kj = null;
    righe.forEach(function (r) {
      r.tks.forEach(function (t, k) {
        var u = unitaTok(t);
        var nudo = String(t).replace(/[.,;:]+$/, "");
        var dentro = u === "kcal" || u === "kj";
        var sciolta = (nudo === "kcal" || nudo === "kj" || nudo === "cal");
        if (!dentro && !sciolta) return;
        var tipo = (u || t) === "kj" ? "kj" : "kcal";
        var v = dentro ? numero(t) : null;
        if (v === null && k > 0) v = numero(r.tks[k - 1]);   // "436 kcal"
        if (v === null) v = numero(r.tks[k + 1]);            // "kcal 436"
        if (v === null || v <= 0) return;
        if (tipo === "kj") { if (kj === null || v > kj) kj = v; }
        else { if (kcal === null || v > kcal) kcal = v; }
      });
    });
    // Etichette americane: "Calories 230", senza unità scritta.
    if (kcal === null) {
      righe.forEach(function (r) {
        r.tks.forEach(function (t, k) {
          if (kcal !== null) return;
          if (!simile(t, "calories") && !simile(t, "calorie") &&
              !simile(t, "kalorien")) return;
          for (var j = k + 1; j < r.tks.length && j <= k + 3; j++) {
            var v = numero(r.tks[j]);
            if (v !== null && v >= 5 && v <= 1200) { kcal = v; return; }
          }
        });
      });
    }
    if (kcal === null && kj !== null) kcal = Math.round(kj / 4.184);
    return { kcal: kcal, kj: kj };
  }

  function estraiDaRighe(righe) {
    var col = colonne(righe);
    var cand = { P: [], C: [], G: [] };
    var h = (righe[0] && righe[0].h) || 10;
    var perdita = perditaVirgola(righe);

    righe.forEach(function (r, idx) {
      for (var i = 0; i < r.tks.length; i++) {
        if (eSotto(r.tks[i])) continue;
        for (var nut in cand) {
          if (!cand.hasOwnProperty(nut)) continue;
          for (var q = 0; q < CHIAVI[nut].length; q++) {
            var salto = frase(r.tks, i, CHIAVI[nut][q]);
            if (!salto) continue;
            // Sotto-voce se un marcatore sta nella stessa cella del nome:
            // "di cui acidi grassi saturi", "Saturated Fat", "Grassi saturi".
            var sotto = false;
            for (var b = 0; b < r.tks.length; b++) {
              if (b >= i && b < i + salto) continue;
              if (r.cella[b] === r.cella[i] && eSotto(r.tks[b])) sotto = true;
            }
            if (sotto) break;
            var trovati = candidatiRiga(r, i, salto, perdita);
            if (!trovati.length) trovati = candidatiSotto(righe, idx, r, i, salto, perdita);
            trovati.forEach(function (c) { cand[nut].push(c); });
            break;
          }
        }
      }
    });

    // Ordine di preferenza: la colonna "per 100 g" se l'abbiamo trovata,
    // altrimenti il primo numero a sinistra; mai sotto una colonna di %.
    for (var nut in cand) {
      if (!cand.hasOwnProperty(nut)) continue;
      cand[nut] = cand[nut].map(function (c) {
        var pen = (c.ord || 0) * 0.5 + (c.extra || 0);
        // Le distanze si misurano in altezze di carattere, non in pixel:
        // altrimenti il peso della colonna cambia con la scala dell'immagine.
        if (col.c100 !== null) pen += Math.abs(c.x - col.c100) / (h * 2.5);
        col.perc.forEach(function (px) { if (Math.abs(c.x - px) < h) pen += 8; });
        c.pen = pen;
        return c;
      }).sort(function (a, b) { return a.pen - b.pen; });
      // Stesso valore da letture diverse: tieni solo la meno penalizzata.
      var visti = {};
      cand[nut] = cand[nut].filter(function (c) {
        var k = c.v.toFixed(3);
        if (visti[k]) return false;
        visti[k] = 1;
        return true;
      }).slice(0, 6);
    }
    var multi = false;
    ["P", "C", "G"].forEach(function (k) {
      cand[k].forEach(function (c) { if (c.ord > 0) multi = true; });
    });
    return { cand: cand, col: col, multi: multi, energia: energia(righe) };
  }

  /* ------------------------------------------------------------ selezione */

  // Fra i candidati sceglie la terna più coerente con le calorie dichiarate.
  // È la difesa che impedisce di prendere le kcal totali come proteine:
  // 4·436 non torna mai con 436 kcal in etichetta.
  // multi: la tabella ha davvero più colonne di valori. Solo in quel caso ha
  // senso pretendere che i tre valori stiano incolonnati; nel formato lineare,
  // in quello orizzontale e nelle etichette americane, dove il numero segue il
  // nome sulla stessa riga, le x sono diverse per costruzione.
  function scegli(cand, kcal, h, multi) {
    var liste = {};
    // "nessun valore" è sempre una possibilità: su una cella illeggibile è
    // meglio non rispondere che prendere il numero della colonna accanto, che
    // è riferito alla porzione e non a 100 g.
    ["P", "C", "G"].forEach(function (k) { liste[k] = cand[k].concat([null]); });
    var best = null;
    liste.P.forEach(function (p) {
      liste.C.forEach(function (c) {
        liste.G.forEach(function (g) {
          var P = p ? p.v : 0, C = c ? c.v : 0, G = g ? g.v : 0;
          var s = 0;
          [p, c, g].forEach(function (x) { if (x) s -= x.pen; else s -= 6; });
          // I tre valori stanno in colonna: se uno viene da molto più a destra
          // è di un'altra colonna, cioè di un'altra base di riferimento.
          var xs = [p, c, g].filter(Boolean).map(function (x) { return x.x; });
          if (multi && xs.length > 1) {
            var largo = Math.max.apply(null, xs) - Math.min.apply(null, xs);
            s -= Math.max(0, largo - 2 * h) / (h * 0.8);
          }
          var somma = P + C + G;
          if (somma > 105) s -= (somma - 105) * 2;
          var calc = 4 * P + 4 * C + 9 * G;
          if (kcal) {
            var scarto = (calc - kcal) / Math.max(kcal, 50);
            // Superare le calorie dichiarate è impossibile, e lo è anche per
            // due valori su tre: questo vincolo vale sempre. La banda morta
            // del 4% lascia passare gli arrotondamenti dell'etichetta.
            if (scarto > 0.04) s -= (scarto - 0.04) * 2.5 * 30;
            // Restare sotto invece è normale — fibre e polioli danno calorie
            // che il 4/4/9 non conta — quindi si contesta solo se i tre valori
            // ci sono tutti e il conto è comunque troppo basso.
            if (p && c && g && scarto < -0.10) s -= (-scarto - 0.10) * 30;
          }
          if (best === null || s > best.s) {
            best = { s: s, P: p, C: c, G: g, calc: calc };
          }
        });
      });
    });
    return best;
  }

  function componi(righe) {
    var e = estraiDaRighe(righe);
    var b = scegli(e.cand, e.energia.kcal, (righe[0] && righe[0].h) || 10, e.multi);
    var val = {
      P: b.P ? b.P.v : null,
      C: b.C ? b.C.v : null,
      G: b.G ? b.G.v : null,
      kcal: e.energia.kcal,
      kJ: e.energia.kj,
      avvisi: [],
      per100: e.col.c100 !== null
    };
    var letti = ["P", "C", "G"].filter(function (k) { return val[k] !== null; });
    val.letti = letti.length;
    val.h = (righe[0] && righe[0].h) || 0;   // altezza tipica del carattere letto
    val.accordo = null;                    // scarto relativo fra calcolo e etichetta
    if (val.kcal && letti.length === 3) {
      var calc = 4 * val.P + 4 * val.C + 9 * val.G;
      val.calc = calc;
      val.accordo = Math.abs(calc - val.kcal) / val.kcal;
      if (Math.abs(calc - val.kcal) > Math.max(20, val.kcal * 0.12)) {
        val.avvisi.push("i valori letti darebbero " + Math.round(calc) +
                        " kcal, l'etichetta ne dichiara " + val.kcal);
      }
    }
    if (val.P !== null && val.C !== null && val.G !== null &&
        val.P + val.C + val.G > 105) {
      val.avvisi.push("la somma dei macronutrienti supera 100 g");
    }
    // Il punteggio serve a confrontare due passaggi di lettura della stessa
    // foto. Conta quanti valori ha trovato, ma soprattutto quanto il conto
    // delle calorie torna: è l'unica misura di qualità che abbiamo senza
    // sapere la risposta giusta.
    val.punteggio = letti.length * 10 + (val.avvisi.length ? 0 : 6) +
                    (val.kcal ? 2 : 0) +
                    (val.accordo === null ? 0 : Math.max(0, 8 - val.accordo * 100));
    return val;
  }

  function daTesto(testo) { return componi(righeDaTesto(testo)); }
  function daDati(data) {
    var l = lineeDa(data);
    return l.length ? componi(righeDaLinee(l)) : daTesto(data && data.text);
  }

  /* -------------------------------------------------------- preparazione */

  function caricaImmagine(file) {
    function viaTag() {
      return new Promise(function (ris, rif) {
        var url = URL.createObjectURL(file), img = new Image();
        img.onload = function () { ris(img); };
        img.onerror = function () { URL.revokeObjectURL(url); rif(new Error("immagine")); };
        img.src = url;
      });
    }
    if (typeof createImageBitmap === "function") {
      try {
        return createImageBitmap(file, { imageOrientation: "from-image" })
          .catch(viaTag);
      } catch (e) { return viaTag(); }
    }
    return viaTag();
  }

  // Ridimensiona, poi soglia adattiva locale, che regge le ombre e i riflessi
  // molto meglio di un contrasto globale.
  //
  // La scala conta più di ogni altro parametro: sotto i ~30 px di altezza del
  // carattere Tesseract attacca l'unità alla cifra ("8,5 g" letto "859g") e il
  // valore diventa inutilizzabile. Meglio ingrandire e non rimpicciolire
  // troppo, anche se costa qualche decimo di secondo.
  function prepara(img, binarizza, extra) {
    var w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    var L = Math.max(w, h), sc = 1;
    if (L < 2000) sc = Math.min(3, 2000 / L);
    else if (L > 2800) sc = 2800 / L;
    sc *= (extra || 1);
    if (L * sc > 4200) sc = 4200 / L;
    var cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w * sc));
    cv.height = Math.max(1, Math.round(h * sc));
    var ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, cv.width, cv.height);

    var W = cv.width, H = cv.height, n = W * H;
    var d = ctx.getImageData(0, 0, W, H), p = d.data;
    var gray = new Uint8Array(n), i;
    for (i = 0; i < n; i++) {
      gray[i] = (0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]) | 0;
    }
    if (!binarizza) {
      for (i = 0; i < n; i++) {
        p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = gray[i];
        p[i * 4 + 3] = 255;
      }
      ctx.putImageData(d, 0, 0);
      return cv;
    }

    var integ = new Uint32Array((W + 1) * (H + 1));
    var x, y;
    for (y = 0; y < H; y++) {
      var rs = 0;
      for (x = 0; x < W; x++) {
        rs += gray[y * W + x];
        integ[(y + 1) * (W + 1) + (x + 1)] = integ[y * (W + 1) + (x + 1)] + rs;
      }
    }
    var r = Math.max(8, Math.round(Math.min(W, H) / 24)), C = 10;
    var mask = new Uint8Array(n), scuri = 0;
    for (y = 0; y < H; y++) {
      var y0 = y - r < 0 ? 0 : y - r, y1 = y + r > H - 1 ? H - 1 : y + r;
      for (x = 0; x < W; x++) {
        var x0 = x - r < 0 ? 0 : x - r, x1 = x + r > W - 1 ? W - 1 : x + r;
        var s = integ[(y1 + 1) * (W + 1) + (x1 + 1)] - integ[y0 * (W + 1) + (x1 + 1)]
              - integ[(y1 + 1) * (W + 1) + x0] + integ[y0 * (W + 1) + x0];
        var media = s / ((x1 - x0 + 1) * (y1 - y0 + 1));
        if (gray[y * W + x] < media - C) { mask[y * W + x] = 1; scuri++; }
      }
    }
    // Scritta chiara su fondo scuro: il "sotto la media" è lo sfondo, si gira.
    var inverti = scuri > n * 0.5;
    for (i = 0; i < n; i++) {
      var nero = inverti ? !mask[i] : !!mask[i];
      var v = nero ? 0 : 255;
      p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v;
      p[i * 4 + 3] = 255;
    }
    ctx.putImageData(d, 0, 0);
    return cv;
  }

  /* ---------------------------------------------------------------- motore */

  var avvio = null, riferisci = null;

  function motore() {
    if (avvio) return avvio;
    avvio = Tesseract.createWorker("ita+eng", 1, {
      logger: function (m) { if (riferisci) riferisci(m); }
    });
    return avvio;
  }

  function passo(w, immagine, psm) {
    return w.setParameters({
      tessedit_pageseg_mode: psm,
      preserve_interword_spaces: "1"
    }).then(function () {
      return w.recognize(immagine, {}, { text: true, blocks: true });
    }).then(function (res) { return daDati(res.data); });
  }

  // Una lettura si può fidare solo se ha trovato tutti e tre i valori e le
  // calorie tornano: tre numeri plausibili ma sbagliati insieme sembrano una
  // lettura riuscita, ed è così che passavano gli errori peggiori.
  function convince(r) {
    return r.letti === 3 && !r.avvisi.length &&
           (r.accordo === null || r.accordo <= 0.05);
  }

  // Il primo passaggio è in scala di grigi: misurato sulle foto di prova, la
  // soglia adattiva perde le virgole ("10,0 g" diventa "100g") e peggiora la
  // lettura, quindi resta solo come ultima spiaggia.
  //
  // Se non convince, il secondo passaggio riscala in base all'altezza del
  // carattere effettivamente misurata nel primo: è il parametro che conta di
  // più, e conoscerla è meglio che indovinare una scala fissa.
  function leggiFoto(file, progresso) {
    riferisci = progresso || null;
    return caricaImmagine(file).then(function (img) {
      return motore().then(function (w) {
        return passo(w, prepara(img, false), "6").then(function (a) {
          if (convince(a)) return a;
          var mira = a.h > 4 ? 40 / a.h : 1.6;
          var extra = Math.max(1.25, Math.min(2.4, mira));
          return passo(w, prepara(img, false, extra), "6").then(function (b) {
            var meglio = b.punteggio > a.punteggio ? b : a;
            if (convince(meglio)) return meglio;
            // Nessuna delle due convince: l'ultima carta è la binarizzazione,
            // che su luce molto irregolare a volte recupera quello che la
            // scala di grigi non vede.
            return passo(w, prepara(img, true, extra), "6").then(function (c) {
              return c.punteggio > meglio.punteggio ? c : meglio;
            }, function () { return meglio; });
          }, function () { return a; });
        });
      });
    }).then(function (r) { riferisci = null; return r; },
            function (e) { riferisci = null; throw e; });
  }

  return {
    leggiFoto: leggiFoto,
    daTesto: daTesto,
    daDati: daDati,
    numero: numero,
    righeDaTesto: righeDaTesto,
    prepara: prepara
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = NC;
