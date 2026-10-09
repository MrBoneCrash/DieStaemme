# Die Stämme – Verteidigungsassistent

> **Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.** Prüfe vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen. Fehler können zu Verlusten im Spiel oder zu Kontosanktionen führen.

## GitHub-Loader

Tampermonkey startet diesen Loader über die `@match`-Einträge ausschließlich auf folgenden Seiten: **Eingehende, Karte und Versammlungsplatz**. Die Reihenfolge der URL-Parameter spielt dabei keine Rolle.

In Tampermonkey **Neues Script erstellen** auswählen, den vorhandenen Inhalt durch den folgenden Loader ersetzen und speichern. Das Beispiel ist für dieses Skript fertig eingerichtet; du musst keine URL ändern. Eine zuvor direkt installierte Variante desselben Skripts deaktivieren, damit es nicht doppelt läuft.

Bei jedem vollständigen Aufruf einer dieser Seiten wird die aktuelle auf GitHub veröffentlichte Version aus `master` geladen. Für ein Update eine bereits geöffnete Spielseite neu laden. GitHubs Bereitstellung kann kurz verzögert sein.

```javascript
// ==UserScript==
// @name         Die Stämme – Verteidigungsassistent (GitHub-Loader)
// @namespace    local.die-staemme.loader.verteidigungsassistent
// @version      1.0.1
// @description  Lädt die aktuelle GitHub-Version. Nutzung auf eigene Gefahr.
// @match        https://*.die-staemme.de/game.php?screen=overview_villages&mode=incomings
// @match        https://*.die-staemme.de/game.php?screen=overview_villages&mode=incomings&*
// @match        https://*.die-staemme.de/game.php?screen=overview_villages&*&mode=incomings
// @match        https://*.die-staemme.de/game.php?screen=overview_villages&*&mode=incomings&*
// @match        https://*.die-staemme.de/game.php?*&screen=overview_villages&mode=incomings
// @match        https://*.die-staemme.de/game.php?*&screen=overview_villages&mode=incomings&*
// @match        https://*.die-staemme.de/game.php?*&screen=overview_villages&*&mode=incomings
// @match        https://*.die-staemme.de/game.php?*&screen=overview_villages&*&mode=incomings&*
// @match        https://*.die-staemme.de/game.php?mode=incomings&screen=overview_villages
// @match        https://*.die-staemme.de/game.php?mode=incomings&screen=overview_villages&*
// @match        https://*.die-staemme.de/game.php?mode=incomings&*&screen=overview_villages
// @match        https://*.die-staemme.de/game.php?mode=incomings&*&screen=overview_villages&*
// @match        https://*.die-staemme.de/game.php?*&mode=incomings&screen=overview_villages
// @match        https://*.die-staemme.de/game.php?*&mode=incomings&screen=overview_villages&*
// @match        https://*.die-staemme.de/game.php?*&mode=incomings&*&screen=overview_villages
// @match        https://*.die-staemme.de/game.php?*&mode=incomings&*&screen=overview_villages&*
// @match        https://*.die-staemme.de/game.php?screen=map
// @match        https://*.die-staemme.de/game.php?screen=map&*
// @match        https://*.die-staemme.de/game.php?*&screen=map
// @match        https://*.die-staemme.de/game.php?*&screen=map&*
// @match        https://*.die-staemme.de/game.php?screen=place
// @match        https://*.die-staemme.de/game.php?screen=place&*
// @match        https://*.die-staemme.de/game.php?*&screen=place
// @match        https://*.die-staemme.de/game.php?*&screen=place&*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

// Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.
(() => {
    const url = 'https://raw.githubusercontent.com/MrBoneCrash/DieStaemme/master/verteidigungsassistent/verteidigungsassistent.user.js';
    fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
        })
        .then(code => new Function(code)())
        .catch(error => console.error('[Verteidigungsassistent] Laden fehlgeschlagen:', error));
})();
```

Ohne erreichbares GitHub startet keine gespeicherte Ersatzversion. Ladefehler stehen in der Browserkonsole. **Die Nutzung erfolgt auf eigene Gefahr; auch zukünftige Änderungen aus `master` werden automatisch ausgeführt.**

