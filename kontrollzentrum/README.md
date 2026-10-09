# Die Stämme – Kontrollzentrum

Das Kontrollzentrum pausiert die eingebundenen Userscripts, sobald ein Aktivitätscheck erkannt wird. Den Check führst du selbst durch. Anschließend hebst du die Pause ausdrücklich auf.

Nur das Kontrollzentrum erkennt Aktivitätschecks und setzt die gemeinsame Pause. Die Helfer empfangen den Zustand, prüfen selbst aber keine Checks. Ohne aktives Kontrollzentrum bleiben Bau- und Raubzugautomatik eigenständig nutzbar; Truppenvorlagen wird manuell bedient. Eine bestehende Pause muss ausdrücklich aufgehoben werden. Automatische Rekrutierungsaufträge erfordern ein aktives Kontrollzentrum auf derselben Spielseite.

Eine gespeicherte Pause bleibt unabhängig von der Anwesenheit des Kontrollzentrums wirksam und wird niemals durch Zeitablauf aufgehoben. Die Präsenzmeldung steuert ausschließlich die Anzeige von **Fortsetzen** in den drei integrierten Helfern: Nach Verlassen einer Kontrollzentrum-Seite gilt sie noch zehn Sekunden, bei einem abrupten Ausfall höchstens 90 Sekunden seit der letzten Meldung. Ist kein Kontrollzentrum mehr erkannt, erscheint der Button. Der Klick hebt die Pause über Broadcast und lokalen Speicher global für denselben Host, dieselbe Welt und denselben Spieler auf. Ist ein Kontrollzentrum aktiv, erfolgt die Freigabe dort. Die Helfer prüfen beim manuellen Fortsetzen selbst keinen Aktivitätscheck; der Nutzer muss diesen vorher durchgeführt haben.

## Installation

Den vollständigen Inhalt von [kontrollzentrum.user.js](kontrollzentrum.user.js) als neues Skript in Tampermonkey speichern. Außerdem Konstruktionshelfer, Raubzug-Helfer und Truppenvorlagen auf die angebundenen Versionen aktualisieren. Bereits geöffnete Spieltabs danach neu laden. Andere Skripte reagieren nicht auf diese Pause; die Massenrekrutierung bleibt manuell.

Im gewünschten Dorf einmal das **Hauptgebäude** und einmal **Versammlungsplatz → Raubzüge** öffnen, damit beide Helfer sich beim Kontrollzentrum anmelden. Danach zum Hauptgebäude zurückkehren. Die Anmeldung, der Automatikzustand und der nächste Raubzug-Einsatz werden pro Host, Welt, Spieler und Dorf gespeichert.

## Gemeinsame Steuerung und Seitenwechsel

### Rekrutierung mit Baureserve

In jedem gewünschten Dorf im Konstruktionshelfer eine Bauvorlage laden und auf der **normalen Rekrutierung** eine Truppenvorlage speichern/zuweisen. Beide Seiten einmal öffnen, damit die Helfer bekannt sind. Für eine konfigurierte Truppenvorlage ist die normale Rekrutierungsautomatik zunächst eingeschaltet; die roten/grünen Schalter im Kontrollzentrum können sie pro Dorf ausschalten. Zur Massenrekrutierung werden keine automatischen Befehle gesendet.

Die Berechnung lautet: **freie Bauernhofkapazität − Platzbedarf der noch offenen Bauvorlagenschritte bis zum nächsten offenen Bauernhof = Überschuss**. Bereits eingereihte Gebäudestufen zählen als erfüllt; ihre bereits belegte Bevölkerung wird nicht nochmals reserviert. Bei mehreren zukünftigen Stufen desselben Gebäudes wird aus nativen Bevölkerungskosten und Steigerungsfaktor eine vorsichtige Obergrenze reserviert, um Rundungsfehler nicht zulasten der Baufolge auszunutzen. Fehlen Bauvorlage, Gebäudestufen oder Kostendaten, findet keine automatische Rekrutierung statt. Ohne weiteren Bauernhof in der Vorlage wird die gesamte verbleibende Baufolge reserviert.

Passt ein noch fehlender Teil der Truppenvorlage in Überschuss und Rohstoffbudget, wechselt das Kontrollzentrum zur normalen Rekrutierung und übergibt konkrete Truppenzahlen. Das Truppenskript liest dort Bestände, bereits laufende Rekrutierungsaufträge, native Maximalwerte und Kosten neu und begrenzt den Auftrag erneut. Es füllt die normalen Felder und klickt nach weiteren 1–4 Sekunden auf **Rekrutieren**. Pause, Automatik, Vorlage, Bestände, Ressourcen und Eingaben werden vor dem Abschicken erneut geprüft. Bereits manuell belegte Felder werden nicht übernommen oder überschrieben. Der Auftrag wird vor dem Klick gespeichert; nach einer Navigation oder unklaren Spielantwort wird derselbe Auftrag nicht erneut abgeschickt.

