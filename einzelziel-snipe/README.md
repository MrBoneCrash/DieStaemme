# Die Stämme – Einzelziel-Snipe

> **Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.** Prüfe vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen. Fehler können zu Verlusten im Spiel oder zu Kontosanktionen führen.

## GitHub-Loader

Tampermonkey startet diesen Loader über die `@match`-Einträge ausschließlich auf folgenden Seiten: **Dorfinfo sowie der vom Planer vorbereitete Versammlungsplatz**. Die Reihenfolge der URL-Parameter spielt dabei keine Rolle.

In Tampermonkey **Neues Script erstellen** auswählen, den vorhandenen Inhalt durch den folgenden Loader ersetzen und speichern. Das Beispiel ist für dieses Skript fertig eingerichtet; du musst keine URL ändern. Eine zuvor direkt installierte Variante desselben Skripts deaktivieren, damit es nicht doppelt läuft.

Auf der Dorfinfo und beim Öffnen eines vom Planer vorbereiteten Versammlungsplatzes wird die aktuelle auf GitHub veröffentlichte Version aus `master` geladen. Für ein Update eine bereits geöffnete Spielseite neu laden. GitHubs Bereitstellung kann kurz verzögert sein.

```javascript
// ==UserScript==
// @name         Die Stämme – Einzelziel-Snipe (GitHub-Loader)
// @namespace    local.die-staemme.loader.einzelziel-snipe
// @version      1.1.1
// @description  Lädt die aktuelle GitHub-Version. Nutzung auf eigene Gefahr.
// @match        https://*.die-staemme.de/game.php?screen=info_village
// @match        https://*.die-staemme.de/game.php?screen=info_village&*
// @match        https://*.die-staemme.de/game.php?*&screen=info_village
// @match        https://*.die-staemme.de/game.php?*&screen=info_village&*
// @match        https://*.die-staemme.de/game.php?screen=place&ds_snipe_command=attack
// @match        https://*.die-staemme.de/game.php?screen=place&ds_snipe_command=attack&*
// @match        https://*.die-staemme.de/game.php?screen=place&*&ds_snipe_command=attack
// @match        https://*.die-staemme.de/game.php?screen=place&*&ds_snipe_command=attack&*
// @match        https://*.die-staemme.de/game.php?*&screen=place&ds_snipe_command=attack
// @match        https://*.die-staemme.de/game.php?*&screen=place&ds_snipe_command=attack&*
// @match        https://*.die-staemme.de/game.php?*&screen=place&*&ds_snipe_command=attack
// @match        https://*.die-staemme.de/game.php?*&screen=place&*&ds_snipe_command=attack&*
// @match        https://*.die-staemme.de/game.php?ds_snipe_command=attack&screen=place
// @match        https://*.die-staemme.de/game.php?ds_snipe_command=attack&screen=place&*
// @match        https://*.die-staemme.de/game.php?ds_snipe_command=attack&*&screen=place
// @match        https://*.die-staemme.de/game.php?ds_snipe_command=attack&*&screen=place&*
// @match        https://*.die-staemme.de/game.php?*&ds_snipe_command=attack&screen=place
// @match        https://*.die-staemme.de/game.php?*&ds_snipe_command=attack&screen=place&*
// @match        https://*.die-staemme.de/game.php?*&ds_snipe_command=attack&*&screen=place
// @match        https://*.die-staemme.de/game.php?*&ds_snipe_command=attack&*&screen=place&*
// @match        https://*.die-staemme.de/game.php?screen=place&ds_snipe_command=support
// @match        https://*.die-staemme.de/game.php?screen=place&ds_snipe_command=support&*
// @match        https://*.die-staemme.de/game.php?screen=place&*&ds_snipe_command=support
// @match        https://*.die-staemme.de/game.php?screen=place&*&ds_snipe_command=support&*
// @match        https://*.die-staemme.de/game.php?*&screen=place&ds_snipe_command=support
// @match        https://*.die-staemme.de/game.php?*&screen=place&ds_snipe_command=support&*
// @match        https://*.die-staemme.de/game.php?*&screen=place&*&ds_snipe_command=support
// @match        https://*.die-staemme.de/game.php?*&screen=place&*&ds_snipe_command=support&*
// @match        https://*.die-staemme.de/game.php?ds_snipe_command=support&screen=place
// @match        https://*.die-staemme.de/game.php?ds_snipe_command=support&screen=place&*
// @match        https://*.die-staemme.de/game.php?ds_snipe_command=support&*&screen=place
// @match        https://*.die-staemme.de/game.php?ds_snipe_command=support&*&screen=place&*
// @match        https://*.die-staemme.de/game.php?*&ds_snipe_command=support&screen=place
// @match        https://*.die-staemme.de/game.php?*&ds_snipe_command=support&screen=place&*
// @match        https://*.die-staemme.de/game.php?*&ds_snipe_command=support&*&screen=place
// @match        https://*.die-staemme.de/game.php?*&ds_snipe_command=support&*&screen=place&*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

// Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.
(() => {
    const url = 'https://raw.githubusercontent.com/MrBoneCrash/DieStaemme/master/einzelziel-snipe/einzelziel-snipe.user.js';
    fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
        })
        .then(code => new Function(code)())
        .catch(error => console.error('[Einzelziel-Snipe] Laden fehlgeschlagen:', error));
})();
```