`verteidigungsassistent.user.js` ergänzt die Eingehenden-, Karten- und
Versammlungsplatzansicht. Es gruppiert Angriffswellen, trennt Fakten von
Indizien, schätzt einen konservativen Verteidigungsbedarf und erstellt manuell
zu bestätigende Unterstützungs- und Ausweichpläne.

Das Skript sendet **keinen** Befehl ab, ändert keine Gruppen automatisch und
ruft keine Drittanbieter auf.

## Installation

1. In Tampermonkey ein neues Userscript anlegen.
2. Den vollständigen Inhalt von `verteidigungsassistent.user.js` einfügen.
3. Speichern und die Seite **Übersichten → Eingehend** neu laden.
4. Vor dem produktiven Einsatz die aktuellen Skriptregeln der eigenen Welt
   prüfen und das Skript gegebenenfalls freigeben lassen.

Gespeicherte Daten liegen in `localStorage`, getrennt nach Host, Welt und
Spieler-ID. Es werden keine Daten an andere Server übertragen.

## Enthaltene Funktionen

- Angriffsbefehle werden je Zieldorf und konfigurierbarem Zeitfenster zu
  Lagegruppen zusammengefasst.
- Eintreffende eigene oder verbündete Unterstützungen und Rückkehrbefehle
  werden über das native Befehlsicon erkannt und aus Risiko, Gruppierung und
  Angriffsalarmen ausgeschlossen; in der Spieltabelle bleiben sie sichtbar.
- Kurze Wellen aus derselben Herkunft sowie zeitlich synchronisierte Befehle
  aus mehreren Herkunftsdörfern werden getrennt erkannt. Eine
  quellübergreifende Folge wird nur mit zusätzlichem AG-Signal als möglicher
  AG-Zug bezeichnet; ohne dieses Signal bleibt sie eine koordinierte Welle.
- Die vom Spiel beim automatischen Umbenennen ausgegebene langsamste Einheit
  wird als vorsichtiges Geschwindigkeitssignal einbezogen. Sie steht unterhalb
  von Wachturmdaten und beweist weder Truppenmenge noch Zusammensetzung.
- Wachturmklassen **klein**, **mittel**, **groß** und **Adelsgeschlecht** werden
  als belastbare Spielsignale behandelt. Befehlsnamen wie `Fake` oder `AG`
  bleiben ausdrücklich schwache, manipulierbare Indizien.
- Jede Gruppe erhält Risikowert, Gefahrenstufe, Konfidenz und eine sichtbare
  Begründung. Unbekannte Truppenzusammensetzungen werden nicht als Gewissheit
  ausgegeben.
- Status und Notiz lassen sich pro Lagegruppe speichern; Filter wirken auf die
  Assistententabelle und optional auf die native Angriffstabelle.
- Browser-Alarme melden auf Wunsch neue Befehle, konfigurierbare
  Ankunftsschwellen und bevorstehende Ausweichbefehle. Der Aktivierungsknopf
  verschwindet, sobald Berechtigung und Konfiguration aktiv sind.
- Je bedrohtem Dorf wird anhand der eigenen Truppen zu Hause bewertet, ob eine
  Off oder ein AG geschützt werden sollte. Daraus entsteht ein vorbereitbarer
  Zeitplan mit Sende-, Abbruch-/Rückruf- und Rückkehrzeit.
- Mauerstufen werden aus der Gebäudeübersicht gelesen; die manuelle Eingabe ist
  nur noch eine ausdrücklich aktivierte Ausnahme oder ein Fallback.
- Auf der Karte erscheint eine kompakte Liste gefährdeter Dörfer zum
  Zentrieren.

## Automatische Datenbasis und Verteidigungsmodell

Beim Laden von **Übersichten → Eingehend** liest das Skript automatisch drei
gleichursprüngliche Spielansichten:

- `Eigene – zu Hause` für tatsächlich versendbare Truppen,
- `Im Dorf` für die bekannte Verteidigung am Ziel einschließlich dort
  stehender Unterstützung,
