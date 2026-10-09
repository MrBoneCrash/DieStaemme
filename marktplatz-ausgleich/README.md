# Marktplatz-Ausgleich

> **Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.** Prüfe vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen. Fehler können zu Verlusten im Spiel oder zu Kontosanktionen führen.

## GitHub-Loader

Tampermonkey startet diesen Loader über die `@match`-Einträge ausschließlich auf folgenden Seiten: **Marktplatz**. Die Reihenfolge der URL-Parameter spielt dabei keine Rolle.

In Tampermonkey **Neues Script erstellen** auswählen, den vorhandenen Inhalt durch den folgenden Loader ersetzen und speichern. Das Beispiel ist für dieses Skript fertig eingerichtet; du musst keine URL ändern. Eine zuvor direkt installierte Variante desselben Skripts deaktivieren, damit es nicht doppelt läuft.

Bei jedem vollständigen Aufruf einer dieser Seiten wird die aktuelle auf GitHub veröffentlichte Version aus `master` geladen. Für ein Update eine bereits geöffnete Spielseite neu laden. GitHubs Bereitstellung kann kurz verzögert sein.

```javascript
// ==UserScript==
// @name         Die Stämme – Marktplatz-Ausgleich (GitHub-Loader)
// @namespace    local.die-staemme.loader.marktplatz-ausgleich
// @version      1.0.1
// @description  Lädt die aktuelle GitHub-Version. Nutzung auf eigene Gefahr.
// @match        https://*.die-staemme.de/game.php?screen=market
// @match        https://*.die-staemme.de/game.php?screen=market&*
// @match        https://*.die-staemme.de/game.php?*&screen=market
// @match        https://*.die-staemme.de/game.php?*&screen=market&*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

// Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.
(() => {
    const url = 'https://raw.githubusercontent.com/MrBoneCrash/DieStaemme/master/marktplatz-ausgleich/marktplatz-ausgleich.user.js';
    fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
        })
        .then(code => new Function(code)())
        .catch(error => console.error('[Marktplatz-Ausgleich] Laden fehlgeschlagen:', error));
})();
```

Ohne erreichbares GitHub startet keine gespeicherte Ersatzversion. Ladefehler stehen in der Browserkonsole. **Die Nutzung erfolgt auf eigene Gefahr; auch zukünftige Änderungen aus `master` werden automatisch ausgeführt.**

`marktplatz-ausgleich.user.js` ist ein eigenständiges Tampermonkey-Userscript.
Es erscheint nur auf dem Marktplatz von **Die Stämme**.

## Installation und Bedienung

1. Eine neue Tampermonkey-Skriptdatei mit dem vollständigen Inhalt von
   `marktplatz-ausgleich.user.js` anlegen.
2. Im Spiel den Marktplatz öffnen und **Dörfer laden**
   anklicken. Die Rohstoffbestände kommen aus der Produktionsübersicht; die
   Marktdaten werden für die ausgewählten Dörfer getrennt gelesen. Die
   Rohstoffwerte werden unabhängig von ihrer Speicher-Warnklasse gelesen.
   Fehlt ein Übersichtswert,
   bleibt das Dorf in der Auswahl; beim Planen wird sein Marktbestand geprüft.
   Bei weniger erkannten Dörfern als laut Spielerkonto wird das Laden abgebrochen.
3. Dörfer bei Bedarf abwählen. Die Auswahl bleibt pro Welt und Spieler lokal
   gespeichert. Standardmäßig sind alle gefundenen Dörfer ausgewählt.
4. **Einstellungen** öffnen und die drei Regler unter **Zielverteilung** einstellen. Ihre Anteile ergeben
   zusammen immer 100 %. **Gleich verteilen** setzt sie auf ungefähr je ein
   Drittel. Für mehr Holz beispielsweise 50 % Holz und je 25 % Lehm und Eisen
   wählen. Die Regler gelten jeweils pro Dorf.