Der Konstruktionshelfer meldet einen tatsächlichen Bauernhof-Stufenanstieg, auch bei AJAX-Bauabschlüssen. Das Kontrollzentrum prüft dann die neue Kapazität, sobald laufende Bau-/Questaktionen beendet sind. Ansonsten erfolgt die Kapazitätsprüfung stündlich pro eingerichtetem Dorf. Muss ein anderes Dorf geprüft werden, wird zunächst dessen Hauptgebäude geöffnet. Fällige Raubzüge haben Vorrang; nach den fälligen Rekrutierungs-/Kapazitätsaufgaben kehrt das Kontrollzentrum zum ursprünglichen Hauptgebäude zurück. Auch hier gelten Aktivitätscheck-Pause und zufälliger Wechsel-Delay. Die Rekrutierungsübersicht zeigt Baureserve, Überschuss, nächsten Check, Dorfzustand und eigene Automatikschalter.

Das aufklappbare Kontrollzentrum zeigt Konstruktionshelfer und Raubzug-Helfer mit ihrem Status und einem zusätzlichen **Automatik: An/Aus**-Button. Grün bedeutet an, Rot bedeutet aus, wie bei den Originalschaltern. Beide Bedienstellen steuern denselben Zustand. Ist der Helfer auf der anderen Spielansicht, wird der Befehl gespeichert und beim nächsten Laden übernommen. Während einer Aktivitätscheck-Pause sind die Buttons gesperrt.

Der Aufklappzustand bleibt im selben Browsertab bei Ansichtswechseln und automatischem Neuladen erhalten. Ein manueller vollständiger Refresh startet mit eingeklapptem Kontrollzentrum. Vor jedem automatischen Wechsel zur Raubzugseite und zurück wartet das Kontrollzentrum zufällig 1–4 Sekunden. Danach prüft es Pause, Fälligkeit und laufende Bauaktionen erneut.

### Mehrere Dörfer

Die Automatikschalter oben beziehen sich auf das **aktuelle Dorf**. Die aufklappbare Übersicht **Raubzug-Dörfer** zeigt zusätzlich alle für diesen Host, diese Welt und diesen Spieler erkannten Raubzug-Dörfer. Jede Zeile enthält Dorfname/Koordinaten, nächsten Prüftermin oder Fälligkeit, Status und einen eigenen roten/grünen Automatikschalter. Aktives Dorf und nächste Verarbeitung werden hervorgehoben. Auch die aufgeklappte Dorfübersicht bleibt bei automatischen Wechseln geöffnet.

Einstellungen und Termine bleiben pro Dorf getrennt. Zur Einrichtung die Raubzug-Ansicht jedes gewünschten Dorfes einmal öffnen, dort Truppenauswahl, Rückkehrgrenze und Freischaltung einstellen und die gewünschte Automatik aktivieren. Noch nie erkannte Dörfer werden nicht automatisch eingerichtet oder besucht. Nach der Einrichtung zum Hauptgebäude zurückkehren.

Das Kontrollzentrum arbeitet eingeschaltete, fällige Dörfer in Reihenfolge ihrer Prüftermine ab: der älteste Termin zuerst. Es wartet auf den abgeschlossenen Raubzug-Lauf und den neuen Termin, bevor es zum nächsten fälligen Dorf wechselt. Nach dem letzten fälligen Dorf kehrt es zur ursprünglich geöffneten Hauptgebäude-Ansicht des Ausgangsdorfes zurück. Zukünftige und ausgeschaltete Dörfer werden übersprungen. Fehlt der Helfer in einem Zieldorf, wird dessen Anmeldung nach 15 Sekunden entfernt und mit den anderen fälligen Dörfern fortgesetzt. Aktivitätschecks pausieren die gesamte Warteschlange; die 1–4 Sekunden Wartezeit gilt vor jedem Dorf- und Ansichtswechsel.

**Nächster Raubzug-Check** verwendet den gespeicherten Prüftermin des Raubzug-Helfers in Browserzeit. Derselbe Termin steht im Helfer; Rückkehr und Freischaltung werden dort separat in Serverzeit angezeigt. Auch bei unterschiedlichen Server- und Browseruhren erfolgt der Wechsel zum tatsächlichen Prüftermin, zuzüglich der zufälligen Wartezeit.