- `Gebäude` für die Mauerstufen der eigenen Dörfer.

Dafür sind beim Seitenaufruf drei zusätzliche lesende Anfragen an denselben
Spielserver nötig. Sie werden nicht im 30-Sekunden-Analysetakt wiederholt. Sind
eine Übersicht, Rechte oder die Netzwerkverbindung nicht verfügbar, bleiben
vorhandene lokale Daten erhalten und der Fehler wird sichtbar ausgewiesen.
Ein bestehender Unterstützungsplan wird nicht heimlich gelöscht; nach einer
Bestandsänderung wird er deutlich als neu zu planen markiert.

Die Truppenübersicht selbst erhält keine zusätzliche Lade-UI mehr. Die früheren
Knöpfe **Neu analysieren** und **Truppenbestände laden** sind entfallen: Die
Eingehenden werden beim Aufbau, bei relevanten Tabellenänderungen und danach
periodisch analysiert; Bestände und Gebäude werden bei jedem vollständigen
Seitenladen aktualisiert.

Aus den Einheitenwerten wird die Verteidigung gegen Infanterie, Kavallerie und
– falls auf der Welt aktiv – Bogenschützen berechnet. Weil die echte
Angriffszusammensetzung unbekannt ist, verwendet die Planung konservativ den
schwächsten dieser Verteidigungswerte. Mauer und bestätigter Nachtbonus werden
multipliziert. Normalerweise stammt die Mauerstufe aus der Gebäudeübersicht;
pro Zieldorf kann bewusst eine manuelle Ausnahme aktiviert werden.

Das Ergebnis ist eine **Planungsgröße**, keine Kampfsimulator-Prognose. Moral,
Kirche, Paladin-Gegenstände, Flaggen, Glück, Forschung und unbekannte
Angriffszusammensetzungen werden ohne bestätigte Daten nicht erfunden. Diese
Grenze wird auch direkt in der Ansicht genannt.

### Welten ohne Wachturm

Ohne Wachturm kennt die Eingehenden-Ansicht keine Truppenmenge. Das Skript
verwendet deshalb keinen einzelnen Pauschalwert mehr, sondern unterscheidet
nach der belastbar ermittelten langsamsten Geschwindigkeitsklasse: Späher,
schnelle Kavallerie/Paladin, Infanterie, Rammbock/Katapult, Adelsgeschlecht
oder keine bestimmbare Laufzeit.

Zusätzlich fließen Befehlsdichte, Wiederholungen derselben Herkunft,
quellübergreifende Synchronisierung und Quellenvielfalt in Lage und Bedarf
ein. Die Detailansicht zeigt das verwendete Modell und die Beiträge je Klasse.
Die Laufzeit beweist weiterhin **keine Truppenmenge**: Ein einzelner Rammbock
kann dieselbe Laufzeitklasse wie eine vollständige Off erzeugen. Daher heißt
das Ergebnis bei Belagerungsgeschwindigkeit bewusst **Off möglich** und nicht
**Off bestätigt**.

## Welteigenschaften

Das Skript lädt vom aktuellen Spielserver:

- `/interface.php?func=get_config`
- `/interface.php?func=get_unit_info`

Damit werden Weltgeschwindigkeit, Einheitengeschwindigkeit, Bogenschützen,
Wachturm, Kirche, Moralhinweis, Nachtbonus, das native Befehlsabbruchfenster
und die Einheitenwerte berücksichtigt.
Die Werte werden sechs Stunden lokal gecacht. Wenn die Endpunkte nicht
erreichbar oder unvollständig sind, zeigt die Weltzeile offen den verwendeten
Fallback an. Standardwerte werden nie als frisch geladene Weltdaten ausgegeben.
Für die Befehlsabbruchfrist gibt es bewusst keinen geratenen 10-Minuten-
Fallback: Fehlt der Wert in den offiziellen Weltdaten, werden abbrechbare
Ausweichbefehle blockiert; bereits am Unterstützungsziel eingetroffene Truppen
können weiterhin mit berechenbarer Rückkehr geplant werden.
Die im Einheiten-Endpunkt gelieferten Geschwindigkeiten werden als die für die
Welt geltenden Minuten pro Feld verwendet. `unit_speed` wird nicht ein zweites
Mal darauf angewandt; genau das würde die Langsamste-Einheit-Erkennung und den
Unterstützungsplan systematisch verfälschen.

