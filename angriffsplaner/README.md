# Die Stämme – Angriffsplaner

> **Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.** Prüfe vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen. Fehler können zu Verlusten im Spiel oder zu Kontosanktionen führen.

## GitHub-Loader

In Tampermonkey **Neues Script erstellen** auswählen, den vorhandenen Inhalt durch den folgenden Loader ersetzen und speichern. Das Beispiel ist für dieses Skript fertig eingerichtet; du musst keine URL ändern. Eine zuvor direkt installierte Variante desselben Skripts deaktivieren, damit es nicht doppelt läuft.

Bei jedem vollständigen Seitenaufruf wird die aktuelle auf GitHub veröffentlichte Version aus `master` geladen. Für ein Update eine bereits geöffnete Spielseite neu laden. GitHubs Bereitstellung kann kurz verzögert sein.

```javascript
// ==UserScript==
// @name         Die Stämme – Angriffsplaner (GitHub-Loader)
// @namespace    local.die-staemme.loader.angriffsplaner
// @version      1.0.0
// @description  Lädt die aktuelle GitHub-Version. Nutzung auf eigene Gefahr.
// @match        https://*.die-staemme.de/game.php*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      twforge.net
// @run-at       document-idle
// @noframes
// ==/UserScript==

// Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.
(() => {
    const url = 'https://raw.githubusercontent.com/MrBoneCrash/DieStaemme/master/angriffsplaner/angriffsplaner.user.js';
    const fail = error => console.error('[Angriffsplaner] Laden fehlgeschlagen:', error);
    GM_xmlhttpRequest({
        method: 'GET',
        url: `${url}?t=${Date.now()}`,
        nocache: true,
        anonymous: true,
        timeout: 20000,
        onload(response) {
            if (response.status !== 200) {
                fail(`HTTP ${response.status}`);
                return;
            }
            try {
                new Function('window', 'unsafeWindow', 'game_data', 'GM_xmlhttpRequest',
                    response.responseText)(unsafeWindow, unsafeWindow,
                    unsafeWindow.game_data, GM_xmlhttpRequest);
            } catch (error) {
                fail(error);
            }
        },
        onerror: () => fail('Netzwerkfehler'),
        ontimeout: () => fail('Zeitüberschreitung')
    });
})();
```

Die Anfrageberechtigung für `raw.githubusercontent.com` lädt die Datei; `twforge.net` wird für TWForge-Berichte benötigt. Erlaube diese Domains, wenn Tampermonkey danach fragt.

Ohne erreichbares GitHub startet keine gespeicherte Ersatzversion. Ladefehler stehen in der Browserkonsole. **Die Nutzung erfolgt auf eigene Gefahr; auch zukünftige Änderungen aus `master` werden automatisch ausgeführt.**

`angriffsplaner.user.js` ist ein eigenständiges Tampermonkey-Userscript. Es öffnet
im **Versammlungsplatz** (`screen=place`) einen Planer im Design des Einzelziel-Snipe-Skripts.
Er startet bei jedem Öffnen der Seite vollständig eingeklappt, auch bei der Rückkehr
über den Browser-Verlauf. Auf anderen Spielseiten wird er nicht angezeigt.
Welt, Spieler, Einheitenwerte, Laufzeiten, Fake-Mindestgröße und Nachtbonus werden
aus der aktuellen deutschen Welt ermittelt. Das Skript erstellt einen Plan und
einen DS-Util / DS-Workbench-Importcode. Es schickt keine Angriffe ab.

## Installation und Bedienung

1. Den Inhalt von `angriffsplaner.user.js` als neues Skript in Tampermonkey
   speichern. Die Berechtigung für `twforge.net` wird für die Berichtsanalyse benötigt.
2. Den **Versammlungsplatz** öffnen. Oberhalb des bisherigen Seiteninhalts steht die
   eingeklappte Leiste **Angriffsplaner**. Zum Benutzen die Leiste anklicken.
