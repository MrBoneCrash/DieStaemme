# Die Stämme – Konstruktionshelfer

> **Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.** Prüfe vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen. Fehler können zu Verlusten im Spiel oder zu Kontosanktionen führen.

## GitHub-Loader

In Tampermonkey **Neues Script erstellen** auswählen, den vorhandenen Inhalt durch diesen Loader ersetzen und speichern. Eine direkt installierte Variante desselben Skripts deaktivieren, damit es nicht doppelt läuft. Der Loader lädt bei jedem vollständigen Aufruf der normalen **Hauptgebäude-Bauansicht** (`screen=main`, ohne `mode` oder mit `mode=build`) die veröffentlichte Version aus `master`. Abriss, Aktionen, AJAX-Aufrufe und doppelte Routing-Parameter sind ausgeschlossen.

```javascript
// ==UserScript==
// @name         Die Stämme – Konstruktionshelfer (GitHub-Loader)
// @namespace    local.die-staemme.loader.konstruktionshelfer
// @version      1.0.0
// @description  Lädt die aktuelle GitHub-Version. Nutzung auf eigene Gefahr.
// @match        https://*.die-staemme.de/game.php?*screen=main*
// @exclude      /^[^?]+\?(?!(?=(?:[^#]*&)?screen=main(?:&|#|$))(?!(?:[^#]*&)?(?:try|action|ajax|ajaxaction)(?:=|&|#|$))(?!(?:[^#]*&)?mode=(?!(?:build)?(?:&|#|$))[^&#]*(?:&|#|$)))/
// @exclude      /^[^?]+\?(?:[^#]*&)?(screen|mode)=[^#]*&\1=/
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==

// Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.
(() => {
    const url = 'https://raw.githubusercontent.com/MrBoneCrash/DieStaemme/master/konstruktionshelfer/konstruktionshelfer.user.js';
    fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
        })
        .then(source => new Function('window', 'unsafeWindow', 'game_data', source)(
            unsafeWindow, unsafeWindow, unsafeWindow.game_data))
        .catch(error => console.error('[Konstruktionshelfer] Laden fehlgeschlagen:', error));
})();
```

Für Updates die passende Spielseite neu laden. Ohne erreichbares GitHub startet keine gespeicherte Ersatzversion. **Auch zukünftige Änderungen aus `master` werden automatisch ausgeführt.** Der Loader funktioniert erst, sobald diese Datei auf GitHub veröffentlicht ist.

## Installation und Bedienung

Der Helfer bleibt ohne Kontrollzentrum einschließlich seiner Bauautomatik eigenständig nutzbar. Er erkennt selbst keine Aktivitätschecks, hält aber jede gespeicherte Pause ein. Wird kein Kontrollzentrum erkannt, erscheint **Fortsetzen**, um die Pause global aufzuheben; bei aktivem Kontrollzentrum erfolgt die Freigabe dort.

1. Den Loader oben oder den vollständigen Inhalt von `konstruktionshelfer.user.js` als neues Tampermonkey-Skript speichern.
2. Das **Hauptgebäude** öffnen und die zunächst eingeklappte Leiste **Konstruktionshelfer** aufklappen.
3. Den Exportcode einer Konstruktionsmanager-Vorlage einfügen und **Vorlage laden** anklicken. Der im Auftrag mitgelieferte Beispielcode liegt in [tests/vorlage.txt](tests/vorlage.txt); er heißt `W256_Deff_AG_End` und enthält 287 Bauschritte.
4. Den Vorschlag, die Rohstoffkosten und die freien Bauplätze prüfen. **Baufolge** zeigt die gesamte decodierte Vorlage.
5. **… einreihen** anklicken, um genau einen Ausbau über die native Spielfunktion in die Warteschlange zu setzen. Danach wird der nächste Vorschlag anhand der aktualisierten Spielansicht angezeigt. Bei einer Änderung des Vorschlags unmittelbar vor dem Klick ist ein neuer Klick erforderlich.
6. Optional den Schalter **Automatisch einreihen** direkt daneben anklicken: **Rot / Aus** deaktiviert die Automatik, **Grün / An** aktiviert sie. Beim Einschalten füllt der Helfer die freien Bauplätze, solange die weiteren Prüfungen erfüllt sind. Der Zustand wird lokal **pro Dorf, Host, Welt und Spieler** gespeichert und nach einem Reload wiederhergestellt. Neue Dörfer starten mit ausgeschalteter Automatik.