## Unterstützung planen

1. Eingehenden-Ansicht vollständig laden lassen und Lagebewertung sowie die
   automatisch ausgewiesene Mauerstufe prüfen.
2. **Unterstützung planen** oder **Nur dieses Dorf planen** verwenden.
3. Die Tabelle zeigt Quelle, Ziel, Einheiten, Verteidigungswert, Laufzeit,
   letzten Sendezeitpunkt, benötigte Schutzdauer und eventuelle Restlücken.
4. **Am Versammlungsplatz vorbereiten** öffnet das korrekte Quelldorf.
5. Dort **Plan in Felder übernehmen** anklicken, alles prüfen und erst danach
   den nativen Spielknopf selbst betätigen.

Der Planer:

- zieht prozentuale und feste Reserven ab,
- verwendet Miliz nur zur Zielverteidigung, nie als versendbare Einheit,
- teilt eine Einheit nicht doppelt zu,
- berücksichtigt die langsamste enthaltene Einheit, die
  offiziellen Minuten pro Feld und den konfigurierten Ankunftspuffer,
- nimmt standardmäßig selbst angegriffene Dörfer nicht als Quelle,
- meldet nicht schließbare Lücken statt unrealistische Befehle zu erzeugen.

Nach **Als gesendet markieren** speichert der Assistent die bestätigte
Sendezeit und berechnet daraus die voraussichtliche Ankunft. Der Plan wird bei
jedem Laden und anschließend alle 30 Sekunden von `Unterwegs` über
`Angekommen` bis `Rücksendung fällig` fortgeschrieben. Herkunftsdorf,
Zieldorf und Truppen bleiben dabei vollständig sichtbar. Nach dem letzten für
dieses Ziel eingeplanten Einschlag erscheint die klare Anweisung
**Jetzt zurückschicken**. Sie öffnet die native Truppenansicht des richtigen
Herkunftsdorfs, markiert dort die passende Zielzeile und bietet die native
Rücksendeaktion an. Anschließend wird auch der berechnete Rückweg verfolgt.

Eine zuvor in die Felder übernommene Unterstützung wird zusätzlich gegen die
nativen eingehenden Unterstützungsbefehle abgeglichen. Stimmen Herkunft, Ziel
und plausibles Sende-/Ankunftsfenster überein, verwendet der Assistent die vom
Spiel angezeigte Ankunftszeit und kennzeichnet den Status als **nativ erkannt**.
Native Unterstützungen bleiben dabei aus der Angriffsbewertung ausgeschlossen.

Bis zur nativen Erkennung sind Sende- und Ankunftszeit lokale Planwerte; die
Rückkehr bleibt auch danach eine aus dem bestätigten Rückruf berechnete Zeit.
Der Assistent weist diesen Unterschied transparent aus. Eine bereits sichtbar
angekommene, aber nicht zugeordnete Unterstützung kann manuell bestätigt werden.
Die Planung eines einzelnen Zieldorfs kann in der Lagezeile oder direkt in der
Plantabelle gelöscht werden, ohne die Pläne anderer Dörfer anzutasten.

## Verspätete Umbenennung korrigieren

In der Detailtabelle besitzt jeder Befehl das Feld **Umbenennung zu spät**.
Dort wird die Zeit zwischen Absenden und Umbenennen als `HH:MM:SS` eingetragen,
zum Beispiel `00:07:30`. Beim Verlassen des Feldes oder mit Enter wird die
Korrektur pro Befehl gespeichert. Grundlage ist die beim Umbenennen im
Befehlsnamen festgehaltene Rückkehrzeit:

`Rückkehrzeit aus Name − Ankunftszeit = beim Umbenennen gesehene Laufzeit`

