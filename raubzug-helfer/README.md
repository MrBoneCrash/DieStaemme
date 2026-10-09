# Die Stämme – Raubzug-Helfer

Den GitHub-Loader unten als neues Tampermonkey-Skript speichern. Alternativ die Datei [raubzug-helfer.user.js](raubzug-helfer.user.js) vollständig direkt installieren. Danach den **Versammlungsplatz → Raubzüge** öffnen (`screen=place&mode=scavenge`). Der Helfer erscheint über der normalen Raubzugansicht und arbeitet ausschließlich im aktuellen Dorf.

## GitHub-Loader

In Tampermonkey **Neues Script erstellen** auswählen, den Inhalt durch diesen Loader ersetzen und speichern. Eine direkt installierte Variante desselben Skripts deaktivieren. Der Loader lädt bei jedem vollständigen Aufruf der Raubzugansicht die auf GitHub veröffentlichte Version aus `master`. Aktionen, AJAX-Aufrufe und doppelte Routing-Parameter sind ausgeschlossen.

```javascript
// ==UserScript==
// @name         Die Stämme – Raubzug-Helfer (GitHub-Loader)
// @namespace    local.die-staemme.loader.raubzug-helfer
// @version      1.0.0
// @description  Lädt die aktuelle GitHub-Version des Raubzug-Helfers.
// @match        https://*.die-staemme.de/game.php?*screen=place*
// @exclude      /^[^?]+\?(?!(?=(?:[^#]*&)?screen=place(?:&|#|$))(?=(?:[^#]*&)?mode=scavenge(?:&|#|$))(?!(?:[^#]*&)?(?:try|action|ajax|ajaxaction)(?:=|&|#|$)))/
// @exclude      /^[^?]+\?(?:[^#]*&)?(screen|mode|village)=[^#]*&\1=/
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==
(() => {
    const url = 'https://raw.githubusercontent.com/MrBoneCrash/DieStaemme/master/raubzug-helfer/raubzug-helfer.user.js';
    fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
        })
        .then(source => new Function('window', 'unsafeWindow', 'game_data', source)(
            unsafeWindow, unsafeWindow, unsafeWindow.game_data))
        .catch(error => console.error('[Raubzug-Helfer] Laden fehlgeschlagen:', error));
})();
```

Für Updates die Raubzugansicht neu laden. Die Datei muss dafür auf GitHub veröffentlicht sein. Ohne erreichbares GitHub startet keine gespeicherte Ersatzversion; zukünftige Änderungen aus `master` werden automatisch ausgeführt.

## Bedienung

Die Kopfzeile klappt den Helfer auf und zu. Auch eingeklappt zeigt sie Pause beziehungsweise Automatikzustand, laufende Verarbeitung, Anzahl der Raubzüge unterwegs und den nächsten Prüftermin. Einklappen beeinflusst die Automatik nicht.

- **Einheitensymbole:** ausgewählte, tatsächlich zu Hause verfügbare Truppen verwenden. Nicht raubzugfähige Einheiten werden nicht angeboten.
- **Rückkehrgrenze:** optional `TT.MM.JJJJ HH:MM:SS`, Serverzeit Europe/Berlin. Zum Entfernen das Feld leeren. Die Grenze bleibt auch nach Ablauf erhalten; danach starten keine neuen Raubzüge. Bereits laufende Raubzüge lassen sich damit nicht zurückrufen.
- **Freischalten:** startet bei ausreichendem Holz, Lehm und Eisen die normale Freischaltung der nächsten erreichbaren Option über die Spielbuttons. Keine Premium-Sofortfreischaltung.
- **Raubzug abschicken** links: berechnet die Gruppen, füllt die normalen Truppenfelder und startet die zulässigen Gruppen nacheinander. Die Tabelle zeigt Truppen, rechnerische Beute, Stundenertrag und Rückkehr.
- **Automatisch abschicken** rechts: rot = aus, grün = an. Der Schalter und alle Einstellungen werden pro Welt, Spieler und Dorf im Browserspeicher gespeichert. Die nächste Rückkehr beziehungsweise fertig werdende Freischaltung wird ebenfalls gespeichert. Zur Fälligkeit lädt der Helfer die Seite neu und berechnet mit dem aktuellen Bestand erneut. Bis dahin erfolgen keine minütlichen Zwischenprüfungen. Nur wenn weder eine Rückkehr noch eine Freischaltung läuft, prüft er nach einer Minute erneut.