Die zuletzt erfolgreich geladene Vorlage wird lokal pro Host, Welt und Spieler gespeichert und auch nach einem Dorfwechsel verwendet. Änderungen im Codefeld sperren den Bauknopf, bis die Vorlage erneut geladen ist. Die Leiste startet bei jedem Seitenaufruf und bei Rückkehr über den Browser-Verlauf eingeklappt.

Die Kopfzeile zeigt auch eingeklappt den aktuellen Stand, etwa **15 / 25**: erfüllte Bauschritte gegenüber allen Schritten der geladenen Vorlage. Bereits eingereihte Ausbauten zählen mit. Ohne geladene Vorlage steht dort **0 / 0**.

Ersetzt das Spiel nach einem Bauabschluss die Bauansicht ohne vollständigen Seitenaufruf, setzt der Helfer seine Leiste automatisch wieder ein. Eingaben, geladene Vorlage und aufgeklappte Bereiche bleiben dabei erhalten. Nach einem vollständigen Reload wartet das Skript auf die Spieldaten und lädt die gespeicherte Vorlage erneut.

## Prüfungen und Verhalten

- **Baufolge:** Bereits vorhandene oder eingereihte Gebäudestufen zählen als erfüllt. Maßgeblich ist `BuildingMain.buildings[…].level_next`; deshalb wird etwa Hauptgebäude 4 in der Warteschlange nicht noch einmal vorgeschlagen. Fehlen mehrere Stufen bis zum Vorlagenziel, wird jeweils nur die nächste Stufe gebaut.
- **Rohstoffe:** Holz, Lehm und Eisen müssen jetzt verfügbar sein. Fehlmengen werden angezeigt; auf künftig produzierte Rohstoffe wird kein Auftrag erteilt.
- **Bauernhof:** Reicht der freie Bevölkerungsplatz für das nächste Gebäude nicht, wird stattdessen der nächste Bauernhof-Ausbau vorgeschlagen und ebenfalls auf Kosten, Voraussetzungen und Höchststufe geprüft. Ist bereits ein Bauernhof-Ausbau eingereiht, wartet der Helfer auf seine Fertigstellung. Ein vorgezogener Bauernhof wird später bei der Vorlagenprüfung berücksichtigt.
- **Premium und Bauplätze:** Ohne Premium höchstens **2**, mit aktivem Premium höchstens **5 Bauaufträge einschließlich des laufenden Baus**. Vorhandene Aufträge werden mitgezählt. Bei fünf Aufträgen bleibt der Knopf gesperrt, auch wenn das Spiel weitere Bauten gegen Aufpreis erlauben würde. Gemeldete Bauschleifen-Extrakosten oder eine native Extrakosten-Bestätigung sperren ebenfalls den Bau.
- **Voraussetzungen:** Nicht verfügbare Gebäude, fehlende Bauvoraussetzungen, maximale Stufen und unlesbare Daten sperren den Knopf. Der Helfer überspringt einen blockierten Vorlagenschritt nicht und fügt keine weiteren Voraussetzungsausbaufolgen hinzu.
- **Aktualisierung:** Ohne Automatik wird die Anzeige alle 30 Sekunden aus den aktuellen Spielwerten aktualisiert. **Vorschlag aktualisieren** aktualisiert sofort und stößt bei eingeschalteter Automatik einen Prüflauf an. Für Änderungen aus anderen Browser-Tabs die Spielseite neu laden. Die endgültige Prüfung führt der Spielserver durch; dessen Fehlermeldungen bleiben sichtbar.

## Automatisch einreihen

Bei **An** wird die nächste mögliche Stufe eingereiht, die native Spielantwort abgewartet und anschließend die gesamte Prüfung für das nächste Gebäude erneuert. Der Lauf endet bei voller Warteschlange, fehlenden Rohstoffen, fehlendem Bauernhofplatz, unerfüllten Voraussetzungen, Extrakosten oder abgeschlossener Vorlage. Auch automatisch gelten höchstens zwei Aufträge ohne Premium und fünf mit Premium, einschließlich des laufenden Baus.

Ohne bekannten Bauabschluss erfolgt die nächste Prüfung nach **30 Sekunden**. Enthält die Warteschlange eine Fertigstellungszeit, wartet der Helfer bis zum **nächsten Bauabschluss plus zwei Sekunden**. Die nächste Prüfzeit steht unter den Knöpfen. Wird die Warteschlange vorher kürzer, etwa durch einen Abbruch, wird eine Prüfung in zwei Sekunden angesetzt. Eigene Ergänzungen und Änderungen der Helferanzeige lösen keinen zusätzlichen Prüflauf aus.