`gesehene Laufzeit + manuelle Verzögerung = korrigierte Gesamtlaufzeit`

Die laufend sinkende Zeit bis zur Ankunft wird ausdrücklich **nicht** als
Laufzeit verwendet. Fehlt eine Rückkehrzeit, ist eine Schätzung nur möglich,
wenn die Seite eine separate, feste Befehlsdauer bereitstellt.

Die Einheitenschätzung verwendet danach die korrigierte Gesamtlaufzeit, die
Distanz und die offiziellen Einheitenwerte. In der Spalte **Laufzeit** steht nur
das Ergebnis; die vollständige Herleitung bleibt als Tooltip verfügbar. Die
erkannte Geschwindigkeitsklasse wird in **Langsamste Einheit** mit den nativen
Einheitensymbolen und dem Konfidenzwert angezeigt. Ein leeres Korrekturfeld
entfernt die gespeicherte Verzögerung beim Verlassen des Feldes.

Die Risikozahl wird in der nativen Befehlsspalte weiterhin sichtbar angezeigt,
aber ausschließlich als CSS-Pseudoelement. Es werden dort keine eigenen
Formularelemente oder Kindknoten eingefügt. Während der native
Umbenennungseditor fokussiert ist, wird die Zahl ausgeblendet. Die Analyse wird
durch QuickEdit-Markup nicht pausiert und verändert keine nativen Kindknoten;
dadurch können dauerhaft vorhandene Editiersymbole oder ausgeblendete Felder die
Einschätzung nicht blockieren.
Die gesamte Assistentenoberfläche wird außerhalb des nativen Befehlsformulars
eingefügt. Dadurch kann Die Stämme beim Umbenennen ausschließlich die echten
Befehlscheckboxen auswerten und keine Auswahlfelder des Assistenten erfassen.

Einige Einheiten besitzen dieselbe Geschwindigkeit. Deshalb zeigt das Skript
in diesen Fällen ehrlich die Geschwindigkeitsklasse an, beispielsweise
`Speerträger / Axtkämpfer / Bogenschütze` oder
`Rammbock / Katapult`, statt eine nicht beweisbare Einzelart zu behaupten.

## Belastbare Standardprofile

**Ausgewogen** ist der wiederherstellbare Standard. Zusätzlich gibt es
**Konservativ** und **Schnelle Reaktion**. Schon die erste freie Änderung
kennzeichnet die Konfiguration als **Benutzerdefiniert** und speichert sie
sofort. **Belastbare Standards wiederherstellen** setzt alle Werte auf
`Ausgewogen` zurück.

Jeder Konfigurationspunkt besitzt ein sichtbares Info-Symbol und einen
ausführlichen Tooltip. Er beschreibt, welche Daten der Wert beeinflusst und
welche Auswirkung höhere oder niedrigere Einstellungen haben.
Die Einstellungen sind in kompakte, gleichmäßig aufgebaute Karten für
Gruppierung, quellübergreifende Synchronisierung, Wachturmbedarf, Bedarf ohne
Wachturm, Unterstützung, Ausweichen, Reserven sowie Anzeige/Alarme gegliedert.

Wichtige Ausgangswerte von `Ausgewogen`:

| Einstellung | Standard |
|---|---:|
| Gruppenfenster | 10 Minuten |
| Quellübergreifende Folge | 3 Befehle, höchstens 10 Sekunden Abstand |
| Ankunftspuffer | 5 Minuten |
| Ausweichbefehl bestätigt | 90 Sekunden vor Einschlag |
| Abbruch nach Einschlag | 5 Sekunden |
| Reserve vor Ende der nativen Abbruchfrist | 30 Sekunden |
| Mindestzeit zuhause vor neuem Ausweichen | 90 Sekunden |
| Barbaren-Fallback | mindestens 250.000 Angriffskraft |
| Barbarendorf bei möglichem Einschlag | höchstens 12.000 Punkte |
| Barbaren-Suchradius | 35 Felder |
| Prozentuale Reserve | 20 % |
| Mindestunterstützung | 500 Bevölkerung |
| Mauer-Fallback | Stufe 20 |
| Bestandswarnung | nach 6 Stunden |
| Feste Reserve | 500 Speer, 500 Schwert, 300 Bogen, 50 SKav |
| Angegriffene Quellen | ausgeschlossen |