Vor jeder Spielaktion wartet der Helfer wie der Konstruktionshelfer zufällig **1.000–4.000 ms** (`1000 + Math.floor(Math.random() * 3001)`). Das betrifft Öffnen der Freischaltbestätigung, Bestätigen, Eintragen einer Truppengruppe, deren Abschicken und automatisches Neuladen. Nach jeder Wartezeit werden die benötigten Daten und der Pausenstatus erneut geprüft. Die Freischaltung wird im zugehörigen nativen Dialog `popup_box_unlock-option-<ID>` mit dessen normalem „Freischalten“-Link bestätigt; andere Bestätigungsdialoge werden nicht angeklickt.

Der Spieltab muss geöffnet bleiben. Ein geschlossener Browser führt keine Aktionen aus; nach erneutem Öffnen dieser Raubzugseite wird eine gespeicherte aktive Automatik wieder aufgenommen. Browser können Hintergrundtabs und Timer verzögern; ein verspäteter Prüflauf verwendet die aktuellen Bestände und die weiterhin gültige Rückkehrgrenze.

## Kontrollzentrum

Das aktualisierte Kontrollzentrum und der aktualisierte Konstruktionshelfer können diese Automatik gemeinsam steuern. Der Raubzug-Helfer meldet Status, Automatikzustand, nächsten Prüftermin und den abgeschlossenen Lauf. Der zusätzliche rote/grüne Automatikbutton im Kontrollzentrum steuert dieselbe Einstellung wie **Automatisch abschicken**.

Bei einem Aktivitätscheck wird die laufende Berechnung abgebrochen und es werden keine weiteren Abschick-, Freischalt- oder Reload-Aktionen ausgelöst. Die Automatik bleibt gespeichert und startet erst nach manueller Freigabe im Kontrollzentrum mit einer neuen Prüfung.

Zur Einrichtung beide Spielansichten im gewünschten Dorf einmal öffnen und anschließend zur Hauptgebäude-Ansicht zurückkehren. Bei fälliger Raubzug-Automatik wechselt das Kontrollzentrum im selben Browsertab zur Raubzugseite und nach Abschluss wieder zurück. Der gemeldete Prüftermin entspricht der frühesten laufenden Rückkehr oder fertig werdenden Freischaltung. Fehlt ein solcher Termin, erfolgt eine erneute Prüfung nach einer Minute. Die Rückkehrzeiten bleiben im bisherigen Speicher erhalten; `wakeAt` speichert zusätzlich den nächsten Einsatz als Zeitpunkt der Browseruhr.

Der Helfer zeigt **Nächster Raubzug-Check** getrennt von der nächsten Rückkehr beziehungsweise Freischaltung an. Helfer und Kontrollzentrum verwenden denselben gespeicherten Prüftermin. Die anschließende zufällige Wartezeit von 1–4 Sekunden gilt auch für beide Ansichtswechsel. Automatisches Neuladen erhält ein geöffnetes Kontrollzentrum; ein manueller Refresh setzt dessen Ansicht zurück.

Bei mehreren Dörfern bleiben Truppenauswahl, Rückkehrgrenze, Freischaltoption, Automatik und Termine für jedes Dorf separat gespeichert. Jedes gewünschte Dorf einmal auf der Raubzug-Ansicht einrichten. Das Kontrollzentrum zeigt die erkannten Dörfer mit eigenen Automatikschaltern und arbeitet fällige Termine nacheinander ab, beginnend beim ältesten. Danach kehrt es zum ursprünglichen Hauptgebäude-Dorf zurück. Ausgeschaltete Dörfer werden übersprungen; ein Schalter für ein anderes Dorf verändert die Einstellungen des aktuellen Dorfes nicht.

## Berechnung

Für jede freie Option werden ihre tatsächlichen Werte aus `ScavengeScreen.village.options[*].base` gelesen. Die Tragkraft kommt aus `ScavengeScreen.sendable_units` und berücksichtigt `village.unit_carry_factor`. Es gibt keine Schätzung aus der Weltgeschwindigkeit und keine festen Prozentaufteilungen.

Für eine Gruppe mit Tragkraft `C`, Beutefaktor `L`, Laufzeitexponent `E`, Startdauer `I` und Dauerfaktor `F` gilt:

```text
Beute        = C × L
Laufzeit     = ((C² × 100 × L²)^E + I) × F   [Sekunden]
Stundenertrag = 3600 × Beute / Laufzeit
Zielfunktion = Summe der individuellen Stundenerträge aller neu gestarteten Gruppen
```

