# Die Stämme – Userscripts

> **Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.** Prüfe vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen. Fehler können zu Verlusten im Spiel oder zu Kontosanktionen führen.

Sechs eigenständige Userscripts für die deutsche Browserversion von Die Stämme. Jeder Ordner enthält das Skript und seine Anleitung.

| Skript | Funktion | Anleitung |
| --- | --- | --- |
| [Angriffsplaner](angriffsplaner/angriffsplaner.user.js) | Plant Angriffe und Fakes für mehrere Ziele; exportiert nach Workbench. | [README](angriffsplaner/README.md) |
| [Einzelziel-Snipe](einzelziel-snipe/einzelziel-snipe.user.js) | Berechnet Abschickzeiten für ein Zieldorf und exportiert Einheiten nach Workbench. | [README](einzelziel-snipe/README.md) |
| [Marktplatz-Ausgleich](marktplatz-ausgleich/marktplatz-ausgleich.user.js) | Plant Rohstoffverteilung und Marktaktionen. | [README](marktplatz-ausgleich/README.md) |
| [Premium-Depot](premium-depot/premium-depot.user.js) | Berechnet Verkaufsvorschläge und prüft die native Bestätigung. | [README](premium-depot/README.md) |
| [Truppenvorlagen](truppenvorlagen/truppenvorlagen.user.js) | Speichert Sollbestände und trägt Fehlmengen in Rekrutierungsfelder ein. | [README](truppenvorlagen/README.md) |
| [Verteidigungsassistent](verteidigungsassistent/verteidigungsassistent.user.js) | Analysiert Eingehende und plant Unterstützung sowie Ausweichbefehle. | [README](verteidigungsassistent/README.md) |

## Installation

1. Tampermonkey im Browser installieren.
2. Die gewünschte `.user.js`-Datei öffnen und vollständig als neues Userscript in Tampermonkey speichern.
3. Die Anleitung im jeweiligen Skriptordner lesen und die dort genannte Spielseite öffnen.

## Spielregeln

Prüfe vor der Nutzung die aktuellen Regeln deiner Welt und eine gegebenenfalls erforderliche Freigabe durch den Support. Die Aufnahme in dieses Repository ist keine offizielle Freigabe.

- [Hinweise zu externen Skripten](https://support.innogames.com/kb/TribalWars/de_DE/6023)
- [Weitere Support-Hinweise](https://support.innogames.com/kb/TribalWars/de_DE/1317)

## Lokale Entwicklung

Der Ordner `test/` bleibt ausschließlich lokal und wird nicht veröffentlicht. Auch `.local/` mit lokalen Sicherungen ist ausgeschlossen. Syntaxprüfung aus dem Repository-Hauptordner:

```powershell
Get-ChildItem -Recurse -Filter *.user.js -Exclude *test* | ForEach-Object { node --check $_.FullName }
```

Die Testbefehle in den einzelnen Anleitungen setzen die lokal vorhandenen Testdateien voraus.
