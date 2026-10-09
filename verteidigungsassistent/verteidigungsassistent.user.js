// ==UserScript==
// @name         Die Stämme – Verteidigungsassistent
// @namespace    local.die-staemme.verteidigungsassistent
// @version      1.4.6
// @description  Gruppiert Eingehende, bewertet erklärbar das Risiko und plant manuell zu bestätigende Unterstützungen und Ausweichbefehle anhand der Weltdaten. Nutzung auf eigene Gefahr.
// @author       Lokal
// @match        https://*.die-staemme.de/game.php?*screen=overview_villages*mode=incomings*
// @match        https://*.die-staemme.de/game.php?*mode=incomings*screen=overview_villages*
// @match        https://*.die-staemme.de/game.php?*screen=map*
// @match        https://*.die-staemme.de/game.php?*screen=place*
// @exclude      /^[^?]+\?(?!(?:(?=(?:[^#]*&)?screen=(?:map|place)(?:&|#|$))|(?=(?:[^#]*&)?screen=overview_villages(?:&|#|$))(?=(?:[^#]*&)?mode=incomings(?:&|#|$))))/
// @exclude      /^[^?]+\?(?:[^#]*&)?(screen|mode)=[^#]*&\1=/
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.
// Vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen prüfen.

(function () {
    'use strict';

    const VERSION = '1.4.6';
    const SCRIPT_ID = 'ds-defense-assistant';
    const STORAGE_VERSION = 1;
    const STORAGE_PREFIX = 'ds-defense-assistant';
    // Miliz verteidigt im Dorf, kann aber nicht als Unterstützung verschickt werden.
    const DEFENSE_UNITS = ['spear', 'sword', 'archer', 'heavy'];
    // Die defensive Dorfbesetzung bleibt unangetastet. Ein AG wird nur gemeinsam
    // mit der erkannten Off in denselben Ausweichbefehl eingeplant.
    const DODGE_UNITS = ['axe', 'spy', 'light', 'marcher', 'ram', 'catapult', 'snob'];
    const ALL_UNITS = [
        'spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher',
        'heavy', 'ram', 'catapult', 'knight', 'snob', 'militia'
    ];
    const UNIT_NAMES = {
        spear: 'Speerträger', sword: 'Schwertkämpfer', axe: 'Axtkämpfer',
        archer: 'Bogenschütze', spy: 'Späher', light: 'Leichte Kavallerie',
        marcher: 'Berittener Bogenschütze', heavy: 'Schwere Kavallerie',
        ram: 'Rammbock', catapult: 'Katapult', knight: 'Paladin',
        snob: 'Adelsgeschlecht', militia: 'Miliz'
    };
    const REQUIREMENT_KIND_NAMES = Object.freeze({
        small: 'Wachturm klein', medium: 'Wachturm mittel', large: 'Wachturm groß',
        noble: 'AG', unknown: 'ohne Geschwindigkeitssignal', scout: 'Späherklasse',
        cavalry: 'schnelle Kavallerieklasse', infantry: 'Infanterieklasse', siege: 'Belagerungsklasse'
    });

    // Offizielle Standardwerte dienen nur als transparenter Fallback. Wenn möglich,
    // werden sie durch /interface.php?func=get_unit_info der aktiven Welt ersetzt.
    const STANDARD_UNIT_INFO = Object.freeze({
        spear:    { attack: 10,  defense: 15,  defenseCavalry: 45,  defenseArcher: 20,  speed: 18,   pop: 1 },
        sword:    { attack: 25,  defense: 50,  defenseCavalry: 15,  defenseArcher: 40,  speed: 22,   pop: 1 },
        axe:      { attack: 40,  defense: 10,  defenseCavalry: 5,   defenseArcher: 10,  speed: 18,   pop: 1 },
        archer:   { attack: 15,  defense: 50,  defenseCavalry: 40,  defenseArcher: 5,   speed: 18,   pop: 1 },
        spy:      { attack: 0,   defense: 2,   defenseCavalry: 1,   defenseArcher: 2,   speed: 9,    pop: 2 },
        light:    { attack: 130, defense: 30,  defenseCavalry: 40,  defenseArcher: 30,  speed: 10,   pop: 4 },
        marcher:  { attack: 120, defense: 40,  defenseCavalry: 30,  defenseArcher: 50,  speed: 10,   pop: 5 },
        heavy:    { attack: 150, defense: 200, defenseCavalry: 80,  defenseArcher: 180, speed: 11,   pop: 6 },
        ram:      { attack: 2,   defense: 20,  defenseCavalry: 50,  defenseArcher: 20,  speed: 30,   pop: 5 },
        catapult: { attack: 100, defense: 100, defenseCavalry: 50,  defenseArcher: 100, speed: 30,   pop: 8 },
        knight:   { attack: 150, defense: 250, defenseCavalry: 400, defenseArcher: 150, speed: 10,   pop: 10 },
        snob:     { attack: 30,  defense: 100, defenseCavalry: 50,  defenseArcher: 100, speed: 35,   pop: 100 },
        militia:  { attack: 5,   defense: 15,  defenseCavalry: 45,  defenseArcher: 25,  speed: 0.02, pop: 0 }
    });

    const PRESET_DEFINITIONS = Object.freeze({
        standard: {
            name: 'Ausgewogen',
            groupWindowMinutes: 10,
            sameSourceWaveGapSeconds: 20,
            nobleTrainGapSeconds: 10,
            nobleTrainMinCommands: 3,
            crossSourceWaveGapSeconds: 10,
            crossSourceWaveMinCommands: 3,
            supportBufferMinutes: 5,
            dodgeLeadSeconds: 90,
            dodgePostSeconds: 5,
            dodgeCancelSafetySeconds: 30,
            dodgeMinimumHomeSeconds: 90,
            dodgeNotifyMinutes: 3,
            dodgeFullOffPopulation: 3000,
            dodgeBarbarianMinimumAttack: 250000,
            dodgeBarbarianMaxPoints: 12000,
            dodgeTargetSearchRadius: 35,
            reservePercent: 20,
            minimumSupportPop: 500,
            excludeThreatenedSources: true,
            assumedWallLevel: 20,
            wallFactorPerLevel: 1.037,
            inventoryStaleHours: 6,
            alertMinutes: [30, 10],
            requirements: { small: 30000, medium: 150000, large: 450000, unknown: 250000, noble: 500000 },
            noWatchtowerRequirements: { scout: 100000, cavalry: 225000, infantry: 300000, siege: 400000 },
            repeatedCommandWeight: 0.45,
            maxEquivalentAttacks: 6,
            fixedReserve: { spear: 500, sword: 500, archer: 300, heavy: 50, militia: 0 }
        },
        conservative: {
            name: 'Konservativ',
            groupWindowMinutes: 15,
            sameSourceWaveGapSeconds: 30,
            nobleTrainGapSeconds: 12,
            nobleTrainMinCommands: 3,
            crossSourceWaveGapSeconds: 12,
            crossSourceWaveMinCommands: 3,
            supportBufferMinutes: 10,
            dodgeLeadSeconds: 120,
            dodgePostSeconds: 8,
            dodgeCancelSafetySeconds: 45,
            dodgeMinimumHomeSeconds: 120,
            dodgeNotifyMinutes: 5,
            dodgeFullOffPopulation: 2500,
            dodgeBarbarianMinimumAttack: 350000,
            dodgeBarbarianMaxPoints: 9000,
            dodgeTargetSearchRadius: 45,
            reservePercent: 30,
            minimumSupportPop: 800,
            excludeThreatenedSources: true,
            assumedWallLevel: 20,
            wallFactorPerLevel: 1.037,
            inventoryStaleHours: 4,
            alertMinutes: [45, 15],
            requirements: { small: 45000, medium: 200000, large: 600000, unknown: 350000, noble: 650000 },
            noWatchtowerRequirements: { scout: 150000, cavalry: 325000, infantry: 425000, siege: 550000 },
            repeatedCommandWeight: 0.6,
            maxEquivalentAttacks: 8,
            fixedReserve: { spear: 800, sword: 800, archer: 500, heavy: 80, militia: 0 }
        },
        rapid: {
            name: 'Schnelle Reaktion',
            groupWindowMinutes: 5,
            sameSourceWaveGapSeconds: 15,
            nobleTrainGapSeconds: 8,
            nobleTrainMinCommands: 3,
            crossSourceWaveGapSeconds: 8,
            crossSourceWaveMinCommands: 3,
            supportBufferMinutes: 3,
            dodgeLeadSeconds: 60,
            dodgePostSeconds: 3,
            dodgeCancelSafetySeconds: 20,
            dodgeMinimumHomeSeconds: 60,
            dodgeNotifyMinutes: 2,
            dodgeFullOffPopulation: 4000,
            dodgeBarbarianMinimumAttack: 200000,
            dodgeBarbarianMaxPoints: 15000,
            dodgeTargetSearchRadius: 30,
            reservePercent: 10,
            minimumSupportPop: 300,
            excludeThreatenedSources: true,
            assumedWallLevel: 20,
            wallFactorPerLevel: 1.037,
            inventoryStaleHours: 8,
            alertMinutes: [20, 5],
            requirements: { small: 25000, medium: 120000, large: 360000, unknown: 200000, noble: 420000 },
            noWatchtowerRequirements: { scout: 75000, cavalry: 180000, infantry: 250000, siege: 320000 },
            repeatedCommandWeight: 0.35,
            maxEquivalentAttacks: 5,
            fixedReserve: { spear: 300, sword: 300, archer: 200, heavy: 30, militia: 0 }
        }
    });

    const CONFIG_HELP = Object.freeze({
        profile: 'Lädt einen vollständigen, zusammenpassenden Satz von Bewertungs- und Planungswerten. „Ausgewogen“ ist der belastbare Standard; jede manuelle Änderung schaltet auf „Benutzerdefiniert“.',
        groupWindowMinutes: 'Angriffe auf dasselbe Dorf werden zu einer Lagegruppe zusammengefasst, solange der Abstand zum vorherigen Befehl höchstens diesem Zeitfenster entspricht. Ein kleiner Wert trennt Wellen früher, ein großer Wert fasst unabhängige Angriffe eher zusammen.',
        sameSourceWaveGapSeconds: 'Maximaler Ankunftsabstand, bei dem mindestens zwei Befehle aus demselben Herkunftsdorf als enge Folge erkannt werden. Solche Folgen erhöhen das Risiko und beeinflussen die Gewichtung weiterer Befehle.',
        nobleTrainGapSeconds: 'Maximaler Ankunftsabstand innerhalb eines klassischen AG-Zugs aus demselben Herkunftsdorf. Quellübergreifend synchronisierte Befehle werden mit den separat einstellbaren Werten darunter erkannt.',
        nobleTrainMinCommands: 'Mindestanzahl eng aufeinanderfolgender Befehle aus derselben Herkunft, bevor ein möglicher AG-Zug angenommen wird. Ein höherer Wert reduziert Fehlalarme, kann kurze Züge aber übersehen.',
        crossSourceWaveGapSeconds: 'Maximaler Ankunftsabstand für eine koordinierte Befehlsfolge aus mindestens zwei unterschiedlichen Herkunftsdörfern. Enthält diese Folge ein AG-Signal, wird sie zusätzlich als quellübergreifender AG-Zug gewertet.',
        crossSourceWaveMinCommands: 'Mindestanzahl zeitlich synchronisierter Befehle aus mehreren Herkunftsdörfern. Ohne AG-Signal bleibt das Ergebnis eine koordinierte Welle und wird nicht fälschlich als sicherer AG-Zug bezeichnet.',
        supportBufferMinutes: 'Sicherheitsabstand zwischen der geplanten Ankunft der Unterstützung und dem ersten Angriff. Der Planer verwirft Quellen, deren Unterstützung einschließlich dieses Puffers nicht rechtzeitig eintreffen kann.',
        dodgeLeadSeconds: 'So viele Sekunden vor dem ersten Einschlag eines Ausweichfensters soll der Befehl bestätigt sein. Der Puffer ist Vorbereitungszeit und wird bei der Abbruchfrist vollständig mitgerechnet.',
        dodgePostSeconds: 'So viele Sekunden nach dem letzten zusammengefassten Einschlag wartet der Plan bis zum Abbruch beziehungsweise Rückruf. Ein kleiner positiver Wert schützt gegen Rundungs- und Netzwerklatenz.',
        dodgeCancelSafetySeconds: 'Sicherheitsabstand zum von der Welt gemeldeten Befehlsabbruchfenster. Der Plan nutzt die native Frist nie bis zur letzten Sekunde aus.',
        dodgeMinimumHomeSeconds: 'Mindestzeit, die zurückgekehrte Truppen vor dem nächsten geplanten Ausweichbefehl wieder im Dorf sein sollen. Reicht sie nicht, werden Angriffe zusammengefasst oder eine längere Unterstützung geplant.',
        dodgeNotifyMinutes: 'Vorlauf der Browser-Benachrichtigung vor dem geplanten Absendezeitpunkt. Die Benachrichtigung erscheint nur bei aktivierten und vom Browser erlaubten Alarmen.',
        dodgeFullOffPopulation: 'Ab dieser offensiven Bevölkerungszahl bezeichnet der Assistent den Bestand als große Off. Ein vorhandenes Adelsgeschlecht führt unabhängig davon immer zu einer klaren Ausweichempfehlung.',
        dodgeBarbarianMinimumAttack: 'Mindestangriffskraft der gemeinsam ausgelagerten Off, damit ein Barbarendorf notfalls bewusst getroffen werden darf. Der Wert wird aus den offiziellen Angriffswerten der aktiven Welt berechnet. Er ersetzt mangels aktueller Dorftruppen keinen Kampfsimulator; unterhalb der Schwelle wird niemals ein Durchlaufen empfohlen.',
        dodgeBarbarianMaxPoints: 'Höchste Dorfpunktzahl eines automatisch gewählten Barbarendorfs, wenn der Befehl möglicherweise eintreffen muss. Bei sicher abbrechbaren Befehlen darf auch ein größeres Barbarendorf als reines Laufzeitziel dienen.',
        dodgeTargetSearchRadius: 'Maximaler Suchradius für automatisch gewählte Barbarendörfer. Eigene, angriffsfreie Unterstützungsziele werden unabhängig davon zuerst nach Laufzeit sortiert.',
        reservePercent: 'Dieser Anteil der verfügbaren Truppen jedes Quelldorfs bleibt grundsätzlich unangetastet. Zusätzlich werden die festen Reserven je Einheit abgezogen; wirksam ist damit beides zusammen.',
        minimumSupportPop: 'Kleinste erlaubte Bevölkerungsmenge eines geplanten Unterstützungsbefehls. Verhindert viele ineffiziente Kleinstbefehle; 0 erlaubt jede positive Zuteilung.',
        assumedWallLevel: 'Reiner Fallback, falls die Gebäudeübersicht nicht geladen oder das Dorf dort nicht erkannt werden konnte. Normalerweise verwendet der Assistent die automatisch abgefragte Mauerstufe; je Dorf ist weiterhin eine manuelle Ausnahme möglich.',
        inventoryStaleHours: 'Nach dieser Zeit wird ein gespeicherter Truppenbestand als veraltet markiert. Beim Laden der Eingehenden werden Truppen und Mauerstufen automatisch neu abgefragt; der Wert greift vor allem bei fehlenden Rechten oder Netzwerkfehlern.',
        urgentMinutes: 'Grenze für den Filter „nur dringend“. Gruppen mit einer ersten Ankunft innerhalb dieses Zeitraums bleiben sichtbar; die eigentliche Risikoberechnung wird dadurch nicht verändert.',
        'requirements.small': 'Angenommene Basis-Verteidigungspunkte für einen vom Wachturm bestätigten kleinen Angriff. Dies ist eine konservative Planungsgröße, keine Kampfsimulator-Prognose.',
        'requirements.medium': 'Angenommene Basis-Verteidigungspunkte für einen vom Wachturm bestätigten mittleren Angriff. Mauer und bestätigter Nachtbonus werden anschließend separat berücksichtigt.',
        'requirements.large': 'Angenommene Basis-Verteidigungspunkte für einen vom Wachturm bestätigten großen Angriff. Weitere Befehle derselben Gruppe werden nach den Folgebefehl-Regeln ergänzt.',
        'requirements.unknown': 'Planungsbedarf für einen Angriff ohne belastbare Größenklasse. Der Wert ist bewusst vorsichtig und sollte zur üblichen Offensivgröße der Welt passen.',
        'requirements.noble': 'Planungsbedarf für ein bestätigtes oder hinreichend wahrscheinliches Adelsgeschlecht. Er ersetzt keine Prüfung von Wellen, Fakes oder bekannten Angreiferprofilen.',
        'noWatchtowerRequirements.scout': 'Planwert ohne Wachturm für einen reinen Späher-Geschwindigkeitshinweis. Die Laufzeit schließt langsamere Einheiten aus, beweist aber weder Truppenmenge noch Angriffszweck.',
        'noWatchtowerRequirements.cavalry': 'Planwert ohne Wachturm für eine schnelle Kavallerie-/Paladin-Geschwindigkeitsklasse. Eine große Kavallerie-Off ist möglich; Ramme, Katapult oder AG wären bei korrekter Laufzeit jedoch ausgeschlossen.',
        'noWatchtowerRequirements.infantry': 'Planwert ohne Wachturm für Speer-, Axt-, Bogen- oder Schwertgeschwindigkeit. Sowohl Einheiten-Fakes als auch ernsthafte infanterielastige Angriffe sind möglich.',
        'noWatchtowerRequirements.siege': 'Planwert ohne Wachturm für Rammbock-/Katapultgeschwindigkeit. Das ist mit einer klassischen Off vereinbar, kann laut Spielmechanik aber auch durch einen einzelnen Rammbock gefälscht werden.',
        repeatedCommandWeight: 'Gewicht eines weiteren engen Nicht-AG-Befehls aus derselben Herkunft relativ zum ersten Befehl. 0,45 bedeutet: Der Folgebefehl erhöht den Bedarf um 45 % seines Klassenwerts.',
        maxEquivalentAttacks: 'Obergrenze der aufsummierten Angriffsäquivalente pro Lagegruppe. Sie verhindert unbegrenzt wachsende Planwerte bei sehr großen oder künstlich aufgeblähten Gruppen.',
        fixedReserve: 'Absolute Mindestmenge dieser Einheit, die in jedem Quelldorf verbleibt. Sie wird zusätzlich zur prozentualen Reserve geschützt.',
        alertsEnabled: 'Erlaubt dem Assistenten, bereits freigegebene Browser-Benachrichtigungen zu verwenden. Die Browserberechtigung selbst wird weiterhin über „Browser-Alarme“ angefordert.',
        notifyNewAttacks: 'Meldet neu erkannte Befehle, nachdem bereits mindestens eine Analyse dieser Seite erfolgt ist. Beim ersten Laden wird kein Alarm für den gesamten vorhandenen Bestand erzeugt.',
        excludeThreatenedSources: 'Dörfer mit eigenen eingehenden Angriffen werden nicht als Unterstützungsquelle eingeplant. Das schützt lokale Verteidigung, kann aber zu bewusst ausgewiesenen Restlücken führen.',
        filterNativeRows: 'Überträgt Gefahren-, Status- und Suchfilter auch auf die originale Angriffstabelle des Spiels. Ist die Option aus, wird nur die Assistentenansicht gefiltert.'
    });

    const STATUS_OPTIONS = Object.freeze([
        ['unreviewed', 'Ungeprüft'],
        ['likely_real', 'Vermutlich echt'],
        ['likely_fake', 'Vermutlich Fake'],
        ['noble', 'AG-Verdacht'],
        ['planned', 'Verteidigung geplant'],
        ['support_underway', 'Unterstützung unterwegs'],
        ['support_arrived', 'Unterstützung angekommen'],
        ['support_return_due', 'Unterstützung zurückschicken'],
        ['handled', 'Erledigt'],
        ['ignore', 'Ignorieren']
    ]);

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function createDefaultConfig(profile = 'standard') {
        const selected = PRESET_DEFINITIONS[profile] || PRESET_DEFINITIONS.standard;
        return {
            profile,
            alertsEnabled: false,
            notifyNewAttacks: true,
            urgentMinutes: 60,
            filterNativeRows: true,
            ...deepClone(selected)
        };
    }

    function mergeConfig(value) {
        const selectedProfile = PRESET_DEFINITIONS[value?.profile] ? value.profile : 'standard';
        const profile = value?.profile === 'custom' ? 'custom' : selectedProfile;
        const base = createDefaultConfig(selectedProfile);
        const input = value && typeof value === 'object' ? value : {};
        return {
            ...base,
            ...input,
            profile,
            requirements: { ...base.requirements, ...(input.requirements || {}) },
            noWatchtowerRequirements: { ...base.noWatchtowerRequirements, ...(input.noWatchtowerRequirements || {}) },
            fixedReserve: { ...base.fixedReserve, ...(input.fixedReserve || {}) },
            alertMinutes: Array.isArray(input.alertMinutes)
                ? input.alertMinutes.map(Number).filter(Number.isFinite).map((n) => Math.max(1, Math.floor(n))).slice(0, 4)
                : base.alertMinutes
        };
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, Number(value) || 0));
    }

    function normalizeText(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function detectCommandType(technicalSignals, label = '') {
        const technical = normalizeText(technicalSignals);
        const named = normalizeText(label);
        // Native Icon-, Klassen- und data-Attribute sind maßgeblich. Der Name
        // ist frei änderbar und deshalb nur ein enger Fallback.
        if (/(?:^|[^a-z])(?:support|unterstutzung)(?:[^a-z]|$)/.test(technical)) return 'support';
        if (/(?:^|[^a-z])(?:back|return)(?:[^a-z]|$)/.test(technical)) return 'return';
        if (/(?:^|[^a-z])(?:attack|angriff)(?:[^a-z]|$)/.test(technical)) return 'attack';
        if (/^(?:support|unterstutzung)(?:\b|\s)/.test(named)) return 'support';
        return 'attack';
    }

    function detectRenamedUnit(value) {
        const text = normalizeText(value);
        const patterns = [
            ['marcher', /\b(berittener? bogenschutze|berittene bogenschutzen|marcher|bbogen)\b/],
            ['light', /\b(leichte kavallerie|leichte kav|lkav|light cavalry|light)\b/],
            ['heavy', /\b(schwere kavallerie|schwere kav|skav|heavy cavalry|heavy)\b/],
            ['snob', /\b(adelsgeschlecht|adliger|noble|snob)\b/],
            ['catapult', /\b(katapult|katapulte|catapult)\b/],
            ['ram', /\b(rammbock|ramme|rammen|ram)\b/],
            ['spy', /\b(spaher|spaeher|spion|spy|scout)\b/],
            ['spear', /\b(speertrager|speer|spear)\b/],
            ['sword', /\b(schwertkampfer|schwert|sword)\b/],
            ['axe', /\b(axtkampfer|axt|axe)\b/],
            ['archer', /\b(bogenschutze|bogenschutzen|bogen|archer)\b/],
            ['knight', /\b(paladin|knight)\b/]
        ];
        return patterns.find(([, pattern]) => pattern.test(text))?.[0] || null;
    }

    function plannedSupportMatches(assignment, command) {
        const targetMatches = assignment?.targetId && command?.targetId
            ? String(assignment.targetId) === String(command.targetId)
            : Boolean(assignment?.targetCoord && command?.targetCoord && assignment.targetCoord === command.targetCoord);
        const sourceMatches = assignment?.sourceId && command?.sourceId
            ? String(assignment.sourceId) === String(command.sourceId)
            : Boolean(assignment?.sourceCoord && command?.sourceCoord && assignment.sourceCoord === command.sourceCoord);
        return targetMatches && sourceMatches;
    }

    function parseFormattedInt(value) {
        if (value === null || value === undefined) return null;
        const cleaned = String(value).replace(/[^0-9-]/g, '');
        if (!cleaned || cleaned === '-') return null;
        const parsed = Number.parseInt(cleaned, 10);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function parseCoord(value) {
        const match = String(value || '').match(/(\d{1,3})\s*[|,]\s*(\d{1,3})/);
        return match ? { x: Number(match[1]), y: Number(match[2]), text: `${Number(match[1])}|${Number(match[2])}` } : null;
    }

    function distanceBetween(a, b) {
        const first = typeof a === 'string' ? parseCoord(a) : a;
        const second = typeof b === 'string' ? parseCoord(b) : b;
        if (!first || !second) return null;
        return Math.hypot(first.x - second.x, first.y - second.y);
    }

    function parseDurationText(value) {
        const text = String(value || '').trim();
        if (!text) return null;
        const dayMatch = text.match(/(?:(\d+)\s*(?:t|tag|tage|d)\s*)?(\d{1,2}):(\d{2}):(\d{2})/i);
        if (dayMatch) {
            return (Number(dayMatch[1] || 0) * 86400)
                + (Number(dayMatch[2]) * 3600)
                + (Number(dayMatch[3]) * 60)
                + Number(dayMatch[4]);
        }
        const shortMatch = text.match(/^(\d{1,2}):(\d{2})$/);
        return shortMatch ? Number(shortMatch[1]) * 60 + Number(shortMatch[2]) : null;
    }

    function parseReturnTimestamp(value, arrivalTimestamp) {
        if (!Number.isFinite(arrivalTimestamp)) return null;
        const text = String(value || '').replace(/\u00a0/g, ' ');
        const expression = /(?:(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?[ ,T]+)?(\d{1,2}):(\d{2}):(\d{2})(?::(\d{1,3}))?/g;
        const matches = [...text.matchAll(expression)];
        if (!matches.length) return null;
        const match = matches[matches.length - 1];
        const arrival = new Date(arrivalTimestamp);
        const result = new Date(arrivalTimestamp);
        const hasDate = Boolean(match[1] && match[2]);
        if (hasDate) {
            const explicitYear = match[3]
                ? (Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]))
                : arrival.getFullYear();
            result.setFullYear(explicitYear, Number(match[2]) - 1, Number(match[1]));
        }
        result.setHours(Number(match[4]), Number(match[5]), Number(match[6]), Number(match[7] || 0));
        if (!hasDate && result.getTime() <= arrivalTimestamp) result.setDate(result.getDate() + 1);
        if (hasDate && !match[3] && result.getTime() <= arrivalTimestamp) result.setFullYear(result.getFullYear() + 1);
        return result.getTime() > arrivalTimestamp ? result.getTime() : null;
    }

    function unitInfoWithFallback(unitInfo = {}) {
        return Object.fromEntries(ALL_UNITS.map((unit) => [
            unit,
            { ...(STANDARD_UNIT_INFO[unit] || {}), ...(unitInfo[unit] || {}) }
        ]));
    }

    function wallMultiplier(level, config) {
        return Math.pow(Number(config.wallFactorPerLevel) || 1.037, clamp(level, 0, 30));
    }

    function isNightArrival(timestamp, world = {}) {
        if (!world.night?.active || !Number.isFinite(timestamp)) return false;
        const hour = new Date(timestamp).getHours();
        const start = clamp(world.night.startHour, 0, 23);
        const end = clamp(world.night.endHour, 0, 24);
        return start < end ? hour >= start && hour < end : hour >= start || hour < end;
    }

    function computeDefense(troops = {}, unitInfo = {}, options = {}) {
        const info = unitInfoWithFallback(unitInfo);
        let general = 0;
        let cavalry = 0;
        let archer = 0;
        let population = 0;
        for (const [unit, amountValue] of Object.entries(troops || {})) {
            const amount = Math.max(0, Math.floor(Number(amountValue) || 0));
            const stats = info[unit];
            if (!stats || !amount) continue;
            general += amount * (Number(stats.defense) || 0);
            cavalry += amount * (Number(stats.defenseCavalry) || 0);
            archer += amount * (Number(stats.defenseArcher) || Number(stats.defense) || 0);
            population += amount * (Number(stats.pop) || 0);
        }
        const archerEnabled = options.archerEnabled !== false;
        const baseEffective = archerEnabled ? Math.min(general, cavalry, archer) : Math.min(general, cavalry);
        const multiplier = (Number(options.wallMultiplier) || 1) * (Number(options.nightMultiplier) || 1);
        return {
            general,
            cavalry,
            archer: archerEnabled ? archer : null,
            population,
            baseEffective,
            effective: baseEffective * multiplier,
            multiplier
        };
    }

    function stableGroupId(targetKey, arrival, windowMinutes) {
        const bucket = Math.floor(Number(arrival || 0) / (Math.max(1, Number(windowMinutes) || 10) * 60000));
        return `${targetKey}:${bucket}`.replace(/[^a-z0-9:_|-]/gi, '_');
    }

    function detectRuns(attacks, maxGapSeconds, minCommands) {
        const runs = [];
        const bySource = new Map();
        for (const attack of attacks) {
            const key = attack.sourceId || attack.sourceCoord || attack.sourceName || 'unknown';
            if (!bySource.has(key)) bySource.set(key, []);
            bySource.get(key).push(attack);
        }
        for (const [sourceKey, sourceAttacks] of bySource) {
            const sorted = sourceAttacks.slice().sort((a, b) => a.arrival - b.arrival);
            let current = [];
            const flush = () => {
                if (current.length >= minCommands) runs.push({ sourceKey, attacks: current.slice() });
                current = [];
            };
            for (const attack of sorted) {
                if (current.length && (attack.arrival - current[current.length - 1].arrival) / 1000 > maxGapSeconds) flush();
                current.push(attack);
            }
            flush();
        }
        return runs;
    }

    function hasNobleSignal(attack) {
        return Boolean(attack.watchNoble || attack.inferredUnit === 'snob' || attack.renamedUnit === 'snob'
            || /\b(ag|adel|noble|snob)\b/i.test(attack.label || ''));
    }

    function detectSynchronizedRuns(attacks, maxGapSeconds, minCommands) {
        const runs = [];
        const sorted = attacks.slice().sort((a, b) => a.arrival - b.arrival);
        let current = [];
        const sourceKey = (attack) => attack.sourceId || attack.sourceCoord || attack.sourceName || 'unknown';
        const flush = () => {
            const sources = new Set(current.map(sourceKey));
            if (current.length >= minCommands && sources.size >= 2) {
                runs.push({ sourceKeys: [...sources], attacks: current.slice() });
            }
            current = [];
        };
        for (const attack of sorted) {
            if (current.length && (attack.arrival - current[current.length - 1].arrival) / 1000 > maxGapSeconds) flush();
            current.push(attack);
        }
        flush();
        return runs;
    }

    function groupAttacks(attacks, configValue = createDefaultConfig()) {
        const config = mergeConfig(configValue);
        const byTarget = new Map();
        for (const attack of attacks.filter((item) => Number.isFinite(item.arrival))) {
            const targetKey = String(attack.targetId || attack.targetCoord || attack.targetName || 'unknown');
            if (!byTarget.has(targetKey)) byTarget.set(targetKey, []);
            byTarget.get(targetKey).push({ ...attack, targetKey });
        }

        const groups = [];
        const maxGap = config.groupWindowMinutes * 60000;
        for (const [targetKey, targetAttacks] of byTarget) {
            const sorted = targetAttacks.slice().sort((a, b) => a.arrival - b.arrival);
            let current = [];
            const flush = () => {
                if (!current.length) return;
                const first = current[0];
                const sources = new Set(current.map((item) => item.sourceId || item.sourceCoord || item.sourceName || '?'));
                const runs = detectRuns(current, config.sameSourceWaveGapSeconds, 2);
                const nobleRuns = detectRuns(current, config.nobleTrainGapSeconds, config.nobleTrainMinCommands)
                    .filter((run) => run.attacks.some(hasNobleSignal));
                const synchronizedRuns = detectSynchronizedRuns(
                    current, config.crossSourceWaveGapSeconds, config.crossSourceWaveMinCommands
                );
                const crossSourceNobleRuns = synchronizedRuns.filter((run) => run.attacks.some(hasNobleSignal));
                groups.push({
                    id: stableGroupId(targetKey, first.arrival, config.groupWindowMinutes),
                    targetKey,
                    targetId: first.targetId || null,
                    targetCoord: first.targetCoord || null,
                    targetName: first.targetName || first.targetCoord || targetKey,
                    attacks: current.slice(),
                    firstArrival: first.arrival,
                    lastArrival: current[current.length - 1].arrival,
                    uniqueSources: sources.size,
                    sameSourceRuns: runs,
                    nobleRuns,
                    synchronizedRuns,
                    crossSourceNobleRuns
                });
                current = [];
            };
            for (const attack of sorted) {
                if (current.length && attack.arrival - current[current.length - 1].arrival > maxGap) flush();
                current.push(attack);
            }
            flush();
        }
        return groups.sort((a, b) => a.firstArrival - b.firstArrival || b.attacks.length - a.attacks.length);
    }

    function classifyAttack(attack) {
        const label = normalizeText(attack.label);
        const inferredNames = (attack.inferredUnits?.length ? attack.inferredUnits : attack.inferredUnit ? [attack.inferredUnit] : [])
            .map((unit) => UNIT_NAMES[unit] || unit).join(' / ');
        const evidence = [];
        let classification = 'unknown';
        let confidence = 0.2;

        if (attack.watchNoble) {
            classification = 'confirmed_noble';
            confidence = 1;
            evidence.push('Wachturm bestätigt ein Adelsgeschlecht');
        } else if (attack.watchSize === 'large') {
            classification = 'confirmed_large';
            confidence = 0.98;
            evidence.push('Wachturm meldet mehr als 5.000 Truppen');
        } else if (attack.watchSize === 'medium') {
            classification = 'confirmed_medium';
            confidence = 0.98;
            evidence.push('Wachturm meldet 1.001–5.000 Truppen');
        } else if (attack.watchSize === 'small') {
            classification = 'confirmed_small';
            confidence = 0.98;
            evidence.push('Wachturm meldet höchstens 1.000 Truppen');
        } else if (attack.inferredUnit === 'snob') {
            classification = 'probable_noble';
            confidence = Math.max(confidence, Number(attack.speedConfidence) || 0.72);
            evidence.push('Korrigierte Gesamtlaufzeit passt zur Adelsgeschwindigkeit');
        } else if (attack.renamedUnit === 'snob') {
            classification = 'probable_noble';
            confidence = 0.55;
            evidence.push('Umbenennung nennt ein Adelsgeschlecht als langsamste Einheit');
        } else if (/\b(ag|adel|noble|snob)\b/.test(label)) {
            classification = 'possible_noble';
            confidence = 0.35;
            evidence.push('Befehlsname enthält einen schwachen AG-Hinweis');
        } else if (attack.inferredUnit) {
            classification = `speed_${attack.inferredUnit}`;
            confidence = Math.max(confidence, Number(attack.speedConfidence) || 0.65);
            evidence.push(`Korrigierte Gesamtlaufzeit passt zur Geschwindigkeitsklasse ${inferredNames}`);
        } else if (attack.renamedUnit) {
            classification = `renamed_${attack.renamedUnit}`;
            confidence = 0.5;
            evidence.push(`Umbenennung nennt ${UNIT_NAMES[attack.renamedUnit] || attack.renamedUnit} als langsamste Einheit`);
        }

        if (/\bfake\b/.test(label)) {
            evidence.push('Befehlsname enthält „Fake“; nicht als Beweis gewertet');
            if (!attack.watchNoble && !attack.watchSize && !attack.inferredUnit) confidence = Math.min(confidence, 0.45);
        }
        return { classification, confidence, evidence };
    }

    function attackSpeedFamily(attack) {
        const units = attack.inferredUnits?.length
            ? attack.inferredUnits
            : attack.inferredUnit ? [attack.inferredUnit] : attack.renamedUnit ? [attack.renamedUnit] : [];
        if (units.includes('snob')) return 'noble';
        if (units.some((unit) => ['ram', 'catapult'].includes(unit))) return 'siege';
        if (units.some((unit) => ['spear', 'sword', 'axe', 'archer'].includes(unit))) return 'infantry';
        if (units.some((unit) => ['light', 'marcher', 'heavy', 'knight'].includes(unit))) return 'cavalry';
        if (units.includes('spy')) return 'scout';
        return 'unknown';
    }

    function estimateGroupRequirement(group, configValue = createDefaultConfig(), context = {}) {
        const config = mergeConfig(configValue);
        const attacks = group.attacks.slice().sort((a, b) => a.arrival - b.arrival);
        const lastBySource = new Map();
        const contributions = [];
        let equivalent = 0;
        let total = 0;
        for (const attack of attacks) {
            const assessed = classifyAttack(attack);
            let kind = 'unknown';
            if (attack.watchNoble || ['confirmed_noble', 'probable_noble'].includes(assessed.classification)) kind = 'noble';
            else if (attack.watchSize && config.requirements[attack.watchSize]) kind = attack.watchSize;
            else if (assessed.classification === 'confirmed_large') kind = 'large';
            else if (assessed.classification === 'confirmed_medium') kind = 'medium';
            else if (assessed.classification === 'confirmed_small') kind = 'small';
            else kind = attackSpeedFamily(attack);

            const sourceKey = attack.sourceId || attack.sourceCoord || attack.sourceName || attack.commandId;
            const previous = lastBySource.get(sourceKey);
            const repeated = previous && (attack.arrival - previous.arrival) / 1000 <= config.sameSourceWaveGapSeconds;
            const weight = repeated && kind !== 'noble' ? config.repeatedCommandWeight : 1;
            const basePoints = Number(config.requirements[kind] ?? config.noWatchtowerRequirements[kind]
                ?? config.requirements.unknown) || 0;
            const points = basePoints * weight;
            const equivalentFactor = ({ small: 0.15, medium: 0.5, scout: 0.25, cavalry: 0.65, infantry: 0.8 })[kind] ?? 1;
            const equivalentPart = equivalentFactor * weight;
            if (equivalent + equivalentPart <= config.maxEquivalentAttacks) {
                total += points;
                equivalent += equivalentPart;
                contributions.push({
                    commandId: attack.commandId, kind, weight, points,
                    authoritative: Boolean(attack.watchNoble || attack.watchSize),
                    confidence: assessed.confidence
                });
            }
            lastBySource.set(sourceKey, attack);
        }
        const hasAuthoritativeSize = attacks.some((attack) => attack.watchNoble || attack.watchSize);
        return {
            baseDefense: Math.round(total), equivalentAttacks: equivalent, contributions,
            model: hasAuthoritativeSize ? (contributions.every((item) => item.authoritative) ? 'watchtower' : 'mixed') : 'timing',
            watchtowerAvailable: context.world?.watchtower === true
        };
    }

    function assessGroup(group, context = {}) {
        const now = Number(context.now) || Date.now();
        const config = mergeConfig(context.config);
        const world = context.world || {};
        const requirement = estimateGroupRequirement(group, config, { world });
        const classifications = group.attacks.map(classifyAttack);
        const minutes = Math.max(0, (group.firstArrival - now) / 60000);
        const reasons = [];
        let score = 0;

        if (minutes <= 15) { score += 25; reasons.push('erste Ankunft in höchstens 15 Minuten'); }
        else if (minutes <= 60) { score += 20; reasons.push('erste Ankunft in höchstens einer Stunde'); }
        else if (minutes <= 240) { score += 12; reasons.push('erste Ankunft in höchstens vier Stunden'); }
        else if (minutes <= 720) { score += 6; reasons.push('erste Ankunft in höchstens zwölf Stunden'); }

        score += Math.min(20, Math.max(0, group.attacks.length - 1) * 3);
        if (group.attacks.length > 1) reasons.push(`${group.attacks.length} Befehle in diesem Zeitfenster`);
        score += Math.min(15, Math.max(0, group.uniqueSources - 1) * 3);
        if (group.uniqueSources > 1) reasons.push(`${group.uniqueSources} verschiedene Herkunftsdörfer`);

        const watchSizes = group.attacks.map((attack) => attack.watchSize).filter(Boolean);
        if (watchSizes.includes('large')) { score += 28; reasons.push('Wachturm bestätigt mindestens einen großen Angriff'); }
        else if (watchSizes.includes('medium')) { score += 18; reasons.push('Wachturm bestätigt mindestens einen mittleren Angriff'); }
        else if (watchSizes.length && watchSizes.every((size) => size === 'small')) {
            score += 3;
            reasons.push('Wachturm meldet ausschließlich kleine Befehle');
        }

        const confirmedNoble = group.attacks.some((attack) => attack.watchNoble);
        const probableNoble = classifications.some((item) => ['probable_noble', 'possible_noble'].includes(item.classification));
        if (confirmedNoble) { score += 32; reasons.push('Wachturm bestätigt ein Adelsgeschlecht'); }
        else if (group.nobleRuns.length) { score += 25; reasons.push('kurze, AG-verdächtige Folge aus demselben Herkunftsdorf'); }
        else if (group.crossSourceNobleRuns?.length) { score += 25; reasons.push('synchronisierte AG-verdächtige Folge aus mehreren Herkunftsdörfern'); }
        else if (probableNoble) { score += 14; reasons.push('mindestens ein schwacher AG-Hinweis'); }

        if (group.sameSourceRuns.length) { score += Math.min(10, group.sameSourceRuns.length * 4); reasons.push('enge Befehlsfolge aus gleicher Herkunft'); }
        if (group.synchronizedRuns?.length) {
            score += Math.min(12, group.synchronizedRuns.length * 6);
            reasons.push('zeitlich synchronisierte Befehlsfolge aus mehreren Herkunftsdörfern');
        }
        const siegeSignals = group.attacks.filter((attack) => {
            const units = attack.inferredUnits?.length ? attack.inferredUnits : [attack.inferredUnit || attack.renamedUnit];
            return units.some((unit) => ['ram', 'catapult'].includes(unit));
        });
        if (siegeSignals.length) {
            score += Math.min(12, 6 + Math.max(0, siegeSignals.length - 1) * 2);
            reasons.push(`${siegeSignals.length} Befehl${siegeSignals.length === 1 ? '' : 'e'} mit Belagerungsgeschwindigkeit; mit Voll-Off vereinbar, aber auch per Einzelramme fakebar`);
        }
        if (!world.watchtower && !watchSizes.length && !confirmedNoble) {
            reasons.push('kein Wachturm: Bedarf aus Laufzeitklasse, Befehlsdichte und Quellenvielfalt statt unbekannter Truppenmenge modelliert');
        }
        const nightProtected = isNightArrival(group.firstArrival, world);
        if (nightProtected) { score -= 8; reasons.push('erste Ankunft liegt im aktiven Nachtbonus'); }

        const inventory = context.targetInventory || null;
        const wallLevel = Number.isFinite(context.wallLevel) ? context.wallLevel : config.assumedWallLevel;
        const nightMultiplier = nightProtected ? Number(world.night?.defenseFactor || 2) : 1;
        const defense = inventory
            ? computeDefense(inventory.thereTroops || inventory.troops, context.unitInfo, {
                archerEnabled: world.archer !== false,
                wallMultiplier: wallMultiplier(wallLevel, config),
                nightMultiplier
            })
            : null;
        const coverage = defense && requirement.baseDefense > 0 ? defense.effective / requirement.baseDefense : null;
        if (coverage !== null && coverage < 0.5) { score += 22; reasons.push('bekannte Verteidigung deckt weniger als die Hälfte der Planannahme'); }
        else if (coverage !== null && coverage < 1) { score += 12; reasons.push('bekannte Verteidigung liegt unter der Planannahme'); }
        else if (coverage !== null && coverage >= 1.5) { score -= 6; reasons.push('bekannte Verteidigung übertrifft die Planannahme deutlich'); }

        score = Math.round(clamp(score, 0, 100));
        const level = score >= 75 ? 'critical' : score >= 55 ? 'high' : score >= 30 ? 'medium' : 'low';
        let classification = 'unknown';
        if (confirmedNoble) classification = 'confirmed_noble';
        else if (group.nobleRuns.length || group.crossSourceNobleRuns?.length || probableNoble) classification = 'possible_noble';
        else if (watchSizes.includes('large')) classification = 'confirmed_large';
        else if (watchSizes.includes('medium')) classification = 'confirmed_medium';
        else if (watchSizes.length && watchSizes.every((size) => size === 'small')) classification = 'confirmed_small';
        else if (siegeSignals.length) classification = 'possible_off';
        else if (score >= 55) classification = 'serious_unknown';

        const authoritative = group.attacks.filter((attack) => attack.watchSize || attack.watchNoble).length;
        const inferred = group.attacks.filter((attack) => attack.inferredUnit).length;
        const renamed = group.attacks.filter((attack) => attack.renamedUnit).length;
        const confidence = clamp(0.25 + (authoritative / Math.max(1, group.attacks.length)) * 0.55
            + (inferred ? 0.1 : 0) + (renamed ? 0.05 : 0) + (inventory ? 0.1 : 0), 0.2, 0.98);
        return {
            ...group,
            score,
            level,
            classification,
            confidence,
            reasons,
            requirement,
            defense,
            coverage,
            nightProtected,
            wallLevel,
            minutesUntil: minutes
        };
    }

    function travelSeconds(sourceCoord, targetCoord, troops, unitInfo = {}) {
        const distance = distanceBetween(sourceCoord, targetCoord);
        if (!Number.isFinite(distance)) return null;
        const info = unitInfoWithFallback(unitInfo);
        const speeds = Object.entries(troops || {})
            .filter(([, amount]) => Number(amount) > 0)
            .map(([unit]) => Number(info[unit]?.speed))
            .filter((speed) => Number.isFinite(speed) && speed > 0.1);
        if (!speeds.length) return null;
        // get_unit_info liefert die auf dieser Welt geltenden Minuten pro Feld.
        // Ein erneutes Anwenden von config.unit_speed verfälscht die Laufzeit.
        return Math.ceil(distance * Math.max(...speeds) * 60);
    }

    function inferSlowestUnit(durationSeconds, sourceCoord, targetCoord, unitInfo = {}) {
        const distance = distanceBetween(sourceCoord, targetCoord);
        if (!Number.isFinite(durationSeconds) || !Number.isFinite(distance) || distance <= 0) {
            return { unit: null, candidates: [], confidence: 0, observedMinutesPerField: null };
        }
        const observed = durationSeconds / 60 / distance;
        const info = unitInfoWithFallback(unitInfo);
        const candidates = Object.entries(info)
            .filter(([unit, stats]) => unit !== 'militia' && Number(stats.speed) > 0)
            .map(([unit, stats]) => {
                const effectiveSpeed = Number(stats.speed);
                return { unit, difference: Math.abs(observed - effectiveSpeed) / effectiveSpeed };
            })
            .sort((a, b) => a.difference - b.difference);
        const best = candidates[0];
        if (!best || best.difference > 0.12) {
            return { unit: null, candidates: [], confidence: 0, observedMinutesPerField: observed };
        }
        const sameSpeedClass = candidates
            .filter((candidate) => candidate.difference <= Math.max(0.025, best.difference + 0.015))
            .map((candidate) => candidate.unit);
        const ambiguityFactor = sameSpeedClass.length > 1 ? 0.82 : 1;
        return {
            unit: best.unit,
            candidates: sameSpeedClass,
            confidence: clamp((1 - best.difference * 3) * ambiguityFactor, 0.45, 0.92),
            observedMinutesPerField: observed
        };
    }

    function scaleTroops(troops, factor) {
        return Object.fromEntries(Object.entries(troops).map(([unit, amount]) => [unit,
            Math.min(Math.max(0, Math.floor(Number(amount) || 0)), Math.max(0, Math.ceil((Number(amount) || 0) * factor)))
        ]));
    }

    function availableDefenseTroops(entry, config, used = {}) {
        const troops = entry.troops || {};
        return Object.fromEntries(DEFENSE_UNITS.map((unit) => {
            const amount = Math.max(0, Math.floor(Number(troops[unit]) || 0));
            const reserve = Math.max(Number(config.fixedReserve[unit]) || 0, Math.floor(amount * config.reservePercent / 100));
            return [unit, Math.max(0, amount - reserve - (Number(used[unit]) || 0))];
        }));
    }

    function troopPopulation(troops, unitInfo) {
        const info = unitInfoWithFallback(unitInfo);
        return Object.entries(troops || {}).reduce((sum, [unit, amount]) => sum + (Number(amount) || 0) * (Number(info[unit]?.pop) || 0), 0);
    }

    function troopAttackPower(troops, unitInfo) {
        const info = unitInfoWithFallback(unitInfo);
        return Math.round(Object.entries(troops || {}).reduce((sum, [unit, amount]) =>
            sum + Math.max(0, Number(amount) || 0) * Math.max(0, Number(info[unit]?.attack) || 0), 0));
    }

    function mobileOffenseTroops(entry) {
        const troops = entry?.troops || {};
        return Object.fromEntries(DODGE_UNITS
            .map((unit) => [unit, Math.max(0, Math.floor(Number(troops[unit]) || 0))])
            .filter(([, amount]) => amount > 0));
    }

    function dodgeWindowReturnAt(window, supportTravelSeconds = null) {
        if (window.mode === 'short_cancel') {
            return window.cancelAt + (window.cancelAt - window.sendAt);
        }
        if (!Number.isFinite(supportTravelSeconds)) return null;
        const travelMs = Math.max(0, supportTravelSeconds) * 1000;
        // Ist die Unterstützung schon angekommen, kann sie nach dem letzten
        // Einschlag zurückgerufen werden. Andernfalls ist die früheste sichere
        // Rückkehr: am Ziel ankommen und unmittelbar wieder zurückziehen.
        return Math.max(window.cancelAt + travelMs, window.sendAt + 2 * travelMs);
    }

    function planDodgeWindows(arrivals, context = {}) {
        const leadMs = Math.max(0, Number(context.leadSeconds ?? 90)) * 1000;
        const postMs = Math.max(0, Number(context.postSeconds ?? 5)) * 1000;
        const cancelWindowValue = context.commandCancelSeconds === undefined ? 600 : Number(context.commandCancelSeconds);
        const cancelWindowMs = Math.max(1, Number.isFinite(cancelWindowValue) ? cancelWindowValue : 0) * 1000;
        const cancelSafetyMs = Math.max(0, Number(context.cancelSafetySeconds ?? 30)) * 1000;
        const usableCancelMs = Math.max(1000, cancelWindowMs - cancelSafetyMs);
        const minimumHomeMs = Math.max(0, Number(context.minimumHomeSeconds ?? 90)) * 1000;
        const supportTravelSeconds = Number.isFinite(Number(context.supportTravelSeconds))
            ? Math.max(0, Number(context.supportTravelSeconds)) : null;
        const ordered = [...new Set((arrivals || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
        const base = ordered.map((arrival) => ({
            arrivals: [arrival], firstArrival: arrival, lastArrival: arrival,
            sendAt: arrival - leadMs, cancelAt: arrival + postMs, mode: 'short_cancel'
        }));
        const windows = [];
        let current = null;

        const mergeInto = (window, next) => {
            window.arrivals.push(...next.arrivals);
            window.lastArrival = next.lastArrival;
            window.cancelAt = next.cancelAt;
        };
        const canReturnBefore = (window, next) => {
            const canCancelWindow = window.mode === 'short_cancel'
                && window.cancelAt - window.sendAt <= usableCancelMs;
            const returnAt = canCancelWindow
                ? dodgeWindowReturnAt(window, supportTravelSeconds)
                : Number.isFinite(supportTravelSeconds)
                    ? Math.max(
                        window.cancelAt + supportTravelSeconds * 1000,
                        window.sendAt + 2 * supportTravelSeconds * 1000
                    )
                    : null;
            return Number.isFinite(returnAt) && returnAt + minimumHomeMs <= next.sendAt;
        };

        for (const next of base) {
            if (!current) {
                current = next;
                continue;
            }
            const mergedSpan = next.cancelAt - current.sendAt;
            if (current.mode === 'short_cancel' && mergedSpan <= usableCancelMs) {
                mergeInto(current, next);
            } else if (canReturnBefore(current, next)) {
                windows.push(current);
                current = next;
            } else {
                current.mode = 'support_hold';
                mergeInto(current, next);
            }
        }
        if (current) windows.push(current);
        return windows.map((window) => ({
            ...window,
            durationSeconds: Math.ceil((window.cancelAt - window.sendAt) / 1000),
            cancelDeadline: window.sendAt + cancelWindowMs,
            returnAt: dodgeWindowReturnAt(window, supportTravelSeconds),
            cancelable: window.mode === 'short_cancel' && window.cancelAt - window.sendAt <= usableCancelMs
        }));
    }

    function supportDestinationSafety(windows, destinationArrivals, travelSeconds, safetySeconds = 90, cancelSafetySeconds = 30, minimumHomeSeconds = 90) {
        const travelMs = Math.max(0, Number(travelSeconds) || 0) * 1000;
        const safetyMs = Math.max(0, Number(safetySeconds) || 0) * 1000;
        const cancelSafety = Math.max(0, Number(cancelSafetySeconds) || 0);
        const minimumHomeMs = Math.max(0, Number(minimumHomeSeconds) || 0) * 1000;
        const attacks = (destinationArrivals || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
        const planned = [];
        for (const window of windows || []) {
            const arrivalAt = window.sendAt + travelMs;
            const cancelSafe = window.cancelable && Number(travelSeconds) > window.durationSeconds + cancelSafety;
            if (cancelSafe) {
                planned.push({
                    ...window, actionKind: 'cancel', actionAt: window.cancelAt,
                    returnAt: window.cancelAt + (window.cancelAt - window.sendAt)
                });
                continue;
            }
            const actionAt = Math.max(window.cancelAt, arrivalAt);
            const conflict = attacks.find((attackAt) => attackAt >= arrivalAt && attackAt <= actionAt + safetyMs);
            if (Number.isFinite(conflict)) {
                return { safe: false, conflictAt: conflict, arrivalAt, withdrawBy: actionAt, windows: [] };
            }
            planned.push({ ...window, actionKind: 'withdraw', actionAt, returnAt: actionAt + travelMs });
        }
        for (let index = 0; index < planned.length - 1; index += 1) {
            if (planned[index].returnAt + minimumHomeMs > planned[index + 1].sendAt) {
                return { safe: false, conflictAt: null, reason: 'Rückkehr zum Herkunftsdorf ist vor dem nächsten Ausweichfenster zu spät.', windows: [] };
            }
        }
        return { safe: true, conflictAt: null, windows: planned };
    }

    function evaluateBarbarianDodgeWindows(windows, travelSeconds, context = {}) {
        const travel = Math.max(0, Number(travelSeconds) || 0);
        const cancelSafety = Math.max(0, Number(context.cancelSafetySeconds) || 0);
        const minimumHomeMs = Math.max(0, Number(context.minimumHomeSeconds) || 0) * 1000;
        const postMs = Math.max(0, Number(context.postSeconds) || 0) * 1000;
        const landingAllowed = context.landingAllowed === true;
        const planned = [];
        for (const window of windows || []) {
            const cancelSafe = window.cancelable && travel > window.durationSeconds + cancelSafety;
            if (cancelSafe) {
                planned.push({
                    ...window, actionKind: 'cancel', actionAt: window.cancelAt,
                    returnAt: window.cancelAt + (window.cancelAt - window.sendAt), landingFallback: false
                });
                continue;
            }
            if (!landingAllowed) {
                return { ready: false, reason: 'Der Befehl kann nicht sicher abgebrochen werden und die Off erfüllt den belastbaren Barbaren-Fallback nicht.', windows: [] };
            }
            const arrivalAt = window.sendAt + travel * 1000;
            const returnAt = window.sendAt + 2 * travel * 1000;
            if (returnAt < window.lastArrival + postMs) {
                return { ready: false, reason: 'Die vom Barbarendorf zurückkehrende Off wäre vor dem letzten geschützten Einschlag wieder zuhause.', windows: [] };
            }
            planned.push({
                ...window, actionKind: 'land', actionAt: arrivalAt,
                returnAt, landingFallback: true
            });
        }
        for (let index = 0; index < planned.length - 1; index += 1) {
            if (planned[index].returnAt + minimumHomeMs > planned[index + 1].sendAt) {
                return { ready: false, reason: 'Die Off wäre vor dem nächsten Ausweichfenster nicht lange genug wieder zuhause.', windows: [] };
            }
        }
        return { ready: true, reason: '', windows: planned, needsLanding: planned.some((window) => window.landingFallback) };
    }

    function planSupport(assessments, inventoryEntries, context = {}) {
        const now = Number(context.now) || Date.now();
        const config = mergeConfig(context.config);
        const world = context.world || {};
        const unitInfo = unitInfoWithFallback(context.unitInfo);
        const reservations = deepClone(context.reservations || {});
        const inventory = inventoryEntries.filter((entry) => entry?.villageId && entry.coord);
        const targetPlanned = new Map();
        const threatenedVillages = new Set(assessments.flatMap((assessment) => [
            assessment.targetId ? `id:${assessment.targetId}` : null,
            assessment.targetCoord ? `coord:${assessment.targetCoord}` : null
        ]).filter(Boolean));
        const assignments = [];
        const shortages = [];

        const sorted = assessments.slice().sort((a, b) => b.score - a.score || a.firstArrival - b.firstArrival);
        for (const assessment of sorted) {
            const targetEntry = inventory.find((entry) => String(entry.villageId) === String(assessment.targetId)
                || entry.coord === assessment.targetCoord);
            const wallLevel = assessment.wallLevel ?? config.assumedWallLevel;
            const nightMultiplier = assessment.nightProtected ? Number(world.night?.defenseFactor || 2) : 1;
            const targetDefense = targetEntry
                ? computeDefense(targetEntry.thereTroops || targetEntry.troops, unitInfo, { archerEnabled: world.archer !== false })
                : { baseEffective: 0 };
            const alreadyPlanned = targetPlanned.get(assessment.targetKey) || 0;
            let need = Math.max(0, assessment.requirement.baseDefense
                - (targetDefense.baseEffective + alreadyPlanned) * wallMultiplier(wallLevel, config) * nightMultiplier);
            if (need <= 0) continue;

            const deadline = assessment.firstArrival - config.supportBufferMinutes * 60000;
            const candidates = inventory
                .filter((entry) => String(entry.villageId) !== String(assessment.targetId) && entry.coord !== assessment.targetCoord)
                .filter((entry) => !config.excludeThreatenedSources
                    || (!threatenedVillages.has(`id:${entry.villageId}`) && !threatenedVillages.has(`coord:${entry.coord}`)))
                .map((entry) => {
                    const available = availableDefenseTroops(entry, config, reservations[entry.villageId] || {});
                    const seconds = travelSeconds(entry.coord, assessment.targetCoord, available, unitInfo);
                    const defense = computeDefense(available, unitInfo, { archerEnabled: world.archer !== false });
                    return { entry, available, seconds, defense, canArrive: Number.isFinite(seconds) && now + seconds * 1000 <= deadline };
                })
                .filter((candidate) => candidate.canArrive && candidate.defense.baseEffective > 0)
                .sort((a, b) => a.seconds - b.seconds || b.defense.baseEffective - a.defense.baseEffective);

            let addedForTarget = 0;
            for (const candidate of candidates) {
                if (need <= 0) break;
                const targetBaseNeed = need / (wallMultiplier(wallLevel, config) * nightMultiplier);
                const factor = Math.min(1, targetBaseNeed / candidate.defense.baseEffective);
                let troops = scaleTroops(candidate.available, factor);
                if (troopPopulation(troops, unitInfo) < config.minimumSupportPop && factor < 1) {
                    const minFactor = Math.min(1, config.minimumSupportPop / Math.max(1, troopPopulation(candidate.available, unitInfo)));
                    troops = scaleTroops(candidate.available, Math.max(factor, minFactor));
                }
                const defense = computeDefense(troops, unitInfo, { archerEnabled: world.archer !== false });
                if (defense.baseEffective <= 0 || troopPopulation(troops, unitInfo) < Math.min(50, config.minimumSupportPop)) continue;

                const id = `${assessment.id}:${candidate.entry.villageId}`;
                assignments.push({
                    id,
                    groupId: assessment.id,
                    targetId: assessment.targetId,
                    targetCoord: assessment.targetCoord,
                    targetName: assessment.targetName,
                    sourceId: candidate.entry.villageId,
                    sourceCoord: candidate.entry.coord,
                    sourceName: candidate.entry.name,
                    troops,
                    baseDefense: Math.round(defense.baseEffective),
                    population: troopPopulation(troops, unitInfo),
                    travelSeconds: candidate.seconds,
                    arrivalIfSentNow: now + candidate.seconds * 1000,
                    sendBy: deadline - candidate.seconds * 1000,
                    deadline,
                    neededUntil: assessment.lastArrival || assessment.firstArrival,
                    plannedAt: now,
                    status: 'draft'
                });
                reservations[candidate.entry.villageId] ||= {};
                for (const [unit, amount] of Object.entries(troops)) {
                    reservations[candidate.entry.villageId][unit] = (reservations[candidate.entry.villageId][unit] || 0) + amount;
                }
                addedForTarget += defense.baseEffective;
                targetPlanned.set(assessment.targetKey, alreadyPlanned + addedForTarget);
                need = Math.max(0, assessment.requirement.baseDefense
                    - (targetDefense.baseEffective + alreadyPlanned + addedForTarget) * wallMultiplier(wallLevel, config) * nightMultiplier);
            }
            if (need > 0) {
                shortages.push({
                    groupId: assessment.id,
                    targetId: assessment.targetId,
                    targetName: assessment.targetName,
                    missingEffectiveDefense: Math.round(need),
                    deadline,
                    reachableSources: candidates.length
                });
            }
        }
        return { assignments, shortages, reservations };
    }

    function supportAssignmentLifecycle(assignment, now = Date.now(), neededUntilOverride = null) {
        const status = String(assignment?.status || 'draft');
        const sentAt = Number(assignment?.sentAt);
        const expectedArrival = Number(assignment?.expectedArrival)
            || (Number.isFinite(sentAt) ? sentAt + Math.max(0, Number(assignment?.travelSeconds) || 0) * 1000 : null);
        const neededUntil = Number(neededUntilOverride) || Number(assignment?.neededUntil) || Number(assignment?.deadline) || null;
        const returnStartedAt = Number(assignment?.returnStartedAt);
        const expectedHomeAt = Number(assignment?.expectedHomeAt)
            || (Number.isFinite(returnStartedAt) ? returnStartedAt + Math.max(0, Number(assignment?.travelSeconds) || 0) * 1000 : null);

        if (status === 'cancelled') return { phase: 'cancelled', expectedArrival, neededUntil, expectedHomeAt };
        if (status === 'returned') return { phase: 'returned', expectedArrival, neededUntil, expectedHomeAt };
        if (status === 'returning') {
            return {
                phase: Number.isFinite(expectedHomeAt) && now >= expectedHomeAt ? 'returned' : 'returning',
                expectedArrival, neededUntil, expectedHomeAt
            };
        }
        if (!['sent', 'arrived', 'return_due'].includes(status)) {
            return { phase: status === 'prepared' ? 'prepared' : 'draft', expectedArrival, neededUntil, expectedHomeAt };
        }
        if (status === 'sent') {
            if (!Number.isFinite(expectedArrival) || now < expectedArrival) {
                return { phase: 'underway', expectedArrival, neededUntil, expectedHomeAt };
            }
        }
        if (Number.isFinite(neededUntil) && now >= neededUntil) {
            return { phase: 'return_due', expectedArrival, neededUntil, expectedHomeAt };
        }
        return { phase: 'arrived', expectedArrival, neededUntil, expectedHomeAt };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            STANDARD_UNIT_INFO,
            PRESET_DEFINITIONS,
            createDefaultConfig,
            mergeConfig,
            normalizeText,
            detectCommandType,
            detectRenamedUnit,
            parseFormattedInt,
            parseCoord,
            distanceBetween,
            parseDurationText,
            parseReturnTimestamp,
            unitInfoWithFallback,
            wallMultiplier,
            isNightArrival,
            computeDefense,
            classifyAttack,
            groupAttacks,
            estimateGroupRequirement,
            assessGroup,
            travelSeconds,
            inferSlowestUnit,
            troopAttackPower,
            mobileOffenseTroops,
            planDodgeWindows,
            supportDestinationSafety,
            evaluateBarbarianDodgeWindows,
            parseBarbarianVillageMap,
            indexNearbyBarbarians,
            planSupport,
            supportAssignmentLifecycle,
            plannedSupportMatches
        };
        return;
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const gameData = window.game_data || {};
    const search = new URLSearchParams(window.location.search);
    const screen = search.get('screen') || gameData.screen || '';
    const mode = search.get('mode') || gameData.mode || '';
    const isIncomingScreen = screen === 'overview_villages' && mode === 'incomings';
    const isPlaceScreen = screen === 'place';
    const isMapScreen = screen === 'map';
    if (document.getElementById(`${SCRIPT_ID}-root`)) return;

    const state = {
        store: loadStore(),
        config: null,
        world: null,
        unitInfo: unitInfoWithFallback(),
        worldDataPromise: null,
        attacks: [],
        incomingSupports: [],
        groups: [],
        assessments: [],
        incomingTable: null,
        groupTable: null,
        dodgeTable: null,
        planTable: null,
        panel: null,
        statusElement: null,
        summaryElement: null,
        worldElement: null,
        filterLevel: 'all',
        filterStatus: 'all',
        filterSearch: '',
        urgentOnly: false,
        observer: null,
        refreshTimer: null,
        alertTimer: null,
        rendering: false,
        lastAssessmentSignature: null,
        openDetailGroups: new Set()
    };
    state.config = mergeConfig(state.store.config);
    state.world = fallbackWorldData();

    injectStyles();
    if (isIncomingScreen) initIncomingScreen();
    else if (isPlaceScreen) initPlaceScreen();
    else if (isMapScreen) initMapScreen();

    window.DSDefenseAssistant = Object.freeze({
        version: VERSION,
        refresh: () => isIncomingScreen && analyzeIncoming(true),
        groupAttacks,
        assessGroup,
        planDodgeWindows,
        planSupport
    });

    function storageKey() {
        const world = gameData.world || window.location.hostname.split('.')[0] || 'world';
        const player = gameData.player?.id || 'player';
        return `${STORAGE_PREFIX}:v${STORAGE_VERSION}:${window.location.host}:${world}:${player}`;
    }

    function emptyStore() {
        return {
            version: STORAGE_VERSION,
            config: createDefaultConfig(),
            groupState: {},
            commandState: {},
            villageOverrides: {},
            inventory: { own: [], there: [], walls: [], loadedAt: 0, source: '' },
            activePlan: null,
            dodgeSettings: {},
            dodgePlan: null,
            barbarianTargets: { loadedAt: 0, bySource: {}, source: '' },
            reservations: {},
            knownCommands: [],
            notified: {},
            worldCache: null,
            lastGroups: []
        };
    }

    function loadStore() {
        const empty = emptyStore();
        try {
            const parsed = JSON.parse(window.localStorage.getItem(storageKey()) || 'null');
            if (!parsed || parsed.version !== STORAGE_VERSION) return empty;
            return {
                ...empty,
                ...parsed,
                config: mergeConfig(parsed.config),
                groupState: parsed.groupState && typeof parsed.groupState === 'object' ? parsed.groupState : {},
                commandState: parsed.commandState && typeof parsed.commandState === 'object' ? parsed.commandState : {},
                villageOverrides: parsed.villageOverrides && typeof parsed.villageOverrides === 'object' ? parsed.villageOverrides : {},
                inventory: {
                    ...empty.inventory,
                    ...(parsed.inventory || {}),
                    own: Array.isArray(parsed.inventory?.own) ? parsed.inventory.own : [],
                    there: Array.isArray(parsed.inventory?.there) ? parsed.inventory.there : [],
                    walls: Array.isArray(parsed.inventory?.walls) ? parsed.inventory.walls : []
                },
                dodgeSettings: parsed.dodgeSettings && typeof parsed.dodgeSettings === 'object' ? parsed.dodgeSettings : {},
                barbarianTargets: {
                    ...empty.barbarianTargets,
                    ...(parsed.barbarianTargets || {}),
                    bySource: parsed.barbarianTargets?.bySource && typeof parsed.barbarianTargets.bySource === 'object'
                        ? parsed.barbarianTargets.bySource : {}
                },
                reservations: parsed.reservations && typeof parsed.reservations === 'object' ? parsed.reservations : {},
                knownCommands: Array.isArray(parsed.knownCommands) ? parsed.knownCommands.slice(-10000) : [],
                notified: parsed.notified && typeof parsed.notified === 'object' ? parsed.notified : {},
                lastGroups: Array.isArray(parsed.lastGroups) ? parsed.lastGroups.slice(0, 500) : []
            };
        } catch (_) {
            return empty;
        }
    }

    function saveStore() {
        state.store.config = state.config;
        try {
            window.localStorage.setItem(storageKey(), JSON.stringify(state.store));
        } catch (_) {
            notify('Daten konnten nicht im Browser gespeichert werden.', true);
        }
    }

    function fallbackWorldData() {
        const configuredUnits = Array.isArray(gameData.units) ? gameData.units : ALL_UNITS;
        return {
            source: 'fallback',
            loadedAt: 0,
            speed: 1,
            unitSpeed: 1,
            archer: configuredUnits.includes('archer'),
            watchtower: Object.prototype.hasOwnProperty.call(gameData.village?.buildings || {}, 'watchtower'),
            church: Object.prototype.hasOwnProperty.call(gameData.village?.buildings || {}, 'church'),
            morale: null,
            commandCancelSeconds: null,
            night: { active: false, startHour: 0, endHour: 8, defenseFactor: 2 }
        };
    }

    function textFromXml(root, selectors, fallback = null) {
        for (const selector of selectors) {
            const node = root.querySelector(selector);
            if (node && node.textContent.trim() !== '') return node.textContent.trim();
        }
        return fallback;
    }

    function boolFromXml(root, selectors, fallback = false) {
        const value = normalizeText(textFromXml(root, selectors, ''));
        if (['1', 'true', 'yes', 'ja', 'active'].includes(value)) return true;
        if (['0', 'false', 'no', 'nein', 'inactive'].includes(value)) return false;
        return fallback;
    }

    function parseWorldConfigXml(text) {
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        if (doc.querySelector('parsererror')) throw new Error('Weltkonfiguration ist kein gültiges XML.');
        const fallback = fallbackWorldData();
        return {
            ...fallback,
            source: 'official',
            loadedAt: Date.now(),
            speed: Number(textFromXml(doc, ['config > speed', 'speed'], '1')) || 1,
            unitSpeed: Number(textFromXml(doc, ['config > unit_speed', 'unit_speed'], '1')) || 1,
            archer: boolFromXml(doc, ['config > game > archer', 'game > archer', 'archer'], fallback.archer),
            watchtower: boolFromXml(doc, ['config > game > watchtower', 'game > watchtower', 'watchtower'], fallback.watchtower),
            church: boolFromXml(doc, ['config > game > church', 'game > church', 'church'], fallback.church),
            morale: textFromXml(doc, ['config > moral', 'moral'], null),
            commandCancelSeconds: (() => {
                const value = Number(textFromXml(doc, [
                    'config > commands > command_cancel_time', 'commands > command_cancel_time',
                    'config > command_cancel_time', 'command_cancel_time'
                ], ''));
                return Number.isFinite(value) && value > 0 ? value : null;
            })(),
            night: {
                active: boolFromXml(doc, ['config > night > active', 'night > active'], false),
                startHour: Number(textFromXml(doc, ['config > night > start_hour', 'night > start_hour'], '0')) || 0,
                endHour: Number(textFromXml(doc, ['config > night > end_hour', 'night > end_hour'], '8')) || 8,
                defenseFactor: Number(textFromXml(doc, ['config > night > def_factor', 'night > def_factor'], '2')) || 2
            }
        };
    }

    function parseUnitInfoXml(text) {
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        if (doc.querySelector('parsererror')) throw new Error('Einheitenwerte sind kein gültiges XML.');
        const result = {};
        for (const node of [...doc.documentElement.children]) {
            const unit = node.localName || node.nodeName;
            if (!ALL_UNITS.includes(unit)) continue;
            const value = (name, fallback = 0) => Number(node.querySelector(name)?.textContent) || fallback;
            result[unit] = {
                attack: value('attack'),
                defense: value('defense'),
                defenseCavalry: value('defense_cavalry'),
                defenseArcher: value('defense_archer', value('defense')),
                speed: value('speed', STANDARD_UNIT_INFO[unit]?.speed || 0),
                pop: value('pop', STANDARD_UNIT_INFO[unit]?.pop || 0)
            };
        }
        if (Object.keys(result).length < 5) throw new Error('Zu wenige Einheitenwerte empfangen.');
        return unitInfoWithFallback(result);
    }

    async function loadWorldData(force = false) {
        if (!force && state.worldDataPromise) return state.worldDataPromise;
        const cache = state.store.worldCache;
        const maxAge = 6 * 60 * 60 * 1000;
        if (!force && cache?.loadedAt && Date.now() - cache.loadedAt < maxAge && cache.world && cache.unitInfo
            && Number(cache.world.commandCancelSeconds) > 0) {
            state.world = { ...cache.world, source: 'cache' };
            state.unitInfo = unitInfoWithFallback(cache.unitInfo);
            renderWorldInfo();
            return { world: state.world, unitInfo: state.unitInfo };
        }

        state.worldDataPromise = (async () => {
            try {
                const [configResponse, unitResponse] = await Promise.all([
                    fetch('/interface.php?func=get_config', { credentials: 'same-origin' }),
                    fetch('/interface.php?func=get_unit_info', { credentials: 'same-origin' })
                ]);
                if (!configResponse.ok || !unitResponse.ok) throw new Error('Offizielle Welt-Endpunkte nicht erreichbar.');
                const [configText, unitText] = await Promise.all([configResponse.text(), unitResponse.text()]);
                state.world = parseWorldConfigXml(configText);
                state.unitInfo = parseUnitInfoXml(unitText);
                state.store.worldCache = {
                    loadedAt: Date.now(),
                    world: state.world,
                    unitInfo: state.unitInfo
                };
                saveStore();
            } catch (error) {
                state.world = { ...fallbackWorldData(), source: 'fallback', error: error.message };
                state.unitInfo = unitInfoWithFallback();
            }
            renderWorldInfo();
            return { world: state.world, unitInfo: state.unitInfo };
        })();
        return state.worldDataPromise;
    }

    function serverNow() {
        try {
            const value = window.Timing?.getCurrentServerTime?.();
            if (value instanceof Date) return value.getTime();
            if (Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
        } catch (_) {
            // Lokale Uhr bleibt der belastbare Fallback.
        }
        return Date.now();
    }

    function parseArrivalText(value, now = serverNow()) {
        const text = String(value || '').replace(/\u00a0/g, ' ').trim();
        const time = text.match(/(\d{1,2}):(\d{2}):(\d{2})(?::(\d{1,3}))?/);
        if (!time) return null;
        const base = new Date(now);
        if (/morgen|tomorrow/i.test(text)) base.setDate(base.getDate() + 1);
        const date = text.match(/(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?/);
        if (date) {
            const year = date[3] ? (Number(date[3]) < 100 ? 2000 + Number(date[3]) : Number(date[3])) : base.getFullYear();
            base.setFullYear(year, Number(date[2]) - 1, Number(date[1]));
        }
        base.setHours(Number(time[1]), Number(time[2]), Number(time[3]), Number(time[4] || 0));
        if (!date && !/morgen|tomorrow|heute|today/i.test(text) && base.getTime() < now - 12 * 60 * 60 * 1000) {
            base.setDate(base.getDate() + 1);
        }
        return base.getTime();
    }

    function resolveColumns(table) {
        const headerRows = [...table.querySelectorAll('tr')].filter((row) => row.querySelectorAll('th').length >= 3);
        const row = headerRows[headerRows.length - 1];
        const result = { select: 0, command: 1, target: 2, source: 3, arrival: 4, remaining: 5 };
        if (!row) return result;
        [...row.cells].forEach((cell, index) => {
            const text = normalizeText(cell.textContent);
            if (/befehl|command/.test(text)) result.command = index;
            else if (/ziel|target|destination/.test(text)) result.target = index;
            else if (/herkunft|origin|from/.test(text)) result.source = index;
            else if (/ankunft in|arrival in|restzeit/.test(text)) result.remaining = index;
            else if (/ankunft|arrival/.test(text)) result.arrival = index;
        });
        return result;
    }

    function idFromHref(href, preferred = []) {
        if (!href) return null;
        try {
            const params = new URL(href, window.location.href).searchParams;
            for (const key of [...preferred, 'id', 'village']) {
                if (params.get(key)) return params.get(key);
            }
        } catch (_) {
            // Ein unvollständiger Link wird weiter über RegEx versucht.
        }
        const match = String(href).match(/[?&](?:id|village)=(\d+)/);
        return match?.[1] || null;
    }

    function entityFromCell(cell, preferredIdKeys = []) {
        if (!cell) return { id: null, coord: null, name: '' };
        const anchors = [...cell.querySelectorAll('a[href]')];
        const anchor = anchors.find((item) => parseCoord(item.textContent)) || anchors[0] || null;
        const coord = parseCoord(cell.textContent);
        return {
            id: idFromHref(anchor?.href, preferredIdKeys),
            coord: coord?.text || null,
            name: anchor?.textContent.trim() || cell.textContent.trim()
        };
    }

    function watchtowerEvidence(row) {
        const text = normalizeText([
            row.className,
            row.getAttribute('title'),
            ...[...row.querySelectorAll('[class], [title], img')].flatMap((node) => [
                node.className?.baseVal || node.className || '', node.getAttribute('title') || '',
                node.getAttribute('alt') || '', node.getAttribute('src') || ''
            ])
        ].join(' '));
        const watchNoble = /watchtower[^ ]*(snob|noble)|snobwt|watchtower.*adel|adelsgeschlecht|noble/.test(text);
        let watchSize = null;
        if (/watchtower[^ ]*large|attack[_-]?large|grosser angriff|großer angriff|5000\+/.test(text)) watchSize = 'large';
        else if (/watchtower[^ ]*medium|attack[_-]?medium|mittlerer angriff|1001/.test(text)) watchSize = 'medium';
        else if (/watchtower[^ ]*small|attack[_-]?small|kleiner angriff|1-1000/.test(text)) watchSize = 'small';
        return { watchNoble, watchSize };
    }

    function inferUnitFromDuration(durationSeconds, sourceCoord, targetCoord) {
        return inferSlowestUnit(durationSeconds, sourceCoord, targetCoord, state.unitInfo);
    }

    function parseAttackRow(row, columns, now) {
        if (row.classList.contains('ds-da-generated') || row.querySelector('th')) return null;
        const cells = [...row.cells];
        if (cells.length < 4) return null;
        const commandCell = cells[columns.command] || cells[1];
        const targetCell = cells[columns.target] || cells[2];
        const sourceCell = cells[columns.source] || cells[3];
        const arrivalCell = cells[columns.arrival] || cells[cells.length - 2];
        const remainingCell = cells[columns.remaining] || cells[cells.length - 1];
        const commandLink = commandCell?.querySelector('a[href*="info_command"], a[href*="command"]');
        const label = commandLink?.textContent.trim() || commandCell?.textContent.trim() || 'Angriff';
        const technicalSignals = [
            row.className, row.dataset.commandType || '', commandCell?.dataset.commandType || '',
            ...[...row.querySelectorAll('img, [data-command-type], [class*="command"], [title], [alt]')].flatMap((node) => [
                node.className?.baseVal || node.className || '', node.dataset?.commandType || '',
                node.getAttribute('title') || '', node.getAttribute('alt') || '', node.getAttribute('src') || ''
            ])
        ].join(' ');
        if (detectCommandType(technicalSignals, label) !== 'attack') return null;
        const checkbox = row.querySelector('input[type="checkbox"][value], input[name*="id"][value]');
        const commandId = String(checkbox?.value || idFromHref(commandLink?.href, ['id']) || row.dataset.commandId || '').trim();
        if (!commandId && !parseCoord(targetCell?.textContent)) return null;

        const target = entityFromCell(targetCell, ['id', 'village']);
        const source = entityFromCell(sourceCell, ['id', 'village']);
        const timestampNode = row.querySelector('[data-arrival], [data-timestamp], [data-endtime]');
        let arrival = Number(timestampNode?.dataset.arrival || timestampNode?.dataset.timestamp || timestampNode?.dataset.endtime);
        if (Number.isFinite(arrival) && arrival > 0 && arrival < 1e12) arrival *= 1000;
        if (!Number.isFinite(arrival) || arrival <= 0) arrival = null;
        if (!Number.isFinite(arrival)) arrival = parseArrivalText(arrivalCell?.textContent, now);
        if (!Number.isFinite(arrival)) {
            const remaining = parseDurationText(remainingCell?.textContent);
            if (Number.isFinite(remaining)) arrival = now + remaining * 1000;
        }
        if (!Number.isFinite(arrival)) return null;

        const effectiveCommandId = commandId || `${target.coord}:${source.coord}:${arrival}`;
        const returnTimestamp = parseReturnTimestamp(label, arrival);

        const durationNode = row.querySelector('[data-duration], [data-travel-seconds]');
        const fixedDurationSeconds = Number(durationNode?.dataset.duration || durationNode?.dataset.travelSeconds || row.dataset.duration);
        let observedDurationSeconds = Number.isFinite(returnTimestamp)
            ? Math.round((returnTimestamp - arrival) / 1000)
            : fixedDurationSeconds;
        if (!Number.isFinite(observedDurationSeconds) || observedDurationSeconds <= 0) observedDurationSeconds = null;
        const durationSource = Number.isFinite(returnTimestamp)
            ? 'return_minus_arrival'
            : Number.isFinite(observedDurationSeconds) ? 'fixed_duration' : null;
        const commandCorrection = state.store.commandState[effectiveCommandId] || {};
        const correctedDurationSeconds = Number.isFinite(observedDurationSeconds)
            ? observedDurationSeconds + Math.max(0, Number(commandCorrection.renameDelaySeconds) || 0)
            : null;
        const inference = inferUnitFromDuration(correctedDurationSeconds, source.coord, target.coord);
        const watch = watchtowerEvidence(row);
        const attackerLink = sourceCell?.querySelector('a[href*="info_player"], a[href*="player"]');
        const renamedUnit = detectRenamedUnit(label)
            || [...(commandCell?.querySelectorAll('img, [data-unit]') || [])].map(unitFromNode).find(Boolean)
            || null;
        return {
            commandId: effectiveCommandId,
            label,
            targetId: target.id,
            targetCoord: target.coord,
            targetName: target.name,
            sourceId: source.id,
            sourceCoord: source.coord,
            sourceName: source.name,
            attackerId: idFromHref(attackerLink?.href, ['id']),
            attackerName: attackerLink?.textContent.trim() || '',
            arrival,
            durationSeconds: correctedDurationSeconds,
            observedDurationSeconds,
            correctedDurationSeconds,
            durationSource,
            returnTimestamp,
            renameDelaySeconds: Math.max(0, Number(commandCorrection.renameDelaySeconds) || 0),
            inferredUnit: inference.unit,
            inferredUnits: inference.candidates,
            renamedUnit,
            speedConfidence: inference.confidence,
            watchNoble: watch.watchNoble,
            watchSize: watch.watchSize,
            row,
            commandCell
        };
    }

    function parseIncomingSupportRow(row, columns, now) {
        if (row.classList.contains('ds-da-generated') || row.querySelector('th')) return null;
        const cells = [...row.cells];
        if (cells.length < 4) return null;
        const commandCell = cells[columns.command] || cells[1];
        const targetCell = cells[columns.target] || cells[2];
        const sourceCell = cells[columns.source] || cells[3];
        const arrivalCell = cells[columns.arrival] || cells[cells.length - 2];
        const remainingCell = cells[columns.remaining] || cells[cells.length - 1];
        const commandLink = commandCell?.querySelector('a[href*="info_command"], a[href*="command"]');
        const label = commandLink?.textContent.trim() || commandCell?.textContent.trim() || 'Unterstützung';
        const technicalSignals = [
            row.className, row.dataset.commandType || '', commandCell?.dataset.commandType || '',
            ...[...row.querySelectorAll('img, [data-command-type], [class*="command"], [title], [alt]')].flatMap((node) => [
                node.className?.baseVal || node.className || '', node.dataset?.commandType || '',
                node.getAttribute('title') || '', node.getAttribute('alt') || '', node.getAttribute('src') || ''
            ])
        ].join(' ');
        if (detectCommandType(technicalSignals, label) !== 'support') return null;
        const checkbox = row.querySelector('input[type="checkbox"][value], input[name*="id"][value]');
        const commandId = String(checkbox?.value || idFromHref(commandLink?.href, ['id']) || row.dataset.commandId || '').trim();
        const target = entityFromCell(targetCell, ['id', 'village']);
        const source = entityFromCell(sourceCell, ['id', 'village']);
        const timestampNode = row.querySelector('[data-arrival], [data-timestamp], [data-endtime]');
        let arrival = Number(timestampNode?.dataset.arrival || timestampNode?.dataset.timestamp || timestampNode?.dataset.endtime);
        if (Number.isFinite(arrival) && arrival > 0 && arrival < 1e12) arrival *= 1000;
        if (!Number.isFinite(arrival) || arrival <= 0) arrival = parseArrivalText(arrivalCell?.textContent, now);
        if (!Number.isFinite(arrival)) {
            const remaining = parseDurationText(remainingCell?.textContent);
            if (Number.isFinite(remaining)) arrival = now + remaining * 1000;
        }
        if (!Number.isFinite(arrival)) return null;
        return {
            commandId: commandId || `${target.coord}:${source.coord}:${arrival}`,
            label,
            targetId: target.id,
            targetCoord: target.coord,
            targetName: target.name,
            sourceId: source.id,
            sourceCoord: source.coord,
            sourceName: source.name,
            arrival
        };
    }

    function discoverIncomingTable() {
        const direct = document.querySelector('#incomings_table');
        if (direct) return direct;
        return [...document.querySelectorAll('table')].find((table) => {
            const text = normalizeText(table.querySelector('tr')?.textContent);
            return /befehl|command/.test(text) && /ziel|target|destination/.test(text) && /ankunft|arrival/.test(text);
        }) || null;
    }

    function collectIncomingAttacks(table) {
        const columns = resolveColumns(table);
        const now = serverNow();
        return [...table.querySelectorAll('tr')]
            .map((row) => parseAttackRow(row, columns, now))
            .filter(Boolean);
    }

    function collectIncomingSupports(table) {
        const columns = resolveColumns(table);
        const now = serverNow();
        return [...table.querySelectorAll('tr')]
            .map((row) => parseIncomingSupportRow(row, columns, now))
            .filter(Boolean);
    }

    function element(tagName, properties = {}) {
        const node = document.createElement(tagName);
        for (const [key, value] of Object.entries(properties)) {
            if (value === null || value === undefined) continue;
            if (key === 'textContent' || key === 'className' || key === 'value'
                || key === 'checked' || key === 'hidden' || key === 'disabled' || key === 'readOnly') {
                node[key] = value;
            } else if (key === 'dataset') {
                Object.assign(node.dataset, value);
            } else {
                node.setAttribute(key, String(value));
            }
        }
        return node;
    }

    function button(label, listener, title = '') {
        const node = element('button', { type: 'button', className: 'btn', textContent: label, title });
        node.addEventListener('click', listener);
        return node;
    }

    function formatNumber(value) {
        return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Number(value) || 0);
    }

    function formatDate(timestamp) {
        if (!Number.isFinite(timestamp)) return 'unbekannt';
        return new Intl.DateTimeFormat('de-DE', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).format(new Date(timestamp));
    }

    function formatDuration(seconds) {
        if (!Number.isFinite(seconds)) return 'unbekannt';
        const safe = Math.max(0, Math.floor(seconds));
        const days = Math.floor(safe / 86400);
        const hours = Math.floor((safe % 86400) / 3600);
        const minutes = Math.floor((safe % 3600) / 60);
        const secs = safe % 60;
        return `${days ? `${days}T ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function levelLabel(level) {
        return ({ critical: 'Kritisch', high: 'Hoch', medium: 'Mittel', low: 'Niedrig' })[level] || 'Unbekannt';
    }

    function classificationLabel(value) {
        return ({
            confirmed_noble: 'AG bestätigt', possible_noble: 'AG-Verdacht',
            confirmed_large: 'Groß bestätigt', confirmed_medium: 'Mittel bestätigt',
            confirmed_small: 'Klein bestätigt', possible_off: 'Off möglich (Laufzeitsignal)',
            serious_unknown: 'Ernst, Typ unbekannt', unknown: 'Nicht bestimmbar'
        })[value] || 'Nicht bestimmbar';
    }

    function statusLabel(value) {
        return STATUS_OPTIONS.find(([id]) => id === value)?.[1] || STATUS_OPTIONS[0][1];
    }

    function notify(message, error = false) {
        if (state.statusElement) {
            state.statusElement.textContent = message;
            state.statusElement.className = `ds-da-status ${error ? 'is-error' : ''}`;
        }
        try {
            if (error && typeof window.UI?.ErrorMessage === 'function') window.UI.ErrorMessage(message, 3500);
            else if (!error && typeof window.UI?.SuccessMessage === 'function') window.UI.SuccessMessage(message, 2500);
        } catch (_) {
            // Das Statusfeld bleibt als Fallback sichtbar.
        }
    }

    function initIncomingScreen(attempt = 0) {
        state.incomingTable = discoverIncomingTable();
        if (!state.incomingTable) {
            if (attempt < 20) window.setTimeout(() => initIncomingScreen(attempt + 1), 250);
            return;
        }
        state.panel = createIncomingPanel();
        state.groupTable = element('table', { className: 'vis ds-da-groups' });
        state.dodgeTable = element('table', { className: 'vis ds-da-dodge-plan', hidden: true });
        state.planTable = element('table', { className: 'vis ds-da-plan', hidden: true });
        // Die native Tabelle liegt auf echten Welten innerhalb des Formulars,
        // das auch der Mehrfach-Umbenennen-Knopf auswertet. Eigene Checkboxen
        // oder Eingabefelder dürfen deshalb niemals in dieses Formular geraten.
        const nativeForm = state.incomingTable.closest('form');
        const anchor = nativeForm || state.incomingTable;
        anchor.parentNode.insertBefore(state.panel, anchor);
        anchor.parentNode.insertBefore(state.groupTable, anchor);
        anchor.parentNode.insertBefore(state.dodgeTable, anchor);
        anchor.parentNode.insertBefore(state.planTable, anchor);

        // Die sichtbaren Befehle sofort mit Cache-/Fallbackdaten analysieren.
        // Langsame oder hängende Bestandsabrufe dürfen die Einschätzung und
        // die Beobachtung neuer Angriffe nicht blockieren.
        state.summaryElement.textContent = 'Sichtbare Befehle werden analysiert …';
        const worldPromise = loadWorldData(false);
        analyzeIncoming(false);
        observeIncomingTable();
        state.alertTimer = window.setInterval(() => analyzeIncoming(false), 30000);
        worldPromise.then(() => analyzeIncoming(false)).catch(() => analyzeIncoming(false));
        loadOperationalData({ silent: true })
            .then(() => analyzeIncoming(false))
            .catch(() => analyzeIncoming(false));
    }

    function createIncomingPanel() {
        const table = element('table', { id: `${SCRIPT_ID}-root`, className: 'vis ds-da-panel' });
        const tbody = element('tbody');
        table.append(tbody);
        const title = element('tr');
        title.append(element('th', { colSpan: 2, textContent: 'Verteidigungsassistent' }));
        tbody.append(title);

        const summaryRow = element('tr');
        summaryRow.append(element('td', { className: 'ds-da-label', textContent: 'Lage' }));
        state.summaryElement = element('td', { className: 'ds-da-summary' });
        summaryRow.append(state.summaryElement);
        tbody.append(summaryRow);

        const actionsRow = element('tr');
        actionsRow.append(element('td', { className: 'ds-da-label', textContent: 'Aktionen' }));
        const actions = element('td', { className: 'ds-da-actions' });
        actions.append(
            button('Unterstützung planen', () => createSupportPlan(state.assessments), 'Erstellt einen Plan, sendet aber keine Befehle'),
            button('Unterstützungsplan löschen', clearActivePlan, 'Verwirft nur den lokalen Unterstützungsplan')
        );
        if (!state.config.alertsEnabled || !('Notification' in window) || Notification.permission !== 'granted') {
            const alarmButton = button('Browser-Alarme aktivieren', enableNotifications, 'Einmalige Browserfreigabe für Angriffs- und Ausweich-Erinnerungen');
            alarmButton.id = `${SCRIPT_ID}-enable-alerts`;
            actions.append(alarmButton);
        }
        state.statusElement = element('span', { className: 'ds-da-status', 'aria-live': 'polite' });
        actions.append(state.statusElement);
        actionsRow.append(actions);
        tbody.append(actionsRow);

        const filterRow = element('tr');
        filterRow.append(element('td', { className: 'ds-da-label', textContent: 'Filter' }));
        const filters = element('td', { className: 'ds-da-filters' });
        const levelSelect = element('select', { 'aria-label': 'Gefahrenstufe filtern' });
        [['all', 'Alle Gefahrenstufen'], ['critical', 'Kritisch'], ['high', 'Hoch'], ['medium', 'Mittel'], ['low', 'Niedrig']]
            .forEach(([value, label]) => levelSelect.append(element('option', { value, textContent: label })));
        levelSelect.addEventListener('change', () => { state.filterLevel = levelSelect.value; renderAnalysis(); });
        const statusSelect = element('select', { 'aria-label': 'Bearbeitungsstatus filtern' });
        statusSelect.append(element('option', { value: 'all', textContent: 'Alle Status' }));
        STATUS_OPTIONS.forEach(([value, label]) => statusSelect.append(element('option', { value, textContent: label })));
        statusSelect.addEventListener('change', () => { state.filterStatus = statusSelect.value; renderAnalysis(); });
        const searchInput = element('input', { type: 'search', placeholder: 'Dorf, Koordinate, Angreifer …', 'aria-label': 'Eingehende durchsuchen' });
        searchInput.addEventListener('input', () => { state.filterSearch = normalizeText(searchInput.value); renderAnalysis(); });
        const urgentInput = element('input', { type: 'checkbox' });
        urgentInput.addEventListener('change', () => { state.urgentOnly = urgentInput.checked; renderAnalysis(); });
        const urgentLabel = element('label', { className: 'ds-da-inline' });
        urgentLabel.append(urgentInput, document.createTextNode(` nur ≤ ${state.config.urgentMinutes} Minuten`));
        filters.append(levelSelect, statusSelect, searchInput, urgentLabel);
        filterRow.append(filters);
        tbody.append(filterRow);

        const worldRow = element('tr');
        worldRow.append(element('td', { className: 'ds-da-label', textContent: 'Welt' }));
        state.worldElement = element('td', { className: 'ds-da-world' });
        worldRow.append(state.worldElement);
        tbody.append(worldRow);

        const configRow = element('tr');
        configRow.append(element('td', { className: 'ds-da-label', textContent: 'Konfiguration' }));
        const configCell = element('td');
        configCell.append(createConfigEditor());
        configRow.append(configCell);
        tbody.append(configRow);
        renderWorldInfo();
        return table;
    }

    function createConfigEditor() {
        const details = element('details', { className: 'ds-da-config-details' });
        details.append(element('summary', {
            textContent: 'Bewertungs- und Planungsstandards',
            title: 'Hier werden Gruppierung, Risikobewertung, Verteidigungsbedarf, Reserven und Benachrichtigungen konfiguriert. Alle Werte gelten lokal für diese Welt und diesen Spieler.'
        }));
        const toolbar = element('div', { className: 'ds-da-config-toolbar' });
        const preset = element('select', { 'aria-label': 'Standardprofil', title: CONFIG_HELP.profile });
        Object.entries(PRESET_DEFINITIONS).forEach(([value, definition]) => preset.append(element('option', { value, textContent: definition.name })));
        preset.append(element('option', { value: 'custom', textContent: 'Benutzerdefiniert' }));
        preset.value = PRESET_DEFINITIONS[state.config.profile] ? state.config.profile : 'custom';
        preset.addEventListener('change', () => {
            if (PRESET_DEFINITIONS[preset.value]) {
                state.config = createDefaultConfig(preset.value);
                state.store.config = state.config;
                saveStore();
                replaceConfigEditor(details);
                analyzeIncoming(true);
                notify(`Profil „${PRESET_DEFINITIONS[preset.value].name}“ geladen.`);
            }
        });
        toolbar.append(
            element('span', { textContent: 'Standardprofil: ' }),
            preset,
            button('Belastbare Standards wiederherstellen', () => {
                if (!window.confirm('Alle eigenen Bewertungs- und Planungseinstellungen durch das Profil „Ausgewogen“ ersetzen?')) return;
                state.config = createDefaultConfig('standard');
                state.store.config = state.config;
                saveStore();
                replaceConfigEditor(details);
                analyzeIncoming(true);
                notify('Ausgewogene Standards wiederhergestellt.');
            }, 'Setzt sämtliche sichtbaren Konfigurationswerte auf das Profil „Ausgewogen“ zurück. Eigene Abweichungen werden dabei ersetzt.')
        );
        details.append(toolbar);

        const sections = element('div', { className: 'ds-da-config-sections' });
        const definitions = [
            {
                icon: '⚔', title: 'Gruppierung & Wellen',
                description: 'Zeitliche Muster innerhalb eines Zieldorfs – getrennt nach gleicher und unterschiedlicher Herkunft.',
                fields: [
                    ['groupWindowMinutes', 'Gruppenfenster', 1, 120, 1, 'Min.'],
                    ['sameSourceWaveGapSeconds', 'Gleiche Herkunft', 1, 300, 1, 'Sek.'],
                    ['nobleTrainGapSeconds', 'AG-Zug, gleiche Herkunft', 1, 60, 1, 'Sek.'],
                    ['nobleTrainMinCommands', 'AG-Zug Mindestbefehle', 2, 20, 1, 'Bef.']
                ]
            },
            {
                icon: '⤨', title: 'Quellübergreifende Synchronisierung',
                description: 'Erkennt eng getaktete Wellen und mögliche AG-Züge aus mehreren Herkunftsdörfern.',
                fields: [
                    ['crossSourceWaveGapSeconds', 'Maximaler Abstand', 1, 60, 1, 'Sek.'],
                    ['crossSourceWaveMinCommands', 'Mindestbefehle', 2, 20, 1, 'Bef.']
                ]
            },
            {
                icon: '◉', title: 'Bedarf mit Wachturm',
                description: 'Planwerte, wenn das Spiel eine belastbare Größenklasse oder ein AG meldet.',
                fields: [
                    ['requirements.small', 'Kleiner Angriff', 0, 2000000, 5000, 'Def.'],
                    ['requirements.medium', 'Mittlerer Angriff', 0, 2000000, 5000, 'Def.'],
                    ['requirements.large', 'Großer Angriff', 0, 3000000, 5000, 'Def.'],
                    ['requirements.noble', 'Adelsgeschlecht', 0, 3000000, 5000, 'Def.']
                ]
            },
            {
                icon: '◇', title: 'Bedarf ohne Wachturm',
                description: 'Szenariowerte nach langsamster Geschwindigkeitsklasse; die Truppenmenge bleibt unbekannt.',
                fields: [
                    ['noWatchtowerRequirements.scout', 'Späherklasse', 0, 3000000, 5000, 'Def.'],
                    ['noWatchtowerRequirements.cavalry', 'Schnelle Kavallerie', 0, 3000000, 5000, 'Def.'],
                    ['noWatchtowerRequirements.infantry', 'Infanterieklasse', 0, 3000000, 5000, 'Def.'],
                    ['noWatchtowerRequirements.siege', 'Belagerungsklasse', 0, 3000000, 5000, 'Def.'],
                    ['requirements.unknown', 'Ohne Laufzeitsignal', 0, 3000000, 5000, 'Def.'],
                    ['repeatedCommandWeight', 'Folgebefehl-Gewicht', 0.05, 1, 0.05, '×'],
                    ['maxEquivalentAttacks', 'Max. Äquivalente', 1, 30, 1, 'Offs']
                ]
            },
            {
                icon: '⚑', title: 'Planung & Aktualität',
                description: 'Puffer, Mindestgröße und automatische Datengrundlage des Unterstützungsplans.',
                fields: [
                    ['supportBufferMinutes', 'Ankunftspuffer', 0, 120, 1, 'Min.'],
                    ['minimumSupportPop', 'Kleinste Unterstützung', 0, 50000, 50, 'Bev.'],
                    ['assumedWallLevel', 'Mauer-Fallback', 0, 30, 1, 'Stufe'],
                    ['inventoryStaleHours', 'Bestandswarnung', 1, 72, 1, 'Std.']
                ]
            },
            {
                icon: '↪', title: 'Ausweichplanung',
                description: 'Wählt automatisch ein sicheres eigenes Unterstützungsziel oder ein geprüftes Barbarenziel.',
                fields: [
                    ['dodgeLeadSeconds', 'Vor Einschlag senden', 15, 600, 5, 'Sek.'],
                    ['dodgePostSeconds', 'Nach Einschlag warten', 0, 120, 1, 'Sek.'],
                    ['dodgeCancelSafetySeconds', 'Abbruchreserve', 0, 180, 5, 'Sek.'],
                    ['dodgeMinimumHomeSeconds', 'Mindestens zuhause', 0, 900, 15, 'Sek.'],
                    ['dodgeNotifyMinutes', 'Erinnerung vorher', 1, 60, 1, 'Min.'],
                    ['dodgeFullOffPopulation', 'Große Off ab', 1, 30000, 100, 'Bev.'],
                    ['dodgeBarbarianMinimumAttack', 'Barbaren-Fallback ab', 10000, 2000000, 10000, 'Angriff'],
                    ['dodgeBarbarianMaxPoints', 'Barbarendorf max.', 100, 50000, 100, 'Punkte'],
                    ['dodgeTargetSearchRadius', 'Barbaren-Suchradius', 5, 100, 1, 'Felder']
                ]
            },
            {
                icon: '◆', title: 'Reserven',
                description: 'Truppen, die der Planer in jedem Quelldorf garantiert unangetastet lässt.',
                fields: [
                    ['reservePercent', 'Prozentuale Reserve', 0, 90, 1, '%'],
                    ['fixedReserve.spear', `Feste ${UNIT_NAMES.spear}`, 0, 999999, 50, 'Einheiten', `${CONFIG_HELP.fixedReserve} Aktuell wird damit ${UNIT_NAMES.spear} geschützt.`],
                    ['fixedReserve.sword', `Feste ${UNIT_NAMES.sword}`, 0, 999999, 50, 'Einheiten', `${CONFIG_HELP.fixedReserve} Aktuell wird damit ${UNIT_NAMES.sword} geschützt.`],
                    ['fixedReserve.archer', `Feste ${UNIT_NAMES.archer}`, 0, 999999, 50, 'Einheiten', `${CONFIG_HELP.fixedReserve} Aktuell wird damit ${UNIT_NAMES.archer} geschützt.`],
                    ['fixedReserve.heavy', `Feste ${UNIT_NAMES.heavy}`, 0, 999999, 50, 'Einheiten', `${CONFIG_HELP.fixedReserve} Aktuell wird damit ${UNIT_NAMES.heavy} geschützt.`]
                ]
            },
            {
                icon: '☷', title: 'Anzeige & Alarme',
                description: 'Filter, Benachrichtigungen und Verhalten der nativen Angriffstabelle.',
                fields: [['urgentMinutes', 'Dringend bis', 1, 1440, 5, 'Min.']],
                checks: [
                    ['alertsEnabled', 'Browser-Alarme verwenden'],
                    ['notifyNewAttacks', 'Neue Befehle melden'],
                    ['excludeThreatenedSources', 'Angegriffene Dörfer nicht als Quelle'],
                    ['filterNativeRows', 'Native Angriffstabelle mitfiltern']
                ]
            }
        ];
        definitions.forEach((definition) => sections.append(createConfigSection(definition)));
        details.append(sections);
        return details;
    }

    function createConfigSection(definition) {
        const section = element('section', { className: 'ds-da-config-card' });
        const heading = element('div', { className: 'ds-da-config-card-heading' });
        heading.append(
            element('span', { className: 'ds-da-config-card-icon', textContent: definition.icon, 'aria-hidden': 'true' }),
            element('div', { textContent: definition.title })
        );
        section.append(heading, element('div', { className: 'ds-da-config-card-description', textContent: definition.description }));
        const fields = element('div', { className: 'ds-da-config-fields' });
        (definition.fields || []).forEach((field) => fields.append(configNumberField(field)));
        section.append(fields);
        if (definition.checks?.length) {
            const checks = element('div', { className: 'ds-da-config-checks' });
            definition.checks.forEach(([key, label]) => checks.append(configCheckbox(key, label, CONFIG_HELP[key])));
            section.append(checks);
        }
        return section;
    }

    function configNumberField([path, labelText, min, max, step, suffix, customDescription]) {
        const description = customDescription || CONFIG_HELP[path];
        const label = element('label', { className: 'ds-da-config-field', title: description });
        label.append(configCaption(labelText, description));
        const control = element('span', { className: 'ds-da-config-control' });
        const input = element('input', {
            type: 'number', min, max, step, value: String(configValue(path)),
            'aria-label': labelText, title: description
        });
        input.addEventListener('input', () => {
            setConfigValue(path, clamp(input.value, min, max));
            markConfigCustom();
            state.store.config = state.config;
            saveStore();
        });
        input.addEventListener('change', () => {
            setConfigValue(path, clamp(input.value, min, max));
            markConfigCustom();
            state.store.config = state.config;
            saveStore();
            analyzeIncoming(true);
        });
        control.append(input, element('span', { className: 'ds-da-config-unit', textContent: suffix }));
        label.append(control);
        return label;
    }

    function replaceConfigEditor(oldDetails) {
        const replacement = createConfigEditor();
        replacement.open = true;
        oldDetails.replaceWith(replacement);
    }

    function configValue(path) {
        return path.split('.').reduce((value, key) => value?.[key], state.config);
    }

    function setConfigValue(path, value) {
        const parts = path.split('.');
        let target = state.config;
        while (parts.length > 1) {
            const key = parts.shift();
            target[key] ||= {};
            target = target[key];
        }
        target[parts[0]] = value;
    }

    function markConfigCustom() {
        state.config.profile = 'custom';
        const preset = document.querySelector('[aria-label="Standardprofil"]');
        if (preset) preset.value = 'custom';
    }

    function configCaption(labelText, description) {
        const caption = element('span', { className: 'ds-da-config-caption' });
        caption.append(
            document.createTextNode(labelText),
            element('span', {
                className: 'ds-da-help', textContent: 'ⓘ', title: description, tabindex: 0,
                'aria-label': `${labelText}: ${description}`
            })
        );
        return caption;
    }

    function configCheckbox(key, labelText, description) {
        const input = element('input', {
            type: 'checkbox', checked: Boolean(state.config[key]),
            title: description, 'aria-label': labelText
        });
        input.addEventListener('change', () => {
            state.config[key] = input.checked;
            markConfigCustom();
            saveStore();
            renderAnalysis();
        });
        const label = element('label', { className: 'ds-da-inline', title: description });
        label.append(input, document.createTextNode(' '), configCaption(labelText, description));
        return label;
    }

    function renderWorldInfo() {
        if (!state.worldElement) return;
        const source = state.world.source === 'official' ? 'offizielle Weltdaten'
            : state.world.source === 'cache' ? 'offizielle Weltdaten (Cache)'
                : 'transparente Standardwerte (Fallback)';
        const features = [
            `Welt ${state.world.speed}×`, `Einheiten ${state.world.unitSpeed}×`,
            state.world.archer ? 'Bogenschützen aktiv' : 'keine Bogenschützen',
            state.world.watchtower ? 'Wachturm aktiv' : 'Wachturm nicht erkannt',
            Number(state.world.commandCancelSeconds) > 0
                ? `Befehlsabbruch ${formatDuration(state.world.commandCancelSeconds)}`
                : 'Befehlsabbruch unbekannt',
            state.world.night?.active
                ? `Nachtbonus ${state.world.night.startHour}:00–${state.world.night.endHour}:00 (${state.world.night.defenseFactor}×)`
                : 'kein Nachtbonus erkannt',
            state.world.morale === null ? 'Moral unbekannt' : `Moral: ${state.world.morale}`
        ];
        state.worldElement.textContent = `${source} · ${features.join(' · ')}`;
        state.worldElement.className = `ds-da-world ${state.world.source === 'fallback' ? 'is-warning' : ''}`;
    }

    function inventoryEntries() {
        const own = new Map((state.store.inventory.own || []).map((entry) => [String(entry.villageId || entry.coord), { ...entry }]));
        for (const there of state.store.inventory.there || []) {
            const key = String(there.villageId || there.coord);
            if (own.has(key)) own.get(key).thereTroops = there.troops;
            else own.set(key, { ...there, troops: {}, thereTroops: there.troops });
        }
        for (const wall of state.store.inventory.walls || []) {
            const key = String(wall.villageId || wall.coord);
            if (own.has(key)) own.get(key).wallLevel = wall.wallLevel;
            else own.set(key, { ...wall, troops: {}, thereTroops: {} });
        }
        return [...own.values()];
    }

    function targetInventoryFor(group) {
        return inventoryEntries().find((entry) =>
            (group.targetId && String(entry.villageId) === String(group.targetId))
            || (group.targetCoord && entry.coord === group.targetCoord)
        ) || null;
    }

    function analyzeIncoming(announce = false) {
        if (!state.incomingTable || state.rendering) return;
        try {
            state.attacks = collectIncomingAttacks(state.incomingTable);
            state.incomingSupports = collectIncomingSupports(state.incomingTable);
            state.groups = groupAttacks(state.attacks, state.config);
            const now = serverNow();
            state.assessments = state.groups.map((group) => {
                const key = group.targetId || group.targetCoord;
                const override = state.store.villageOverrides[key] || {};
                const targetInventory = targetInventoryFor(group);
                const hasOverride = Number.isFinite(Number(override.wallLevel));
                const hasAutomaticWall = Number.isFinite(Number(targetInventory?.wallLevel));
                const wallLevel = hasOverride ? Number(override.wallLevel)
                    : hasAutomaticWall ? Number(targetInventory.wallLevel) : state.config.assumedWallLevel;
                const assessed = assessGroup(group, {
                    now,
                    config: state.config,
                    world: state.world,
                    unitInfo: state.unitInfo,
                    targetInventory,
                    wallLevel
                });
                return {
                    ...assessed,
                    wallSource: hasOverride ? 'manual' : hasAutomaticWall ? 'automatic' : 'fallback',
                    automaticWallLevel: hasAutomaticWall ? Number(targetInventory.wallLevel) : null
                };
            });
            refreshDodgePlan();
            reconcileIncomingSupports(now);
            syncSupportPlanLifecycle(now);
            state.store.lastGroups = state.assessments.slice(0, 500).map((group) => ({
                id: group.id, targetId: group.targetId, targetCoord: group.targetCoord,
                targetName: group.targetName, firstArrival: group.firstArrival, lastArrival: group.lastArrival,
                level: group.level, score: group.score, count: group.attacks.length
            }));
            checkAlerts();
            saveStore();
            const signature = assessmentRenderSignature();
            if (announce || signature !== state.lastAssessmentSignature) {
                state.lastAssessmentSignature = signature;
                renderAnalysis();
            } else {
                renderSummary();
            }
            if (announce) notify(`${state.attacks.length} Angriffe in ${state.groups.length} Lagegruppen analysiert.`);
        } catch (error) {
            const message = `Analysefehler: ${error?.message || String(error)}`;
            if (state.summaryElement) state.summaryElement.textContent = message;
            if (state.statusElement) {
                state.statusElement.textContent = message;
                state.statusElement.className = 'ds-da-status is-error';
            }
            console.error(`[${SCRIPT_ID}]`, error);
        }
    }

    function assessmentRenderSignature() {
        return JSON.stringify(state.assessments.map((group) => ({
            id: group.id,
            commands: group.attacks.map((attack) => [
                attack.commandId, attack.label, attack.watchSize,
                attack.watchNoble, attack.inferredUnit, attack.inferredUnits,
                attack.renamedUnit, attack.renameDelaySeconds, attack.correctedDurationSeconds,
                attack.durationSource, attack.returnTimestamp
            ]),
            score: group.score,
            level: group.level,
            classification: group.classification,
            confidence: Math.round(group.confidence * 1000),
            requirement: group.requirement.baseDefense,
            defense: Math.round(group.defense?.effective || 0),
            urgent: group.minutesUntil <= state.config.urgentMinutes,
            nightProtected: group.nightProtected,
            wallLevel: group.wallLevel,
            wallSource: group.wallSource,
            reasons: group.reasons
        })));
    }

    function assessmentVisible(group) {
        const stored = state.store.groupState[group.id] || {};
        if (state.filterLevel !== 'all' && group.level !== state.filterLevel) return false;
        if (state.filterStatus !== 'all' && (stored.status || 'unreviewed') !== state.filterStatus) return false;
        if (state.urgentOnly && group.minutesUntil > state.config.urgentMinutes) return false;
        if (state.filterSearch) {
            const haystack = normalizeText([
                group.targetName, group.targetCoord,
                ...group.attacks.flatMap((attack) => [attack.sourceName, attack.sourceCoord, attack.attackerName, attack.label])
            ].join(' '));
            if (!haystack.includes(state.filterSearch)) return false;
        }
        return true;
    }

    function renderAnalysis() {
        if (!state.groupTable) return;
        state.rendering = true;
        try {
            state.openDetailGroups = new Set([...state.openDetailGroups].filter((id) =>
                state.assessments.some((group) => group.id === id)));
            renderSummary();
            state.groupTable.replaceChildren();
            const head = element('tr');
            ['Risiko', 'Zieldorf / Zeitfenster', 'Einschätzung', 'Verteidigung', 'Status', 'Notiz', ''].forEach((text) =>
                head.append(element('th', { textContent: text })));
            state.groupTable.append(head);
            const visibleCommands = new Set();
            for (const group of state.assessments) {
                if (!assessmentVisible(group)) continue;
                group.attacks.forEach((attack) => visibleCommands.add(attack.commandId));
                appendGroupRows(group);
            }
            decorateNativeRows(visibleCommands);
            renderDodgePlanTable();
            renderPlanTable();
        } finally {
            state.rendering = false;
        }
    }

    function renderSummary() {
        if (!state.summaryElement) return;
        const counts = { critical: 0, high: 0, medium: 0, low: 0 };
        state.assessments.forEach((group) => { counts[group.level] += 1; });
        const inventoryAge = state.store.inventory.loadedAt
            ? (Date.now() - state.store.inventory.loadedAt) / 3600000
            : null;
        const inventoryText = inventoryAge === null
            ? 'keine Truppenbestände geladen'
            : `${state.store.inventory.own.length} Dörfer, Bestand ${inventoryAge < 1 ? '<1' : Math.round(inventoryAge)} Std. alt`;
        const loadErrorText = state.store.inventory.lastErrors?.length
            ? ` · Datenabruf teilweise fehlgeschlagen (${state.store.inventory.lastErrors.length} Quellen)` : '';
        const supportCounts = { underway: 0, arrived: 0, return_due: 0, returning: 0 };
        for (const assignment of state.store.activePlan?.assignments || []) {
            const phase = supportAssignmentLifecycle(assignment, serverNow(), effectiveSupportNeedUntil(assignment)).phase;
            if (Object.prototype.hasOwnProperty.call(supportCounts, phase)) supportCounts[phase] += 1;
        }
        const supportParts = [
            supportCounts.underway ? `${supportCounts.underway} Unterstützung unterwegs` : '',
            supportCounts.arrived ? `${supportCounts.arrived} angekommen` : '',
            supportCounts.return_due ? `${supportCounts.return_due} zurückzuschicken` : '',
            supportCounts.returning ? `${supportCounts.returning} auf Rückweg` : ''
        ].filter(Boolean);
        const supportText = supportParts.length ? ` · ${supportParts.join(', ')}` : '';
        state.summaryElement.replaceChildren(
            severitySummary('critical', counts.critical),
            severitySummary('high', counts.high),
            severitySummary('medium', counts.medium),
            severitySummary('low', counts.low),
            document.createTextNode(` · ${inventoryText}${loadErrorText}${supportText}`)
        );
    }

    function severitySummary(level, count) {
        return element('span', { className: `ds-da-severity is-${level}`, textContent: `${levelLabel(level)} ${count}` });
    }

    function appendGroupRows(group) {
        const stored = state.store.groupState[group.id] || { status: 'unreviewed', note: '' };
        const row = element('tr', { className: `ds-da-group is-${group.level}` });
        row.dataset.groupId = group.id;
        const risk = element('td');
        risk.append(element('span', {
            className: `ds-da-risk is-${group.level}`,
            textContent: `${group.score}/100`,
            title: `Konfidenz ${Math.round(group.confidence * 100)} %`
        }));
        row.append(risk);

        const targetCell = element('td');
        const targetLink = createVillageLink(group.targetId, group.targetCoord, group.targetName);
        targetCell.append(targetLink, element('div', {
            className: 'ds-da-subline',
            textContent: `${group.attacks.length} Angriffe · ${group.uniqueSources} Quellen · ${formatDate(group.firstArrival)}–${formatDate(group.lastArrival)}`
        }));
        row.append(targetCell);

        const assessmentCell = element('td');
        assessmentCell.append(
            element('strong', { textContent: classificationLabel(group.classification) }),
            element('div', { className: 'ds-da-subline', textContent: `Konfidenz ${Math.round(group.confidence * 100)} %${group.nightProtected ? ' · Nachtbonus' : ''}` })
        );
        row.append(assessmentCell);

        const defenseCell = element('td');
        defenseCell.textContent = group.defense
            ? `${formatNumber(group.defense.effective)} / ${formatNumber(group.requirement.baseDefense)} (${Math.round((group.coverage || 0) * 100)} %)`
            : `? / ${formatNumber(group.requirement.baseDefense)}`;
        defenseCell.title = 'Effektive bekannte Verteidigung inklusive Mauer-/Nachtfaktor / belastbare Planannahme';
        row.append(defenseCell);

        const statusCell = element('td');
        const status = element('select', { 'aria-label': `Status für ${group.targetName}` });
        STATUS_OPTIONS.forEach(([value, label]) => status.append(element('option', { value, textContent: label })));
        status.value = stored.status || 'unreviewed';
        status.addEventListener('change', () => {
            state.store.groupState[group.id] = { ...(state.store.groupState[group.id] || {}), status: status.value };
            saveStore();
            if (state.filterStatus !== 'all') renderAnalysis();
        });
        statusCell.append(status);
        row.append(statusCell);

        const noteCell = element('td');
        const note = element('input', {
            type: 'text', maxlength: 160, value: stored.note || '',
            placeholder: 'Notiz', 'aria-label': `Notiz für ${group.targetName}`
        });
        note.addEventListener('change', () => {
            state.store.groupState[group.id] = { ...state.store.groupState[group.id], note: note.value.slice(0, 160) };
            saveStore();
        });
        noteCell.append(note);
        row.append(noteCell);

        const buttonsCell = element('td', { className: 'ds-da-nowrap' });
        const detailsRow = element('tr', {
            className: 'ds-da-detail ds-da-generated',
            hidden: !state.openDetailGroups.has(group.id)
        });
        const detailCell = element('td', { colSpan: 7 });
        detailCell.append(createGroupDetails(group));
        detailsRow.append(detailCell);
        buttonsCell.append(
            button('Details', () => {
                detailsRow.hidden = !detailsRow.hidden;
                if (detailsRow.hidden) state.openDetailGroups.delete(group.id);
                else state.openDetailGroups.add(group.id);
            }),
            button('Nur dieses Dorf planen', () => createSupportPlan([group]))
        );
        if (supportPlanContains(group.id)) {
            buttonsCell.append(button('Dorfplan löschen', () => removeSupportPlanForGroup(group.id), 'Entfernt nur Unterstützungen und Restlücken für dieses Zieldorf'));
        }
        row.append(buttonsCell);
        state.groupTable.append(row, detailsRow);
    }

    function createGroupDetails(group) {
        const container = element('div', { className: 'ds-da-detail-grid' });
        const reasons = element('div');
        reasons.append(element('strong', { textContent: 'Nachvollziehbare Signale' }));
        const list = element('ul');
        (group.reasons.length ? group.reasons : ['keine belastbaren Zusatzsignale; Typ bleibt unbekannt'])
            .forEach((reason) => list.append(element('li', { textContent: reason })));
        reasons.append(list);

        const assumptions = element('div');
        assumptions.append(element('strong', { textContent: 'Planannahmen' }));
        const wallLabel = element('label', { className: 'ds-da-inline' });
        const key = group.targetId || group.targetCoord;
        const override = state.store.villageOverrides[key] || {};
        const manualWall = Number.isFinite(Number(override.wallLevel));
        const wallToggle = element('input', { type: 'checkbox', checked: manualWall });
        wallLabel.append(wallToggle, document.createTextNode(' Mauerstufe manuell überschreiben '));
        const wallInput = element('input', {
            type: 'number', inputmode: 'numeric', min: 0, max: 30, step: 1, value: String(group.wallLevel),
            disabled: !manualWall,
            'aria-label': `Mauerstufe für ${group.targetName}`
        });
        ['keydown', 'keypress', 'keyup'].forEach((type) => wallInput.addEventListener(type, (event) => {
            // Die globalen Dorf-/Fenster-Shortcuts des Spiels dürfen eine
            // Zahleneingabe in diesem Feld nicht abfangen.
            event.stopPropagation();
            if (type === 'keydown' && event.key === 'Enter') {
                event.preventDefault();
                wallInput.blur();
            }
        }));
        const wallSource = element('span', {
            className: 'ds-da-subline',
            textContent: group.wallSource === 'automatic'
                ? `Automatisch aus der Gebäudeübersicht: Stufe ${group.automaticWallLevel}.`
                : group.wallSource === 'manual'
                    ? `Manuelle Ausnahme; automatisch erkannt: ${group.automaticWallLevel ?? 'nicht verfügbar'}.`
                    : `Gebäudedaten nicht verfügbar; Fallback Stufe ${state.config.assumedWallLevel}.`
        });
        wallToggle.addEventListener('change', () => {
            wallInput.disabled = !wallToggle.checked;
            if (wallToggle.checked) {
                state.store.villageOverrides[key] = { ...override, wallLevel: clamp(wallInput.value, 0, 30) };
            } else {
                const next = { ...(state.store.villageOverrides[key] || {}) };
                delete next.wallLevel;
                if (Object.keys(next).length) state.store.villageOverrides[key] = next;
                else delete state.store.villageOverrides[key];
            }
            saveStore();
            analyzeIncoming(true);
        });
        wallInput.addEventListener('change', () => {
            if (!wallToggle.checked) return;
            state.store.villageOverrides[key] = { ...(state.store.villageOverrides[key] || {}), wallLevel: clamp(wallInput.value, 0, 30) };
            saveStore();
            analyzeIncoming(true);
        });
        wallLabel.append(wallInput);
        const requirementModel = requirementModelDescription(group.requirement);
        const breakdown = requirementBreakdown(group.requirement);
        assumptions.append(
            element('div', { textContent: `Bedarf: ${formatNumber(group.requirement.baseDefense)} Basis-Verteidigungspunkte (${group.requirement.equivalentAttacks.toFixed(2)} Angriffsäquivalente)` }),
            element('div', { className: 'ds-da-model-badge', textContent: requirementModel }),
            element('div', { className: 'ds-da-subline', textContent: breakdown }),
            wallLabel,
            wallSource,
            element('div', { className: 'ds-da-subline', textContent: 'Moral, Kirche, Paladin- und Flaggenboni werden ohne bestätigte Daten bewusst nicht eingerechnet.' }),
            createDodgePlanner(group)
        );

        const commands = element('div', { className: 'ds-da-command-list' });
        commands.append(element('strong', { textContent: 'Befehle' }));
        const table = element('table', { className: 'vis' });
        const head = element('tr');
        ['Ankunft', 'Herkunft', 'Langsamste Einheit', 'Umbenennung zu spät', 'Laufzeit', 'Befehlsname']
            .forEach((text) => head.append(element('th', { textContent: text })));
        table.append(head);
        group.attacks.forEach((attack) => {
            const assessed = classifyAttack(attack);
            const row = element('tr');
            const delayCell = element('td');
            const delayInput = element('input', {
                type: 'text', inputmode: 'numeric', placeholder: 'HH:MM:SS',
                value: attack.renameDelaySeconds ? formatDuration(attack.renameDelaySeconds).replace(/^00:/, '00:') : '',
                'aria-label': `Verspätung der Umbenennung für Befehl ${attack.commandId}`,
                title: 'Zeit zwischen Absenden und Umbenennen; beim Verlassen des Feldes wird sie zu Rückkehr minus Ankunft addiert'
            });
            let committedDelay = delayInput.value;
            const commitDelay = () => {
                if (delayInput.value === committedDelay) return;
                if (saveRenameDelay(attack, delayInput)) committedDelay = delayInput.value;
            };
            delayInput.addEventListener('blur', commitDelay);
            delayInput.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                delayInput.blur();
            });
            delayCell.append(delayInput);
            const unitCell = element('td', {
                className: 'ds-da-slowest-unit',
                title: slowestUnitTitle(attack)
            });
            appendSlowestUnit(unitCell, attack, assessed.confidence);
            row.append(
                element('td', { textContent: formatDate(attack.arrival) }),
                element('td', { textContent: attack.sourceName || attack.sourceCoord || '?' }),
                unitCell,
                delayCell,
                element('td', {
                    textContent: durationCalculationLabel(attack),
                    title: durationCalculationTitle(attack)
                }),
                element('td', { textContent: attack.label })
            );
            table.append(row);
        });
        commands.append(table);
        container.append(reasons, assumptions, commands);
        return container;
    }

    function requirementModelDescription(requirement) {
        if (requirement.model === 'watchtower') return 'Modell: Größenklasse durch Wachturm belegt';
        if (requirement.model === 'mixed') return 'Modell: Wachturmdaten und Laufzeitklassen kombiniert';
        return requirement.watchtowerAvailable
            ? 'Modell: kein Tag vorhanden – Laufzeitklasse und Befehlsmuster'
            : 'Modell ohne Wachturm: Laufzeitklasse und Befehlsmuster';
    }

    function requirementBreakdown(requirement) {
        const totals = new Map();
        for (const contribution of requirement.contributions || []) {
            const current = totals.get(contribution.kind) || { count: 0, points: 0 };
            current.count += 1;
            current.points += Number(contribution.points) || 0;
            totals.set(contribution.kind, current);
        }
        if (!totals.size) return 'Keine bewertbaren Befehle.';
        return [...totals.entries()].map(([kind, value]) =>
            `${value.count}× ${REQUIREMENT_KIND_NAMES[kind] || kind}: ${formatNumber(value.points)}`
        ).join(' · ');
    }

    function dodgeTargetKey(group) {
        return String(group.targetId || group.targetCoord || group.targetName);
    }

    function dodgeRecommendation(group) {
        const inventory = targetInventoryFor(group);
        const troops = mobileOffenseTroops(inventory);
        const population = troopPopulation(troops, state.unitInfo);
        const hasNoble = Number(troops.snob || 0) > 0;
        if (!Object.keys(troops).length) {
            return { level: 'none', troops, population, text: 'Nicht erforderlich: keine eigene Off und kein AG zuhause erkannt.' };
        }
        if (hasNoble) {
            return { level: 'strong', troops, population, text: `Klar empfohlen: ${formatNumber(troops.snob)} AG und ${formatNumber(population)} offensive Bevölkerung sind zuhause.` };
        }
        if (population >= state.config.dodgeFullOffPopulation) {
            return { level: 'strong', troops, population, text: `Klar empfohlen: große Off mit ${formatNumber(population)} Bevölkerung ist zuhause.` };
        }
        return { level: 'useful', troops, population, text: `Sinnvoll: ${formatNumber(population)} offensive Bevölkerung ist zuhause; die defensive Besetzung bleibt stehen.` };
    }

    function dodgeWindowContext(travelSeconds) {
        return {
            leadSeconds: state.config.dodgeLeadSeconds,
            postSeconds: state.config.dodgePostSeconds,
            commandCancelSeconds: state.world.commandCancelSeconds,
            cancelSafetySeconds: state.config.dodgeCancelSafetySeconds,
            minimumHomeSeconds: state.config.dodgeMinimumHomeSeconds,
            supportTravelSeconds: travelSeconds
        };
    }

    function attacksAtOwnVillage(village) {
        return state.assessments
            .filter((assessment) => sameSupportTarget(village, assessment))
            .flatMap((assessment) => assessment.attacks.map((attack) => attack.arrival))
            .filter(Number.isFinite);
    }

    function chooseAutomaticDodgeTarget(group, recommendation, arrivals) {
        const ownCandidates = (state.store.inventory.own || [])
            .filter((candidate) => String(candidate.villageId) !== String(group.targetId) && candidate.coord !== group.targetCoord)
            .map((candidate) => {
                const travel = travelSeconds(group.targetCoord, candidate.coord, recommendation.troops, state.unitInfo);
                if (!Number.isFinite(travel)) return null;
                const windows = planDodgeWindows(arrivals, dodgeWindowContext(travel));
                const safety = supportDestinationSafety(
                    windows, attacksAtOwnVillage(candidate), travel, state.config.dodgeLeadSeconds,
                    state.config.dodgeCancelSafetySeconds, state.config.dodgeMinimumHomeSeconds
                );
                if (!safety.safe) return null;
                return {
                    ready: true, method: 'support', targetKind: 'own',
                    destinationId: String(candidate.villageId), destinationCoord: candidate.coord,
                    destinationName: candidate.name, travelSeconds: travel, windows: safety.windows,
                    selectionReason: 'Eigenes Dorf ohne Angriff während Aufenthalt und Rückrufpuffer.',
                    distance: distanceBetween(group.targetCoord, candidate.coord)
                };
            })
            .filter(Boolean)
            .sort((left, right) => left.travelSeconds - right.travelSeconds || left.distance - right.distance);
        if (ownCandidates.length) return ownCandidates[0];

        const sourceInventory = (state.store.inventory.own || []).find((entry) =>
            (group.targetId && String(entry.villageId) === String(group.targetId)) || entry.coord === group.targetCoord);
        const sourceKey = String(sourceInventory?.villageId || group.targetId || group.targetCoord);
        const attackPower = troopAttackPower(recommendation.troops, state.unitInfo);
        const nobleCount = Number(recommendation.troops?.snob || 0);
        const barbarianCandidates = (state.store.barbarianTargets?.bySource?.[sourceKey] || [])
            .map((candidate) => {
                const travel = travelSeconds(group.targetCoord, candidate.coord, recommendation.troops, state.unitInfo);
                if (!Number.isFinite(travel)) return null;
                const windows = planDodgeWindows(arrivals, dodgeWindowContext(travel));
                const landingAllowed = attackPower >= state.config.dodgeBarbarianMinimumAttack
                    && Number(candidate.points) <= state.config.dodgeBarbarianMaxPoints
                    && nobleCount <= 1;
                const evaluation = evaluateBarbarianDodgeWindows(windows, travel, {
                    cancelSafetySeconds: state.config.dodgeCancelSafetySeconds,
                    minimumHomeSeconds: state.config.dodgeMinimumHomeSeconds,
                    postSeconds: state.config.dodgePostSeconds,
                    landingAllowed
                });
                if (!evaluation.ready) return null;
                return {
                    ready: true, method: 'barbarian', targetKind: 'barbarian',
                    destinationId: String(candidate.id), destinationCoord: candidate.coord,
                    destinationName: candidate.name || 'Barbarendorf', destinationPoints: Number(candidate.points) || 0,
                    travelSeconds: travel, windows: evaluation.windows,
                    needsLanding: evaluation.needsLanding, attackPower,
                    selectionReason: evaluation.needsLanding
                        ? `Kein sicheres eigenes Ziel; Barbaren-Fallback mit ${formatNumber(attackPower)} Angriffskraft und höchstens einem AG.`
                        : 'Kein sicheres eigenes Ziel; nahes Barbarendorf mit sicherem nativen Abbruchfenster.',
                    distance: Number(candidate.distance) || distanceBetween(group.targetCoord, candidate.coord)
                };
            })
            .filter(Boolean)
            .sort((left, right) => Number(left.needsLanding) - Number(right.needsLanding)
                || left.distance - right.distance || left.destinationPoints - right.destinationPoints);
        if (barbarianCandidates.length) return barbarianCandidates[0];

        const mapAvailable = Number(state.store.barbarianTargets?.loadedAt) > 0;
        return {
            ready: false, method: null, targetKind: null, windows: [],
            problem: mapAvailable
                ? 'Kein eigenes angriffsfreies Unterstützungsziel und kein sicher abbrechbares oder ausreichend schwaches Barbarenziel im Suchradius gefunden.'
                : 'Keine eigenen sicheren Zieldörfer; Barbarenziele konnten noch nicht aus der Weltkarte geladen werden.'
        };
    }

    function createDodgePlanner(group) {
        const key = dodgeTargetKey(group);
        const recommendation = dodgeRecommendation(group);
        const stored = state.store.dodgeSettings[key] || {};
        const box = element('div', { className: `ds-da-dodge-box is-${recommendation.level}` });
        box.append(element('strong', { textContent: '↪ Ausweichplanung' }), element('div', { textContent: recommendation.text }));
        if (recommendation.level === 'none') return box;
        if (stored.disabled) {
            box.append(button('Ausweichplanung für dieses Dorf wieder aktivieren', () => {
                state.store.dodgeSettings[key] = { ...stored, disabled: false };
                saveStore();
                analyzeIncoming(true);
            }));
            return box;
        }

        const selection = state.store.dodgePlan?.selections?.[key];
        const controls = element('div', { className: 'ds-da-dodge-auto-target' });
        if (selection?.ready) {
            controls.append(
                element('strong', {
                    textContent: selection.method === 'support'
                        ? `Automatisch: eigenes Dorf unterstützen → ${villageDisplay(selection.destinationName, selection.destinationCoord)}`
                        : `Automatisch: Barbarendorf angreifen → ${villageDisplay(selection.destinationName, selection.destinationCoord)}`
                }),
                element('div', { className: 'ds-da-subline', textContent: selection.selectionReason })
            );
        } else {
            controls.append(element('span', { className: 'ds-da-warning', textContent: selection?.problem || 'Automatisches Ausweichziel wird berechnet …' }));
        }
        controls.append(button('Dorfplan entfernen', () => {
            state.store.dodgeSettings[key] = { ...stored, disabled: true };
            saveStore();
            analyzeIncoming(true);
        }, 'Blendet die Ausweichplanung für dieses Dorf aus, bis sie hier wieder aktiviert wird.'));
        box.append(controls);
        const entries = state.store.dodgePlan?.entries?.filter((entry) => entry.targetKey === key) || [];
        if (entries.some((entry) => !entry.ready)) {
            box.append(element('div', { className: 'ds-da-warning', textContent: entries.find((entry) => !entry.ready)?.problem || 'Ausweichfenster noch nicht sicher planbar.' }));
        } else if (entries.length) {
            box.append(element('div', {
                className: 'ds-da-dodge-window',
                textContent: `${entries.length} Ausweichfenster geplant · nächstes Senden ${formatDate(entries[0].sendAt)} · Rückkehr ${formatDate(entries[0].returnAt)}`
            }));
        }
        box.append(element('div', {
            className: 'ds-da-subline',
            textContent: Number(recommendation.troops.snob || 0) > 0
                ? 'Das AG wird ausschließlich zusammen mit der gesamten erkannten Off in denselben Befehl eingetragen. Abschicken, Abbrechen und Rückrufen bleiben bewusste Klicks im Spiel.'
                : 'Der Plan hält die Truppen nur so lange wie nötig mobil. Abschicken, Abbrechen und Rückrufen bleiben bewusste Klicks im Spiel.'
        }));
        return box;
    }

    function saveRenameDelay(attack, input) {
        const raw = input.value.trim();
        const delaySeconds = raw ? parseDurationText(raw) : 0;
        if (!Number.isFinite(delaySeconds) || delaySeconds < 0) {
            notify('Verzögerung bitte als HH:MM:SS eingeben, zum Beispiel 00:07:30.', true);
            input.value = attack.renameDelaySeconds ? formatDuration(attack.renameDelaySeconds) : '';
            return false;
        }
        if (!Number.isFinite(attack.observedDurationSeconds)) {
            notify('Für diesen Befehl ist keine beobachtete Laufzeit verfügbar; die Verzögerung kann nicht angewendet werden.', true);
            return false;
        }
        const current = { ...(state.store.commandState[attack.commandId] || {}) };
        delete current.correctedDurationSeconds;
        delete current.correctedAt;
        if (delaySeconds === 0) {
            delete current.renameDelaySeconds;
            if (Object.keys(current).length) state.store.commandState[attack.commandId] = current;
            else delete state.store.commandState[attack.commandId];
        } else {
            current.renameDelaySeconds = delaySeconds;
            state.store.commandState[attack.commandId] = current;
        }
        saveStore();
        analyzeIncoming(true);
        notify(`Korrigierte Laufzeit: ${formatDuration(attack.observedDurationSeconds)} + ${formatDuration(delaySeconds)} = ${formatDuration(attack.observedDurationSeconds + delaySeconds)}.`);
        return true;
    }

    function durationCalculationLabel(attack) {
        return Number.isFinite(attack.correctedDurationSeconds)
            ? formatDuration(attack.correctedDurationSeconds)
            : 'nicht verfügbar';
    }

    function durationCalculationTitle(attack) {
        if (!Number.isFinite(attack.observedDurationSeconds)) return 'Keine feste Rückkehr- oder Laufzeit im Befehl verfügbar.';
        const base = attack.durationSource === 'return_minus_arrival' && Number.isFinite(attack.returnTimestamp)
            ? `${formatDate(attack.returnTimestamp)} − ${formatDate(attack.arrival)} = ${formatDuration(attack.observedDurationSeconds)}`
            : `feste Laufzeit ${formatDuration(attack.observedDurationSeconds)}`;
        if (!attack.renameDelaySeconds) return base;
        return `${base} + ${formatDuration(attack.renameDelaySeconds)} = ${formatDuration(attack.correctedDurationSeconds)}`;
    }

    function slowestUnitCandidates(attack) {
        if (attack.inferredUnits?.length) return attack.inferredUnits;
        if (attack.inferredUnit) return [attack.inferredUnit];
        if (attack.renamedUnit) return [attack.renamedUnit];
        if (attack.watchNoble) return ['snob'];
        return [];
    }

    function unitImageSource(unit) {
        const base = String(gameData.image_base || '/graphic/').replace(/\/?$/, '/');
        return `${base}unit/unit_${unit}.png`;
    }

    function unitIcon(unit) {
        return element('img', {
            className: 'ds-da-unit-icon', src: unitImageSource(unit),
            alt: UNIT_NAMES[unit] || unit, title: UNIT_NAMES[unit] || unit
        });
    }

    function appendSlowestUnit(cell, attack, confidence) {
        const units = slowestUnitCandidates(attack);
        if (!units.length) cell.append(document.createTextNode('unbekannt'));
        units.forEach((unit) => cell.append(unitIcon(unit)));
        cell.append(document.createTextNode(` (${Math.round(confidence * 100)} %)`));
    }

    function slowestUnitTitle(attack) {
        const units = slowestUnitCandidates(attack);
        const names = units.length ? units.map((unit) => UNIT_NAMES[unit] || unit).join(' / ') : 'unbekannt';
        if (attack.inferredUnit) return `${names}. Aus der gespeicherten Laufzeit und der Entfernung ermittelte Geschwindigkeitsklasse.`;
        if (attack.renamedUnit) return `${names}. Aus der Umbenennung des Befehls gelesen.`;
        if (attack.watchNoble) return `${names}. Vom Wachturm als Adelsgeschlecht erkannt.`;
        return 'Keine belastbare Laufzeit oder Einheitenangabe verfügbar.';
    }

    function createVillageLink(villageId, coord, label) {
        const url = new URL('/game.php', window.location.origin);
        if (gameData.village?.id) url.searchParams.set('village', gameData.village.id);
        url.searchParams.set('screen', 'info_village');
        if (villageId) url.searchParams.set('id', villageId);
        const link = element('a', { href: url.toString(), textContent: label || coord || 'Dorf' });
        if (!villageId) link.removeAttribute('href');
        return link;
    }

    function decorateNativeRows(visibleCommands) {
        state.incomingTable?.querySelectorAll('[data-ds-da-risk]').forEach((cell) => {
            delete cell.dataset.dsDaRisk;
            cell.classList.remove('ds-da-native-risk', 'ds-da-native-risk-critical', 'ds-da-native-risk-high', 'ds-da-native-risk-medium', 'ds-da-native-risk-low');
        });
        const groupByCommand = new Map();
        state.assessments.forEach((group) => group.attacks.forEach((attack) => groupByCommand.set(attack.commandId, group)));
        for (const attack of state.attacks) {
            const group = groupByCommand.get(attack.commandId);
            if (group && attack.commandCell) {
                // Nur ein Attribut für ein CSS-Pseudoelement: kein zusätzliches
                // Formularelement und kein Kindknoten in der QuickEdit-Struktur.
                attack.commandCell.dataset.dsDaRisk = String(group.score);
                attack.commandCell.classList.add('ds-da-native-risk', `ds-da-native-risk-${group.level}`);
            }
            if (state.config.filterNativeRows) attack.row.hidden = !visibleCommands.has(attack.commandId);
            else attack.row.hidden = false;
        }
    }

    function scheduleIncomingAnalysis(delay = 150) {
        if (state.refreshTimer !== null) window.clearTimeout(state.refreshTimer);
        state.refreshTimer = window.setTimeout(() => {
            state.refreshTimer = null;
            analyzeIncoming(false);
        }, delay);
    }

    function observeIncomingTable() {
        state.observer = new MutationObserver((mutations) => {
            const remainingColumn = resolveColumns(state.incomingTable).remaining;
            const countdownOnly = mutations.every((mutation) => {
                const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
                const cell = target?.closest?.('td');
                return cell && cell.cellIndex === remainingColumn;
            });
            const generatedOnly = mutations.every((mutation) => {
                if (mutation.target.closest?.(`#${SCRIPT_ID}-root, .ds-da-groups, .ds-da-plan`)) return true;
                const changed = [...mutation.addedNodes, ...mutation.removedNodes];
                return changed.length > 0 && changed.every((node) => node.nodeType === 1
                    && node.matches?.('.ds-da-generated'));
            });
            if (state.rendering || generatedOnly || countdownOnly) return;
            scheduleIncomingAnalysis(150);
        });
        state.observer.observe(state.incomingTable, { childList: true, subtree: true, characterData: true });
    }

    function unitFromNode(node) {
        const haystack = normalizeText([
            node?.textContent || '', node?.getAttribute?.('title') || '', node?.getAttribute?.('alt') || '',
            node?.getAttribute?.('class') || '', node?.getAttribute?.('src') || '', node?.dataset?.unit || ''
        ].join(' '));
        const aliases = {
            spear: ['spear', 'speer'], sword: ['sword', 'schwert'], axe: ['axe', 'axt'],
            archer: ['archer', 'bogen'], spy: ['spy', 'spaher', 'spaeher'], light: ['light', 'leichte kav'],
            marcher: ['marcher', 'beritten'], heavy: ['heavy', 'schwere kav'], ram: ['ram', 'rammbock'],
            catapult: ['catapult', 'katapult'], knight: ['knight', 'paladin'], snob: ['snob', 'adel'],
            militia: ['militia', 'miliz']
        };
        return Object.entries(aliases).find(([, values]) => values.some((value) => haystack.includes(value)))?.[0] || null;
    }

    function resolveUnitColumns(table) {
        const headerRows = [...table.querySelectorAll('tr')].filter((row) => row.querySelectorAll('th').length >= 2);
        const header = headerRows[headerRows.length - 1];
        const result = new Map();
        if (!header) return result;
        [...header.cells].forEach((cell, index) => {
            const candidates = [cell, ...cell.querySelectorAll('img, [data-unit], [class]')];
            const unit = candidates.map(unitFromNode).find(Boolean);
            if (unit) result.set(index, unit);
        });
        return result;
    }

    function parseUnitsOverviewDocument(doc) {
        const table = doc.querySelector('#units_table') || [...doc.querySelectorAll('table')].find((candidate) => {
            const units = resolveUnitColumns(candidate);
            return units.size >= 2 && /dorf|village/.test(normalizeText(candidate.textContent));
        });
        if (!table) throw new Error('Truppenübersicht wurde nicht gefunden.');
        const columns = resolveUnitColumns(table);
        if (columns.size < 2) throw new Error('Einheitenspalten konnten nicht erkannt werden.');
        const entries = [];
        for (const row of [...table.querySelectorAll('tr')]) {
            if (row.querySelector('th') || row.classList.contains('units_away')) continue;
            const coord = parseCoord(row.textContent);
            if (!coord) continue;
            const villageLink = row.querySelector('a[href*="info_village"], a[href*="village="]');
            const villageId = idFromHref(villageLink?.href, ['id', 'village']) || row.dataset.villageId || null;
            if (!villageId) continue;
            const troops = {};
            for (const [index, unit] of columns.entries()) {
                troops[unit] = Math.max(0, parseFormattedInt(row.cells[index]?.textContent) || 0);
            }
            entries.push({
                villageId: String(villageId),
                coord: coord.text,
                name: villageLink?.textContent.trim() || coord.text,
                troops
            });
        }
        const unique = new Map(entries.map((entry) => [String(entry.villageId), entry]));
        if (!unique.size) throw new Error('Keine Dorfbestände in der Truppenübersicht erkannt.');
        return [...unique.values()];
    }

    function unitsOverviewUrl(type) {
        const url = new URL('/game.php', window.location.origin);
        if (gameData.village?.id) url.searchParams.set('village', gameData.village.id);
        url.searchParams.set('screen', 'overview_villages');
        url.searchParams.set('mode', 'units');
        url.searchParams.set('type', type);
        url.searchParams.set('group', '0');
        url.searchParams.set('page', '-1');
        return url;
    }

    async function fetchUnitsOverview(type) {
        const response = await fetch(unitsOverviewUrl(type), { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Truppenübersicht „${type}“ nicht erreichbar (${response.status}).`);
        const html = await response.text();
        return parseUnitsOverviewDocument(new DOMParser().parseFromString(html, 'text/html'));
    }

    function buildingFromNode(node) {
        const haystack = normalizeText([
            node?.textContent || '', node?.getAttribute?.('title') || '', node?.getAttribute?.('alt') || '',
            node?.getAttribute?.('class') || '', node?.getAttribute?.('src') || '', node?.dataset?.building || ''
        ].join(' '));
        return /\bwall\b|mauer/.test(haystack) ? 'wall' : null;
    }

    function parseBuildingLevel(cell) {
        const explicit = Number(cell?.dataset?.level);
        if (Number.isFinite(explicit)) return Math.max(0, Math.floor(explicit));
        const match = String(cell?.textContent || '').replace(/\u00a0/g, ' ').match(/\d+/);
        return match ? Math.max(0, Number(match[0])) : null;
    }

    function parseBuildingsOverviewDocument(doc) {
        const table = doc.querySelector('#buildings_table') || [...doc.querySelectorAll('table')].find((candidate) => {
            const text = normalizeText(candidate.textContent);
            return /dorf|village/.test(text) && /mauer|wall/.test(text);
        });
        if (!table) throw new Error('Gebäudeübersicht wurde nicht gefunden.');
        const headerRows = [...table.querySelectorAll('tr')].filter((row) => row.querySelectorAll('th').length >= 2);
        const header = headerRows[headerRows.length - 1];
        let wallColumn = -1;
        [...(header?.cells || [])].forEach((cell, index) => {
            const candidates = [cell, ...cell.querySelectorAll('img, [data-building], [class]')];
            if (candidates.some((candidate) => buildingFromNode(candidate) === 'wall')) wallColumn = index;
        });
        if (wallColumn < 0) throw new Error('Mauerspalte konnte nicht erkannt werden.');
        const entries = [];
        for (const row of [...table.querySelectorAll('tr')]) {
            if (row.querySelector('th') || !row.cells[wallColumn]) continue;
            const coord = parseCoord(row.textContent);
            if (!coord) continue;
            const villageLink = row.querySelector('a[href*="info_village"], a[href*="village="]');
            const villageId = idFromHref(villageLink?.href, ['id', 'village']) || row.dataset.villageId || null;
            const wallLevel = parseBuildingLevel(row.cells[wallColumn]);
            if (!villageId || !Number.isFinite(wallLevel)) continue;
            entries.push({
                villageId: String(villageId), coord: coord.text,
                name: villageLink?.textContent.trim() || coord.text, wallLevel
            });
        }
        const unique = new Map(entries.map((entry) => [String(entry.villageId), entry]));
        if (!unique.size) throw new Error('Keine Mauerstufen in der Gebäudeübersicht erkannt.');
        return [...unique.values()];
    }

    function buildingsOverviewUrl() {
        const url = new URL('/game.php', window.location.origin);
        if (gameData.village?.id) url.searchParams.set('village', gameData.village.id);
        url.searchParams.set('screen', 'overview_villages');
        url.searchParams.set('mode', 'buildings');
        url.searchParams.set('group', '0');
        url.searchParams.set('page', '-1');
        return url;
    }

    async function fetchBuildingsOverview() {
        const response = await fetch(buildingsOverviewUrl(), { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Gebäudeübersicht nicht erreichbar (${response.status}).`);
        const html = await response.text();
        return parseBuildingsOverviewDocument(new DOMParser().parseFromString(html, 'text/html'));
    }

    function parseBarbarianVillageMap(text) {
        const villages = [];
        for (const line of String(text || '').split(/\r?\n/)) {
            if (!line) continue;
            const fields = line.split(',');
            if (fields.length < 6 || Number(fields[4]) !== 0) continue;
            const x = Number(fields[2]);
            const y = Number(fields[3]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            let name = fields[1] || 'Barbarendorf';
            try { name = decodeURIComponent(name.replace(/\+/g, '%20')); } catch (_) { /* Rohname bleibt erhalten. */ }
            villages.push({
                id: String(fields[0]), name, x, y, coord: `${x}|${y}`,
                points: Math.max(0, Number(fields[5]) || 0)
            });
        }
        return villages;
    }

    function indexNearbyBarbarians(barbarians, ownVillages, radius = 35, limit = 25) {
        const safeRadius = Math.max(1, Number(radius) || 35);
        const bucketSize = safeRadius;
        const buckets = new Map();
        const own = (ownVillages || []).map((entry) => ({ ...entry, parsed: parseCoord(entry.coord) })).filter((entry) => entry.parsed);
        for (const entry of own) {
            const key = `${Math.floor(entry.parsed.x / bucketSize)}:${Math.floor(entry.parsed.y / bucketSize)}`;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(entry);
        }
        const bySource = {};
        for (const barbarian of barbarians || []) {
            const bx = Math.floor(Number(barbarian.x) / bucketSize);
            const by = Math.floor(Number(barbarian.y) / bucketSize);
            for (let dx = -1; dx <= 1; dx += 1) {
                for (let dy = -1; dy <= 1; dy += 1) {
                    for (const source of buckets.get(`${bx + dx}:${by + dy}`) || []) {
                        const distance = Math.hypot(source.parsed.x - barbarian.x, source.parsed.y - barbarian.y);
                        if (distance <= 0 || distance > safeRadius) continue;
                        const sourceKey = String(source.villageId || source.coord);
                        bySource[sourceKey] ||= [];
                        bySource[sourceKey].push({
                            id: barbarian.id, name: barbarian.name, coord: barbarian.coord,
                            points: barbarian.points, distance
                        });
                    }
                }
            }
        }
        for (const [sourceKey, candidates] of Object.entries(bySource)) {
            candidates.sort((left, right) => left.distance - right.distance || left.points - right.points);
            bySource[sourceKey] = candidates.slice(0, Math.max(1, Number(limit) || 25));
        }
        return bySource;
    }

    async function loadBarbarianTargets(ownVillages) {
        const radius = state.config.dodgeTargetSearchRadius;
        const signature = `${radius}:${(ownVillages || []).map((entry) => `${entry.villageId}:${entry.coord}`).sort().join(';')}`;
        const cache = state.store.barbarianTargets || {};
        if (cache.loadedAt && Date.now() - cache.loadedAt < 6 * 3600000 && cache.signature === signature) return cache;
        const response = await fetch('/map/village.txt', { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Barbarendörfer nicht erreichbar (${response.status}).`);
        const barbarians = parseBarbarianVillageMap(await response.text());
        const next = {
            loadedAt: Date.now(), signature,
            bySource: indexNearbyBarbarians(barbarians, ownVillages, radius, 25),
            source: 'offizielle Weltkarte /map/village.txt'
        };
        state.store.barbarianTargets = next;
        return next;
    }

    async function loadOperationalData(options = {}) {
        const silent = options.silent === true;
        if (!silent) notify('Truppenbestände und Mauerstufen werden geladen …');
        const results = await Promise.allSettled([
            fetchUnitsOverview('own_home'), fetchUnitsOverview('there'), fetchBuildingsOverview()
        ]);
        const [ownResult, thereResult, wallsResult] = results;
        const inventory = { ...state.store.inventory };
        if (ownResult.status === 'fulfilled') inventory.own = ownResult.value;
        if (thereResult.status === 'fulfilled') inventory.there = thereResult.value;
        if (wallsResult.status === 'fulfilled') inventory.walls = wallsResult.value;
        const troopSuccess = ownResult.status === 'fulfilled' || thereResult.status === 'fulfilled';
        if (troopSuccess) inventory.loadedAt = Date.now();
        if (wallsResult.status === 'fulfilled') inventory.wallsLoadedAt = Date.now();
        const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason?.message || 'unbekannter Fehler');
        if (inventory.own.length) {
            try {
                await loadBarbarianTargets(inventory.own);
            } catch (error) {
                errors.push(error?.message || 'Barbarenziele konnten nicht geladen werden.');
            }
        }
        inventory.lastAttemptAt = Date.now();
        inventory.lastErrors = errors;
        inventory.source = 'beim Laden der Eingehenden automatisch aus Truppen-, Gebäudeübersicht und Weltkarte gelesen';
        state.store.inventory = inventory;
        saveStore();
        if (!silent) {
            notify(errors.length
                ? `Daten teilweise aktualisiert: ${errors.join(' · ')}`
                : `${inventory.own.length} Heimatbestände, ${inventory.there.length} Dorfbestände, ${inventory.walls.length} Mauerstufen und automatische Ausweichziele aktualisiert.`,
            results.every((result) => result.status === 'rejected'));
        }
        return { inventory, errors };
    }

    function refreshDodgePlan() {
        const previous = new Map((state.store.dodgePlan?.entries || []).map((entry) => [entry.id, entry]));
        const now = serverNow();
        const entries = [];
        const selections = {};
        const seenTargets = new Set();
        for (const group of state.assessments.slice().sort((a, b) => a.firstArrival - b.firstArrival)) {
            const targetKey = dodgeTargetKey(group);
            if (seenTargets.has(targetKey)) continue;
            seenTargets.add(targetKey);
            const recommendation = dodgeRecommendation(group);
            if (recommendation.level === 'none') continue;
            const setting = state.store.dodgeSettings[targetKey] || {};
            if (setting.disabled) continue;
            const arrivals = state.assessments
                .filter((candidate) => dodgeTargetKey(candidate) === targetKey)
                .flatMap((candidate) => candidate.attacks.map((attack) => attack.arrival))
                .filter((arrival) => Number.isFinite(arrival) && arrival >= now - state.config.dodgePostSeconds * 1000);
            const selection = chooseAutomaticDodgeTarget(group, recommendation, arrivals);
            const { windows: selectedWindows = [], ...selectionSummary } = selection;
            selections[targetKey] = selectionSummary;
            const windows = selection.ready
                ? selectedWindows
                : planDodgeWindows(arrivals, dodgeWindowContext(0));
            for (const window of windows) {
                const id = `dodge:${targetKey}:${selection.method || 'blocked'}:${selection.destinationCoord || 'none'}:${window.firstArrival}:${window.lastArrival}`;
                const prior = previous.get(id) || {};
                const ready = selection.ready === true;
                const problem = ready ? '' : selection.problem;
                entries.push({
                    id, groupId: group.id, targetKey,
                    sourceId: group.targetId, sourceCoord: group.targetCoord, sourceName: group.targetName,
                    destinationId: selection.destinationId || null,
                    destinationCoord: selection.destinationCoord || '', destinationName: selection.destinationName || '',
                    destinationPoints: selection.destinationPoints || null, targetKind: selection.targetKind || null,
                    method: selection.method || 'blocked', mode: window.mode, troops: recommendation.troops,
                    recommendation: recommendation.text, offensivePopulation: recommendation.population,
                    attackPower: selection.attackPower || troopAttackPower(recommendation.troops, state.unitInfo),
                    selectionReason: selection.selectionReason || '',
                    sendAt: window.sendAt, firstArrival: window.firstArrival, lastArrival: window.lastArrival,
                    actionAt: window.actionAt || window.cancelAt,
                    actionKind: window.actionKind || 'cancel', cancelDeadline: window.cancelDeadline,
                    returnAt: window.returnAt,
                    durationSeconds: window.durationSeconds, travelSeconds: selection.travelSeconds || null,
                    ready, problem, late: window.sendAt < now,
                    status: prior.status || 'draft'
                });
            }
        }
        state.store.dodgePlan = {
            createdAt: Date.now(), inventoryLoadedAt: state.store.inventory.loadedAt,
            commandCancelSeconds: state.world.commandCancelSeconds, selections, entries
        };
    }

    function compactDodgeTroops(troops) {
        return DODGE_UNITS.filter((unit) => Number(troops?.[unit]) > 0)
            .map((unit) => `${UNIT_NAMES[unit]} ${formatNumber(troops[unit])}`).join(' · ') || '–';
    }

    function villageDisplay(name, coord) {
        const label = String(name || '').trim();
        if (!coord) return label || 'Dorf';
        if (label.includes(coord)) return label;
        return label ? `${label} (${coord})` : coord;
    }

    function dodgeUrl(entry) {
        const url = new URL('/game.php', window.location.origin);
        url.searchParams.set('village', entry.sourceId);
        url.searchParams.set('screen', 'place');
        url.searchParams.set('ds_dodge_plan', entry.id);
        return url.toString();
    }

    function dodgeActionLabel(entry) {
        if (entry.actionKind === 'cancel') return 'Befehl abbrechen';
        if (entry.actionKind === 'land') return 'Angriff trifft ein; nicht abbrechen';
        return 'Unterstützung zurückrufen';
    }

    function renderDodgePlanTable() {
        if (!state.dodgeTable) return;
        const plan = state.store.dodgePlan;
        const entries = plan?.entries || [];
        state.dodgeTable.replaceChildren();
        state.dodgeTable.hidden = entries.length === 0;
        if (!entries.length) return;
        const title = element('tr');
        title.append(element('th', {
            colSpan: 8,
            textContent: `Ausweichplan · natives Befehlsabbruchfenster ${Number(plan.commandCancelSeconds) > 0 ? formatDuration(plan.commandCancelSeconds) : 'unbekannt'} · keine Befehle werden automatisch gesendet`
        }));
        state.dodgeTable.append(title);
        const head = element('tr');
        ['Dorf / Empfehlung', 'Auszulagernde Truppen', 'Senden', 'Geschützte Ankünfte', 'Abbrechen / Rückrufen', 'Zurück zuhause', 'Status', 'Vorbereitung']
            .forEach((text) => head.append(element('th', { textContent: text })));
        state.dodgeTable.append(head);
        const renderedDelete = new Set();
        for (const entry of entries) {
            const row = element('tr', { className: !entry.ready ? 'ds-da-plan-blocked' : entry.late ? 'ds-da-plan-late' : '' });
            const village = element('td');
            village.append(
                element('strong', { textContent: villageDisplay(entry.sourceName, entry.sourceCoord) }),
                element('div', { className: 'ds-da-subline', textContent: entry.recommendation }),
                element('div', {
                    className: 'ds-da-auto-destination',
                    textContent: entry.ready
                        ? `Automatisch → ${entry.targetKind === 'own' ? 'eigenes Dorf' : 'Barbarendorf'} ${villageDisplay(entry.destinationName, entry.destinationCoord)}`
                        : 'Kein sicheres automatisches Ziel'
                })
            );
            if (!renderedDelete.has(entry.targetKey)) {
                renderedDelete.add(entry.targetKey);
                village.append(button('Dorfplan entfernen', () => {
                    state.store.dodgeSettings[entry.targetKey] = { ...(state.store.dodgeSettings[entry.targetKey] || {}), disabled: true };
                    saveStore();
                    analyzeIncoming(true);
                }));
            }
            const status = element('select', { 'aria-label': `Ausweichstatus ${entry.sourceName}` });
            [['draft', 'Geplant'], ['prepared', 'Felder gefüllt'], ['sent', 'Gesendet'], ['recalled', 'Abgebrochen / zurückgerufen'], ['done', 'Zurück'], ['skipped', 'Ausgelassen']]
                .forEach(([value, label]) => status.append(element('option', { value, textContent: label })));
            status.value = entry.status || 'draft';
            status.addEventListener('change', () => {
                entry.status = status.value;
                saveStore();
            });
            const action = element('td');
            if (entry.ready) {
                action.append(element('a', {
                    className: 'btn', href: dodgeUrl(entry),
                    textContent: entry.status === 'prepared' ? 'Versammlungsplatz prüfen' : 'Befehl vorbereiten'
                }));
            } else {
                action.append(element('span', { className: 'ds-da-warning', textContent: entry.problem }));
            }
            const protectedWindow = entry.firstArrival === entry.lastArrival
                ? formatDate(entry.firstArrival)
                : `${formatDate(entry.firstArrival)}–${formatDate(entry.lastArrival)}`;
            row.append(
                village,
                element('td', { textContent: compactDodgeTroops(entry.troops) }),
                element('td', { className: entry.late ? 'ds-da-overdue' : '', textContent: formatDate(entry.sendAt) }),
                element('td', { textContent: protectedWindow }),
                element('td', {
                    textContent: `${formatDate(entry.actionAt)} · ${dodgeActionLabel(entry)}`,
                    title: entry.actionKind === 'cancel'
                        ? `Native Abbruchfrist endet ${formatDate(entry.cancelDeadline)}`
                        : entry.actionKind === 'land'
                            ? `Fallback mit ${formatNumber(entry.attackPower)} Angriffskraft; Barbarendorf ${formatNumber(entry.destinationPoints)} Punkte.`
                            : 'Eigenes, im relevanten Zeitraum angriffsfreies Zieldorf; danach Unterstützung zurückrufen.'
                }),
                element('td', { textContent: Number.isFinite(entry.returnAt) ? formatDate(entry.returnAt) : 'nach Zielwahl' }),
                element('td')
            );
            row.cells[6].append(status);
            row.append(action);
            state.dodgeTable.append(row);
        }
    }

    function createSupportPlan(groups) {
        const inventory = inventoryEntries();
        if (!state.store.inventory.loadedAt || !inventory.length) {
            notify('Die automatisch geladene Truppenübersicht ist nicht verfügbar. Bitte Seite neu laden und Zugriffsrechte prüfen.', true);
            return;
        }
        const ageHours = (Date.now() - state.store.inventory.loadedAt) / 3600000;
        const selectedIds = new Set(groups.map((group) => group.id));
        const protectedGroupIds = new Set((state.store.activePlan?.assignments || [])
            .filter((assignment) => selectedIds.has(assignment.groupId)
                && !['draft', 'prepared', 'cancelled', 'returned'].includes(assignment.status))
            .map((assignment) => assignment.groupId));
        const preservedAssignments = (state.store.activePlan?.assignments || [])
            .filter((assignment) => !selectedIds.has(assignment.groupId) || protectedGroupIds.has(assignment.groupId));
        const preservedShortages = (state.store.activePlan?.shortages || [])
            .filter((shortage) => !selectedIds.has(shortage.groupId) || protectedGroupIds.has(shortage.groupId));
        const preservedReservations = {};
        for (const assignment of preservedAssignments) {
            if (!assignmentNeedsReservation(assignment)) continue;
            preservedReservations[assignment.sourceId] ||= {};
            for (const [unit, amount] of Object.entries(assignment.troops || {})) {
                preservedReservations[assignment.sourceId][unit] = (preservedReservations[assignment.sourceId][unit] || 0) + Number(amount || 0);
            }
        }
        const groupsToPlan = groups.filter((group) => !protectedGroupIds.has(group.id));
        const result = planSupport(groupsToPlan, inventory, {
            now: serverNow(), config: state.config, world: state.world,
            unitInfo: state.unitInfo, reservations: preservedReservations
        });
        const assignments = [...preservedAssignments, ...result.assignments];
        const shortages = [...preservedShortages, ...result.shortages];
        state.store.activePlan = assignments.length || shortages.length ? {
            id: state.store.activePlan?.id || `plan-${Date.now()}`,
            createdAt: state.store.activePlan?.createdAt || Date.now(),
            inventoryLoadedAt: state.store.inventory.loadedAt,
            assignments, shortages
        } : null;
        state.store.reservations = result.reservations;
        for (const assignment of result.assignments) {
            state.store.groupState[assignment.groupId] = {
                ...(state.store.groupState[assignment.groupId] || {}), status: 'planned'
            };
        }
        saveStore();
        renderAnalysis();
        const stale = ageHours > state.config.inventoryStaleHours ? ` Achtung: Bestand ist ${Math.round(ageHours)} Std. alt.` : '';
        const protectedText = protectedGroupIds.size
            ? ` ${protectedGroupIds.size} Dorfpläne mit bereits gesendeter oder angekommener Unterstützung blieben unverändert.` : '';
        notify(result.assignments.length || result.shortages.length
            ? `${result.assignments.length} manuell zu bestätigende Unterstützungen geplant; ${result.shortages.length} Restlücken.${protectedText}${stale}`
            : `Für die ausgewählten Dörfer ist nach aktuellem Bestand keine zusätzliche Unterstützung erforderlich.${protectedText}${stale}`,
        result.assignments.length === 0 && result.shortages.length > 0);
    }

    function sameSupportTarget(left, right) {
        if (left?.targetId && right?.targetId) return String(left.targetId) === String(right.targetId);
        return Boolean(left?.targetCoord && right?.targetCoord && left.targetCoord === right.targetCoord);
    }

    function effectiveSupportNeedUntil(assignment) {
        const values = [Number(assignment?.neededUntil)];
        for (const group of state.assessments || []) {
            if (sameSupportTarget(assignment, group)) values.push(Number(group.lastArrival));
        }
        for (const group of state.store.lastGroups || []) {
            if (sameSupportTarget(assignment, group)) values.push(Number(group.lastArrival));
        }
        for (const other of state.store.activePlan?.assignments || []) {
            if (!['cancelled', 'returned'].includes(other.status) && sameSupportTarget(assignment, other)) {
                values.push(Number(other.neededUntil));
            }
        }
        const valid = values.filter((value) => Number.isFinite(value) && value > 0);
        if (valid.length) return Math.max(...valid);
        const deadline = Number(assignment?.deadline);
        return Number.isFinite(deadline) ? deadline + state.config.supportBufferMinutes * 60000 : null;
    }

    function reconcileIncomingSupports(now = serverNow()) {
        const assignments = state.store.activePlan?.assignments || [];
        if (!assignments.length || !state.incomingSupports.length) return false;
        const usedAssignments = new Set();
        let changed = false;
        for (const command of state.incomingSupports) {
            const candidates = assignments
                .filter((assignment) => !usedAssignments.has(assignment.id))
                .filter((assignment) => ['prepared', 'sent', 'arrived'].includes(assignment.status))
                .filter((assignment) => !assignment.nativeCommandId
                    || String(assignment.nativeCommandId) === String(command.commandId))
                .filter((assignment) => plannedSupportMatches(assignment, command))
                .filter((assignment) => {
                    const travelMs = Math.max(0, Number(assignment.travelSeconds) || 0) * 1000;
                    const inferredSentAt = command.arrival - travelMs;
                    if (inferredSentAt > now + 120000) return false;
                    if (assignment.nativeCommandId) return true;
                    const expectedArrival = Number(assignment.expectedArrival);
                    if (assignment.status === 'sent' && Number.isFinite(expectedArrival)
                        && Math.abs(expectedArrival - command.arrival) > 120000) return false;
                    const earliest = Number(assignment.preparedAt) || Number(assignment.plannedAt)
                        || Number(state.store.activePlan?.createdAt);
                    return !Number.isFinite(earliest) || inferredSentAt >= earliest - 120000;
                })
                .sort((left, right) => {
                    const leftReference = Number(left.expectedArrival) || Number(left.arrivalIfSentNow) || Number(left.deadline) || command.arrival;
                    const rightReference = Number(right.expectedArrival) || Number(right.arrivalIfSentNow) || Number(right.deadline) || command.arrival;
                    return Math.abs(leftReference - command.arrival) - Math.abs(rightReference - command.arrival);
                });
            const assignment = candidates[0];
            if (!assignment) continue;
            usedAssignments.add(assignment.id);
            const sentAt = command.arrival - Math.max(0, Number(assignment.travelSeconds) || 0) * 1000;
            assignment.status = 'sent';
            assignment.sentAt = sentAt;
            assignment.expectedArrival = command.arrival;
            assignment.nativeCommandId = command.commandId;
            assignment.nativeLastSeenAt = now;
            assignment.trackingSource = 'native_incoming';
            changed = true;
        }
        return changed;
    }

    function syncSupportPlanLifecycle(now = serverNow()) {
        const plan = state.store.activePlan;
        if (!plan?.assignments?.length) return false;
        let changed = false;
        for (const assignment of plan.assignments) {
            const neededUntil = effectiveSupportNeedUntil(assignment);
            if (Number.isFinite(neededUntil) && assignment.neededUntil !== neededUntil) {
                assignment.neededUntil = neededUntil;
                changed = true;
            }
            const lifecycle = supportAssignmentLifecycle(assignment, now, neededUntil);
            const returnNotificationKey = `support-return:${assignment.id}`;
            if (lifecycle.phase !== 'return_due' && state.store.notified[returnNotificationKey]) {
                delete state.store.notified[returnNotificationKey];
                changed = true;
            }
            const nextStatus = lifecycle.phase === 'underway' ? 'sent' : lifecycle.phase;
            if (['arrived', 'return_due', 'returned'].includes(nextStatus) && assignment.status !== nextStatus) {
                assignment.status = nextStatus;
                if (nextStatus === 'arrived' && !assignment.arrivedAt) {
                    assignment.arrivedAt = lifecycle.expectedArrival || now;
                }
                if (nextStatus === 'returned' && !assignment.returnedAt) {
                    assignment.returnedAt = lifecycle.expectedHomeAt || now;
                }
                changed = true;
            }
        }

        const automaticGroupStatuses = new Set([
            'planned', 'support_underway', 'support_arrived', 'support_return_due', 'handled'
        ]);
        const updateGroupProgress = (groupId, assignments) => {
            if (!assignments.length) return;
            const phases = assignments.map((assignment) => supportAssignmentLifecycle(
                assignment, now, effectiveSupportNeedUntil(assignment)
            ).phase);
            let desired = 'planned';
            if (phases.includes('return_due')) desired = 'support_return_due';
            else if (phases.includes('underway')) desired = 'support_underway';
            else if (phases.includes('arrived') || phases.includes('returning')) desired = 'support_arrived';
            else if (phases.every((phase) => phase === 'returned')) desired = 'handled';
            const current = state.store.groupState[groupId]?.status || 'planned';
            if (automaticGroupStatuses.has(current) && current !== desired) {
                state.store.groupState[groupId] = { ...(state.store.groupState[groupId] || {}), status: desired };
                changed = true;
            }
        };
        const groupIds = new Set(plan.assignments.map((assignment) => assignment.groupId));
        for (const groupId of groupIds) {
            const assignments = plan.assignments.filter((assignment) => assignment.groupId === groupId && assignment.status !== 'cancelled');
            updateGroupProgress(groupId, assignments);
        }
        // Ändert sich durch neue Befehle die Lagegruppen-ID, bleibt eine
        // Unterstützung trotzdem über das Zieldorf mit der aktuellen Lage
        // verbunden und wird dort weiterhin als unterwegs/angekommen gezeigt.
        for (const group of state.assessments || []) {
            const assignments = plan.assignments.filter((assignment) =>
                assignment.status !== 'cancelled' && sameSupportTarget(assignment, group));
            updateGroupProgress(group.id, assignments);
        }
        if (changed) recomputeReservationsFromPlan();
        return changed;
    }

    function markSupportSent(assignment, sentAt = serverNow()) {
        assignment.status = 'sent';
        assignment.sentAt = sentAt;
        assignment.expectedArrival = sentAt + Math.max(0, Number(assignment.travelSeconds) || 0) * 1000;
        delete assignment.arrivedAt;
        delete assignment.returnStartedAt;
        delete assignment.expectedHomeAt;
        delete assignment.returnedAt;
        syncSupportPlanLifecycle(sentAt);
        saveStore();
    }

    function markSupportArrived(assignment, arrivedAt = serverNow()) {
        assignment.status = 'arrived';
        assignment.arrivedAt = arrivedAt;
        assignment.expectedArrival = arrivedAt;
        syncSupportPlanLifecycle(arrivedAt);
        saveStore();
    }

    function markSupportReturning(assignment, returnStartedAt = serverNow()) {
        assignment.status = 'returning';
        assignment.returnStartedAt = returnStartedAt;
        assignment.expectedHomeAt = returnStartedAt + Math.max(0, Number(assignment.travelSeconds) || 0) * 1000;
        syncSupportPlanLifecycle(returnStartedAt);
        saveStore();
    }

    function assignmentNeedsReservation(assignment) {
        if (['cancelled', 'returned'].includes(assignment.status)) return false;
        const sentAt = Number(assignment.sentAt);
        const inventoryLoadedAt = Number(state.store.inventory.loadedAt);
        const inventoryReflectsDeparture = Number.isFinite(sentAt) && Number.isFinite(inventoryLoadedAt)
            && inventoryLoadedAt >= sentAt
            && ['sent', 'arrived', 'return_due', 'returning'].includes(assignment.status);
        return !inventoryReflectsDeparture;
    }

    function recomputeReservationsFromPlan() {
        const reservations = {};
        for (const assignment of state.store.activePlan?.assignments || []) {
            if (!assignmentNeedsReservation(assignment)) continue;
            reservations[assignment.sourceId] ||= {};
            for (const [unit, amount] of Object.entries(assignment.troops || {})) {
                reservations[assignment.sourceId][unit] = (reservations[assignment.sourceId][unit] || 0) + Number(amount || 0);
            }
        }
        state.store.reservations = reservations;
    }

    function supportPlanContains(groupId) {
        const plan = state.store.activePlan;
        return Boolean(plan && (
            plan.assignments?.some((assignment) => assignment.groupId === groupId)
            || plan.shortages?.some((shortage) => shortage.groupId === groupId)
        ));
    }

    function removeSupportPlanForGroup(groupId) {
        const plan = state.store.activePlan;
        if (!plan || !supportPlanContains(groupId)) {
            notify('Für dieses Dorf ist kein lokaler Unterstützungsplan vorhanden.');
            return;
        }
        plan.assignments = (plan.assignments || []).filter((assignment) => assignment.groupId !== groupId);
        plan.shortages = (plan.shortages || []).filter((shortage) => shortage.groupId !== groupId);
        if (!plan.assignments.length && !plan.shortages.length) state.store.activePlan = null;
        recomputeReservationsFromPlan();
        saveStore();
        renderAnalysis();
        notify('Unterstützungsplanung für dieses Dorf entfernt. Andere Dorfpläne bleiben erhalten.');
    }

    function clearActivePlan() {
        if (!state.store.activePlan) {
            notify('Kein lokaler Unterstützungsplan vorhanden.');
            return;
        }
        if (!window.confirm('Lokalen Unterstützungsplan und seine Reservierungen wirklich löschen? Bereits im Spiel gesendete Unterstützungen werden dadurch nicht verändert.')) return;
        state.store.activePlan = null;
        state.store.reservations = {};
        saveStore();
        renderAnalysis();
        notify('Lokaler Plan und Reservierungen gelöscht.');
    }

    function supportUrl(assignment) {
        const url = new URL('/game.php', window.location.origin);
        url.searchParams.set('village', assignment.sourceId);
        url.searchParams.set('screen', 'place');
        if (assignment.targetId) url.searchParams.set('target', assignment.targetId);
        url.searchParams.set('ds_def_plan', assignment.id);
        return url.toString();
    }

    function returnSupportUrl(assignment) {
        const url = new URL('/game.php', window.location.origin);
        url.searchParams.set('village', assignment.sourceId);
        url.searchParams.set('screen', 'place');
        url.searchParams.set('mode', 'units');
        url.searchParams.set('ds_def_return', assignment.id);
        return url.toString();
    }

    function compactTroops(troops) {
        return DEFENSE_UNITS.filter((unit) => Number(troops?.[unit]) > 0)
            .map((unit) => `${UNIT_NAMES[unit]} ${formatNumber(troops[unit])}`).join(' · ') || '–';
    }

    function supportLifecyclePresentation(assignment, now = serverNow()) {
        const lifecycle = supportAssignmentLifecycle(assignment, now, effectiveSupportNeedUntil(assignment));
        const presentations = {
            draft: ['Entwurf', 'Noch nicht in die nativen Felder übernommen.'],
            prepared: ['Felder gefüllt', 'Der tatsächliche Befehl wurde noch nicht bestätigt.'],
            underway: ['Unterwegs', Number.isFinite(lifecycle.expectedArrival)
                ? `${assignment.trackingSource === 'native_incoming' ? 'Nativ erkannt; Ankunft' : 'Voraussichtliche Ankunft'} ${formatDate(lifecycle.expectedArrival)}.`
                : 'Ankunftszeit nicht verfügbar.'],
            arrived: ['Angekommen', Number.isFinite(lifecycle.neededUntil)
                ? `${assignment.trackingSource === 'native_incoming' ? 'Zuvor nativ als unterwegs erkannt; ' : ''}Schutz wird bis ${formatDate(lifecycle.neededUntil)} benötigt.`
                : 'Am Ziel.'],
            return_due: ['Rücksendung fällig', Number.isFinite(lifecycle.neededUntil)
                ? `Letzter geplanter Einschlag war ${formatDate(lifecycle.neededUntil)}.` : 'Kein weiterer geplanter Einschlag.'],
            returning: ['Auf dem Rückweg', Number.isFinite(lifecycle.expectedHomeAt)
                ? `Voraussichtlich zuhause ${formatDate(lifecycle.expectedHomeAt)}.` : 'Rückkehrzeit nicht verfügbar.'],
            returned: ['Zurück', Number.isFinite(assignment.returnedAt)
                ? `Seit ${formatDate(assignment.returnedAt)} wieder zuhause.` : 'Wieder im Herkunftsdorf.'],
            cancelled: ['Verworfen', 'Diese Zuteilung wird nicht mehr verwendet.']
        };
        const [label, detail] = presentations[lifecycle.phase] || presentations.draft;
        return { ...lifecycle, label, detail };
    }

    function renderPlanTable() {
        if (!state.planTable) return;
        syncSupportPlanLifecycle();
        const plan = state.store.activePlan;
        state.planTable.replaceChildren();
        state.planTable.hidden = !plan;
        if (!plan) return;
        const title = element('tr');
        title.append(element('th', { colSpan: 8, textContent: `Unterstützungsplan vom ${formatDate(plan.createdAt)} – keine Befehle werden automatisch gesendet` }));
        state.planTable.append(title);
        const ageHours = (Date.now() - Number(plan.inventoryLoadedAt || 0)) / 3600000;
        const inventoryChanged = Number(plan.inventoryLoadedAt || 0) !== Number(state.store.inventory.loadedAt || 0);
        const hasUnsentAssignments = (plan.assignments || []).some((assignment) =>
            ['draft', 'prepared'].includes(assignment.status));
        if (hasUnsentAssignments && (ageHours > state.config.inventoryStaleHours || inventoryChanged)) {
            const warning = element('tr');
            warning.append(element('td', {
                colSpan: 8, className: 'ds-da-warning',
                textContent: inventoryChanged
                    ? 'Die Bestände wurden seit dieser Planung automatisch aktualisiert. Vor dem Senden den betroffenen Dorfplan neu erstellen.'
                    : `Bestandsgrundlage ist ${Math.round(ageHours)} Std. alt. Vor dem Senden die Seite neu laden und neu planen.`
            }));
            state.planTable.append(warning);
        }
        const head = element('tr');
        ['Von', 'Nach', 'Truppen', 'Def.', 'Laufzeit', 'Nächster Zeitpunkt', 'Status', 'Aktion'].forEach((text) => head.append(element('th', { textContent: text })));
        state.planTable.append(head);
        for (const assignment of plan.assignments || []) {
            const row = element('tr', { className: assignment.status === 'cancelled' ? 'ds-da-cancelled' : '' });
            const progress = supportLifecyclePresentation(assignment);
            const statusCell = element('td', { className: `ds-da-support-status is-${progress.phase}` });
            statusCell.append(
                element('strong', { textContent: progress.label }),
                element('div', { className: 'ds-da-subline', textContent: progress.detail })
            );
            const action = element('td');
            if (['draft', 'prepared'].includes(progress.phase)) {
                action.append(element('a', {
                    className: 'btn', href: supportUrl(assignment),
                    textContent: progress.phase === 'prepared' ? 'Vorbereitung prüfen' : 'Am Versammlungsplatz vorbereiten'
                }));
            } else if (progress.phase === 'underway') {
                action.append(
                    element('a', { className: 'btn', href: supportUrl(assignment), textContent: 'Plan öffnen' }),
                    button('Ankunft bestätigen', () => {
                        markSupportArrived(assignment);
                        renderAnalysis();
                        notify('Unterstützung als angekommen bestätigt.');
                    }, 'Verwenden, wenn die native Ankunft bereits sicher sichtbar ist')
                );
            } else if (['arrived', 'return_due'].includes(progress.phase)) {
                action.append(element('a', {
                    className: `btn ${progress.phase === 'return_due' ? 'ds-da-return-due' : ''}`,
                    href: returnSupportUrl(assignment),
                    textContent: progress.phase === 'return_due' ? 'Jetzt zurückschicken' : 'Vorzeitig zurückschicken'
                }));
            } else if (progress.phase === 'returning') {
                action.append(button('Rückkehr bestätigen', () => {
                    assignment.status = 'returned';
                    assignment.returnedAt = serverNow();
                    saveStore();
                    renderAnalysis();
                    notify('Unterstützung als zurückgekehrt bestätigt.');
                }));
            }
            action.append(button('Dorfplan löschen', () => removeSupportPlanForGroup(assignment.groupId)));
            const timing = ['draft', 'prepared'].includes(progress.phase)
                ? { value: assignment.sendBy, overdue: assignment.sendBy < serverNow() }
                : progress.phase === 'underway'
                    ? { value: progress.expectedArrival, overdue: false }
                    : progress.phase === 'returning'
                        ? { value: progress.expectedHomeAt, overdue: false }
                        : { value: progress.neededUntil, overdue: progress.phase === 'return_due' };
            row.append(
                element('td', { textContent: villageDisplay(assignment.sourceName, assignment.sourceCoord) }),
                element('td', { textContent: villageDisplay(assignment.targetName, assignment.targetCoord) }),
                element('td', { textContent: compactTroops(assignment.troops) }),
                element('td', { textContent: formatNumber(assignment.baseDefense) }),
                element('td', { textContent: formatDuration(assignment.travelSeconds) }),
                element('td', {
                    className: timing.overdue ? 'ds-da-overdue' : '',
                    textContent: formatDate(timing.value)
                }),
                statusCell
            );
            row.append(action);
            state.planTable.append(row);
        }
        for (const shortage of plan.shortages || []) {
            const row = element('tr', { className: 'ds-da-shortage' });
            row.append(element('td', {
                colSpan: 8,
                textContent: `Restlücke bei ${shortage.targetName}: ${formatNumber(shortage.missingEffectiveDefense)} effektive Verteidigungspunkte; ${shortage.reachableSources} rechtzeitig erreichbare Quelldörfer.`
            }));
            state.planTable.append(row);
        }
    }

    async function enableNotifications() {
        if (!('Notification' in window)) {
            notify('Dieser Browser unterstützt keine Desktop-Benachrichtigungen.', true);
            return;
        }
        const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        state.config.alertsEnabled = permission === 'granted';
        markConfigCustom();
        saveStore();
        if (permission === 'granted') document.getElementById(`${SCRIPT_ID}-enable-alerts`)?.remove();
        notify(permission === 'granted' ? 'Browser-Alarme sind aktiv.' : 'Browser-Alarme wurden nicht freigegeben.', permission !== 'granted');
    }

    function desktopNotification(title, body, tag) {
        if (!state.config.alertsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
        try { new Notification(title, { body, tag }); } catch (_) { /* Statusanzeige genügt als Fallback. */ }
    }

    function checkAlerts() {
        const previous = new Set(state.store.knownCommands || []);
        const current = state.attacks.map((attack) => String(attack.commandId));
        if (previous.size && state.config.notifyNewAttacks) {
            const added = current.filter((id) => !previous.has(id));
            if (added.length) desktopNotification('Neue eingehende Angriffe', `${added.length} neue Befehle in der sichtbaren Übersicht.`, 'ds-da-new');
        }
        state.store.knownCommands = [...new Set([...previous, ...current])].slice(-10000);
        for (const group of state.assessments) {
            for (const minutes of state.config.alertMinutes) {
                const key = `${group.id}:${minutes}`;
                if (group.minutesUntil <= minutes && group.minutesUntil > 0 && !state.store.notified[key]) {
                    state.store.notified[key] = Date.now();
                    desktopNotification(`${levelLabel(group.level)}: ${group.targetName}`, `${group.attacks.length} Angriffe, erste Ankunft in ${Math.max(1, Math.ceil(group.minutesUntil))} Minuten.`, key);
                }
            }
        }
        for (const entry of state.store.dodgePlan?.entries || []) {
            if (!entry.ready || ['sent', 'recalled', 'done', 'skipped'].includes(entry.status)) continue;
            const notifyAt = entry.sendAt - state.config.dodgeNotifyMinutes * 60000;
            const key = `dodge-send:${entry.id}`;
            if (serverNow() >= notifyAt && serverNow() < entry.actionAt && !state.store.notified[key]) {
                state.store.notified[key] = Date.now();
                desktopNotification(
                    `Ausweichbefehl vorbereiten: ${entry.sourceName}`,
                    `${compactDodgeTroops(entry.troops)} · planmäßig senden ${formatDate(entry.sendAt)}.`,
                    key
                );
            }
        }
        for (const assignment of state.store.activePlan?.assignments || []) {
            const progress = supportAssignmentLifecycle(assignment, serverNow(), effectiveSupportNeedUntil(assignment));
            if (progress.phase !== 'return_due') continue;
            const key = `support-return:${assignment.id}`;
            if (state.store.notified[key]) continue;
            state.store.notified[key] = Date.now();
            desktopNotification(
                `Unterstützung zurückschicken: ${assignment.targetName}`,
                `Der geplante Schutz ist beendet. Unterstützung aus ${villageDisplay(assignment.sourceName, assignment.sourceCoord)} kann zurückgerufen werden.`,
                key
            );
        }
        const cutoff = Date.now() - 7 * 86400000;
        state.store.notified = Object.fromEntries(Object.entries(state.store.notified).filter(([, time]) => Number(time) >= cutoff));
    }

    function findAssignmentById(id) {
        return state.store.activePlan?.assignments?.find((assignment) => assignment.id === id) || null;
    }

    function findDodgeEntryById(id) {
        return state.store.dodgePlan?.entries?.find((entry) => entry.id === id) || null;
    }

    function setCommandField(selectors, value) {
        const field = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
        if (!field) return false;
        field.value = String(value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function fillSupportForm(assignment) {
        const currentVillage = String(gameData.village?.id || search.get('village') || '');
        if (currentVillage && currentVillage !== String(assignment.sourceId)) {
            notify(`Falsches Quelldorf: erwartet wird ${assignment.sourceName} (${assignment.sourceCoord}).`, true);
            return;
        }
        const target = parseCoord(assignment.targetCoord);
        let filled = 0;
        if (target) {
            setCommandField(['input[name="x"]', '#inputx'], target.x);
            setCommandField(['input[name="y"]', '#inputy'], target.y);
        }
        for (const [unit, amount] of Object.entries(assignment.troops || {})) {
            if (!amount) continue;
            if (setCommandField([`input[name="${unit}"]`, `input[name="units[${unit}]"]`, `#unit_input_${unit}`], amount)) filled += 1;
        }
        if (!filled) {
            notify('Keine passenden Einheitenfelder gefunden. Die Seite oder Weltkonfiguration weicht vom erwarteten Aufbau ab.', true);
            return;
        }
        assignment.status = 'prepared';
        assignment.preparedAt = serverNow();
        saveStore();
        notify(`${filled} Einheitenfelder gefüllt. Bitte Ziel, Truppen und Ankunft prüfen und selbst „Unterstützen“ klicken.`);
    }

    function fillDodgeForm(entry) {
        const currentVillage = String(gameData.village?.id || search.get('village') || '');
        if (currentVillage && currentVillage !== String(entry.sourceId)) {
            notify(`Falsches Dorf: erwartet wird ${entry.sourceName} (${entry.sourceCoord}).`, true);
            return;
        }
        const target = parseCoord(entry.destinationCoord);
        if (!target) {
            notify('Das Ausweichziel ist nicht vollständig konfiguriert.', true);
            return;
        }
        setCommandField(['input[name="x"]', '#inputx'], target.x);
        setCommandField(['input[name="y"]', '#inputy'], target.y);
        let filled = 0;
        for (const [unit, amount] of Object.entries(entry.troops || {})) {
            if (!amount) continue;
            if (setCommandField([`input[name="${unit}"]`, `input[name="units[${unit}]"]`, `#unit_input_${unit}`], amount)) filled += 1;
        }
        if (!filled) {
            notify('Keine passenden Off-/AG-Felder gefunden. Die Weltkonfiguration oder Seite weicht vom erwarteten Aufbau ab.', true);
            return;
        }
        entry.status = 'prepared';
        saveStore();
        notify(`${filled} Truppenfelder und das Ziel wurden gefüllt. Bitte alles prüfen und selbst „${entry.method === 'support' ? 'Unterstützen' : 'Angreifen'}“ klicken.`);
    }

    function nativeReturnControlSignal(node) {
        return normalizeText([
            node?.textContent || '', node?.value || '', node?.name || '', node?.id || '',
            node?.className || '', node?.getAttribute?.('title') || '',
            node?.getAttribute?.('href') || '', node?.getAttribute?.('formaction') || '',
            node?.getAttribute?.('onclick') || ''
        ].join(' '));
    }

    function findNativeReturnAction(assignment) {
        const coord = assignment.targetCoord;
        const rows = [...document.querySelectorAll('tr')].filter((row) =>
            row.closest(`#${SCRIPT_ID}-root`) === null
            && (!coord || parseCoord(row.textContent)?.text === coord || row.textContent.includes(coord))
        );
        const returnPattern = /zuruck|zurueck|abzieh|heimschick|ruckruf|withdraw|send.?back|support.?back/;
        for (const row of rows) {
            const controls = [...row.querySelectorAll('a[href], button, input[type="submit"], input[type="button"]')];
            const direct = controls.find((control) => returnPattern.test(nativeReturnControlSignal(control)));
            if (direct) return { row, control: direct, checkbox: null };
            const checkbox = row.querySelector('input[type="checkbox"]');
            if (!checkbox) continue;
            const form = row.closest('form');
            const scope = form || document;
            const shared = [...scope.querySelectorAll('button, input[type="submit"], input[type="button"], a[href]')]
                .find((control) => !row.contains(control) && returnPattern.test(nativeReturnControlSignal(control)));
            if (shared) return { row, control: shared, checkbox };
        }
        return null;
    }

    function initReturnSupportScreen(assignment, attempt = 0) {
        const nativeAction = findNativeReturnAction(assignment);
        if (!nativeAction && attempt < 8) {
            window.setTimeout(() => initReturnSupportScreen(assignment, attempt + 1), 250);
            return;
        }
        const anchor = nativeAction?.row.closest('table, form')
            || document.querySelector('#content_value > form, #content_value table.vis, #contentContainer form, #contentContainer table.vis, form, table.vis, body');
        if (!anchor) return;
        const progress = supportLifecyclePresentation(assignment);
        const panel = element('table', { id: `${SCRIPT_ID}-root`, className: 'vis ds-da-panel' });
        const title = element('tr');
        title.append(element('th', { colSpan: 2, textContent: 'Verteidigungsassistent – Unterstützung zurückschicken' }));
        const info = element('tr');
        info.append(
            element('td', { className: 'ds-da-label', textContent: 'Unterstützung' }),
            element('td', {
                textContent: `${villageDisplay(assignment.sourceName, assignment.sourceCoord)} → ${villageDisplay(assignment.targetName, assignment.targetCoord)} · ${compactTroops(assignment.troops)}`
            })
        );
        const statusRow = element('tr');
        statusRow.append(
            element('td', { className: 'ds-da-label', textContent: 'Empfehlung' }),
            element('td', {
                className: progress.phase === 'return_due' ? 'ds-da-return-instruction' : 'ds-da-warning',
                textContent: progress.phase === 'return_due'
                    ? `Der letzte dafür geplante Angriff ist durch. Die Unterstützung wird nicht mehr benötigt und soll jetzt nach ${villageDisplay(assignment.sourceName, assignment.sourceCoord)} zurückgeschickt werden.`
                    : `Der Schutz ist bis ${formatDate(progress.neededUntil)} eingeplant. Vorher nur zurückschicken, wenn die Lage anderweitig gedeckt ist.`
            })
        );
        const actionRow = element('tr');
        actionRow.append(element('td', { className: 'ds-da-label', textContent: 'Aktion' }));
        const actions = element('td');
        if (nativeAction) {
            nativeAction.row.classList.add('ds-da-native-return-target');
            actions.append(button('Unterstützung nativ zurückschicken', () => {
                if (nativeAction.checkbox) {
                    nativeAction.checkbox.checked = true;
                    nativeAction.checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
                markSupportReturning(assignment);
                nativeAction.control.click();
            }, 'Betätigt die zu dieser Unterstützung gehörende native Rücksendeaktion von Die Stämme'));
            window.setTimeout(() => nativeAction.row.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0);
        } else {
            actions.append(element('span', {
                className: 'ds-da-warning',
                textContent: 'Die passende native Rücksendezeile konnte auf dieser Seitenvariante nicht sicher erkannt werden. Bitte die markierte Unterstützung in der nativen Truppenansicht manuell zurückschicken.'
            }));
        }
        actions.append(
            button('Als Rückweg markieren', () => {
                markSupportReturning(assignment);
                notify(`Rückweg gespeichert; voraussichtlich zuhause ${formatDate(assignment.expectedHomeAt)}.`);
            }, 'Nur verwenden, wenn die native Rücksendung bereits bestätigt wurde'),
            element('span', { className: 'ds-da-status', 'aria-live': 'polite' })
        );
        state.statusElement = actions.lastElementChild;
        actionRow.append(actions);
        panel.append(title, info, statusRow, actionRow);
        anchor.parentNode.insertBefore(panel, anchor);
        loadWorldData(false);
    }

    function initPlaceScreen(attempt = 0) {
        const assignment = findAssignmentById(search.get('ds_def_plan'));
        const returnAssignment = findAssignmentById(search.get('ds_def_return'));
        const dodgeEntry = findDodgeEntryById(search.get('ds_dodge_plan'));
        if (returnAssignment) {
            initReturnSupportScreen(returnAssignment, attempt);
            return;
        }
        if (!assignment && !dodgeEntry) return;
        const form = document.querySelector('#command-data-form, form[action*="screen=place"], form');
        if (!form) {
            if (attempt < 20) window.setTimeout(() => initPlaceScreen(attempt + 1), 250);
            return;
        }
        const panel = element('table', { id: `${SCRIPT_ID}-root`, className: 'vis ds-da-panel' });
        const title = element('tr');
        title.append(element('th', {
            colSpan: 2,
            textContent: dodgeEntry ? 'Verteidigungsassistent – Ausweichbefehl vorbereiten' : 'Verteidigungsassistent – Unterstützung vorbereiten'
        }));
        const info = element('tr');
        info.append(
            element('td', { className: 'ds-da-label', textContent: 'Plan' }),
            element('td', {
                textContent: dodgeEntry
                    ? `${villageDisplay(dodgeEntry.sourceName, dodgeEntry.sourceCoord)} → ${villageDisplay(dodgeEntry.destinationName, dodgeEntry.destinationCoord)} · ${dodgeEntry.targetKind === 'own' ? 'eigenes Dorf' : 'Barbarendorf'} · ${compactDodgeTroops(dodgeEntry.troops)} · senden ${formatDate(dodgeEntry.sendAt)} · ${dodgeActionLabel(dodgeEntry)} ${formatDate(dodgeEntry.actionAt)}`
                    : `${villageDisplay(assignment.sourceName, assignment.sourceCoord)} → ${villageDisplay(assignment.targetName, assignment.targetCoord)} · ${compactTroops(assignment.troops)} · Ankunft bei sofortigem Senden etwa ${formatDate(serverNow() + assignment.travelSeconds * 1000)}`
            })
        );
        const actionsRow = element('tr');
        actionsRow.append(element('td', { className: 'ds-da-label', textContent: 'Aktion' }));
        const actions = element('td');
        if (dodgeEntry) {
            actions.append(
                button('Ausweichplan in Felder übernehmen', () => fillDodgeForm(dodgeEntry)),
                element('strong', {
                    className: 'ds-da-place-instruction',
                    textContent: `Danach selbst „${dodgeEntry.method === 'support' ? 'Unterstützen' : 'Angreifen'}“ klicken. ${dodgeEntry.actionKind === 'cancel'
                        ? `Befehl um ${formatDate(dodgeEntry.actionAt)} abbrechen.`
                        : dodgeEntry.actionKind === 'land'
                            ? `Nicht abbrechen: Der ausreichend starke Befehl trifft um ${formatDate(dodgeEntry.actionAt)} im Barbarendorf ein und kehrt automatisch zurück.`
                            : `Unterstützung um ${formatDate(dodgeEntry.actionAt)} aus dem eigenen Zieldorf zurückrufen.`}`
                }),
                button('Als gesendet markieren', () => {
                    dodgeEntry.status = 'sent';
                    saveStore();
                    notify('Lokal als gesendet markiert. Der tatsächliche Spielbefehl wird weiterhin nicht automatisch geprüft.');
                })
            );
        } else {
            actions.append(
                button('Plan in Felder übernehmen', () => fillSupportForm(assignment)),
                button('Als gesendet markieren', () => {
                    markSupportSent(assignment);
                    notify(`Unterstützung als unterwegs gespeichert; voraussichtliche Ankunft ${formatDate(assignment.expectedArrival)}.`);
                })
            );
        }
        state.statusElement = element('span', { className: 'ds-da-status', 'aria-live': 'polite' });
        actions.append(state.statusElement);
        actionsRow.append(actions);
        panel.append(title, info, actionsRow);
        form.parentNode.insertBefore(panel, form);
        loadWorldData(false);
    }

    function mapUrl(group) {
        const coord = parseCoord(group.targetCoord);
        const url = new URL('/game.php', window.location.origin);
        if (gameData.village?.id) url.searchParams.set('village', gameData.village.id);
        url.searchParams.set('screen', 'map');
        if (coord) { url.searchParams.set('x', coord.x); url.searchParams.set('y', coord.y); }
        return url.toString();
    }

    function focusMap(group) {
        const coord = parseCoord(group.targetCoord);
        try {
            if (coord && typeof window.TWMap?.focus === 'function') {
                window.TWMap.focus(coord.x, coord.y);
                return;
            }
        } catch (_) { /* Link-Fallback folgt. */ }
        window.location.assign(mapUrl(group));
    }

    function initMapScreen(attempt = 0) {
        const anchor = document.querySelector('#map_wrap, #map');
        if (!anchor) {
            if (attempt < 20) window.setTimeout(() => initMapScreen(attempt + 1), 250);
            return;
        }
        const groups = (state.store.lastGroups || []).filter((group) => group.firstArrival > Date.now() - 3600000).slice(0, 50);
        const panel = element('table', { id: `${SCRIPT_ID}-root`, className: 'vis ds-da-panel ds-da-map-panel' });
        const title = element('tr');
        title.append(element('th', { colSpan: 4, textContent: 'Verteidigungsassistent – gefährdete Dörfer' }));
        panel.append(title);
        const head = element('tr');
        ['Risiko', 'Dorf', 'Erste Ankunft', ''].forEach((text) => head.append(element('th', { textContent: text })));
        panel.append(head);
        if (!groups.length) {
            const empty = element('tr');
            empty.append(element('td', { colSpan: 4, textContent: 'Keine aktuellen Lagegruppen gespeichert. Zuerst die Eingehenden-Ansicht öffnen.' }));
            panel.append(empty);
        }
        groups.forEach((group) => {
            const row = element('tr');
            const action = element('td');
            action.append(button('Zentrieren', () => focusMap(group)));
            row.append(
                element('td', { className: `ds-da-map-risk is-${group.level}`, textContent: `${group.score}/100 ${levelLabel(group.level)}` }),
                element('td', { textContent: `${group.targetName} (${group.targetCoord})` }),
                element('td', { textContent: formatDate(group.firstArrival) }), action
            );
            panel.append(row);
        });
        anchor.parentNode.insertBefore(panel, anchor);
    }

    function injectStyles() {
        if (document.getElementById(`${SCRIPT_ID}-styles`)) return;
        const style = element('style', { id: `${SCRIPT_ID}-styles` });
        style.textContent = `
            .ds-da-panel,.ds-da-groups,.ds-da-plan,.ds-da-dodge-plan{width:100%;margin:0 0 10px;border-collapse:collapse}
            .ds-da-panel td,.ds-da-groups td,.ds-da-plan td,.ds-da-dodge-plan td{vertical-align:top}
            .ds-da-label{width:9em;font-weight:bold;white-space:nowrap}.ds-da-actions>*{margin:2px 5px 2px 0}
            .ds-da-status{display:inline-block;margin-left:8px;color:#47720b}.ds-da-status.is-error,.ds-da-overdue{color:#b20d0d;font-weight:bold}
            .ds-da-filters{display:flex;flex-wrap:wrap;gap:5px;align-items:center}.ds-da-filters input[type=search]{min-width:220px}
            .ds-da-inline{white-space:nowrap}.ds-da-world.is-warning,.ds-da-warning{color:#8a4c00;font-weight:bold}
            .ds-da-config-details summary{cursor:pointer;font-weight:bold;padding:1px 0}.ds-da-config-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin:5px 0 6px}
            .ds-da-config-sections{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:6px;width:100%;max-width:1250px}
            .ds-da-config-card{min-width:0;border:1px solid #c7aa6b;border-radius:5px;background:rgba(255,248,221,.52);box-shadow:0 1px 2px rgba(80,48,15,.12);overflow:hidden}
            .ds-da-config-card-heading{display:flex;align-items:center;gap:5px;padding:4px 6px;background:linear-gradient(#ead39a,#d7b66d);font-weight:bold;color:#4d2d12}
            .ds-da-config-card-heading>div{min-width:0;overflow-wrap:anywhere}
            .ds-da-config-card-icon{display:inline-grid;place-items:center;width:19px;height:19px;border-radius:50%;background:#75502a;color:#fff;font-size:12px}
            .ds-da-config-card-description{padding:3px 6px;color:#674a2c;font-size:.8em;line-height:1.15}
            .ds-da-config-fields{padding:1px 6px 4px}.ds-da-config-field{display:grid;grid-template-columns:minmax(0,1fr) 9.5em;align-items:center;gap:5px;min-height:24px;border-top:1px solid rgba(166,126,66,.25)}
            .ds-da-config-field:first-child{border-top:0}.ds-da-config-control{display:grid;grid-template-columns:minmax(0,1fr) 3.6em;align-items:center;gap:4px}
            .ds-da-config-control input{width:100%;box-sizing:border-box;text-align:right}.ds-da-config-unit{font-size:.82em;color:#765b3d;white-space:nowrap}
            .ds-da-config-caption{display:inline-flex;align-items:center;gap:4px;min-width:0}.ds-da-help{color:#3068a8;cursor:help;font-size:.9em;line-height:1;flex:none}
            .ds-da-config-checks{display:grid;grid-template-columns:1fr;gap:2px;padding:3px 6px 5px;border-top:1px solid rgba(166,126,66,.35)}
            .ds-da-config-checks label{white-space:normal}
            .ds-da-severity,.ds-da-risk,.ds-da-map-risk{display:inline-block;padding:2px 5px;border-radius:3px;font-weight:bold;margin-right:4px}
            .ds-da-native-risk::before{content:attr(data-ds-da-risk);display:inline-block;padding:2px 5px;border-radius:3px;font-weight:bold;margin-right:5px}
            .ds-da-native-risk-critical::before{background:#d63031;color:#fff}.ds-da-native-risk-high::before{background:#e17055;color:#fff}
            .ds-da-native-risk-medium::before{background:#fdcb6e;color:#3b2a00}.ds-da-native-risk-low::before{background:#a3cb65;color:#183000}
            .ds-da-native-risk:focus-within::before{display:none}
            .is-critical{background:#d63031!important;color:#fff}.is-high{background:#e17055!important;color:#fff}
            .is-medium{background:#fdcb6e!important;color:#3b2a00}.is-low{background:#a3cb65!important;color:#183000}
            .ds-da-group.is-critical>td:first-child{border-left:5px solid #d63031}.ds-da-group.is-high>td:first-child{border-left:5px solid #e17055}
            .ds-da-group.is-medium>td:first-child{border-left:5px solid #d89e17}.ds-da-group.is-low>td:first-child{border-left:5px solid #6a9636}
            .ds-da-subline{font-size:.9em;color:#555;margin-top:2px}.ds-da-nowrap{white-space:nowrap}.ds-da-nowrap .btn{display:block;margin:1px 0}
            .ds-da-detail>td{padding:7px!important}.ds-da-detail-grid{display:grid;grid-template-columns:minmax(220px,1fr) minmax(240px,1fr) minmax(450px,2fr);gap:12px}
            .ds-da-model-badge{display:inline-block;margin:4px 0;padding:2px 6px;border-radius:3px;background:#e8d39d;color:#513414;font-weight:bold}
            .ds-da-dodge-box{margin-top:6px;padding:6px;border-left:4px solid #9b782f;background:rgba(255,244,202,.72)}.ds-da-dodge-box.is-strong{border-left-color:#cf6d16;background:#f7dfb2}.ds-da-dodge-box.is-none{border-left-color:#78945b;background:#edf1d7}
            .ds-da-dodge-window{margin:4px 0;font-weight:bold;color:#6a3d12}.ds-da-dodge-auto-target{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin:5px 0;padding:4px 6px;border:1px solid #d0b16e;background:rgba(255,250,224,.72)}
            .ds-da-dodge-auto-target .ds-da-subline{flex-basis:100%}.ds-da-auto-destination{margin-top:4px;padding:2px 4px;background:#ebd69e;color:#513414;font-weight:bold}
            .ds-da-command-list{overflow-x:auto}
            .ds-da-command-list input[placeholder="HH:MM:SS"]{width:6.5em}.ds-da-slowest-unit{white-space:nowrap}
            .ds-da-unit-icon{width:18px;height:18px;object-fit:contain;vertical-align:middle;margin-right:3px}
            .ds-da-plan td:nth-child(3){max-width:430px}.ds-da-shortage td{background:#f4b8aa!important;color:#7a1300;font-weight:bold}
            .ds-da-support-status{min-width:150px}.ds-da-support-status.is-underway strong{color:#2f66a3}.ds-da-support-status.is-arrived strong{color:#47720b}
            .ds-da-support-status.is-return_due{background:#ffe0a3!important}.ds-da-support-status.is-return_due strong,.ds-da-return-instruction{color:#8a3d00;font-weight:bold}
            .ds-da-support-status.is-returning strong{color:#6b4b8f}.ds-da-support-status.is-returned strong{color:#47720b}.ds-da-return-due{background:#9a3e10!important}
            .ds-da-native-return-target>td{outline:2px solid #c66b13;outline-offset:-2px;background:#fff0bf!important}
            .ds-da-dodge-plan{font-size:.92em}.ds-da-dodge-plan td:nth-child(2){max-width:360px}.ds-da-dodge-plan .btn{margin:3px 3px 0 0;white-space:nowrap}.ds-da-plan-blocked td{background:#f8e2b8!important}.ds-da-plan-late td{background:#f5c7bd!important}.ds-da-place-instruction{display:inline-block;margin:4px 8px;color:#7a3e00}
            .ds-da-cancelled{opacity:.55;text-decoration:line-through}.ds-da-plan .btn{text-decoration:none;white-space:nowrap}
            .ds-da-map-panel{max-width:900px}.ds-da-map-risk{white-space:nowrap}
            @media(max-width:1000px){.ds-da-detail-grid{grid-template-columns:1fr}.ds-da-config-sections{grid-template-columns:1fr}.ds-da-plan,.ds-da-dodge-plan{font-size:.9em}.ds-da-label{width:auto}}
        `;
        document.head.append(style);
    }
})();