Die Bedarfswerte sind bewusst frei konfigurierbar. Sie sind konservative
Planungsstandards für unvollständige Informationen und kein Ersatz für den
offiziellen Kampfsimulator.

## Intelligente Ausweichplanung

Die Empfehlung basiert nicht mehr nur auf dem manuell vergebenen Fake-Status,
sondern auf dem aktuellen Heimatbestand des bedrohten Dorfs:

- Ein vorhandenes AG oder eine große Off erzeugt eine klare Empfehlung.
- Kleinere offensive Bestände werden als sinnvoll schützbar ausgewiesen.
- Ohne erkannte Off/AG wird kein unnötiger Ausweichbefehl geplant.
- Speer, Schwert, Bogen, schwere Kavallerie, Paladin und Miliz bleiben als
  defensive Dorfbesetzung unangetastet.
- Ein AG wird ausschließlich zusammen mit der vollständig erkannten Off in
  denselben Befehl eingetragen.

Art und Ziel werden automatisch bestimmt. Es gibt kein freies Zielkoordinaten-
oder Methodenfeld mehr. Die feste Priorität lautet:

1. Ein anderes **eigenes Dorf** unterstützen. Das Dorf ist nur zulässig, wenn
   dort zwischen Ankunft der Unterstützung und geplantem Rückruf einschließlich
   Vorlaufpuffer kein sichtbarer Angriff eintrifft. Auch die Rückkehr ins
   Herkunftsdorf vor einem weiteren Ausweichfenster wird geprüft.
2. Falls kein solches eigenes Dorf existiert, wird aus der offiziellen
   Weltkarte ein nahes **Barbarendorf** gewählt, bei dem der Befehl innerhalb
   der nativen Frist sicher abgebrochen werden kann.
3. Ist ein Abbruch nicht möglich, darf der Barbarenangriff nur bewusst
   durchlaufen, wenn die ausgelagerte Off die konfigurierte Mindestangriffskraft
   erreicht, das Barbarendorf höchstens die konfigurierte Punktzahl besitzt und
   höchstens ein AG im Befehl steckt. Die Angriffskraft stammt aus den
   offiziellen Einheitenwerten der Welt. Da unbekannte Barbarentruppen keinen
   Kampfsimulatorbeweis erlauben, ist dies ein konservativer Stärke-Fallback
   und wird in der Anzeige ausdrücklich so bezeichnet.

Andere verbündete Dörfer werden nie als Unterstützungsziel verwendet: Dort
könnten Angriffe eintreffen, die in der eigenen Eingehenden-Übersicht nicht
sichtbar sind. Alte manuell gespeicherte Fremdkoordinaten werden ignoriert.

Nahe Ankünfte werden in einem kurzen Fenster zusammengefasst, wenn der geplante
Abbruch einschließlich Sicherheitsreserve innerhalb der von der Welt
gemeldeten nativen Abbruchfrist liegt. Weiter auseinanderliegende Angriffe
erhalten eigene kurze Fenster, sobald die Truppen dazwischen sicher zurück und
lange genug zuhause sein können.

Überlappt die sichere Rückkehr mit dem nächsten Fenster, werden die Ankünfte so
lange gemeinsam abgedeckt, bis die automatisch gewählte Aktion tatsächlich
ausführbar ist. Bei eigener Unterstützung werden Zielankunft, Rückruf und
Heimkehr berechnet. Beim Barbaren-Fallback wird entweder der sichere Abbruch
oder – nur bei ausreichender Stärke – Einschlag und automatische Rückkehr
geplant.

Die Ausweichtabelle zeigt:

- alle einzutragenden Off-/AG-Einheiten,
- geplanten Sendezeitpunkt und die dadurch geschützten Ankünfte,
- automatisch gewählte Art und das konkrete eigene Dorf beziehungsweise
  Barbarendorf samt Begründung,
