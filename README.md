# Die Stämme – Userscripts

> **Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.** Prüfe vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen. Fehler können zu Verlusten im Spiel oder zu Kontosanktionen führen.

Sechs eigenständige Userscripts für die deutsche Browserversion von Die Stämme. Jeder Ordner enthält das Skript und seine Anleitung.

| Skript | Funktion | Anleitung und Loader |
| --- | --- | --- |
| [Angriffsplaner](angriffsplaner/angriffsplaner.user.js) | Plant Angriffe und Fakes für mehrere Ziele; exportiert nach Workbench. | [Anleitung](angriffsplaner/README.md) · [Loader](angriffsplaner/README.md#github-loader) |
| [Einzelziel-Snipe](einzelziel-snipe/einzelziel-snipe.user.js) | Berechnet Abschickzeiten für ein Zieldorf und exportiert Einheiten nach Workbench. | [Anleitung](einzelziel-snipe/README.md) · [Loader](einzelziel-snipe/README.md#github-loader) |
| [Marktplatz-Ausgleich](marktplatz-ausgleich/marktplatz-ausgleich.user.js) | Plant Rohstoffverteilung und Marktaktionen. | [Anleitung](marktplatz-ausgleich/README.md) · [Loader](marktplatz-ausgleich/README.md#github-loader) |
| [Premium-Depot](premium-depot/premium-depot.user.js) | Berechnet Verkaufsvorschläge und prüft die native Bestätigung. | [Anleitung](premium-depot/README.md) · [Loader](premium-depot/README.md#github-loader) |
| [Truppenvorlagen](truppenvorlagen/truppenvorlagen.user.js) | Speichert Sollbestände und trägt Fehlmengen in Rekrutierungsfelder ein. | [Anleitung](truppenvorlagen/README.md) · [Loader](truppenvorlagen/README.md#github-loader) |
| [Verteidigungsassistent](verteidigungsassistent/verteidigungsassistent.user.js) | Analysiert Eingehende und plant Unterstützung sowie Ausweichbefehle. | [Anleitung](verteidigungsassistent/README.md) · [Loader](verteidigungsassistent/README.md#github-loader) |

## Installation

1. Tampermonkey im Browser installieren.
2. Die gewünschte `.user.js`-Datei öffnen und vollständig als neues Userscript in Tampermonkey speichern.
3. Die Anleitung im jeweiligen Skriptordner lesen und die dort genannte Spielseite öffnen.

## Immer die aktuelle Version über GitHub laden

Oben in jeder Skript-Anleitung steht ein fertig eingerichteter **GitHub-Loader**. Die Links **Loader** in der Tabelle führen direkt zum jeweiligen Beispiel. Kopiere den gewünschten Loader als neues Userscript in Tampermonkey und deaktiviere eine zuvor direkt installierte Variante desselben Skripts.

Kurze `@match`-Einträge mit exakten `@exclude`-Filtern in den Skripten und Loadern begrenzen die Ausführung auf die jeweils benötigten Spielseiten. Der Loader lädt beim vollständigen Aufruf einer passenden Seite die aktuelle auf GitHub veröffentlichte Version aus `master`; für Updates genügt ein Neuladen der passenden Spielseite. Bereits installierte Loader müssen einmal durch das neue Beispiel ersetzt werden, damit auch ihre Seitenfilter aktualisiert sind. Die fünf Skripte ohne TWForge verwenden einen kurzen `fetch`-Loader. Der Angriffsplaner nutzt `GM_xmlhttpRequest` und behält seine Berechtigung für TWForge-Berichte. Details zu dieser Funktion stehen in der [Tampermonkey-Dokumentation](https://www.tampermonkey.net/documentation.php#api:GM_xmlhttpRequest).

## Spielregeln

Prüfe vor der Nutzung die aktuellen Regeln deiner Welt und eine gegebenenfalls erforderliche Freigabe durch den Support. Die Aufnahme in dieses Repository ist keine offizielle Freigabe.

- [Hinweise zu externen Skripten](https://support.innogames.com/kb/TribalWars/de_DE/6023)
- [Weitere Support-Hinweise](https://support.innogames.com/kb/TribalWars/de_DE/1317)