5. Im selben aufklappbaren Bereich bei Bedarf Mindestreserven, Tauschmengen
   oder Gruppenlimits ändern. Die Werte werden pro Welt und Spieler lokal
   gespeichert. Das Fragezeichen neben jeder
   Einstellung zeigt eine kurze Erklärung mit Beispiel; es lässt sich auch
   per Tastatur fokussieren.
6. Einen Modus auswählen: **Gleichverteilung**, **Ausbau**, **AG-Push** oder **Truppen-Push**.
   Unter Einstellungen die maximale einfache Händlerlaufzeit für Cluster festlegen.
   **Ausgleich vorbereiten** anklicken und die Vorschau prüfen. In der Dorfliste
   erscheinen danach freie und verplante Händler, bereits erwartete Rohstoffe
   aus eingehenden Transporten und optional offenen eigenen Angeboten sowie
   die noch geplanten Abgaben und Eingänge. Nach jedem Klick wird die
   verbleibende Vorschau aktualisiert. Vor der Berechnung stehen dort Striche.
7. Zunächst jede gewünschte **Lieferung senden** anklicken. Je Dorfpaar werden die
   Mengen zu einer Lieferung zusammengefasst. Ein Klick liest das native Formular,
   öffnet dessen Bestätigung und bestätigt genau diesen Transport. Die Marktgruppen
   bleiben bis zum Abschluss aller vorgesehenen eigenen Lieferungen gesperrt.
8. Pro gewünschter Marktzeile **Gruppe einstellen** beziehungsweise **Gruppe handeln**
   anklicken. Ein Klick sendet höchstens eine native Marktaktion. Ist die
   Fremdangebot-Option aktiv und ein Angebot mit exakt denselben Rohstoffen und
   Einzelmengen vorhanden, wird es angenommen. Reicht dessen Verfügbarkeit
   nur für einen Teil der Gruppe, bleibt der Rest für einen weiteren Klick
   stehen. Andernfalls erstellt das Skript eigene Angebote über das native
   Formular mit dem Feld `multi`.

Das Skript führt beim Laden und Planen keine Handelsaktion aus. Es stellt
keine Angebote zeitgesteuert ein und bearbeitet keine Zeile ohne ihren eigenen
Klick. Nach einem Klick prüft es die aktuellen Rohstoffe und verfügbaren
Händler erneut. Eine unklare Antwort wird nicht
automatisch wiederholt; die eigene Angebotsliste muss dann geprüft werden.
Mehrere Gruppen derselben Vorschau können nacheinander eingestellt werden.
Der vom Spiel angezeigte Lagerbestand enthält die Abgabe zuvor eingestellter
Angebote bereits nicht mehr und wird deshalb nicht nochmals um diese Abgabe
verringert. Wenn zwischendurch andere Ausgaben das Dorf verändern, kann eine
noch offene Gruppe weiterhin eine neue Vorschau benötigen.

## Einstellbare Werte

| Einstellung | Wirkung |
| --- | --- |
| Modus | Genau ein Ziel für den eigenen Dorfausgleich; wird gespeichert |
| Empfängervorlagen | Im Truppen-Push erhalten Dörfer mit einer zugewiesenen ausgewählten Rekrutierungsvorlage Ressourcen; die Auswahl wird gespeichert |
| Cluster-Laufzeit | Maximale geschätzte einfache Laufzeit zwischen allen Dörfern eines Clusters |
| Clusterübergreifend ausgleichen | Erlaubt bei fehlender lokaler Deckung weiter entfernte Dörfer; standardmäßig aus |
| Zielanteil je Rohstoff | Angestrebte prozentuale Verteilung pro Dorf |
| Reserve je Rohstoff | Unter diesen Bestand wird keine Ressource angeboten |
| Anbieten/Fordern je Angebot | Tauschkurs und Menge eines einzelnen Angebots |
| Mindestabweichung | Kleine Abweichungen werden übersprungen |
| Angebote je Gruppe | Obergrenze für das native `multi`-Feld |
| Gruppen je Dorf | Obergrenze verschiedener Tauschkombinationen in einer Vorschau |
| Max. Handelsdauer | Begrenzt die Suche nach fremden Angeboten und wird an `max_time` übergeben, falls das Formular dieses Feld besitzt |
| Offene eigene Angebote einplanen | Zählt die geforderten Rohstoffe offener Angebote als erwarteten Eingang |
| Exakt passende Fremdangebote bevorzugen | Sucht beim Klick ein Angebot mit denselben Einzelmengen und nimmt es statt eines eigenen an; standardmäßig aus |