- Zeitpunkt für **Befehl abbrechen**, **Unterstützung zurückrufen** oder den
  bewusst durchlaufenden Barbarenangriff,
- errechnete Rückkehr ins Heimatdorf,
- lokale Arbeitsstatus und einen Link zum richtigen Versammlungsplatz.

Am Versammlungsplatz füllt ein Klick Ziel und Truppen. Der native Knopf
**Angreifen** oder **Unterstützen** wird weiterhin bewusst selbst betätigt.
Ausweichpläne lassen sich je Dorf ausblenden und in der Dorfdetailansicht wieder
aktivieren. Browser-Benachrichtigungen erinnern mit konfigurierbarem Vorlauf an
das Wegschicken, solange die Eingehenden-Seite geöffnet ist.

## Tests

Die Befehle werden im Repository-Hauptordner ausgeführt. Der Ordner `test` bleibt lokal und ist nicht Bestandteil der Veröffentlichung. Die Testbefehle setzen diese lokalen Dateien voraus.

```powershell
node --check verteidigungsassistent/verteidigungsassistent.user.js
node --test test/verteidigungsassistent.core.test.cjs
```

Die Kernprüfungen decken Gruppierung, Wachturmbeweise, schwache Befehlsnamen,
automatische Umbenennung, Umbenennungsverzögerung, gleiche
Geschwindigkeitsklassen, AG-Folgen aus gleicher und unterschiedlicher Herkunft,
Nachtbonus, Mauer, Verteidigungskategorien, offizielle Minuten-pro-Feld-Werte,
Reserven, Fristen, Doppelbelegung, angegriffene Quelldörfer, Restlücken, mobile
Einzel-Ausweichfenster, Zusammenfassung innerhalb der Abbruchfrist,
Unterstützung bei Rückkehrkonflikten, sichere eigene Ausweichziele,
Barbaren-Weltkartenauswahl, Abbruch- und Stärke-Fallback, den
Unterstützungs-Lebenszyklus sowie das gemeinsame Auslagern von Off und AG ab.
Zusätzlich existieren lokale
HTML-Fixtures für Eingehende, unveränderte native Inline-Umbenennung, Rücksendung und
Versammlungsplatz; damit wurden automatischer Bestands- und Mauerabruf,
Planerstellung, Persistenz, individuelle Löschung, Formularbefüllung und die
Stabilität über periodische Aktualisierungen geprüft. Geöffnete Detailzeilen und der
Fokus der Statusauswahl bleiben bei reinen Restzeit-Aktualisierungen erhalten.

## Fachliche und technische Grenzen

- Wachturminformationen existieren nur, wenn der Angriff rechtzeitig in den
  Erkennungsradius gelangt und die Welt das Gebäude verwendet.
- Eine Laufzeitklassifikation ist nur möglich, wenn die Seite eine belastbare
  Gesamtlaufzeit enthält. Andernfalls bleibt der Einheitentyp unbekannt.
- Truppenbestände sind Momentaufnahmen und können durch zwischenzeitliche
  Befehle veralten.
- Die Weltkarte liefert Punkte, aber keine aktuelle Truppenbelegung eines
  Barbarendorfs. Ein bewusst durchlaufender Angriff wird deshalb nur oberhalb
  der konservativen Stärke- und Punkteschwellen freigegeben, bleibt aber eine
  Planannahme und kein Kampfsimulatorergebnis.
- Browser-Benachrichtigungen laufen nur, solange eine Skriptseite geöffnet ist;
  Tampermonkey ist kein unabhängiger Hintergrunddienst.
- Nachtzeiten werden in der lokalen Browserzeit interpretiert; bei einer vom
  Weltserver abweichenden Zeitzone muss die angezeigte Kennzeichnung geprüft
  werden.
- Die Seite von Die Stämme kann ihren HTML-Aufbau ändern. Erkennt das Skript
  Pflichtdaten nicht, bricht es mit einer sichtbaren Meldung ab, statt Werte zu
  erfinden.