3. Ziele eingeben: Spielernamen, Stammnamen/-Tags und Dorfkoordinaten, getrennt durch Zeilenumbrüche,
   Kommas oder Semikolons. Namen mit Leerzeichen bleiben erhalten. Spielernamen
   werden während der Eingabe gegen die Weltdaten geprüft; alle Dörfer des Spielers
   werden Ziele. Stammnamen oder Tags (auch `[TAG]`) kommen direkt in dasselbe
   Textfeld und ergänzen alle Spieler und deren Dörfer aus `/map/ally.txt` und `/map/player.txt`.
   Mehrere Stämme sind möglich. Doppelte Ziele werden zusammengeführt. Eigene Dörfer sind keine Ziele.
4. Fake-Prozentsatz per Slider wählen. Der Anteil bezieht sich auf **Angriffsbefehle**,
   nicht auf Truppen oder Ziele. Er ist ein **Wunschverhältnis für die anfängliche
   Angriffszahl**. Alle unter diesen Einstellungen möglichen Offs werden zuerst
   reserviert, soweit die gewählte Gesamtzahl reicht. Erhöhen der Anzahl ergänzt
   Fakes, ohne Offs zu verdrängen. Ohne Offs entstehen nur Fakes. Die tatsächliche
   Verteilung steht bereits vor dem Erstellen in der berechneten Vorschau.
   **100 % Fakes** ist die ausdrückliche Auswahl eines reinen Fake-Plans.
5. Optional eine Off-Vorlage aus `truppenvorlagen.user.js` wählen. Verwendet wird dessen
   lokaler Vorlagenspeicher für denselben Host, dieselbe Welt und denselben Spieler.
6. Quelldörfer auswählen und bei Bedarf ihre Rolle auf **Nur Offs** oder **Nur Fakes**
   setzen. Der Suchfilter verändert die Auswahl nicht. **Alle** und **Keine** gelten
   für die gesamte Dorfmenge, einschließlich gerade ausgefilterter Dörfer.
   Die **Mindest-Off-Mengen** werden je Einheit eingegeben, standardmäßig
   1.000 Äxte und 0 bei den anderen Einheiten. Alle positiven Mindestmengen müssen
   gleichzeitig erfüllt werden; 0 bedeutet keine Mindestvorgabe. Die Mengen sind
   ausschließlich eine Eignungsgrenze, **keine Versandgröße**. Kleinere Bestände stehen für Fakes zur Verfügung, auch bei einem
   zuvor als Off-Dorf markierten Quelldorf. Ebenso dürfen unzureichende Off-Dörfer
   fehlende Offs durch Fakes ersetzen.
7. Unter **Zeitfenster & Berichtseinstellungen** optional den Abschickzeitraum,
   den Ankunftszeitraum oder beide begrenzen. Zeitformat: `TT.MM.JJJJ HH:MM:SS`.
   Zeiten beziehen sich auf `Europe/Berlin`, einschließlich Sommer-/Winterzeit.
   Die Felder sind bei jedem Seitenaufruf frisch vorbelegt: Abschicken ab fünf
   Minuten nach der aktuellen Serverzeit für eine Stunde; Ankunft zunächst sechs
   Stunden später, bei Bedarf auf das Ende des Nachtbonus verschoben. Der
   Ankunftsbereich dauert bis zu eine Stunde und endet vor einem neuen Nachtbonus.
   Beide Begrenzungen starten deaktiviert und lassen sich an den Plan anpassen.
8. **Kapazität berechnen** aktualisiert die Bestände der gewählten Dörfer, liest
   Berichte und berechnet die unter diesen Einstellungen erreichbare Angriffszahl.
   Angezeigt werden die erreichbare Gesamtzahl und die tatsächliche Off-Kapazität.
   Anschließend die gewünschte Anzahl per zweitem Slider wählen. Jede Änderung
   aktualisiert zunächst nur die Anzeige. **Erst beim Loslassen des Sliders**
   (dem `change`-Ereignis, ebenso bei Tastaturbedienung) startet die neue Vorschau im Worker; bis zu deren Abschluss bleibt
   **Plan erstellen** gesperrt. Der Knopf übernimmt genau diese Vorschau.
9. **Plan erstellen** zeigt Truppen, Quell- und Zieldorf, Abschickzeit und Ankunft
   für jeden Befehl. **WB kopieren** kopiert alle ausgewählten, noch abschickbaren
   Befehle; jede Zeile hat zusätzlich einen eigenen Kopierknopf. Bei gesperrter
   Zwischenablage steht der Code in einem Textfeld zum manuellen Kopieren bereit.