Ohne erreichbares GitHub startet keine gespeicherte Ersatzversion. Ladefehler stehen in der Browserkonsole. **Die Nutzung erfolgt auf eigene Gefahr; auch zukünftige Änderungen aus `master` werden automatisch ausgeführt.**

`einzelziel-snipe.user.js` ist eine eigenständige deutsche Neuimplementierung von
[Single Village Snipe v1.0.0](https://cdn.jsdelivr.net/gh/Marcel2511/tribal-wars-schnellleisten-skripte@v1.0.0/SingleVillageSnipedFixed.js)
von Marcel Wollbaum, ursprünglich nach RedAlert.

## Installation und Start

1. `einzelziel-snipe.user.js` als neues Skript in Tampermonkey einfügen und speichern.
2. Die **Dorfinfo des Zieldorfs** öffnen (`screen=info_village&id=…`).
3. Das Skript erscheint oberhalb der Dorfinfo. Für die kombinierte Truppenübersicht
   wird wie beim Original ein Premium-Account benötigt.

Der Planer erscheint ausschließlich in der vollständigen Dorfinfo, die über die
Karte geöffnet wird. In der eigenen Dorfübersicht, der Karte selbst und am
Versammlungsplatz wird kein Planer eingeblendet. Am Versammlungsplatz bereitet ein
kleiner Helfer nur Links vor, die aus diesem Planer stammen. Bei Verwendung des
GitHub-Loaders den obigen Loader ebenfalls aktualisieren.

Der Code kann auch als Schnellleistenskript geladen werden, sobald er unter einer
eigenen URL gehostet wird:

```javascript
javascript:$.getScript('https://DEINE-URL/einzelziel-snipe/einzelziel-snipe.user.js');void(0);
```

`DEINE-URL` ist ein Platzhalter. Die Datei wurde lokal erstellt und noch nicht gehostet.
Für die Schnellleiste das Skript auf der Dorfinfo starten.
Für die automatische Typübernahme am Versammlungsplatz muss das Skript oder der
GitHub-Loader dort ebenfalls über Tampermonkey laufen. Ein einmaliger Aufruf aus
der Schnellleiste allein lädt den Helfer im neuen Tab nicht nach.

## Bedienung

1. Zielkoordinaten und Ankunftszeit eingeben. Verwendet wird die deutsche Serverzeit
   einschließlich Sommer-/Winterzeit, unabhängig von der Zeitzone des Computers.
   Beispiel: `08.10.2026 14:30:00`, optional `08.10.2026 14:30:00.125`.
2. Dorfgruppe, Einheiten, Mindestmenge und optional einen Geschwindigkeitsbonus wählen.
   `20` bedeutet 20 Prozent höhere Geschwindigkeit, entsprechend Laufzeit ÷ 1,2.
   Besondere Befehlsboni müssen passend zum geplanten Befehl selbst eingetragen werden.
3. **Passende Dörfer finden** liest die aktuell angezeigten Bestände der eigenen
   Dörfer aus der kombinierten Übersicht. Desktop und Mobil sowie verlinkte
   Übersichtsseiten werden unterstützt.
4. **WB kopieren** kopiert einen Befehl. **Alle nach Workbench** kopiert
   alle noch nicht abgelaufenen Befehle, getrennt durch echte Zeilenumbrüche.
   In DS Workbench die kopierten Befehle über das Einfügen aus der Zwischenablage übernehmen.
5. **Versammlungsplatz** öffnet das betreffende Dorf mit Ziel und denselben Truppenmengen
   vorausgefüllt. Der gewählte Befehlstyp wird übernommen: Bei Unterstützung ist nur
   der Unterstützen-Button verfügbar, bei Angriff nur Angreifen. Weiter zur
   Bestätigungsseite und Abschicken erfolgt durch den Spieler im Spiel.

Ein Klick auf eine eingehende oder ausgehende Befehlszeile übernimmt deren Ankunft.
Der URL-Parameter `landingTime` wird ebenfalls unterstützt (Unixzeit in Millisekunden).
Änderungen am Filter verwerfen das alte Ergebnis; anschließend neu berechnen.

Die Oberfläche gliedert sich in **Ziel & Ankunft**, **Einheiten wählen** und
**Passende Befehle**. Der Titelbereich entfällt. Kompakte Bildkacheln zeigen die
aktivierten Einheiten; Namen stehen im Tooltip und sind für Screenreader verfügbar.
**Defensive**, **Offensive**, **Alle** und **Keine** ändern die Auswahl mit einem Klick.
Defensive wählt Speere, Schwerter, Bogenschützen und schwere Kavallerie.
**Defensive** setzt außerdem den Befehlstyp auf **Unterstützung**; **Offensive**
und **Alle** setzen ihn auf **Angriff**. Der Typ steht direkt unter den Einheiten.
Manuelles Hinzufügen oder Entfernen einzelner Einheiten behält den gewählten Typ
bei, ebenso **Keine**. Er gilt für Workbench und Versammlungsplatz und wird mit
den Einstellungen gespeichert und exportiert. Ältere Einstellungen ohne Typ
werden anhand der Einheitenauswahl ergänzt.
Offensive wählt Äxte, leichte Kavallerie, berittene Bogenschützen, Rammen und Katapulte;
Adelsgeschlechter, Späher und Paladin werden bei diesen Voreinstellungen nicht mitgewählt.
Mindestmenge, Bonus
und Konfigurationsverwaltung befinden sich unter **Filter & weitere Einstellungen**.
Auf dem Handy erscheinen die Ergebnisse als einzelne Befehlskarten.
Mit Enter in einem Eingabefeld lässt sich die Berechnung starten.

Nach jeder Berechnung sind zunächst alle Befehle ausgewählt. Die Checkbox beim
Herkunftsdorf wählt einen Befehl ab oder wieder an; die Checkbox bei den Exportaktionen
wählt alle noch abschickbaren Befehle. Bei einer Teilauswahl heißt der Button
**Ausgewählte nach Workbench** und kopiert nur diese Befehle. Auch der gemeinsame
BBCode-Export berücksichtigt die Auswahl. Ohne ausgewählte zukünftige Befehle sind
die Sammel-Exporte deaktiviert. Einzelnes **WB kopieren** bleibt eine direkte Aktion
für den jeweiligen noch abschickbaren Befehl.

Die Icons neben **Truppen**, **Felder**, **Abschickzeit** und **Verbleibend** schalten
per Klick zwischen **aufsteigend → absteigend → aus**. Truppen sortiert nach der
Gesamtanzahl aller enthaltenen Einheiten, ohne Gewichtung nach Stärke.
Truppen kann allein oder zusammen mit genau einer der anderen drei Spalten aktiv
sein. Bei zwei aktiven Kriterien entscheidet Truppen zuerst (kleine **1** am Icon),
bei gleicher Gesamtanzahl die zweite Spalte (**2**). Felder, Abschickzeit und
Verbleibend ersetzen einander. Verbleibend sortiert nach der Zeit bis zum Abschicken;
seine Reihenfolge entspricht bei derselben aktuellen Serverzeit der Abschickzeit.
Ohne aktives Kriterium gilt die ursprüngliche Ergebnisreihenfolge.
Der kleine **i**-Hinweis erklärt die Bedienung beim Überfahren, Fokussieren oder
Anklicken. Auf Mobilgeräten stehen die Sortiericons über den Karten.
Auswahlboxen bleiben beim Sortieren erhalten; Sammel-Exporte folgen der sichtbaren Reihenfolge.

Der Dorfgruppenfilter lädt die im Spiel vorhandenen Gruppen. Beim Berechnen wird
die kombinierte Übersicht mit der ID der gewählten Gruppe abgerufen; nur deren
Dörfer gehen in die Berechnung ein. **Alle Dörfer** entspricht Gruppe 0. Nach einem
Gruppenwechsel neu berechnen. Die zuletzt berechnete Gruppe wird gespeichert.

## Gemeinsamer Befehl und Mindestmenge

Jedes passende Dorf erhält **einen gemeinsamen Befehl mit allen ausgewählten
verfügbaren Einheiten**. Es gibt keine mehrfachen Zeilen für denselben gemischten
Befehl. Dessen langsamste verfügbare Einheit bestimmt die berechnete Abschickzeit.
Das betrifft auch kleine Bestände unterhalb der Mindestmenge.

Beispiel: Speerträger, Schwertkämpfer und schwere Kavallerie sind ausgewählt.
Ein Dorf hat 1.000 Speere, 2 Schwerter und 50 SK. Bei Mindestmenge 50 passt dieses
Dorf, und es exportiert **alle 1.000 Speere, 2 Schwerter und 50 SK**. Die Schwerter
bestimmen die Laufzeit. Späher und andere abgewählte Einheiten fehlen im Export.
Einheiten mit Bestand 0 fehlen ebenfalls.

Die Mindestmenge ist ein **Dorf-Zulassungsfilter**: Mindestens eine ausgewählte
Einheit muss ihre Mindestmenge erreichen. Für Adelsgeschlechter reicht 1 Exemplar.
Ein ausgewähltes AG mit Bestand 0 senkt die Mindestmenge anderer Einheiten nicht.
Späher und Paladin können ausgewählt werden; die unbewegliche Miliz erscheint nicht.

## Workbench-Format

Der Export verwendet das Format von
[Attack.fromInternalRepresentation](https://github.com/Torridity/dsworkbench/blob/master/Core/src/main/java/de/tor/tribes/types/Attack.java)
und
[TroopAmountDynamic.loadFromProperty](https://github.com/Torridity/dsworkbench/blob/master/Core/src/main/java/de/tor/tribes/io/TroopAmountDynamic.java):

```text
Quelldorf-ID&Zieldorf-ID&langsamste_Einheit&Ankunft_in_ms&Typ&false&false&Einheit=Base64(Menge)/Einheit=Base64(Menge)&1
```

Beispiel mit 1.000 Speeren, 2 Schwertern und 50 SK:

```text
123&987&sword&1791374400000&0&false&false&spear=MTAwMA==/sword=Mg==/heavy=NTA=&1
```

Der gewählte Befehlstyp bestimmt das Workbench-Symbol: Unterstützung 0, Angriff 2,
Angriff mit AG 11. Ein explizit gewählter Unterstützungsbefehl bleibt auch beim
Hinzufügen offensiver Einheiten oder eines AG Unterstützung. Die Ziel-ID gehört zu den
eingetragenen Koordinaten. Bei Änderung des Ziels werden nötigenfalls die Weltdaten
unter `/map/village.txt` gelesen; neu angelegte Dörfer können dort noch fehlen.
In diesem Fall die Dorfinfo des neuen Ziels öffnen und dort starten.

Workbench übernimmt die Zielankunft und Einheit. Den manuellen Geschwindigkeitsbonus
speichert dieses Importformat nicht als eigenes Feld; die dort berechnete Abschickzeit
muss zu den Workbench-Einstellungen passen.

## Weitere Änderungen

- Keine Übersetzungstabellen, externen Bibliotheken oder Aufrufstatistik.
- Deutsche Tausenderpunkte und geschützte Leerzeichen werden korrekt gelesen.
- Ungültige Eingaben oder nicht lesbare Bestände erzeugen eine Fehlermeldung.
- Einheitenlaufzeiten werden vor der Berechnung vollständig geladen und maximal
  einen Tag zwischengespeichert. Weltgeschwindigkeit wird nicht doppelt angewendet.
- Eigener Countdown ohne Überschreiben der Spiel-Timer oder Entfernen fremder Events.
- Abgelaufene Befehle bleiben markiert sichtbar und werden nicht mehr exportiert.
- HTML-Inhalte aus Dorfnamen und Gruppen werden als Text behandelt.
- Gespeicherte Einstellungen sind nach Host, Welt, Spieler und Ziel getrennt.
- JSON-Konfiguration einschließlich Einheitenauswahl und Dorfgruppe lässt sich
  exportieren/importieren. Das alte Konfigurationsformat wird nicht übernommen.
- Bei gesperrter Zwischenablage steht der Export zum manuellen Kopieren bereit.

Die Bestände sind eine Momentaufnahme zum Berechnungszeitpunkt. Wenn Truppen später
verschickt werden oder zurückkehren, erneut berechnen. Besondere Laufzeitmechaniken
wie Paladin-Unterstützung sind nicht automatisch Teil der Berechnung.

## Prüfung

Die Befehle werden im Repository-Hauptordner ausgeführt. Der Ordner `test` bleibt lokal und ist nicht Bestandteil der Veröffentlichung. Die Testbefehle setzen diese lokalen Dateien voraus.

```powershell
node --check einzelziel-snipe/einzelziel-snipe.user.js
node --test test/einzelziel-snipe.core.test.cjs
node test/einzelziel-snipe.browser.cjs
```

Für den Browsertest werden `playwright` und Microsoft Edge benötigt; bei einer
gebündelten Playwright-Installation dessen Paketverzeichnis über `NODE_PATH` setzen.
Der Test simuliert Spielantworten, verwendet keine Zugangsdaten und sendet keine
Spielbefehle. Kern- und Browsertests prüfen Zeitberechnung, Mengen, Workbench-Roundtrip,
Desktop/Mobil, Pagination, Zielwechsel, Filteränderungen und Fehlerbehandlung.
Ein Test gegen den laufenden Spielaccount und die installierte Workbench-Version
wurde nicht durchgeführt.

`test/einzelziel-snipe.sorting.browser.js` enthält zusätzlich einen direkt im
Playwright-Browser ausführbaren Test ohne Shell. Er prüft beide Sortierrichtungen,
Einzel- und Doppelsortierung, den Wechsel der Zeit-/Entfernungsspalte, Tooltips,
erhaltene Auswahl und Exportreihenfolge auf Desktop und Mobil.

`test/einzelziel-snipe.command.browser.js` prüft zusätzlich die Begrenzung auf die
Dorfinfo, Unterstützung trotz manuell hinzugefügter offensiver Einheiten, den
Workbench-Typ, den JSON-Export und die Vorauswahl am Versammlungsplatz einschließlich
Enter im Truppenfeld. Alle Spielseiten sind simuliert; es werden keine echten
Befehle abgeschickt.