Die Automatik läuft nur, solange die passende Hauptgebäude-Seite geöffnet ist. Browser können Timer in Hintergrund-Tabs verzögern. Nicht geladene Änderungen im Vorlagencode sperren auch die Automatik. Fehlt die Bestätigung einer Spielantwort, wird im selben Lauf kein weiterer Auftrag gesendet. **Aus** beendet weitere Bauaufträge und entfernt den geplanten Prüftimer; ein bereits an das Spiel übergebener Auftrag bleibt bestehen.

Der Helfer verwendet keine Premium-Punkte für Kostenreduzierung oder Sofortfertigstellung.

## Aktionspausen und Questbelohnungen

Vor jeder vom Helfer ausgelösten **Spielaktion** wartet er zufällig **1 bis 4 Sekunden**: vor einem manuellen oder automatischen Bau, dem Öffnen der Quests, dem Wechsel zum Belohnungs-Tab, jedem Abholen, dem Abschließen einer Aufgabe und dem Schließen des Questfensters. Direkt nach dem Bau-Delay werden Rohstoffe, Platz, Vorlage und Warteschlange erneut geprüft. Lokale Bedienelemente wie der An/Aus-Schalter reagieren sofort.

Ein neu angezeigtes Questpopup mit sichtbarem **Aufgabe abschließen** pausiert weitere Bauten. Der Helfer wartet den zufälligen Delay ab, klickt auf **Aufgabe abschließen** und schließt danach das Fenster über **X oben rechts**, sofern die native Spielfunktion es nicht bereits geschlossen hat. Diese Popupbearbeitung funktioniert auch bei ausgeschalteter Bauautomatik. Unfertige Aufgaben werden nicht übersprungen; andere Popuparten werden nicht automatisch bestätigt.

Fehlen bei eingeschalteter Bauautomatik Ressourcen für den nächsten Ausbau, öffnet der Helfer über den Questknopf oben links das Questfenster. **Zuerst gibt er alle fertigen Quests ab**, jeweils mit Auswahl, Aktionsdelay und bestätigter Spielantwort. Schließt das Spiel das Fenster dabei selbst, öffnet der Helfer es erneut, bevor er weitere fertige Quests abgibt.

Anschließend wählt er **Belohnung** und holt **alle verfügbaren Rohstoffbelohnungen ab, die vollständig in den Speicher passen**. Er prüft jede Belohnung einzeln: Holz, Lehm **und** Eisen müssen zusammen mit dem aktuellen Bestand hineinpassen. Nach jeder bestätigten Abholung werden Bestände und Speicher erneut geprüft. Er sammelt auch dann weiter, wenn die Ressourcen für den nächsten Bau inzwischen reichen. Erst wenn keine weitere Belohnung hineinpasst, schließt er das Fenster mit Delay und setzt die Bauprüfung fort. Sammelknöpfe **Alle abholen** werden nicht verwendet, damit einzelne passende Belohnungen ohne Überlauf gesammelt werden können.

Die Belohnungsprüfung findet pro Dorf höchstens einmal in der aktuellen Browsersitzung statt, solange kein neues Questpopup erscheint. Das gilt auch nach einem Reload im selben Tab. Jedes neu erkannte Questpopup gibt eine neue Prüfung frei, auch ohne abgabebereite Quest. Zum manuellen Entstucken kannst du das Questfenster öffnen und wieder schließen: Bei eingeschalteter Automatik startet danach sofort ein neuer Prüflauf; Belohnungen werden weiterhin nur bei Rohstoffmangel geprüft. Ein Fenster ohne sichtbares **Aufgabe abschließen** bleibt zur manuellen Bedienung offen. Die vom Helfer selbst geöffneten Belohnungsfenster setzen die Prüfung nicht zurück. Auch eine leere Belohnungsliste oder ausschließlich zu große Belohnungen gelten als geprüft. Während der Questbearbeitung werden keine neuen Bauaufträge gesendet.

## Pause durch das Kontrollzentrum

Der Konstruktionshelfer hört auf Broadcast-Nachrichten und den gespeicherten Pause-Status des Kontrollzentrums. Bei einem Aktivitätscheck hält er die Bauautomatik und automatische Questaktionen an. **Automatisch einreihen: Pausiert** zeigt die Sperre; Bauknopf und Automatikschalter sind währenddessen deaktiviert. Ein bereits an den Spielserver übergebener Bau kann nicht zurückgenommen werden.