Nach der Planung stehen unter **Ansicht** drei Darstellungen zur Verfügung:

- **Zeitliste:** alle Befehle nach Abschickzeit, mit Truppen und Ankunft.
- **Quelldorf → seine Ziele:** aufklappbare Gruppen je gewähltem eigenen Dorf,
  mit seinen Zielen, Anzahl Offs/Fakes sowie Abschick- und Ankunftsbereich.
- **Zieldorf ← seine Angreifer:** aufklappbare Gruppen je Zieldorf, mit den
  angreifenden Quelldörfern, Anzahl Offs/Fakes sowie beiden Zeitbereichen.

Auch Quellen und Ziele ohne Befehle sind in den Gruppen sichtbar. Gruppen zählen
alle geplanten Befehle; die Checkboxen bestimmen den WB-Export. Die Auswahl bleibt
beim Wechsel der Ansicht erhalten, ebenso die Kennzeichnung abgelaufener Befehle.
Die zuletzt gewählte Ansicht wird mit den übrigen Einstellungen gespeichert.

Einstellungen einschließlich Ziele und Stämme, Verhältnis, Mindest-Off-Mengen, Vorlage,
Berichtsalter, Kraftreserve, globalem Abschickabstand, Dorfwahl/-rollen, gewählter
Angriffszahl und API-Schlüssel werden direkt beim Ändern lokal gespeichert,
getrennt nach Host, Welt und Spieler. **Zeiträume und ihre Aktivierungscheckboxen
werden nicht gespeichert** und beim nächsten Seitenaufruf frisch initialisiert.

## Eigene Bestände und Fake-Mindestgröße

Die eigene Dorfmenge kommt aus `/map/village.txt`, gefiltert nach der angemeldeten
Spieler-ID. Das aktuelle Dorf wird bei Bedarf aus `game_data` ergänzt, wenn es noch
nicht in der stündlich aktualisierten Karte steht. Die abschickbaren Truppen kommen
aus dem **Versammlungsplatz jedes Quelldorfs**, nicht aus Gesamtbeständen einschließlich
auswärtiger Truppen oder fremder Unterstützung. Die Abfragen laufen mit höchstens
zwei parallelen gleichursprünglichen GET-Anfragen. Bestände mit unlesbaren Werten
führen zu einem Fehler statt zu einer Schätzung.

Die Mindestgröße ist:

```text
max(1, aufrunden(Punkte des Quelldorfs × fake_limit / 100)) Bauernhofplätze
```

`fake_limit` kommt aus `/interface.php?func=get_config`; Bauernhofbedarf und
Einheitenwerte aus `/interface.php?func=get_unit_info`. Punkte werden aus der
aktuellen Dorfseite bevorzugt, andernfalls aus der Weltkarte übernommen. Ein Fake
enthält genau eine Ramme, bei fehlenden Rammen ein Katapult. Deren Bauernhofbedarf
zählt bereits zum Mindestwert. Der Rest wird vorrangig mit Spähern, danach mit
Speeren, Äxten, Schwertern, Bogenschützen und erst danach Kavallerie aufgefüllt.
Beispiel: Bei 10.001 Dorfpunkten und 1 % Limit braucht ein Fake 101 BH; eine Ramme
mit 5 BH und 48 Späher mit je 2 BH erfüllen das genau. Ohne Belagerungseinheit oder
ausreichenden Bestand entsteht kein Fake. Auch Offs müssen das Mindestlimit erfüllen.

Für jeden geplanten Befehl werden Truppen vom gemeinsamen Dorfbestand abgezogen.
Mehrere Befehle aus demselben Dorf verwenden unterschiedliche Truppen. Rückkehrende
Einheiten und zukünftige Rekrutierungen werden nicht vorweggenommen. Eine
Bestandsaufnahme wird nach fünf Minuten vor einer neuen Planung erneut verlangt.

## Offs, Vorlagen und taktische Verteilung