Eigene Lieferungen lesen die verfügbare Transportkapazität aus dem Markt;
ohne Kapazitätsangabe werden 1000 Rohstoffe pro Händler angenommen.
Für öffentliche Angebote berechnet der Plan konservativ
`ceil(Anbieten je Angebot / 1000)` Händler pro Angebot. Die Zielverteilung
verwendet den aktuellen Lagerbestand plus eingehende Transporte. Offene eigene
Angebote können zusätzlich als erwartete Eingänge zählen; sie sind bis zum
Kauf nicht garantiert. Diese erwarteten Mengen dürfen vor ihrer Ankunft nicht
erneut angeboten werden. Die Transportmengen werden möglichst aus der
Statusleiste des Marktplatzes gelesen. Falls sie dort fehlt, liest das Skript
**Marktplatz → Transporte → Eingehende Transporte**. Die Dorfseiten werden
nacheinander mit Abstand abgerufen. Meldet der Spielserver **HTTP 429**
(zu viele Anfragen), wartet das Skript vor einem einmaligen erneuten Versuch.
Bleibt ein ausgewähltes Dorf unlesbar, wird keine unvollständige Vorschau
freigegeben. Nach einer 429-Meldung sollte man später erneut auf
**Ausgleich vorbereiten** klicken. Dieser Klick liest alle aktuellen Werte neu ein.

## Eigene Dörfer zuerst

**Gleichverteilung** verteilt jeden Rohstoff innerhalb der Cluster möglichst gleich.
Kurze Wege werden zuerst verwendet. Bereits unterwegs befindliche und optional
am Markt geforderte Mengen zählen zum Zielbestand; abgegebene Angebotsmengen sind
bereits vom Lagerbestand abgezogen und werden nicht doppelt abgezogen.

**Ausbau** liest aktive AM-Vorlagenzuordnungen, die zugehörigen absoluten Baustufen
und aktuelle Kosten sowie die laufende Warteschlange im Hauptgebäude. Bereits
eingereihte Stufen werden übersprungen. Es werden bis zu zwei nächste Bauten
geprüft, einschließlich Voraussetzungen und freier Bevölkerung. Zuerst wird ein
vollständiger Bau in verschiedenen Dörfern finanziert; danach ein zweiter Bau im
selben Dorf. Kurze beziehungsweise leere Bauwarteschlangen und kleinere fehlende
Mengen werden bevorzugt. Gesicherte Bauvorräte bleiben vor Abgaben geschützt.
Nicht zweckgebundene Überschüsse gehen anschließend in die Gleichverteilung.
Das Skript baut selbst kein Gebäude.

Für einen finanzierbaren Bau zählen tatsächliche Lagerbestände, Produktion bis
zum geplanten Zeitpunkt und Transporte mit lesbarer Ankunftszeit. Offene Angebote
sind keine gesicherte Baufinanzierung. Der angezeigte Zeitpunkt ist eine Prognose;
AM-Ausgaben oder Rekrutierung während der Laufzeit können sie verändern.
Kosten einer zweiten Stufe werden aus den gelieferten Kostenfaktoren berechnet.
Nach einem geplanten Bauernhof wird ohne bestätigte Kapazitätsangabe keine
zusätzliche Bevölkerung für einen zweiten Bau vorausgesetzt.

