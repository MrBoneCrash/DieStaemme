# Die Stämme – Truppenvorlagen

> **Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.** Prüfe vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen. Fehler können zu Verlusten im Spiel oder zu Kontosanktionen führen.

## GitHub-Loader

Tampermonkey startet diesen Loader über die `@match`-Einträge ausschließlich auf folgenden Seiten: **Rekrutierung einschließlich Massenrekrutierung**. Die Reihenfolge der URL-Parameter spielt dabei keine Rolle.

In Tampermonkey **Neues Script erstellen** auswählen, den vorhandenen Inhalt durch den folgenden Loader ersetzen und speichern. Das Beispiel ist für dieses Skript fertig eingerichtet; du musst keine URL ändern. Eine zuvor direkt installierte Variante desselben Skripts deaktivieren, damit es nicht doppelt läuft.

Bei jedem vollständigen Aufruf einer dieser Seiten wird die aktuelle auf GitHub veröffentlichte Version aus `master` geladen. Für ein Update eine bereits geöffnete Spielseite neu laden. GitHubs Bereitstellung kann kurz verzögert sein.

```javascript
// ==UserScript==
// @name         Die Stämme – Truppenvorlagen (GitHub-Loader)
// @namespace    local.die-staemme.loader.truppenvorlagen
// @version      1.0.1
// @description  Lädt die aktuelle GitHub-Version. Nutzung auf eigene Gefahr.
// @match        https://*.die-staemme.de/game.php?screen=train
// @match        https://*.die-staemme.de/game.php?screen=train&*
// @match        https://*.die-staemme.de/game.php?*&screen=train
// @match        https://*.die-staemme.de/game.php?*&screen=train&*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

// Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.
(() => {
    const url = 'https://raw.githubusercontent.com/MrBoneCrash/DieStaemme/master/truppenvorlagen/truppenvorlagen.user.js';
    fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
        })
        .then(code => new Function(code)())
        .catch(error => console.error('[Truppenvorlagen] Laden fehlgeschlagen:', error));
})();
```

Ohne erreichbares GitHub startet keine gespeicherte Ersatzversion. Ladefehler stehen in der Browserkonsole. **Die Nutzung erfolgt auf eigene Gefahr; auch zukünftige Änderungen aus `master` werden automatisch ausgeführt.**

`truppenvorlagen.user.js` erweitert die vorhandene Einzel- und
Massenrekrutierung von **Die Stämme** um lokal gespeicherte Sollvorlagen.
Es öffnet kein Overlay und sendet keine Rekrutierung selbst ab.

## Installation

1. Tampermonkey im Browser installieren.
2. Eine neue Userscript-Datei anlegen.
3. Den kompletten Inhalt von `truppenvorlagen.user.js` einfügen und speichern.
4. In Die Stämme die Seite **Rekrutieren** oder **Rekrutierung in Massen**
   öffnen.

## Bedienung

1. Einen Vorlagennamen und die gewünschten Gesamtbestände eingeben.
2. **Speichern** anklicken.
3. Die Abweichungen stehen direkt an den nativen Einheiten-/Rekrutierungsfeldern.
4. **Fehlbestand eintragen** füllt die nativen Felder. Das Spiel wird nicht
   automatisch abgesendet; die Werte vor dem eigenen Klick auf
   **Rekrutieren** prüfen.

Standardmäßig werden bereits laufende Rekrutierungen zum Istbestand gezählt.
Wenn die Rohstoffe nicht für den gesamten Fehlbestand reichen, berechnet das
Skript aus den auf der Seite angezeigten Einheitenkosten sowie den aktuell
verfügbaren Rohstoffen und Bauernhofplätzen zuerst eine proportionale Verteilung.
Danach werden Restressourcen weiter verwendet, bis keine noch fehlende Einheit
mehr bezahlbar ist. Eine eigene Zeile zeigt die geplanten Ausgaben für Holz,
Lehm, Eisen und Bevölkerung sowie bei einem einzelnen Dorf den Restbestand.

Die Vorlagenleiste wird nach den regelmäßigen AJAX-Aktualisierungen der
Rekrutierungsansicht automatisch wieder in die native Seite eingesetzt. Die
gewählte Vorlage und ihre Sollwerte bleiben dabei erhalten.

In der Massenrekrutierung erhält jedes sichtbare Dorf neben der Auswahlbox zum
Einbeziehen ein eigenes Vorlagen-Dropdown. Dadurch können unterschiedliche
Dörfer im selben Durchlauf unterschiedliche Vorlagen verwenden. Die Zuordnung
wird anhand der Dorf-ID gespeichert und mit der normalen Rekrutierungsansicht
synchronisiert: Eine dort gewählte Vorlage erscheint anschließend auch für
dasselbe Dorf in der Massenansicht – und umgekehrt. Abgewählte oder durch die
Spielansicht ausgeblendete Dörfer werden nicht verändert. Die Abweichungen
werden dort platzsparend als `−Fehlmenge`,
`+Überschuss` oder `✓` angezeigt; der vollständige Ist-/Sollwert steht im
Tooltip. Wenn die Massenansicht einen Bestand oder eine Warteschlange
nicht direkt ausgibt, liest das Skript nach dem manuellen Klick auf
**Fehlbestand eintragen** die normale Rekrutierungsseite des betreffenden Dorfs
mit maximal zwei parallelen, gleichursprünglichen Leseanfragen. Es werden keine
Daten an Dritte gesendet.

Die Massenansicht trennt das Anwenden und Bearbeiten bewusst: Der Knopf
**Zugewiesene Vorlagen eintragen** verwendet ausschließlich die Dropdown-Auswahl
der einzelnen Dörfer. Das Erstellen oder Ändern von Vorlagen befindet sich im
standardmäßig geschlossenen Bereich **Vorlagen verwalten**.

Vorlagen und Dorfzuordnungen liegen ausschließlich in `localStorage`, getrennt
nach Host, Welt und Spieler-ID.

## Wichtiger Regelhinweis

Die Stämme erlaubt nicht automatisch jedes externe Skript. Laut aktueller
Support-Dokumentation werden neue Skripte über die offizielle Skriptbibliothek
geprüft; nach dem Ende der Übergangsphase sollen nur dort verfügbare Skripte
legal sein. Vor dem Einsatz deshalb die aktuellen Regeln der eigenen Welt
prüfen und das Skript gegebenenfalls beim Support bzw. auf `zz1` zur Freigabe
einreichen:

- https://support.innogames.com/kb/TribalWars/de_DE/6023
- https://support.innogames.com/kb/TribalWars/de_DE/1317

## Lokaler Test

Die Befehle werden im Repository-Hauptordner ausgeführt. Der Ordner `test` bleibt lokal und ist nicht Bestandteil der Veröffentlichung. Die Testbefehle setzen diese lokalen Dateien voraus.

```powershell
node --test test/truppenvorlagen.core.test.cjs
node --check truppenvorlagen/truppenvorlagen.user.js
```