Offs enthalten Äxte, leichte Kavallerie, berittene Bogenschützen, Rammen und Katapulte.
Adelsgeschlechter, Paladin und defensive Einheiten werden nicht in echte Offs
aufgenommen. **Jedes Off-Quelldorf schickt höchstens eine Off auf ein Ziel.**
Dabei gehen alle verfügbaren Off-Einheiten in diesen Befehl, abzüglich der kleinen
Tarnfake-Reserve. Dies gilt unabhängig davon, ob ein aktueller Bericht vorhanden ist.
Offs werden niemals anhand schwacher berichteter Verteidigung aufgeteilt oder
auf die eingegebenen Mindestmengen verkleinert.

**BH bedeutet Bauernhofplätze**, also den Bevölkerungsbedarf der verwendeten
Einheiten. Die manuellen Mindest-Off-Mengen sind konkrete Stückzahlen jeder
offensiven Einheit des tatsächlichen Off-Befehls. Füllspäher oder Def-Truppen
ersetzen diese Einheiten nicht. Eine Off muss sowohl diese Mindestmengen als auch die weltseitige Fake-Mindestgröße
erfüllen. Zu kleine Restbestände werden nicht als kleine Off exportiert, sondern
stehen für weitere Fakes bereit, sofern Belagerungseinheiten und Fülltruppen reichen.

Bei bekannter Verteidigung wird die **Zieleignung** geprüft. Die gewählte
Rekrutierungsvorlage ist dabei eine **Stärkereferenz**, keine Versandgrößenvorgabe
und kein harter Filter nach Dorfzuordnungen: die verfügbare Off soll mindestens
10 % der Angriffskraft dieser Vorlage erreichen. Ohne Vorlage dient der verfügbare
Off-Bestand als Referenz. Die gesamte tatsächlich verfügbare Off bleibt in einem
Befehl. Benötigte Angriffskraft wird aus den gegen Infanterie, Kavallerie und
Bogenschützen gewichteten Verteidigungswerten geschätzt und mit der einstellbaren
Kraftreserve multipliziert. Zu schwache Quelldörfer werden für dieses Ziel übersprungen.

Offs bevorzugen Ziele mit aktuellen stationierten Truppen. Innerhalb dieser Gruppe
gilt **AG → Off → Deff**, dann die geschätzte erreichbare Verlustwirkung. Bereits
eingeplante Off-Kraft wird vom Verteidigungsbedarf des Ziels abgezogen, um denselben
Berichtsbestand nicht unbegrenzt erneut einzuplanen. Unbekannte Ziele bleiben
planbar; gegen bekannte leere oder bereits abgedeckte Bestände entstehen keine
weiteren Offs.

Fakes werden möglichst gleichmäßig auf **alle** Ziele verteilt, einschließlich
der Off-Ziele. Die Ergebniszeile zeigt, wie viele Ziele tatsächlich Fakes erhalten.
Reicht die gewählte Fake-Anzahl nicht für alle Ziele, werden keine zusätzlichen
Befehle erfunden. **Dasselbe Quell-Ziel-Paar erhält höchstens einen Fake.** Ein
Off-Quelldorf schickt seine Tarnfakes auf andere Ziele als seine eigenen Off-Ziele;
Off-Ziele können Fakes von anderen Quellen erhalten.
**Tarnfakes bevorzugen weitere Dörfer desselben Zielspielers**, damit dieser neben
der Off auch mehrere Befehle aus derselben Quelle sieht. Diese Bevorzugung geht vor
der zeitlichen Nähe und der gleichmäßigen Zielverteilung. Sind solche Verbindungen
nicht möglich oder bereits gefaked, werden andere Spieler als Ausweichziele genutzt.

Offs werden immer zuerst reserviert. Für Quellen mit der Rolle **Offs + Fakes**
bleiben nach Möglichkeit Belagerungseinheiten und günstige Fülltruppen für Tarnfakes
übrig. Diese Reservierung darf höchstens **5 % der verfügbaren Off-Angriffskraft**
kosten, erhält alle Mindestmengen und eine langsame Belagerungseinheit für die Off.
Wenn eine größere Fake-Reservierung die Off-Anzahl senkt, wird die Reservierung
auf einen Tarnfake reduziert. Die Ergebniszeile zeigt die Anzahl der Off-Dörfer,
die tatsächlich Tarnfakes liefern. Ohne genügend Truppen, alternative Ziele oder
zeitlich passende Verbindungen ist ein Tarnfake nicht garantiert.

