# Premium-Depot-Verkaufshelfer

> **Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.** Prüfe vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen. Fehler können zu Verlusten im Spiel oder zu Kontosanktionen führen.

`premium-depot.user.js` ergänzt **Marktplatz → Premium-Depot** um eine Verkaufsleiste.
In Tampermonkey ein neues Script anlegen, den gesamten Inhalt dieser Datei einfügen,
speichern und die Depotseite neu laden.

## Bedienung

1. Holz, Lehm und/oder Eisen aktivieren.
2. Für jeden Rohstoff eine **Reserve im Dorf** und optional **maximale Rohstoffe pro
   Premium-Punkt** festlegen. Ein kleinerer Kurs ist für den Verkäufer besser.
   Eine Kursgrenze von 0 erlaubt jeden Kurs. Sie gilt für den durchschnittlichen
   Kurs der ganzen Transaktion, auch im Bestätigungsdialog.
3. Ein **Händlerlimit** setzen. 0 verwendet alle aktuell verfügbaren Händler.
4. **Angebot prüfen** berechnet den Verkauf für diese Rohstoffart und öffnet über
   das normale Spielformular das Angebot. **Größte Menge prüfen** wählt unter den
   aktivierten Rohstoffen den Vorschlag mit der größten Menge.
5. Im nativen Dialog stehen die tatsächliche Menge und der tatsächliche Erlös.
   Die zusätzliche Prüfzeile zeigt Händlerbedarf, Auslastung und Durchschnittskurs.
   **Bestätigen** startet den Handel mit deinem eigenen Klick.
6. Bei einem gesperrten Angebot **Abbrechen** wählen und erneut berechnen.
   Nach einem Handel kannst du den nächsten Rohstoff prüfen.

Einstellungen werden lokal pro Welt, Spieler und Dorf gespeichert. Bei der ersten
Nutzung sind die Reserven und Limits 0. Ungültige Eingaben führen zu keinem Vorschlag.
Das Script schreibt ausschließlich in die Verkaufsfelder; vorhandene Kauf- oder
Verkaufseingaben werden beim Eintragen eines neuen Vorschlags geleert.

## Berechnung und Bestätigung

Die maximale Menge ist das Minimum aus:

- freier Depotkapazität für die Rohstoffart,
- Dorfbestand abzüglich Reserve,
- verfügbarem Händlerbudget × Transportmenge pro Händler.

Die Transportmenge pro Händler wird aus der angezeigten maximalen Transportmenge
und der verfügbaren Händlerzahl ermittelt. Es wird nicht pauschal mit 1.000 gerechnet.
Bei unterschiedlichen Rohstoffanzeigen verwendet das Script den kleineren Wert
aus Seitenanzeige und `game_data`, das auch die native Prüfung verwendet.

Die Kostenkurve entspricht `PremiumExchange.calculateCost` aus den mitgelieferten
Spieldateien. Sie berücksichtigt, dass der Kurs mit wachsendem Depotbestand schlechter
wird. Das Script berechnet den größten ganzen PP-Erlös innerhalb der Grenzen und
sucht die dazugehörige Rohstoffmenge. Eine einfache Multiplikation des angezeigten
Ein-Punkt-Kurses mit der PP-Zahl wäre bei größeren Verkäufen ungenau.

Pro Verkauf wird die größtmögliche durch diese Kurve geschätzte Menge zu ganzen PP
geplant. Dafür wird die minimale notwendige Händlerzahl aufgerundet. Zwischen
gleich großen Vorschlägen erhält der mit weniger Händlern Vorrang, danach der mit
mehr PP. Das ist eine Planung des nächsten einzelnen Handels; die native Oberfläche
erlaubt jeweils nur eine Rohstoffart. Es findet keine automatische Verkaufsserie statt.

Eine volle Auslastung ist wegen ganzer PP nicht immer erreichbar: Die gespeicherte
Bestätigung zeigt **1.518 Lehm → 1 PP**, also zwei Händler bei 1.000 Transportmenge
und 75,9 % Auslastung. Ein Händler reicht dafür nicht.

Der Server bestimmt den verbindlichen passenden Kurs und kann die Menge ändern.
Deshalb prüft das Script seine echte Antwort (`amount`, `cost`, `merchants_required`
und `rate_hash`) im Bestätigungsdialog erneut gegen Depot, Dorfreserve, Händlerlimit,
ursprüngliche Mengengrenze und Kursgrenze. Diese Prüfung läuft auch bei einem vom
Spiel neu angebotenen Kurs und unmittelbar vor dem Bestätigungsklick. Ein Angebot,
das Grenzen überschreitet, wird gesperrt; es wird nicht eigenständig bestätigt oder
nachgebessert. Direkt im Originalformular eingegebene Angebote bleiben native Angebote.

Die Vorschläge aktualisieren sich sekündlich anhand der vorhandenen Seitenwerte.
Die Depotdaten selbst lädt das Spiel mit seinem eigenen Aktualisierungsrhythmus.
**Neu berechnen** verwendet den letzten auf der Seite verfügbaren Stand und löst
keine zusätzliche Netzwerkabfrage aus. Das Script setzt keine eigenen Endpunkte,
Tokens oder Spielerkennungen aus den gespeicherten HTMLs ein.

## Prüfung

Die Befehle werden im Repository-Hauptordner ausgeführt. Der Ordner `test` bleibt lokal und ist nicht Bestandteil der Veröffentlichung. Die Testbefehle setzen diese lokalen Dateien voraus.

```powershell
node --check premium-depot/premium-depot.user.js
node --test test/premium-depot.core.test.cjs
```

Der Offline-Browsertest benötigt das Node-Paket `playwright` und Microsoft Edge:

```powershell
node test/premium-depot.browser.cjs "C:\Pfad\PremiumDepot.html" "C:\Pfad\Confirm.html"
```

Er verwendet die tatsächlichen gespeicherten HTMLs, verhindert sämtliche externen
Ressourcenanfragen und simuliert die Serverantworten. Er vergleicht außerdem die
Kostenkurve mit der mitgespeicherten nativen `PremiumExchange.*.js_`-Datei im
zugehörigen `PremiumDepot_files`-Ordner. Er prüft das Eintragen, das Leeren alter
Eingaben und Fehler, die Dialogprüfung, die Sperre nach einer Limitänderung und die
manuelle Bestätigung. Die Core-Tests prüfen zusätzlich 1.000 erzeugte Kombinationen
von Beständen, Reserven und Händlerkapazitäten. Ein echter Handel auf einer
angemeldeten Spielseite wurde nicht ausgeführt.