Die Rechnung verwendet die ungerundeten Werte der Spielformel mit JavaScript-Zahlengenauigkeit. Die UI rundet nur die Anzeige; für die Rückkehrgrenze werden Laufzeiten auf volle Sekunden aufgerundet und zwei Sekunden Versandreserve abgezogen. Die tatsächlich gutgeschriebenen ganzzahligen Rohstoffe und serverseitige Rundungen können von der ungerundeten Beute abweichen. Optimiert wird diese klar definierte Formel, kein Mehrtagesplan mit zukünftiger Rekrutierung oder erst später zurückkehrenden Truppen.

Die Optimierung berücksichtigt ganze Einheiten, gemeinsame Bestandsgrenzen, die Mindestbevölkerung aus dem nativen Kandidatenmodell (`min_pop_to_send`), eine zusätzlich gelieferte Mindestanzahl sowie die Zeitgrenze. Die gespeicherte Spielseite fordert zehn Bevölkerungspunkte; Kavallerie zählt entsprechend ihrer Bevölkerung. Falls das native Mindestbevölkerungsfeld fehlt, bleibt die vorsichtige bisherige Mindestmenge von zehn Einheiten aktiv. Kurz bevor eine Gruppe startet, werden Verfügbarkeit, Mindestmenge, freie Option und Zeitgrenze erneut geprüft; anschließend muss auch der normale Spielbutton die Gruppe akzeptieren. Der nächste Start erfolgt erst, wenn das Spiel den vorherigen Raubzug bestätigt hat.

Alle Teilmengen der freien Optionen werden untersucht: Reicht der Bestand nicht für alle Mindestgruppen oder erzielt eine kleinere Teilmenge einen höheren Stundenertrag, bleiben entsprechende Optionen frei. Die Grenze kann dazu führen, dass Truppen zu Hause bleiben. Raubzüge, die bereits unterwegs sind oder noch freigeschaltet werden, werden nicht belegt.

Für einen Einheitentyp ist das Problem diskret konkav und wird über die jeweils größte Ertragssteigerung exakt gelöst. Bei Mischtruppen wird zunächst eine optimale Verteilung auf dem Tragkraftgitter berechnet und mit tatsächlichen Truppen rekonstruiert. Wenn dieser Optimalitätsnachweis nicht gelingt, folgt eine vollständige Ganzzahlsuche mit konkaven oberen Schranken. Ein Zwischenstand wird niemals als exakt ausgegeben oder abgeschickt. Gleichartige Einheiten werden intern zusammengefasst und anschließend aus den echten Beständen rekonstruiert.

Die Berechnung läuft in einem Web Worker, damit die Einstellungen bedienbar bleiben. Schwierige Mischbestände können länger rechnen. Ändern der Einstellungen oder Abschalten der Automatik bricht die laufende Rechnung ab. Laufzeitexponenten außerhalb des unterstützten konkaven Bereichs (`0 < E ≤ 0,5`) führen zu einer Fehlermeldung.

## Spielintegration und Prüfung

Das Skript verwendet die normalen kostenlosen Abschick- und Freischaltbuttons. Eine Browser-Tab-Sperre und gespeicherte Rückkehrzeiten verhindern parallele Verarbeitung desselben Dorfes durch mehrere Helfertabs. Sichtbare Aktivitätschecks und eine gespeicherte Pause des Kontrollzentrums halten Aktionen an.

Die lokalen Tests in `test/raubzug-helfer.core.test.cjs` vergleichen kleine gemischte Bestände mit vollständiger Enumeration und prüfen Mindestmengen, Bestandsgrenzen, Zeitgrenzen, Weltdaten und Berliner Zeitumstellungen. `test/raubzug-helfer.browser.cjs` prüft auf simulierten Seiten Worker, native Buttons, Speicher und Desktop-/Mobilansicht. Ein echter eingeloggter Spieltab war während der Entwicklung nicht verfügbar; die aktuelle Spielintegration ist daher noch nicht am Liveaccount bestätigt. Fehlende oder nicht erkannte Spieldaten führen zum Abbruch statt zu geratenen Truppenkombinationen.

Quellen für die Spielformel und die verwendeten Live-Datenfelder: [Raubzug-Rechenbeispiel des Autors](https://gist.github.com/guipenedo/6791ef6f57ff6e8971fde86e90d0a1ec), [Scavenge Assistant – Implementierung der Live-Daten](https://github.com/tilaven/tribalwars-scavenge-assistant/blob/main/script.js). Allgemeine Mechanik: [InnoGames-Support](https://support.innogames.com/kb/TribalWars/en_DK/3002).