Die Suche bevorzugt mehr Offs vor mehr Gesamtbefehlen. Engere Zeitfenster reduzieren
zuerst Fakes. Eine vollständige Fake-Auffüllung rechtfertigt keine verdrängte Off.
Die Reihenfolge gleichzeitiger Befehle wird durchmischt und ein Mindestabstand
zwischen **allen** Abschickzeiten eingehalten.

**Die Verlustwirkung ist eine Heuristik, kein exakter Kampfsimulator.** Wall, Moral,
Forschung, Kirche, Flaggen, Paladin-Gegenstände und weitere Sonderboni sind nicht
Teil dieser Stärkeabschätzung. Auch ein aktueller Bericht garantiert keinen
unveränderten Truppenbestand bei der Ankunft. Die Kraftreserve ist deshalb einstellbar.

## TWForge

Das API-Verfahren wurde im offiziellen DB-Info-Skript nachvollzogen:
[723_DB_Info_SxR_suilenrocm_MKich_Osse.js](https://media.innogames.com/com_DS_DE/Scriptdatenbank/userscript_main/723_DB_Info_SxR_suilenrocm_MKich_Osse.js).
Der Planer lädt dieses Fremdskript nicht nach. Er verwendet nur dessen
Berichtsschnittstelle:

```text
POST https://twforge.net/api/db-info/userscript?action=tribalwars&world=<aktuelle Welt>
Felder: Key, X, Y
```

Der Schlüssel wird aus `localStorage.dbkey` des vorhandenen DB-Info-Skripts gelesen.
Alternativ lässt er sich im Planer eingeben; eingegebene Schlüssel werden zusammen
mit den Einstellungen lokal gespeichert, aber niemals exportiert oder an den
Planungs-Worker weitergegeben. Die Anfrage geht ausschließlich an den festen
TWForge-Endpunkt. `serverConfig`-URLs aus anderen Skripten werden nicht übernommen.
Für die TWForge-Anfrage verwendet Tampermonkey `GM_xmlhttpRequest`; ein reines
Schnellleistenskript ohne diese Berechtigung reicht für die DB-Abfrage nicht aus.

Die Anfrage verwendet ein explizit serialisiertes **Multipart-Formular** mit `Key`,
`X` und `Y`, wie das Referenzskript. Body und passender Boundary-Header werden
gemeinsam erstellt, damit Unterschiede der FormData-Übertragung zwischen
Userscript-Managern die Parameter nicht beschädigen.
Zusätzlich sendet die Anfrage **`Origin: https://<aktuelle Spielwelt>.die-staemme.de`**,
aus `location.origin`. Im offiziellen Skript entsteht dieser Header automatisch
durch die native `XMLHttpRequest`-Anfrage aus der Spielseite. Der Planer setzt ihn
für `GM_xmlhttpRequest` ausdrücklich, da der Erweiterungskontext sonst keinen
Spiel-Origin sendet. TWForge benötigt diesen Header zur Weltzuordnung; der
URL-Parameter `world` allein reicht nicht.
Die vorherige URL-Formularcodierung wurde entfernt: Ein öffentlicher Test mit einem
absichtlich ungültigen Schlüssel lieferte damit HTTP 500, mit Multipart dagegen
die erwartete Authentifizierungsablehnung HTTP 403. **TWForge-Verbindung prüfen**
prüft den eingegebenen Schlüssel unabhängig von der Kapazitätsberechnung und zeigt
HTTP-/API-Fehlercodes oder eine erfolgreiche Verbindung an. Eine erfolgreiche
Verbindung bedeutet nicht, dass für das abgefragte Dorf ein aktueller Bericht existiert.

`HTTP 403 · COMMON-6` ist eine vom TWForge-Server abgelehnte Authentifizierung.
`HTTP 400 · COMMON-1` weist auf abgelehnte Anfrageparameter hin. Bekannte betroffene
Feldnamen werden angezeigt; Servertexte oder abgelehnte Werte werden niemals
ausgegeben, damit darin enthaltene Schlüssel nicht sichtbar werden. Der Multipart-
Aufbau wurde am echten Endpunkt mit einem absichtlich ungültigen Testschlüssel
geprüft (HTTP 403 / COMMON-6).

Am 09.10.2026 wurde die Ursache mit dem vom Nutzer bereitgestellten Schlüssel
auf `de256` eingegrenzt: Ohne `Origin` lieferte TWForge HTTP 400 / COMMON-1 mit
`rejectedArguments.path = world`. Ein `Referer`-Header allein änderte dies nicht.
Mit dem Spiel-Origin und tatsächlich existierenden Dorfkoordinaten aus der
öffentlichen Weltkarte lieferte der Server **HTTP 200** und das erwartete
DB-Info-Antwortformat. Dies wurde sowohl für native FormData als auch für das
explizite Multipart des Planers geprüft. Die frühere Vermutung einer fehlerhaften
TWForge-Weltzuordnung ist damit korrigiert. Der Schlüssel wurde nicht in Dateien gespeichert.
Andere Welt- oder Zugriffsfehler werden weiterhin konkret angezeigt und beenden
weitere DB-Abfragen.

Aus der Antwort werden nur Zeitstempel, Berichts-ID, Dorftyp und Einheitendaten
übernommen. Eingehende Befehle, sonstige Datenbankinformationen und der Rohbericht
werden nicht gespeichert. Der aktuellste gültige stationierte Bestand wird aus
`unit_time` / direkten Einheitendaten oder `defend_report.fighttime` / Einheitendaten
ermittelt. Bekannte `loss_<einheit>` werden abgezogen.

`attack_report` belegt die vom Ziel auswärts verwendeten eigenen Angriffstruppen.
Diese werden **nicht als stationierte Verteidigung** eingerechnet. Ein dort belegtes
AG oder eine Off kann zur Zielklassifizierung beitragen; auswärtige AG sind im
Ergebnis entsprechend bezeichnet. Berichte mit unbekannten Einheitenmengen,
ungültigen Verlustzahlen, zukünftigen Zeiten oder überschrittenem Höchstalter werden
nicht als aktuelle Bestandsgrundlage behandelt. Das Höchstalter ist in Tagen einstellbar.

Ohne aktuellen Bericht bleibt das Ziel im Plan. Verbindungsfehler werden gezählt
und die betroffenen Ziele als unbekannt behandelt. Eine abgelehnte Authentifizierung
stoppt die Berechnung mit einem sichtbaren Hinweis, damit ein ungültiger Schlüssel
nicht unbemerkt eine vermeintlich berichtsgestützte Planung erzeugt. Die DB-Nutzung
kann explizit abgeschaltet werden. Scheitern sämtliche Abfragen, wird die Berechnung
mit dem letzten konkreten Fehler beendet, statt unbemerkt ohne Berichte fortzufahren.

## Zeiten und Optimierung

Der Nachtbonus gilt für die **Ankunft**. Aktivierung und Stunden werden aus der
Weltkonfiguration gelesen. Das Ende des Nachtbonus ist zulässig, sein Beginn nicht.
Eine Ankunft wird nur gewählt, wenn sie zugleich zum Abschickfenster und zum
Ankunftsfenster passt. Die langsamste Einheit des tatsächlichen Befehls bestimmt
die Laufzeit, gerundet auf volle Sekunden wie beim Einzelziel-Snipe-Skript.

Ohne vorgegebene Fenster beginnt die Suche mit zwei Minuten Vorlauf und einem
Planungshorizont von 30 Tagen für das Abschicken. Gewählte Fenster dürfen höchstens
31 Tage umfassen. Laufzeitbedingte Ankünfte können entsprechend später liegen.
Die Optimierung vergleicht mehrere Laufzeitanker mit fester Off-Priorität
und sowohl gebündelte Ankünfte als auch gebündelte Abschickzeiten. Bewertet wird
die Summe beider Zeitspannen, bei Gleichstand die kleinere Ankunftsspanne.

Der Abstand gilt für den **gesamten Plan**, auch beim Wechsel zwischen Quelldörfern.
Er beträgt mindestens eine Sekunde und mindestens den weltseitigen Angriffsabstand.
Das Ergebnis bleibt nach Abschickzeit sortiert.
Abgelaufene Befehle werden sichtbar markiert und sind nicht mehr exportierbar.
Änderungen an Zielen, Verhältnis, Rollen, Vorlagen oder Zeitfenstern verwerfen alte
Ergebnisse und erfordern eine erneute Kapazitätsberechnung.

Die angezeigte Kapazität ist die höchste von der verwendeten Suche gefundene,
vollständig planbare Anzahl für reservierte Offs, eindeutige Fake-Paare, Bestände und Fenster. Fehlende
Offs begrenzen die Fake-Kapazität nicht auf einen festen Prozentsatz. Sie ist kein
Beweis für ein globales mathematisches Optimum aller Zuordnungen. Die Suche ist
für große Konten auf 20.000 Befehle begrenzt; bei Erreichen der Rechengrenze wird
dies angezeigt. Die Berechnung läuft in einem Web Worker, während die Spielseite
bedienbar bleibt, und lässt sich über **Berechnung abbrechen** stoppen.
Engere Zeitfenster, Rollen und fehlende Truppen können die
Kapazität deutlich unter das reine Truppenmaximum senken.

## WB-Format

Wie beim Einzelziel-Snipe:

```text
Quell-ID&Ziel-ID&langsamste_Einheit&Ankunft_in_ms&Typ&false&false&Einheit=Base64(Menge)/Einheit=Base64(Menge)&1
```

Die Befehle werden mit echten Zeilenumbrüchen getrennt. Offs tragen Typ `2`,
Fakes ausdrücklich Typ `14`, auch wenn eine Ramme oder ein Katapult enthalten ist.
Die Typwerte sind anhand von `Attack.CLEAN_TYPE` / `Attack.FAKE_TYPE`, den
zugehörigen `StandardAttack`-Symbolen sowie `ImageManager.NOTE_SYMBOL_AXE` /
`ImageManager.NOTE_SYMBOL_FAKE` im
[DS-Workbench-Quellcode](https://github.com/Torridity/dsworkbench/blob/master/Core/src/main/java/de/tor/tribes/ui/ImageManager.java)
abgeglichen.
Alle Mengen sind konkrete reservierte Bestände. Der WB-Code enthält keinen
API-Schlüssel und keine vollständigen Berichte.

## Prüfung

Die Befehle werden im Repository-Hauptordner ausgeführt. Der Ordner `test` bleibt lokal und ist nicht Bestandteil der Veröffentlichung. Die Testbefehle setzen diese lokalen Dateien voraus.

```powershell
node --check angriffsplaner/angriffsplaner.user.js
node --test test/angriffsplaner.core.test.cjs
node test/angriffsplaner.browser.cjs
```

Für den Browsertest werden Playwright und Microsoft Edge benötigt. Bei der
gebündelten Playwright-Installation dessen Paketverzeichnis als `NODE_PATH` setzen.
Die Tests verwenden simulierte Spielseiten und TWForge-Antworten, keine Zugangsdaten
und keine Spielbefehle. Kern- und Browsertests prüfen Truppenreservierungen,
Fake-Mindestgrößen, Rollen, Zielvalidierung, Vorlagen, Berichtsalter und Verluste,
Zeitzonenwechsel, Nachtbonus, beide Zeitfenster, Kapazität, Worker, WB-Roundtrip,
Auswahl, Exportablauf sowie Desktop- und Mobildarstellung. Ein Regressionstest
plant 487 Befehle mit 146 verfügbaren Offs und prüft genau 146 Offs + 341 Fakes,
eindeutige Fake-Paare, Tarnfakes je Off-Dorf und höchstens 5 % Kraftverlust.
Screenshots liegen unter
`test/artifacts/angriffsplaner-desktop.png` und `test/artifacts/angriffsplaner-mobile.png`.

Die Welt-Endpunkte wurden öffentlich gelesen. Die TWForge-Schnittstelle wurde mit
dem bereitgestellten Schlüssel und den korrigierten Headern erfolgreich auf `de256`
abgefragt. Der Endpunkttest prüft die Anfrage und das Antwortformat; ein Test der
installierten Tampermonkey-Erweiterung im angemeldeten Spielaccount wurde nicht durchgeführt.