Bei laufenden Raubzügen oder Freischaltungen entspricht der Prüftermin der frühesten Rückkehr beziehungsweise abgeschlossenen Freischaltung. Bis dahin bleibt die Hauptgebäude-Ansicht geöffnet; minütliche Zwischenwechsel entfallen. Nur ohne bekannten Rückkehr- oder Freischalttermin prüft die Raubzug-Automatik nach einer Minute erneut.

Ohne gespeicherte Anmeldung erscheint **nicht installiert**. Ein Userscript kann die Tampermonkey-Installationsliste nicht auslesen: Diese Anzeige bedeutet deshalb, dass der Helfer für dieses Dorf noch nicht erkannt wurde. Nach dem ersten Start bleibt er auf anderen Ansichten bekannt. Eine spätere Deinstallation lässt sich dort nicht sofort erkennen; fehlt der Raubzug-Helfer bei einem geplanten Wechsel, wird die Erkennung nach 15 Sekunden zurückgesetzt und zur Hauptgebäude-Ansicht zurückgekehrt.

Bei eingeschalteter Raubzug-Automatik meldet jeder Helfer seinen nächsten tatsächlichen Prüftermin. Das Kontrollzentrum wartet auf fällige Termine und wechselt **innerhalb desselben Browsertabs** von der Hauptgebäude- zur Raubzug-Ansicht des jeweiligen Zieldorfes. Laufende Bau- und Questaktionen werden vorher abgewartet. Nach Abschluss aller fälligen Dorf-Läufe kehrt es zur zuvor geöffneten Hauptgebäude-URL zurück. Die zuvor eingeschaltete Bauautomatik startet dort mit einer neuen Prüfung.

Während einer Aktivitätscheck-Pause gibt es keinen automatischen Seitenwechsel. Nach manueller Freigabe wird der Ablauf fortgesetzt. Andere Spielansichten werden nicht automatisch verlassen. Der Browsertab und Browser müssen geöffnet bleiben; Hintergrundtimer können vom Browser verzögert werden.

Das Skript läuft auf allen `game.php`-Seiten der deutschen Spielwelten, einschließlich Bestätigungsseiten. Es verwendet wie der Konstruktionshelfer `unsafeWindow`, `document-idle` und `@noframes`. Die breitere Seitenfreigabe ist nötig, damit Checks auch außerhalb des Hauptgebäudes erkannt werden. Farben, Schrift, Rahmen und Buttons orientieren sich am Konstruktionshelfer.

## Verhalten

| Zustand | Anzeige und Verhalten |
| --- | --- |
| Kein Check, keine Pause | Kleine aufklappbare Leiste unten rechts: **Kontrollzentrum · Aktiv**. |
| Kleiner Check unter dem Quest-Icon | Skripte pausieren. Ein Popup bittet um manuelle Durchführung und zeigt Datum und Uhrzeit der ersten Erkennung. Kein Freigabe-Button. Das Quest-Icon bleibt anklickbar. |
| Geöffneter Bot-Schutz / sichtbare hCaptcha-Herausforderung | Skripte pausieren. Popup und Leiste des Kontrollzentrums sind ausgeblendet, damit der Check frei zugänglich bleibt. |
| Check nicht mehr sichtbar, gespeicherter Status `pause` | Popup mit ursprünglicher Erkennungszeit und **Pause aufheben**. Keine automatische Freigabe. |

## GitHub-Loader

Alternativ zum vollständigen Userscript diesen Loader in Tampermonkey speichern. Er lädt die veröffentlichte Version aus `master` bei jedem vollständigen Seitenaufruf. Die Datei muss dafür zuerst auf GitHub veröffentlicht sein. Eine direkt installierte Variante desselben Skripts deaktivieren.

```javascript
// ==UserScript==
// @name         Die Stämme – Kontrollzentrum (GitHub-Loader)
// @namespace    local.die-staemme.loader.kontrollzentrum
// @version      1.0.0
// @description  Lädt die aktuelle GitHub-Version des Kontrollzentrums.
// @match        https://*.die-staemme.de/game.php*
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==
(() => {
    const url = 'https://raw.githubusercontent.com/MrBoneCrash/DieStaemme/master/kontrollzentrum/kontrollzentrum.user.js';
    fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
        })
        .then(source => new Function('window', 'unsafeWindow', 'game_data', source)(
            unsafeWindow, unsafeWindow, unsafeWindow.game_data))
        .catch(error => console.error('[Kontrollzentrum] Laden fehlgeschlagen:', error));
})();
```

