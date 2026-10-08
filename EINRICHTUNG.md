# Vereinskasse – Einrichtung (einmalig, ca. 20 Minuten)

Die App liegt kostenlos auf **GitHub Pages**. Login und gemeinsame Daten laufen über **Firebase** (Google, kostenloser „Spark“-Tarif, Serverstandort Frankfurt). Eine Kreditkarte braucht ihr dafür nicht.

## 1. Firebase-Projekt anlegen

1. <https://console.firebase.google.com> öffnen (am besten mit einem Google-Konto des Vereins) und auf **Projekt erstellen** klicken. Name z. B. `vereinskasse-sg-aura`. Google Analytics wird nicht gebraucht.
2. **Authentication** → *Jetzt starten* → Anbieter **E-Mail/Passwort** aktivieren.
3. **Firestore Database** → *Datenbank erstellen* → Standort **eur3 (Europe)** oder **europe-west3 (Frankfurt)** wählen. Den Modus **Produktion** wählen.
4. Unter **Firestore → Regeln** den Inhalt der Datei `firestore.rules` aus diesem Ordner komplett einfügen und dann **Veröffentlichen**.
5. Unter **Projekteinstellungen (Zahnrad) → Allgemein → Meine Apps** auf das Web-Symbol `</>` klicken und eine App registrieren (Name egal, *kein* Hosting). Firebase zeigt dann einen Block `const firebaseConfig = { … }`. Diese Werte gehören in die Datei **`firebase-config.js`**.

## 2. Kassen-Zugänge anlegen

Für jeden Zugang braucht es zwei Schritte:

1. **Authentication → Nutzer → Nutzer hinzufügen**: E-Mail und Passwort eintragen.
2. **Firestore → Daten → Sammlung starten**, Sammlungs-ID **`members`**. Als **Dokument-ID** die E-Mail-Adresse komplett **kleingeschrieben** eintragen, z. B. `kasse@sg-aura.de`. Feld z. B. `name` = `Theke`.

Wer nur in *Authentication* steht, aber nicht in `members`, kommt **nicht** an die Daten.

Es reicht auch **ein** gemeinsamer Zugang für alle Helfer, z. B. `kasse@…`. Mit eigenen Zugängen pro Person sieht man später im CSV-Export, wer welche Buchung gemacht hat.

**Zugang sperren:** Den Eintrag in `members` löschen oder den Nutzer in *Authentication* deaktivieren.

## 3. Auf GitHub veröffentlichen

1. Auf GitHub ein **öffentliches** Repository anlegen, z. B. `vereinskasse`. Alle Dateien aus diesem Ordner hochladen, auch `fonts/` und `.nojekyll`.
2. **Settings → Pages → Branch: `main` / Ordner `/ (root)` → Save**. Nach 1–2 Minuten läuft die App unter `https://DEIN-NAME.github.io/vereinskasse/`.
3. **Wichtig:** In Firebase unter **Authentication → Einstellungen → Autorisierte Domains** die Domain `DEIN-NAME.github.io` hinzufügen. Sonst klappt das Anmelden nicht.

> Ist der Code öffentlich, ist das unkritisch: Die Firebase-Werte in `firebase-config.js` sind kein Passwort. Die Daten sind durch Login und die Regeln in `firestore.rules` geschützt.

## 4. Aufs Handy

- **iPhone (Safari):** Teilen → *Zum Home-Bildschirm*
- **Android (Chrome):** Menü ⋮ → *App installieren*

Einmal anmelden, danach bleibt das Handy angemeldet.

## 5. Bisherige Daten übernehmen

Nach dem ersten Anmelden auf **Einstell. → Sicherung einspielen** tippen und `Vereinskasse_Datenuebernahme.json` auswählen.

## Gut zu wissen

- **Ohne Netz am Sportplatz:** Buchen geht weiter. Oben erscheint dann „Offline · X warten“. Sobald wieder Empfang da ist, wird alles automatisch übertragen. Die **erste** Anmeldung braucht Internet.
- **Mehrere Handys:** Alle angemeldeten Geräte sehen dieselben Buchungen, das laufende Spiel und das Archiv.
- **Kosten:** Der kostenlose Tarif erlaubt pro Tag 50.000 Lesevorgänge und 20.000 Schreibvorgänge. Für eine Vereinskasse reicht das bei Weitem.
- **Abmelden:** unter *Einstell. → Konto*.