Er meldet außerdem seinen Automatikzustand und laufende Arbeit an das Kontrollzentrum. Dessen zusätzlicher roter/grüner Automatikbutton steuert dieselbe gespeicherte Einstellung wie der ursprüngliche Schalter. Ein geplanter Wechsel zur Raubzug-Ansicht wartet auf das Ende laufender Bau- und Questaktionen. Bei der Rückkehr zur Hauptgebäude-Ansicht bleibt die Automatik-Einstellung erhalten und es wird mit aktuellen Spieldaten neu geprüft.

Für die normale Rekrutierung meldet er zusätzlich die geladene Baufolge, wirksame Gebäudestufen und Bevölkerungskosten. Ein tatsächlicher Bauernhofabschluss löst ein Kapazitätssignal aus, auch wenn die Bauansicht per AJAX aktualisiert wird. Das Kontrollzentrum reserviert den Platz für offene Schritte bis zum nächsten Bauernhof und übergibt nur den Überschuss an die Truppenvorlagen. Bis zum Ende laufender Bau-/Questaktionen wird gewartet; ohne Bauernhofsignal prüft das Kontrollzentrum stündlich.

Die gespeicherte Einstellung **An/Aus** bleibt erhalten, auch nach einem Reload während der Pause. Nach **Pause aufheben** im Kontrollzentrum oder **Fortsetzen** bei fehlendem Kontrollzentrum werden aktuelle Gebäude, Rohstoffe, Warteschlange und Quests neu geprüft. War die Automatik vorher eingeschaltet, beginnt ein neuer Prüflauf; war sie ausgeschaltet, bleibt sie ausgeschaltet. Unterbrochene manuelle Bauversuche werden nicht wiederholt.

## Vorlagenformat und Grenzen

Der Decoder liest das binäre Base64-Exportformat der gelieferten Vorlage: eine zwei Byte lange Größenangabe, Gebäude-ID/Stufenänderung-Paare und die anschließenden Metadaten. Unterstützt sind die durch den HTML-Abgleich verifizierten IDs für Hauptgebäude, Kaserne, Stall, Werkstatt, Adelshof, Schmiede, Versammlungsplatz, Marktplatz, Holzfällerlager, Lehmgrube, Eisenmine, Bauernhof, Speicher und Wall. Unbekannte IDs und Abrissschritte werden mit einer Fehlermeldung abgelehnt. Andere Exportformate können eine Decoder-Erweiterung erfordern.

Farm-Prioritäts- und weitere Manager-Einstellungen im Export werden nicht übernommen: Der Bauernhof wird nach dem tatsächlichen Platzbedarf des nächsten Gebäudes vorgezogen. Die Zielstufen der Vorlage beginnen bei Stufe 0; aktuelle Gebäude und eingereihte Ausbauten werden dagegen abgeglichen. Ein aktiver Konstruktionsmanager ist zum Einfügen eines vorhandenen Exportcodes nicht erforderlich.

Die Spiellogik wurde anhand der mitgelieferten HTML-Seiten und ihrer gespeicherten JavaScript-Dateien geprüft. Ein Live-Bau auf dem Spielserver wurde nicht ausgeführt.

## Tests

Mit Node.js:

```powershell
node --check konstruktionshelfer/konstruktionshelfer.user.js
node --test konstruktionshelfer/tests/*.test.cjs
```

Optionaler vollständiger Vergleich mit den drei ursprünglichen Dateien:

```powershell
node konstruktionshelfer/tests/konstruktionshelfer.test.cjs 'C:/Users/nigo2/Downloads/VorlagenListeZumDecodieren.html' 'C:/Users/nigo2/Downloads/Baumenü.htm' 'C:/Users/nigo2/Downloads/BaumenüMitWarteschlange.htm'
```

Die Tests prüfen den Export, die komplette Baufolge gegen das HTML, vorhandene und eingereihte Stufen, beide Warteschlangenlimits, Ressourcen, Extrakostensperren, Bauernhofpriorität und fehlende Daten. Die UI-Regressionstests simulieren verzögert verfügbare Spieldaten sowie wiederholtes Ersetzen der Bauansicht nach Bauabschlüssen. Automatiktests prüfen gespeicherte Schalterzustände, sequenzielle Spielantworten, Ressourcenverbrauch, beide Limits, Fertigstellungszeiten, verkürzte Warteschlangen, Ausschalten während einer Anfrage und das Verhindern paralleler Prüfläufe. Questtests prüfen Delaygrenzen, die Reihenfolge der Popupaktionen, Speichergrenzen, einmalige Sitzungsprüfungen und deren Freigabe durch neue Popups; der UI-Test prüft zusätzlich den Fortschrittsstand in der Kopfzeile.