**AG-Push** liest AG- und Münzkosten sowie das globale verbleibende AG-Limit aus
den Adelshofseiten. Wenn die Münzkosten im Tab „Erzeugen“ fehlen, wird zusätzlich
„Goldmünzen prägen“ gelesen. Auch das native Münzkosten-Datenobjekt wird ausgewertet,
ohne Seitenskripte auszuführen. Bei AG-Limit null sind fehlende AG-Kosten zulässig;
für weitere AG-Plätze müssen die tatsächlichen AG-Kosten lesbar sein.
Das AG-Limit wird aus der eigenständigen Beschriftungszeile gelesen;
äußere Layouttabellen mit darin verschachtelten Tabellen werden übersprungen.
Dörfer mit mindestens 100 freien Einwohnern können einen
vollständigen nächsten AG-Vorrat erhalten. Zusätzliche Überschüsse werden zu
Adelshöfen für Vorrat beziehungsweise Münzen geschickt, mit Reserve und
Speichergrenzen. Bei erreichtem AG-Limit gilt das Münzkostenverhältnis.
Das Skript rekrutiert keine AGs und prägt keine Münzen.

**Truppen-Push** liest die gespeicherten Vorlagen und Dorfzuordnungen aus
`truppenvorlagen.user.js`. Beide Skripte müssen im selben Browserprofil auf
demselben Spielserver, für dieselbe Welt und denselben Spieler laufen.
Zuerst im Rekrutierungsskript Vorlagen speichern und jedem gewünschten Dorf eine
Vorlage zuweisen. Im Marktmodus unter **Empfängervorlagen** beispielsweise „Off“
auswählen und „Deff“ abwählen. **Vorlagen neu lesen** übernimmt Änderungen aus
dem Rekrutierungsskript. Die Zuordnungen werden nur gelesen.
Der Adelshof entscheidet in diesem Modus nicht über die Empfänger.
Alle in der Dorfliste ausgewählten Dörfer können Ressourcen spenden, auch mit
abgewählter Empfängervorlage oder ohne Zuordnung.

Für jede Einheit gilt: Vorlagenmenge minus eigener Gesamtbestand (einschließlich
auswärtiger Truppen) minus laufende Rekrutierung. Bestände, Warteschlangen,
Rohstoffkosten und Bevölkerungskosten kommen aktuell aus der Rekrutierungsseite.
Nicht verfügbare Einheiten ohne Rekrutierungsfeld werden übersprungen.
Das Skript finanziert vollständige Einheitenpakete möglichst im Mengenverhältnis
der Vorlage. Es bevorzugt größere finanzierbare Pakete und kurze Wege; die
Planung ist eine Heuristik und garantiert kein mathematisches Gesamtmaximum.
Reserven, Händler, Speicher, Cluster und freie Bauernhofplätze begrenzen die
Lieferungen. Zukünftige Bauernhofausbauten schaffen in der Planung keine
zusätzlichen Plätze. Unvollständig finanzierbare Pakete lösen keine Lieferung aus.

Produktion und Transporte mit lesbarer Ankunftszeit zählen bis zum geplanten
Zeitpunkt; offene Marktangebote sind keine gesicherte Finanzierung.
Bereits finanzierte Truppenvorräte bleiben vor Abgaben und öffentlichen
Marktangeboten geschützt. Deren Zielverhältnis wird für Empfängerdörfer aus den
Kosten der noch fehlenden Vorlageneinheiten abgeleitet.
Die Vorschau zeigt die finanzierbaren Einheiten; der Tooltip am Dorfnamen zeigt
Soll, Bestand, Warteschlange und Fehlmenge. Vor dem Versand werden auch die
freien Bauernhofplätze erneut geprüft. Zwischenzeitliche Rekrutierung oder
andere Ausgaben können eine neue Vorschau nötig machen.
Das Skript rekrutiert keine Truppen; jede eigene Lieferung benötigt ihren Klick.

