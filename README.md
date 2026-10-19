# Die Stämme – Userscripts

> **Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.** Prüfe vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen. Fehler können zu Verlusten im Spiel oder zu Kontosanktionen führen.

Neun eigenständige Userscripts für die deutsche Browserversion von Die Stämme. Jeder Ordner enthält das Skript und seine Anleitung.

| Skript | Funktion | Anleitung und Loader |
| --- | --- | --- |
| [Angriffsplaner](angriffsplaner/angriffsplaner.user.js) | Plant Angriffe und Fakes für mehrere Ziele; exportiert nach Workbench. | [Anleitung](angriffsplaner/README.md) · [Loader](angriffsplaner/README.md#github-loader) |
| [Einzelziel-Snipe](einzelziel-snipe/einzelziel-snipe.user.js) | Berechnet Abschickzeiten für ein Zieldorf und exportiert Einheiten nach Workbench. | [Anleitung](einzelziel-snipe/README.md) · [Loader](einzelziel-snipe/README.md#github-loader) |
| [Marktplatz-Ausgleich](marktplatz-ausgleich/marktplatz-ausgleich.user.js) | Plant Rohstoffverteilung und Marktaktionen. | [Anleitung](marktplatz-ausgleich/README.md) · [Loader](marktplatz-ausgleich/README.md#github-loader) |
| [Premium-Depot](premium-depot/premium-depot.user.js) | Berechnet Verkaufsvorschläge und prüft die native Bestätigung. | [Anleitung](premium-depot/README.md) · [Loader](premium-depot/README.md#github-loader) |
| [Truppenvorlagen](truppenvorlagen/truppenvorlagen.user.js) | Speichert Sollbestände; normale Rekrutierung über Kontrollzentrum mit Baureserve, Massenrekrutierung manuell. | [Anleitung](truppenvorlagen/README.md) · [Loader](truppenvorlagen/README.md#github-loader) |
| [Verteidigungsassistent](verteidigungsassistent/verteidigungsassistent.user.js) | Analysiert Eingehende und plant Unterstützung sowie Ausweichbefehle. | [Anleitung](verteidigungsassistent/README.md) · [Loader](verteidigungsassistent/README.md#github-loader) |
| [Konstruktionshelfer](konstruktionshelfer/konstruktionshelfer.user.js) | Baut nach Vorlage mit Fortschrittsanzeige und optionaler Automatik; prüft Rohstoffe, Bauernhof und passende Questbelohnungen. Zufällige Aktionspausen, maximal 2 Aufträge ohne bzw. 5 mit Premium, ohne Extrakosten. | [Anleitung](konstruktionshelfer/README.md) · [Loader](konstruktionshelfer/README.md#github-loader) |
| [Kontrollzentrum](kontrollzentrum/kontrollzentrum.user.js) | Gemeinsame Pause und Automatiksteuerung; koordiniert Raubzüge, Rekrutierung mit Baureserve und Dorfwechsel. | [Anleitung](kontrollzentrum/README.md) · [Loader](kontrollzentrum/README.md#github-loader) |
| [Raubzug-Helfer](raubzug-helfer/raubzug-helfer.user.js) | Optimiert ganzzahlige Raubzuggruppen nach Stundenertrag, mit gespeicherter Rückkehrgrenze, Freischaltung und optionalem erneutem Abschicken. | [Anleitung](raubzug-helfer/README.md) · [Loader](raubzug-helfer/README.md#github-loader) |

## Vier Skripte im Zusammenspiel

Das **Kontrollzentrum** verbindet **Konstruktionshelfer**, **Raubzug-Helfer** und **Truppenvorlagen**. Ausgangspunkt ist die Hauptgebäude-Ansicht in einem geöffneten Browsertab. Dort arbeitet die Bauautomatik; das Kontrollzentrum besucht bei Bedarf die Raubzug- und Rekrutierungsansicht und kehrt nach den fälligen Aufgaben zum ursprünglichen Hauptgebäude zurück.

| Skript | Aufgabe im gemeinsamen Ablauf |
| --- | --- |
| **Kontrollzentrum** | Zeigt Status und zusätzliche Automatikschalter, verwaltet fällige Aufgaben und pausiert die angebundenen Helfer bei einem Aktivitätscheck. |
| **Konstruktionshelfer** | Baut nach geladener Bauvorlage, liefert die Daten für die Bauernhofreserve und meldet fertiggestellte Bauernhofstufen. |
| **Raubzug-Helfer** | Berechnet und startet Raubzuggruppen und meldet den nächsten Einsatz nach Rückkehr oder Freischaltung. |
| **Truppenvorlagen** | Speichert Sollbestände je Dorf und setzt automatische Aufträge in der normalen Rekrutierung einschließlich Klick auf **Rekrutieren** um. Die Massenrekrutierung bleibt manuell. |

### Features

- **Gemeinsame Steuerung:** Status und rote/grüne Automatikschalter für das aktuelle Dorf im Kontrollzentrum; Dorfdetails und eigene Schalter in den aufklappbaren Übersichten.
- **Manuelle Aktivitätschecks:** Nur das Kontrollzentrum erkennt den Check und verteilt die Pause über `BroadcastChannel` und `localStorage`. Den Check selbst durchführen und anschließend **Pause aufheben** wählen. Ein geöffneter Vollbildcheck bleibt frei zugänglich.
- **Bauen nach Vorlage:** Fortschrittsanzeige, Rohstoff- und Bauernhofprüfung sowie höchstens zwei Bauaufträge ohne beziehungsweise fünf mit Premium, ohne Extrakosten.
- **Raubzüge nach Termin:** Wechsel zur nächsten Rückkehr oder abgeschlossenen Freischaltung. Ohne bekannten Termin erfolgt ein erneuter Check nach einer Minute.
- **Rekrutierung mit Baureserve:** `freie Bauernhofkapazität − Platzbedarf offener Bauvorlagenschritte bis zum nächsten Bauernhof = Überschuss`. Nur finanzierbare, noch fehlende Truppen werden rekrutiert; bereits laufende Rekrutierungen zählen mit. Ohne weiteren Bauernhof wird die gesamte verbleibende Baufolge reserviert.
- **Kapazitätsprüfung:** Nach einem Bauernhofabschluss sofort, sobald laufende Aktionen beendet sind; ansonsten stündlich pro eingerichtetem Dorf.
- **Mehrere Dörfer:** Raubzugeinstellungen, Truppenvorlagen, Automatikzustände und Termine je Dorf; fällige Raubzüge werden nacheinander abgearbeitet und haben Vorrang vor Rekrutierungsaufgaben. Die geladene Bauvorlage wird für denselben Host, dieselbe Welt und denselben Spieler gemeinsam verwendet.
- **Zufällige Wartezeiten:** 1–4 Sekunden vor automatischen Ansichtswechseln und Spielaktionen mit erneuter Prüfung vor der Aktion.
- **Aufklappzustand:** Das Kontrollzentrum bleibt bei automatischen Wechseln und Reloads geöffnet; ein manueller vollständiger Refresh startet eingeklappt.

### Quickstart mit GitHub-Loadern

1. **Tampermonkey installieren.** Für jeden der folgenden vier Loader ein eigenes neues Userscript anlegen, den vollständigen Codeblock aus der verlinkten Anleitung einfügen und speichern:
   - [Kontrollzentrum-Loader](kontrollzentrum/README.md#github-loader)
   - [Konstruktionshelfer-Loader](konstruktionshelfer/README.md#github-loader)
   - [Raubzug-Helfer-Loader](raubzug-helfer/README.md#github-loader)
   - [Truppenvorlagen-Loader](truppenvorlagen/README.md#github-loader)
2. **Doppelte Installationen vermeiden.** Zuvor direkt installierte Varianten derselben Skripte deaktivieren. Bereits geöffnete Spielseiten neu laden.
3. **Baufolge einrichten.** Im Hauptgebäude den Konstruktionshelfer aufklappen, den Exportcode einer Konstruktionsmanager-Vorlage einfügen und **Vorlage laden** wählen. Die Baufolge prüfen und bei Bedarf **Automatisch einreihen** einschalten.
4. **Raubzüge einrichten.** Im gewünschten Dorf **Versammlungsplatz → Raubzüge** öffnen, Einheitentypen auswählen, bei Bedarf Rückkehrgrenze und Freischaltung einstellen und **Automatisch abschicken** einschalten.
5. **Truppenvorlage einrichten.** Die normale Rekrutierung öffnen, Sollbestände speichern und die Vorlage dem Dorf zuweisen. Bei einer eingerichteten Vorlage ist die Rekrutierungsautomatik zunächst an; im Kontrollzentrum lässt sie sich ausschalten.
6. **Weitere Dörfer anmelden.** In jedem gewünschten Dorf Hauptgebäude, Raubzüge und normale Rekrutierung einmal öffnen und die gewünschten Einstellungen vornehmen. Nur bereits erkannte, eingerichtete Dörfer werden berücksichtigt.
7. **Zum Hauptgebäude zurückkehren.** Kontrollzentrum aufklappen und Status sowie Automatikschalter prüfen. Browsertab und Browser geöffnet lassen. Bei einem Aktivitätscheck den Check manuell durchführen und danach die Pause im Kontrollzentrum aufheben.

Die Loader laden die auf GitHub veröffentlichte Version aus `master` bei jedem vollständigen Aufruf einer passenden Spielseite. Änderungen müssen dafür auf GitHub veröffentlicht sein; ein Neuladen übernimmt dann die aktuelle Version. Ohne erreichbares GitHub startet keine Ersatzversion. Browser können Timer in Hintergrundtabs verzögern.

Weitere Skripte sind nicht an die gemeinsame Pause angebunden. **Nicht installiert** bedeutet, dass ein Helfer für das Dorf noch nicht erkannt wurde; Tampermonkeys Installationsliste kann das Kontrollzentrum nicht auslesen.

**Eigenständige Nutzung:** Ohne aktives Kontrollzentrum funktionieren die Helfer separat. Bau- und Raubzugautomatik bleiben verfügbar; Truppenvorlagen trägt auf Wunsch die Fehlbestände ein, abgeschickt wird manuell. Die Helfer erkennen selbst keine Aktivitätschecks. Eine gespeicherte Pause bleibt auch ohne Kontrollzentrum wirksam. Sobald kein Kontrollzentrum erkannt wird, zeigt jeder integrierte Helfer **Fortsetzen**; der Klick hebt die Pause global für denselben Host, dieselbe Welt und denselben Spieler auf. Gespeicherte Rekrutierungsaufträge werden ohne aktives Kontrollzentrum auf derselben Seite nicht automatisch ausgeführt.

## Installation

1. Tampermonkey im Browser installieren.
2. Den **GitHub-Loader** aus der verlinkten Anleitung als neues Userscript in Tampermonkey speichern. Alternativ die vollständige `.user.js`-Datei direkt installieren.
3. Die Anleitung im jeweiligen Skriptordner lesen und die dort genannte Spielseite öffnen.

## Immer die aktuelle Version über GitHub laden

Für alle Skripte steht in der verlinkten Anleitung ein fertig eingerichteter **GitHub-Loader**. Kopiere den gewünschten Loader als neues Userscript in Tampermonkey und deaktiviere eine zuvor direkt installierte Variante desselben Skripts.

Kurze `@match`-Einträge und, wo benötigt, exakte `@exclude`-Filter begrenzen die Ausführung auf die jeweiligen Spielseiten. Der Loader lädt beim vollständigen Aufruf einer passenden Seite die aktuelle auf GitHub veröffentlichte Version aus `master`; für Updates genügt ein Neuladen der passenden Spielseite. Beim Ändern der Loader-Konfiguration das installierte Beispiel ersetzen, damit auch seine Seitenfilter aktualisiert sind. Die Skripte ohne DB-Info verwenden einen kurzen `fetch`-Loader. Der Angriffsplaner nutzt `GM_xmlhttpRequest` und behält seine Berechtigung für DB-Info-Berichte. Details zu dieser Funktion stehen in der [Tampermonkey-Dokumentation](https://www.tampermonkey.net/documentation.php#api:GM_xmlhttpRequest).

## Spielregeln

Prüfe vor der Nutzung die aktuellen Regeln deiner Welt und eine gegebenenfalls erforderliche Freigabe durch den Support. Die Aufnahme in dieses Repository ist keine offizielle Freigabe.

- [Hinweise zu externen Skripten](https://support.innogames.com/kb/TribalWars/de_DE/6023)
- [Weitere Support-Hinweise](https://support.innogames.com/kb/TribalWars/de_DE/1317)