Der Zeitstempel wird als Datum und Uhrzeit für Europe/Berlin angezeigt. Er bezeichnet die erste Erkennung durch ein Skript, nicht eine vom Spiel übermittelte Startzeit. Ein Neuladen oder Dorfwechsel löscht die Pause nicht. Ein aktiver Check in einem anderen erreichbaren Tab verhindert die Freigabe.

## Gemeinsame Pause

`BroadcastChannel` überträgt Statuswechsel live. `localStorage` speichert den verbindlichen Zustand und liefert über das `storage`-Event einen zweiten Transport. Schlüssel und Kanal heißen:

```text
ds-control:v1:<Host>:<Welt>:<Spieler-ID>
```

Beispiel für den gespeicherten Zustand:

```json
{"status":"pause","detectedAt":1791568537000,"reason":"Aktivitätscheck"}
```

Beim Freigeben wechselt `status` zu `running`; `detectedAt` bleibt erhalten. Die nächste Check-Pause bekommt einen neuen Zeitstempel. Die Kommunikation gilt für dieselbe Welt und denselben Spieler im selben Browserprofil. Andere Welten, Spieler und Browserprofile bleiben unabhängig.

Konstruktionshelfer, Raubzug-Helfer und die normale Rekrutierung der Truppenvorlagen enthalten den gemeinsamen Empfänger. Er sperrt automatische Bau-, Quest-, Abschick-, Freischalt- und Rekrutierungsaktionen. Unterbrochene Rekrutierungsbefehle werden nicht blind wiederholt. Unterbrochene manuelle Vorgänge startest du erneut. Bereits beim Spielserver eingegangene Aktionen können nicht rückgängig gemacht werden. Die normalen Spielbedienelemente bleiben für die manuelle Durchführung zugänglich. Angriffsplaner, Einzelziel-Snipe, Marktplatz-Ausgleich, Premium-Depot und Verteidigungsassistent sind nicht angebunden. Die Massenrekrutierung bleibt ebenfalls ausschließlich manuell und erhält keinen Pausenempfänger.

Fremde Skripte ohne diesen Empfänger werden nicht angehalten. Dazu gehören auch die separat installierten Raubzugskripte aus den HTML-Beispielen. Ihre gespeicherten Ressourcen liegen neben den Downloads, sie sind jedoch kein Bestandteil dieses Repositorys und wurden nicht verändert. Für deren Einbindung muss derselbe Baustein vor ihren automatischen Aktionen verwendet werden.

Für zusätzliche Skripte stellt das Kontrollzentrum außerdem `window.DSControlCenter` mit `isPaused()`, `assertActive()`, `state()` und `onChange(callback)` bereit. Die Methoden dienen zur Anbindung im selben Tab. Skripte, die unabhängig von der Startreihenfolge und auch ohne geladenes Kontrollzentrum auf die gespeicherte Pause reagieren sollen, verwenden den eingebetteten gemeinsamen Baustein.

## Wartung und Prüfung

Der gemeinsame Entwicklungsbaustein wird ausschließlich ins Kontrollzentrum, den Konstruktionshelfer, den Raubzug-Helfer und die Truppenvorlagen eingebettet; in der Massenansicht wird kein Empfänger gestartet. Die fertigen `.user.js`-Dateien sind eigenständig installierbar. Entwicklungsdateien und Tests bleiben lokal und werden durch `.gitignore` ausgeschlossen.

```powershell
node --test kontrollzentrum/tests/*.test.cjs test/*.test.cjs konstruktionshelfer/tests/*.test.cjs
```

Die Tests prüfen Check-Erkennung, Anzeigewechsel, Broadcast, Storage-Fallback, Reload, manuelle Freigabe, Trennung nach Spieler/Welt und Abbruch laufender Anfragen. Versteckte hCaptcha-Frames lösen keinen Fullscreen-Zustand aus.

Hintergrundtabs können vom Browser verzögert ausgeführt werden. Die Empfänger prüfen deshalb zusätzlich unmittelbar vor ihren Aktionen die gespeicherte Sperre und lokale Check-Anzeichen. Aktive Check-Meldungen anderer Tabs werden kurzzeitig gespeichert; beim Verschwinden des Checks werden sie entfernt. Ist der Browserspeicher gesperrt oder beschädigt, bleiben die Skripte vorsichtshalber pausiert und zeigen gegebenenfalls einen unbekannten Zeitpunkt an.