Bei gegenseitigen Lieferungen wird vor dem Versand zwischen vorhandenem Vorrat
und späterer Finanzierung unterschieden. Die Versandprüfung berücksichtigt
aktuelle eingehende Transporte, noch geplante eigene Eingänge und die bereits
eingeplante Produktion. Der vorhandene geschützte Vorrat und die eingestellte
Reserve bleiben erhalten. Nach Ankunft der Eingänge wird entsprechend mehr
vom vollständigen Zielvorrat geschützt; öffentliche Angebote verwenden weiterhin
den vollständigen geschützten Vorrat.

Laufzeiten werden aus Koordinaten und Weltgeschwindigkeit geschätzt. Besondere
Transportboni sind in dieser Schätzung nicht enthalten; vor dem endgültigen
Versand wird die native Laufzeit geprüft.
Die Laufzeiterkennung liest im bestätigten Transportformular die eigenständige
Zeile „Dauer (Hin- und Rückweg jeweils):“, „Dauer“ oder „Laufzeit“.
Der Wert bezeichnet die einfache Laufzeit; er wird nicht halbiert.
Layouttabellen und der Suchfilter für Marktdauer werden übersprungen.
Eine unlesbare Bestätigung und eine überschrittene Cluster-Grenze erhalten
getrennte Fehlermeldungen; bei Grenzüberschreitung wird die tatsächliche Laufzeit angezeigt.
Reserven, Speicher inklusive Produktion
und eingehender Transporte sowie Händler für alle noch offenen Abgaben werden
erneut geprüft. Bei einer unklaren Versandantwort sperrt das Skript die Vorschau.
Eine ausdrückliche Spielbestätigung bleibt gültig, wenn nur die anschließende
Bestandsabfrage fehlschlägt. Die Lieferung wird dann abgeschlossen, die Anzeige
konservativ aus den vor dem Versand gelesenen Werten berechnet und ein Hinweis
angezeigt. Vor der nächsten Aktion werden die aktuellen Bestände erneut gelesen.
Zum Lesen von Marktbeständen ist kein öffentliches Angebotsformular erforderlich.
Ohne Spielbestätigung und ohne eindeutige Bestandsänderung bleibt die Vorschau
gesperrt: zuerst die Transporte im Spiel prüfen und danach neu planen.

Das Skript nutzt die Formularstruktur der deutschen Browserversion. Ändert
das Spiel die Formularfelder, bricht das Skript vor dem Absenden ab. Die
Erkennung für Transporte und fremde Angebote wurde an gespeicherten Seiten
aus Welt 256 ausgerichtet. Die tatsächliche Formularantwort auf der Live-Welt
ist lokal nicht geprüft. Die finale Transportbestätigung wurde anhand der
gespeicherten Seite `SendenBestätigung..html` angepasst und mit ihrer Formularstruktur
lokal geprüft; bei einer abweichenden Struktur wird vor
dem endgültigen Versand abgebrochen. Teste zunächst eine kleine Lieferung und kontrolliere
danach **Eigene Angebote** beziehungsweise **Transporte**.

## Lokale Prüfung

Die Befehle werden im Repository-Hauptordner ausgeführt. Der Ordner `test` bleibt lokal und ist nicht Bestandteil der Veröffentlichung. Die Testbefehle setzen diese lokalen Dateien voraus.

```powershell
node --check marktplatz-ausgleich/marktplatz-ausgleich.user.js
node --test test/marktplatz-ausgleich.core.test.cjs
```

Die aktuellen Regeln für externe Skripte deiner Welt gelten auch hier. Die
offizielle [Spielhilfe zum Marktplatz](https://support.innogames.com/kb/TribalWars/de_DE/1265/Was-ist-der-Marktplatz-und-wie-wird-gehandelt)
beschreibt öffentliche Angebote und die Händlerkapazität.
