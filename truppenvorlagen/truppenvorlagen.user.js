// ==UserScript==
// @name         Die Stämme – Truppenvorlagen in der Rekrutierung
// @namespace    local.die-staemme.truppenvorlagen
// @version      0.3.1
// @description  Zeigt Soll-/Ist-Abweichungen und füllt Fehlbestände in Einzel- und Massenrekrutierung. Sendet niemals selbst ab. Nutzung auf eigene Gefahr.
// @author       Lokal
// @match        https://*.die-staemme.de/game.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.
// Vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen prüfen.

(function () {
    'use strict';

    const VERSION = '0.3.1';
    const SCRIPT_ID = 'ds-troop-templates';
    const STORAGE_VERSION = 1;
    const STORAGE_PREFIX = 'ds-troop-templates';
    const STANDARD_UNITS = [
        'spear', 'sword', 'axe', 'archer', 'spy',
        'light', 'marcher', 'heavy', 'ram', 'catapult'
    ];
    const UNIT_NAMES = {
        spear: 'Speerträger',
        sword: 'Schwertkämpfer',
        axe: 'Axtkämpfer',
        archer: 'Bogenschütze',
        spy: 'Späher',
        light: 'Leichte Kavallerie',
        marcher: 'Berittener Bogenschütze',
        heavy: 'Schwere Kavallerie',
        ram: 'Rammbock',
        catapult: 'Katapult'
    };

    /**
     * Entfernt lokalisierte Tausendertrennzeichen. Die Stämme verwendet je
     * nach Markt Punkte, Leerzeichen oder geschützte Leerzeichen.
     */
    function parseFormattedInt(value) {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
        }
        const digits = String(value ?? '').replace(/[^0-9]/g, '');
        return digits ? Number.parseInt(digits, 10) : null;
    }

    /**
     * Plant zuerst den größtmöglichen proportionalen Anteil aller
     * Fehlbestände und verbraucht anschließend Restressourcen fair weiter.
     * Wenn echte Kosten/Budgets fehlen, dient die konservative Verteilung über
     * die nativen Einzel-Maximalwerte weiterhin als sicherer Fallback.
     */
    function calculatePlan(items, limitAndDistribute = true, availableBudget = null) {
        const normalized = items.map((item) => {
            const deficit = Math.max(0, Math.floor(Number(item.deficit) || 0));
            const parsedMax = Number(item.max);
            const max = Number.isFinite(parsedMax) ? Math.max(0, Math.floor(parsedMax)) : Infinity;
            const cost = normalizeCost(item.cost);
            return { unit: item.unit, deficit, max, cost };
        });

        const result = Object.fromEntries(normalized.map(({ unit }) => [unit, 0]));
        if (!limitAndDistribute) {
            for (const item of normalized) {
                result[item.unit] = item.deficit;
            }
            return result;
        }

        const budget = normalizeBudget(availableBudget);
        const active = normalized.filter((item) => item.deficit > 0 && item.max > 0);
        if (budget && active.length && active.every((item) => item.cost)) {
            return calculateExactBudgetPlan(normalized, budget);
        }

        return calculateMaximaFallbackPlan(normalized, result);
    }

    function calculateExactBudgetPlan(items, budget) {
        const result = Object.fromEntries(items.map(({ unit }) => [unit, 0]));
        const active = items.filter((item) => item.deficit > 0 && item.max > 0 && item.cost);
        if (!active.length) {
            return result;
        }

        // Größtmöglichen proportionalen Anteil der Fehlbestände bestimmen.
        let low = 0;
        let high = 1;
        for (let iteration = 0; iteration < 42; iteration += 1) {
            const middle = (low + high) / 2;
            const candidate = Object.fromEntries(active.map((item) => [
                item.unit,
                Math.min(item.deficit, item.max, Math.floor(item.deficit * middle))
            ]));
            if (planFitsBudget(active, candidate, budget)) {
                low = middle;
            } else {
                high = middle;
            }
        }

        for (const item of active) {
            result[item.unit] = Math.min(item.deficit, item.max, Math.floor(item.deficit * low));
        }

        const remainingBudget = subtractPlanFromBudget(active, result, budget);

        // Verbliebene Ressourcen einzeln so lange nutzen, bis keine noch
        // fehlende, erlaubte Einheit mehr finanzierbar ist. Die relativ größte
        // Restlücke gewinnt, damit das Sollverhältnis erhalten bleibt.
        while (true) {
            const affordable = active
                .filter((item) => result[item.unit] < item.deficit && result[item.unit] < item.max)
                .filter((item) => costFitsBudget(item.cost, remainingBudget))
                .sort((a, b) => {
                    const relativeA = (a.deficit - result[a.unit]) / Math.max(1, a.deficit);
                    const relativeB = (b.deficit - result[b.unit]) / Math.max(1, b.deficit);
                    return relativeB - relativeA || a.unit.localeCompare(b.unit);
                });
            if (!affordable.length) {
                break;
            }
            const chosen = affordable[0];
            result[chosen.unit] += 1;
            for (const resource of ['wood', 'stone', 'iron', 'pop']) {
                remainingBudget[resource] -= chosen.cost[resource];
            }
        }

        return result;
    }

    function calculateMaximaFallbackPlan(normalized, result) {

        const finite = normalized.filter((item) => item.deficit > 0 && Number.isFinite(item.max) && item.max > 0);
        const unknown = normalized.filter((item) => item.deficit > 0 && !Number.isFinite(item.max));

        for (const item of unknown) {
            result[item.unit] = item.deficit;
        }

        const pressure = finite.reduce((sum, item) => sum + (item.deficit / item.max), 0);
        const scale = pressure > 1 ? 1 / pressure : 1;

        const remainders = [];
        for (const item of finite) {
            const ideal = Math.min(item.deficit, item.max, item.deficit * scale);
            const amount = Math.floor(ideal);
            result[item.unit] = amount;
            remainders.push({
                ...item,
                fraction: ideal - amount
            });
        }

        let budget = 1 - finite.reduce((sum, item) => sum + (result[item.unit] / item.max), 0);
        remainders.sort((a, b) => b.fraction - a.fraction || a.unit.localeCompare(b.unit));

        // Pro Einheit höchstens eine Rundungseinheit. So bleibt die Verteilung
        // fair und die Laufzeit unabhängig von sehr großen Truppenzahlen.
        for (const item of remainders) {
            const unitCost = 1 / item.max;
            if (result[item.unit] < item.deficit && result[item.unit] < item.max && unitCost <= budget + 1e-12) {
                result[item.unit] += 1;
                budget -= unitCost;
            }
        }

        return result;
    }

    function normalizeCost(cost) {
        if (!cost || typeof cost !== 'object') {
            return null;
        }
        const normalized = {};
        for (const resource of ['wood', 'stone', 'iron', 'pop']) {
            const value = Number(cost[resource]);
            if (!Number.isFinite(value) || value < 0) {
                return null;
            }
            normalized[resource] = Math.floor(value);
        }
        return Object.values(normalized).some((value) => value > 0) ? normalized : null;
    }

    function normalizeBudget(budget) {
        if (!budget || typeof budget !== 'object') {
            return null;
        }
        const normalized = {};
        for (const resource of ['wood', 'stone', 'iron', 'pop']) {
            const value = Number(budget[resource]);
            if (!Number.isFinite(value) || value < 0) {
                return null;
            }
            normalized[resource] = Math.floor(value);
        }
        return normalized;
    }

    function planFitsBudget(items, plan, budget) {
        const spent = calculateSpentResources(items, plan);
        return ['wood', 'stone', 'iron', 'pop'].every((resource) => spent[resource] <= budget[resource]);
    }

    function subtractPlanFromBudget(items, plan, budget) {
        const spent = calculateSpentResources(items, plan);
        return Object.fromEntries(['wood', 'stone', 'iron', 'pop'].map((resource) => [
            resource,
            budget[resource] - spent[resource]
        ]));
    }

    function calculateSpentResources(items, plan) {
        const spent = { wood: 0, stone: 0, iron: 0, pop: 0 };
        for (const item of items) {
            if (!item.cost) continue;
            const amount = Math.max(0, Number(plan[item.unit]) || 0);
            for (const resource of ['wood', 'stone', 'iron', 'pop']) {
                spent[resource] += amount * item.cost[resource];
            }
        }
        return spent;
    }

    function costFitsBudget(cost, budget) {
        return ['wood', 'stone', 'iron', 'pop'].every((resource) => cost[resource] <= budget[resource]);
    }

    // Kleine, absichtlich dokumentierte Testoberfläche für die lokalen Tests.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { calculatePlan, parseFormattedInt };
        return;
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return;
    }

    const gameData = window.game_data || {};
    const search = new URLSearchParams(window.location.search);
    const screen = search.get('screen') || gameData.screen;
    const mode = search.get('mode') || gameData.mode || 'train';

    if (screen !== 'train' || !['train', 'mass'].includes(mode)) {
        return;
    }

    if (document.getElementById(`${SCRIPT_ID}-panel`)) {
        return;
    }

    const worldUnits = (() => {
        const configured = Array.isArray(gameData.units) ? gameData.units : STANDARD_UNITS;
        const enabled = STANDARD_UNITS.filter((unit) => configured.includes(unit));
        return enabled.length ? enabled : STANDARD_UNITS.slice();
    })();

    const state = {
        mode,
        store: loadStore(),
        selectedTemplateId: null,
        templateActive: false,
        contexts: [],
        targetInputs: new Map(),
        snapshotCache: new Map(),
        includeQueueInput: null,
        limitInput: null,
        masterSelectionInput: null,
        templateSelect: null,
        templateNameInput: null,
        templateEditorToggle: null,
        templateEditorRows: [],
        statusElement: null,
        costSummaryElement: null,
        applyButton: null,
        panel: null,
        anchor: null,
        observer: null,
        refreshTimer: null,
        refreshingIntegration: false
    };

    injectStyles();

    const screenElements = discoverScreen();
    if (!screenElements) {
        return;
    }

    state.contexts = screenElements.contexts;
    state.anchor = screenElements.anchor;
    initializeContextTemplates();
    state.panel = createPanel();
    screenElements.anchor.parentNode.insertBefore(state.panel, screenElements.anchor);

    if (mode === 'mass') {
        decorateMassContexts();
    }

    refreshTemplateSelect();
    restoreSelectedTemplate();
    renderAllContexts();
    startIntegrationObserver();

    window.DSTroopTemplates = Object.freeze({
        version: VERSION,
        refresh: () => refreshIntegration(true),
        calculatePlan
    });

    function discoverScreen() {
        if (mode === 'train') {
            const form = document.querySelector('#train_form');
            if (!form) {
                return null;
            }
            const context = buildSingleContext(document, form);
            return context ? { anchor: form, contexts: [context] } : null;
        }

        const table = document.querySelector('#mass_train_table');
        if (!table) {
            return null;
        }
        const contexts = buildMassContexts(table);
        return contexts.length ? { anchor: table, contexts } : null;
    }

    function buildSingleContext(root, form) {
        const queueInfo = readQueuedCounts(root);
        const units = collectSingleEntries(form, queueInfo.counts, true);
        if (!units.size) {
            return null;
        }
        const budget = readAvailableBudget(root, window.game_data || gameData);

        return {
            kind: 'single',
            scope: form,
            villageId: String(window.game_data?.village?.id || gameData.village?.id || search.get('village') || ''),
            units,
            counts: Object.fromEntries([...units].map(([unit, entry]) => [unit, entry.total])),
            queued: Object.fromEntries([...units].map(([unit, entry]) => [unit, entry.queued])),
            budget,
            budgetKnown: Boolean(budget),
            queueKnown: true,
            selectionInput: null,
            templateId: null,
            templateSelect: null,
            summaryElement: null,
            snapshotLoaded: true
        };
    }

    function collectSingleEntries(form, queuedCounts, decorate) {
        const entries = new Map();
        const links = form.querySelectorAll('.unit_link[data-unit]');

        for (const link of links) {
            const unit = link.getAttribute('data-unit');
            if (!worldUnits.includes(unit)) {
                continue;
            }
            const row = link.closest('tr');
            if (!row) {
                continue;
            }
            const input = findRecruitInput(row, unit);
            if (!input) {
                continue;
            }
            const pair = parseCountPair(row);
            const countCell = pair?.element || row.cells?.[2] || null;
            const statusElement = decorate ? ensureStatusElement(countCell || input.closest('td'), 'single') : null;
            const entry = {
                unit,
                input,
                total: pair?.total ?? null,
                home: pair?.home ?? null,
                queued: queuedCounts[unit] || 0,
                queueKnown: true,
                max: readMaxForInput(input),
                cost: readUnitCost(row, unit),
                statusElement
            };
            attachRecruitInputListener(entry);
            entries.set(unit, entry);
        }
        return entries;
    }

    function buildMassContexts(table) {
        const tbodyCandidates = [...table.tBodies].filter((tbody) => collectUnitInputs(tbody).size > 0);
        let scopes;

        if (tbodyCandidates.length > 1) {
            scopes = tbodyCandidates;
        } else {
            const rowCandidates = [...table.querySelectorAll('tr')].filter((row) => collectUnitInputs(row).size > 0);
            scopes = rowCandidates.length > 1 ? rowCandidates : tbodyCandidates;
        }

        return (scopes || []).map((scope) => {
            const rawInputs = collectUnitInputs(scope);
            const queueInfo = readQueuedCounts(scope);
            const villageId = extractVillageId(scope, rawInputs);
            const units = new Map();
            const budget = readAvailableBudget(scope, null);

            for (const [unit, input] of rawInputs) {
                const total = readCurrentForMassInput(input, unit);
                const statusElement = ensureStatusElement(input.closest('td, th') || input.parentElement, 'mass');
                const entry = {
                    unit,
                    input,
                    total,
                    home: null,
                    queued: queueInfo.counts[unit] || 0,
                    queueKnown: queueInfo.known,
                    max: readMaxForInput(input),
                    cost: readUnitCost(input.closest('td, th') || input.closest('tr'), unit),
                    statusElement
                };
                attachRecruitInputListener(entry);
                units.set(unit, entry);
            }

            return {
                kind: 'mass',
                scope,
                villageId,
                units,
                counts: Object.fromEntries([...units].map(([unit, entry]) => [unit, entry.total])),
                queued: Object.fromEntries([...units].map(([unit, entry]) => [unit, entry.queued])),
                budget,
                budgetKnown: Boolean(budget),
                queueKnown: queueInfo.known,
                selectionInput: null,
                templateId: null,
                templateSelect: null,
                summaryElement: null,
                snapshotLoaded: false
            };
        });
    }

    function collectUnitInputs(scope) {
        const found = new Map();
        const inputs = scope.querySelectorAll('input[type="text"], input[type="number"], input:not([type])');
        for (const input of inputs) {
            if (input.closest(`#${SCRIPT_ID}-panel`) || input.classList.contains('ds-tt-target')) {
                continue;
            }
            const unit = resolveUnitForInput(input);
            if (unit && worldUnits.includes(unit) && !found.has(unit)) {
                found.set(unit, input);
            }
        }
        return found;
    }

    function resolveUnitForInput(input) {
        const dataUnit = input.getAttribute('data-unit') || input.closest('[data-unit]')?.getAttribute('data-unit');
        if (worldUnits.includes(dataUnit)) {
            return dataUnit;
        }

        const rowUnit = input.closest('tr')?.querySelector('.unit_link[data-unit]')?.getAttribute('data-unit');
        if (worldUnits.includes(rowUnit)) {
            return rowUnit;
        }

        const identity = [input.name, input.id, input.className, input.getAttribute('aria-label')]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        const ordered = worldUnits.slice().sort((a, b) => b.length - a.length);
        for (const unit of ordered) {
            const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(identity)) {
                return unit;
            }
        }

        const cell = input.closest('td, th');
        if (cell) {
            const assetText = [...cell.querySelectorAll('img, [class*="unit_"]')]
                .map((node) => `${node.getAttribute('src') || ''} ${node.className || ''} ${node.getAttribute('title') || ''}`)
                .join(' ')
                .toLowerCase();
            for (const unit of ordered) {
                if (assetText.includes(`unit_${unit}`) || assetText.includes(`/${unit}.`)) {
                    return unit;
                }
            }
        }
        return null;
    }

    function findRecruitInput(row, unit) {
        const direct = row.querySelector(`input[name="${unit}"], input[data-unit="${unit}"], input[id^="${unit}_"]`);
        if (direct) {
            return direct;
        }
        return [...row.querySelectorAll('input[type="text"], input[type="number"], input:not([type])')]
            .find((input) => resolveUnitForInput(input) === unit) || null;
    }

    function parseCountPair(scope) {
        const cells = scope.matches?.('td, th') ? [scope] : [...scope.querySelectorAll('td, th')];
        for (const cell of cells) {
            const match = cell.textContent.match(/^\s*([0-9][0-9.\s\u00a0]*)\s*\/\s*([0-9][0-9.\s\u00a0]*)\s*$/);
            if (match) {
                return {
                    home: parseFormattedInt(match[1]),
                    total: parseFormattedInt(match[2]),
                    element: cell
                };
            }
        }
        return null;
    }

    function readCurrentForMassInput(input, unit) {
        for (const attribute of ['data-total-count', 'data-own-count', 'data-current-count', 'data-count']) {
            const value = input.getAttribute(attribute);
            if (value !== null) {
                return parseFormattedInt(value);
            }
        }

        const unitScope = input.closest('td, th') || input.parentElement;
        if (!unitScope) {
            return null;
        }

        const explicit = unitScope.querySelector(
            `[data-unit="${unit}"][data-count], [id*="entry_all_${unit}"], [id*="total_${unit}"], [class*="total"][data-unit="${unit}"]`
        );
        if (explicit) {
            const value = explicit.getAttribute('data-count') ?? explicit.textContent;
            const parsed = parseFormattedInt(value);
            if (parsed !== null) {
                return parsed;
            }
        }

        // In kompakten Massenansichten stehen Istbestand und Eingabefeld oft
        // in derselben Zelle. Native Maximalwert-Links werden vorher entfernt.
        const clone = unitScope.cloneNode(true);
        clone.querySelectorAll('input, button, select, a, .ds-tt-delta').forEach((node) => node.remove());
        const text = clone.textContent.trim();
        const slash = text.match(/([0-9][0-9.\s\u00a0]*)\s*\/\s*([0-9][0-9.\s\u00a0]*)/);
        if (slash) {
            return parseFormattedInt(slash[2]);
        }
        const localCount = text.match(/([0-9]{1,3}(?:[.\u00a0 ]+[0-9]{3})+|[0-9]+)/);
        if (localCount) {
            return parseFormattedInt(localCount[1]);
        }

        // Nur bei einer klassischen Einheitenzeile mit genau einem
        // Rekrutierungsfeld darf ein Zahl/Zahl-Paar aus einer anderen Zelle
        // derselben Zeile als Bestand dienen. In der Massenansicht ist das
        // Paar sonst die Bauernhofbelegung und gehört nicht zu einer Einheit.
        const row = input.closest('tr');
        const recruitInputsInRow = row
            ? [...row.querySelectorAll('input[type="text"], input[type="number"], input:not([type])')]
                .filter((candidate) => !candidate.closest(`#${SCRIPT_ID}-panel`) && resolveUnitForInput(candidate))
            : [];
        if (recruitInputsInRow.length === 1) {
            const pair = parseCountPair(row);
            if (pair) return pair.total;
        }
        return null;
    }

    function readUnitCost(row, unit) {
        if (!row) {
            return null;
        }
        const cost = {};
        for (const resource of ['wood', 'stone', 'iron', 'pop']) {
            const exactId = `${unit}_0_cost_${resource}`;
            let valueNode = row.ownerDocument.getElementById(exactId);
            if (valueNode && !row.contains(valueNode)) {
                valueNode = null;
            }
            valueNode ||= row.querySelector(`[id$="_cost_${resource}"], [data-cost-${resource}]`);

            let value = valueNode
                ? parseFormattedInt(valueNode.getAttribute(`data-cost-${resource}`) ?? valueNode.textContent)
                : null;

            if (value === null) {
                const iconClass = resource === 'pop' ? 'population' : resource;
                const icon = row.querySelector(`.icon.header.${iconClass}, .icon.${iconClass}`);
                const wrapper = icon?.parentElement;
                if (wrapper) {
                    const clone = wrapper.cloneNode(true);
                    clone.querySelectorAll('.icon').forEach((node) => node.remove());
                    value = parseFormattedInt(clone.textContent);
                }
            }

            if (value === null) {
                const managerCost = window.unit_managers?.units?.[unit]?.[resource];
                value = Number.isFinite(Number(managerCost)) ? Math.floor(Number(managerCost)) : null;
            }

            if (value === null) {
                return null;
            }
            cost[resource] = value;
        }
        return normalizeCost(cost);
    }

    function readAvailableBudget(root, sourceGameData) {
        const village = sourceGameData?.village;
        if (village) {
            const wood = finiteInt(village.wood);
            const stone = finiteInt(village.stone);
            const iron = finiteInt(village.iron);
            const population = finiteInt(village.pop);
            const populationMax = finiteInt(village.pop_max);
            if ([wood, stone, iron, population, populationMax].every((value) => value !== null)) {
                return { wood, stone, iron, pop: Math.max(0, populationMax - population) };
            }
        }

        const wood = readElementNumber(root, ['#wood', '[data-resource="wood"]']);
        const stone = readElementNumber(root, ['#stone', '[data-resource="stone"]']);
        const iron = readElementNumber(root, ['#iron', '[data-resource="iron"]']);
        const population = readElementNumber(root, ['#pop_current', '[data-pop-current]']);
        const populationMax = readElementNumber(root, ['#pop_max', '[data-pop-max]']);
        if ([wood, stone, iron, population, populationMax].every((value) => value !== null)) {
            return { wood, stone, iron, pop: Math.max(0, populationMax - population) };
        }
        return null;
    }

    function readElementNumber(root, selectors) {
        for (const selector of selectors) {
            const node = root.querySelector(selector);
            if (!node) continue;
            const resourceAmount = node.hasAttribute('data-resource') ? node.getAttribute('data-amount') : null;
            const dataValue = node.getAttribute('data-value') ?? resourceAmount ?? node.textContent;
            const parsed = parseFormattedInt(dataValue);
            if (parsed !== null) return parsed;
        }
        return null;
    }

    function finiteInt(value) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : null;
    }

    function readMaxForInput(input) {
        // Der Link neben dem Feld ist der vom Spiel aktuell berechnete
        // rekrutierbare Wert. Ein generisches HTML-Attribut `max` kann dagegen
        // lediglich die technische Eingabegrenze sein und kommt daher zuletzt.
        const cell = input.closest('td, th') || input.parentElement;
        if (cell) {
            const links = [...cell.querySelectorAll('a')];
            const preferred = links.find((link) => /set_max|max/i.test(`${link.getAttribute('href') || ''} ${link.getAttribute('onclick') || ''}`));
            const candidates = preferred ? [preferred, ...links.filter((link) => link !== preferred)] : links;
            for (const link of candidates) {
                const match = link.textContent.match(/\(([0-9][0-9.\s\u00a0]*)\)/);
                if (match) {
                    return parseFormattedInt(match[1]);
                }
            }
        }

        for (const attribute of ['data-max-count', 'data-max', 'max']) {
            const raw = input.getAttribute(attribute);
            if (raw !== null && raw !== '') {
                const parsed = parseFormattedInt(raw);
                if (parsed !== null) {
                    return parsed;
                }
            }
        }

        if (!cell) {
            return Infinity;
        }
        return Infinity;
    }

    function readQueuedCounts(root) {
        const counts = Object.fromEntries(worldUnits.map((unit) => [unit, 0]));
        const queueContainers = root.querySelectorAll('.trainqueue_wrap, [id^="trainqueue_wrap_"], [data-trainqueue]');
        const known = queueContainers.length > 0;
        const rows = root.querySelectorAll(
            '.trainqueue_wrap tr, [id^="trainqueue_wrap_"] tr, [data-trainqueue] tr'
        );

        for (const row of rows) {
            const unit = resolveQueueUnit(row);
            if (!unit) {
                continue;
            }
            const firstCell = row.querySelector('td');
            const match = firstCell?.textContent.match(/([0-9][0-9.\s\u00a0]*)/);
            const amount = match ? parseFormattedInt(match[1]) : null;
            if (amount !== null) {
                counts[unit] += amount;
            }
        }
        return { counts, known };
    }

    function resolveQueueUnit(row) {
        const candidates = row.querySelectorAll('[class*="unit_sprite"], img');
        for (const node of candidates) {
            const identity = `${node.className || ''} ${node.getAttribute('src') || ''}`.toLowerCase();
            for (const unit of worldUnits) {
                if (new RegExp(`(^|\\s)${unit}(\\s|$)`).test(identity) || identity.includes(`unit_${unit}`) || identity.includes(`/${unit}.`)) {
                    return unit;
                }
            }
        }
        return null;
    }

    function extractVillageId(scope, unitInputs) {
        const direct = scope.getAttribute?.('data-village-id') || scope.querySelector?.('[data-village-id]')?.getAttribute('data-village-id');
        if (/^\d+$/.test(direct || '')) {
            return direct;
        }

        for (const link of scope.querySelectorAll('a[href*="village="]')) {
            try {
                const id = new URL(link.href, window.location.href).searchParams.get('village');
                if (/^\d+$/.test(id || '')) {
                    return id;
                }
            } catch (_) {
                // Der nächste robuste Datenpfad wird versucht.
            }
        }

        for (const input of unitInputs.values()) {
            const identity = `${input.name || ''} ${input.id || ''}`;
            const numbers = identity.match(/\d{2,}/g);
            if (numbers?.length) {
                return numbers[numbers.length - 1];
            }
        }
        return '';
    }

    function createPanel() {
        const table = element('table', {
            id: `${SCRIPT_ID}-panel`,
            className: `vis ds-tt-panel ${mode === 'mass' ? 'ds-tt-panel-mass' : ''}`
        });
        const tbody = element('tbody');
        table.append(tbody);

        const titleRow = element('tr');
        titleRow.append(element('th', {
            colSpan: 2,
            textContent: mode === 'mass' ? 'Zugewiesene Dorfvorlagen' : 'Truppenvorlage'
        }));
        tbody.append(titleRow);

        const templateRow = element('tr');
        templateRow.append(element('td', {
            className: 'ds-tt-label',
            textContent: mode === 'mass' ? 'Bearbeiten' : 'Vorlage'
        }));
        const templateControls = element('td');
        state.templateSelect = element('select', { className: 'ds-tt-template-select', title: 'Gespeicherte Vorlage auswählen' });
        state.templateNameInput = element('input', {
            type: 'text',
            maxLength: 60,
            placeholder: 'Name der Vorlage',
            className: 'ds-tt-name'
        });
        const newButton = button('Neu', startNewTemplate, 'Leere Vorlage beginnen');
        const saveButton = button('Speichern', saveCurrentTemplate, 'Vorlage lokal in diesem Browser speichern');
        const deleteButton = button('Löschen', deleteCurrentTemplate, 'Ausgewählte Vorlage löschen');
        templateControls.append(state.templateSelect, state.templateNameInput, newButton, saveButton, deleteButton);
        templateRow.append(templateControls);
        if (mode === 'train') tbody.append(templateRow);

        const targetRow = element('tr');
        targetRow.append(element('td', {
            className: 'ds-tt-label',
            textContent: mode === 'mass' ? 'Vorlagenwerte' : 'Sollbestand'
        }));
        const targetCell = element('td');
        const targetGrid = element('div', { className: 'ds-tt-target-grid' });
        for (const unit of worldUnits) {
            const label = element('label', {
                className: 'ds-tt-unit-target',
                title: `${UNIT_NAMES[unit] || unit}: gewünschter Gesamtbestand`
            });
            const icon = element('span', {
                className: `unit_sprite unit_sprite_smaller ${unit} ds-tt-unit-icon`,
                'aria-hidden': 'true'
            });
            const name = element('span', { className: 'ds-tt-unit-name', textContent: UNIT_NAMES[unit] || unit });
            const input = element('input', {
                type: 'number',
                min: '0',
                max: '999999',
                step: '1',
                inputMode: 'numeric',
                className: 'ds-tt-target',
                'aria-label': `Sollbestand ${UNIT_NAMES[unit] || unit}`
            });
            input.addEventListener('input', () => {
                state.templateActive = true;
                renderAllContexts();
            });
            state.targetInputs.set(unit, input);
            label.append(icon, name, input);
            targetGrid.append(label);
        }
        targetCell.append(targetGrid);
        targetRow.append(targetCell);
        if (mode === 'train') tbody.append(targetRow);

        const actionRow = element('tr');
        actionRow.append(element('td', {
            className: 'ds-tt-label',
            textContent: mode === 'mass' ? 'Dorfvorlagen' : 'Rekrutierung'
        }));
        const actionCell = element('td');

        state.includeQueueInput = element('input', { type: 'checkbox', checked: true });
        state.includeQueueInput.addEventListener('change', renderAllContexts);
        actionCell.append(labeledCheckbox(state.includeQueueInput, 'laufende Warteschlangen mitzählen'));

        state.limitInput = element('input', { type: 'checkbox', checked: true });
        actionCell.append(labeledCheckbox(state.limitInput, 'verfügbare Ressourcen proportional verteilen'));

        if (mode === 'mass') {
            state.masterSelectionInput = element('input', { type: 'checkbox', checked: true });
            state.masterSelectionInput.addEventListener('change', () => {
                for (const context of state.contexts) {
                    if (isVisible(context.scope) && context.selectionInput) {
                        context.selectionInput.checked = state.masterSelectionInput.checked;
                    }
                }
                updateMasterSelection();
                renderCostSummary();
            });
            actionCell.append(labeledCheckbox(state.masterSelectionInput, 'sichtbare Dörfer einbeziehen'));
        }

        state.applyButton = button(
            mode === 'mass' ? 'Zugewiesene Vorlagen eintragen' : 'Fehlbestand eintragen',
            applyTemplate,
            'Füllt nur die Rekrutierungsfelder; kein automatisches Absenden'
        );
        const clearButton = button(
            mode === 'mass' ? 'Felder einbezogener Dörfer leeren' : 'Rekrutierungsfelder leeren',
            clearRecruitInputs,
            'Leert die Felder der einbezogenen Dörfer'
        );
        actionCell.append(state.applyButton, clearButton);

        state.statusElement = element('span', { className: 'ds-tt-panel-status', 'aria-live': 'polite' });
        actionCell.append(state.statusElement);
        actionRow.append(actionCell);
        tbody.append(actionRow);

        const costRow = element('tr');
        costRow.append(element('td', { className: 'ds-tt-label', textContent: 'Ausgaben' }));
        state.costSummaryElement = element('td', { className: 'ds-tt-cost-summary', 'aria-live': 'polite' });
        costRow.append(state.costSummaryElement);
        tbody.append(costRow);

        if (mode === 'mass') {
            const managementRow = element('tr', { className: 'ds-tt-management-row' });
            managementRow.append(element('td', { className: 'ds-tt-label', textContent: 'Verwaltung' }));
            const managementCell = element('td');
            state.templateEditorToggle = button('Vorlagen verwalten', toggleMassTemplateEditor, 'Vorlagen erstellen oder bearbeiten');
            state.templateEditorToggle.setAttribute('aria-expanded', 'false');
            managementCell.append(state.templateEditorToggle);
            managementRow.append(managementCell);
            templateRow.hidden = true;
            targetRow.hidden = true;
            state.templateEditorRows = [templateRow, targetRow];
            tbody.append(managementRow, templateRow, targetRow);
        }

        state.templateSelect.addEventListener('change', onTemplateSelected);
        return table;
    }

    function toggleMassTemplateEditor() {
        const open = state.templateEditorRows.some((row) => row.hidden);
        for (const row of state.templateEditorRows) row.hidden = !open;
        state.templateEditorToggle.setAttribute('aria-expanded', String(open));
        state.templateEditorToggle.textContent = open ? 'Vorlagenverwaltung schließen' : 'Vorlagen verwalten';
    }

    function button(label, listener, title) {
        const node = element('button', { type: 'button', className: 'btn', textContent: label, title });
        node.addEventListener('click', listener);
        return node;
    }

    function labeledCheckbox(input, text) {
        const label = element('label', { className: 'ds-tt-option' });
        label.append(input, document.createTextNode(` ${text}`));
        return label;
    }

    function decorateMassContexts(previousSelection = new Map()) {
        state.contexts.forEach((context, index) => {
            const firstRow = context.scope.matches('tr') ? context.scope : context.scope.querySelector('tr');
            if (!firstRow) {
                return;
            }
            const villageLink = firstRow.querySelector('a[href*="village="]');
            const cell = villageLink?.closest('td, th') || firstRow.querySelector('td, th');
            if (!cell) {
                return;
            }

            const wrapper = element('div', {
                className: 'ds-tt-village-choice',
            });
            const villageName = villageLink?.textContent.trim() || context.villageId || `Dorf ${index + 1}`;
            const selectionKey = context.villageId || `index:${index}`;
            context.selectionInput = element('input', {
                type: 'checkbox',
                checked: previousSelection.has(selectionKey) ? previousSelection.get(selectionKey) : true,
                className: 'ds-tt-village-checkbox',
                'aria-label': `${villageName} einbeziehen`,
                title: 'Dieses Dorf beim Eintragen berücksichtigen'
            });
            context.selectionInput.addEventListener('change', () => {
                updateMasterSelection();
                renderCostSummary();
            });
            const checkboxLabel = element('label', {
                className: 'ds-tt-village-checkbox-label',
                title: 'Dieses Dorf beim Eintragen berücksichtigen'
            });
            checkboxLabel.append(context.selectionInput, document.createTextNode(' Einbeziehen'));

            context.templateSelect = element('select', {
                className: 'ds-tt-village-template-select',
                'aria-label': `Vorlage für ${villageName}`,
                title: `Gespeicherte Vorlage für ${villageName}`
            });
            fillTemplateSelect(context.templateSelect, context.templateId, '– Vorlage wählen –');
            context.templateSelect.addEventListener('change', () => {
                context.templateId = context.templateSelect.value || null;
                persistVillageTemplate(context.villageId, context.templateId);
                renderContext(context);
                renderCostSummary();
            });
            context.summaryElement = element('span', { className: 'ds-tt-village-summary' });
            wrapper.append(checkboxLabel, context.templateSelect, context.summaryElement);
            cell.prepend(wrapper);
        });
        updateMasterSelection();
    }

    function updateMasterSelection() {
        if (!state.masterSelectionInput) {
            return;
        }
        const visible = state.contexts.filter((context) => isVisible(context.scope) && context.selectionInput);
        const selected = visible.filter((context) => context.selectionInput.checked).length;
        state.masterSelectionInput.checked = visible.length > 0 && selected === visible.length;
        state.masterSelectionInput.indeterminate = selected > 0 && selected < visible.length;
    }

    function ensureStatusElement(parent, density) {
        if (!parent) {
            return null;
        }
        let node = parent.querySelector(`:scope > .ds-tt-delta[data-density="${density}"]`);
        if (!node) {
            node = element('span', {
                className: `ds-tt-delta ds-tt-delta-${density}`,
                'data-density': density
            });
            parent.append(node);
        }
        return node;
    }

    function attachRecruitInputListener(entry) {
        const update = () => {
            renderAllContexts();
        };
        entry.input.addEventListener('input', update);
        entry.input.addEventListener('change', update);
    }

    function renderAllContexts() {
        for (const context of state.contexts) {
            renderContext(context);
        }
        updateMasterSelection();
        renderCostSummary();
    }

    function renderContext(context) {
        const templateActive = contextHasTemplate(context);
        let missingTypes = 0;
        let excessTypes = 0;
        let unknownTypes = 0;
        for (const entry of context.units.values()) {
            const result = renderEntry(entry, context);
            if (result === 'missing') missingTypes += 1;
            if (result === 'excess') excessTypes += 1;
            if (result === 'unknown') unknownTypes += 1;
        }

        if (context.summaryElement) {
            const parts = [];
            if (missingTypes) parts.push(`${missingTypes}× fehlt`);
            if (excessTypes) parts.push(`${excessTypes}× zu viel`);
            if (unknownTypes) parts.push(`${unknownTypes}× ?`);
            context.summaryElement.textContent = templateActive ? parts.join(', ') || 'passt' : 'keine Vorlage';
            context.summaryElement.className = `ds-tt-village-summary ${missingTypes ? 'is-missing' : excessTypes ? 'is-excess' : ''}`;
        }
    }

    function renderEntry(entry, context) {
        if (!entry.statusElement) {
            return 'unknown';
        }
        entry.statusElement.className = entry.statusElement.className
            .replace(/\s+is-(missing|excess|exact|unknown)/g, '');

        if (!contextHasTemplate(context)) {
            entry.statusElement.textContent = '';
            entry.statusElement.removeAttribute('title');
            return 'inactive';
        }

        if (entry.total === null || entry.total === undefined) {
            entry.statusElement.textContent = 'Bestand ?';
            entry.statusElement.classList.add('is-unknown');
            entry.statusElement.title = 'Der Bestand konnte aus dieser Massenansicht noch nicht gelesen werden.';
            return 'unknown';
        }

        const target = readTargetForContext(context, entry.unit);
        const queue = state.includeQueueInput.checked ? (entry.queued || 0) : 0;
        const current = entry.total + queue;
        const delta = target - current;
        const entered = parseFormattedInt(entry.input.value) || 0;
        const enteredText = entered ? ` · eingetragen ${formatNumber(entered)}` : '';
        const compact = entry.statusElement.dataset.density === 'mass';
        const compactEntered = entered ? ` | +${formatNumber(entered)}` : '';

        if (delta > 0) {
            entry.statusElement.textContent = compact
                ? `−${formatNumber(delta)}${compactEntered}`
                : `Soll ${formatNumber(target)} · fehlen ${formatNumber(delta)}${enteredText}`;
            entry.statusElement.classList.add('is-missing');
            entry.statusElement.title = statusTitle(entry, target, current, entered);
            return 'missing';
        }
        if (delta < 0) {
            entry.statusElement.textContent = compact
                ? `+${formatNumber(-delta)}${compactEntered}`
                : `Soll ${formatNumber(target)} · ${formatNumber(-delta)} zu viel${enteredText}`;
            entry.statusElement.classList.add('is-excess');
            entry.statusElement.title = statusTitle(entry, target, current, entered);
            return 'excess';
        }

        entry.statusElement.textContent = compact
            ? `✓${compactEntered}`
            : `Soll ${formatNumber(target)} · passt${enteredText}`;
        entry.statusElement.classList.add('is-exact');
        entry.statusElement.title = statusTitle(entry, target, current, entered);
        return 'exact';
    }

    function statusTitle(entry, target, current, entered = 0) {
        const queueText = state.includeQueueInput.checked
            ? (entry.queueKnown ? `, davon ${formatNumber(entry.queued || 0)} in Warteschlangen` : ', Warteschlange ggf. noch unbekannt')
            : '';
        const enteredText = entered ? `; eingetragen ${formatNumber(entered)}` : '';
        return `${UNIT_NAMES[entry.unit] || entry.unit}: Ist ${formatNumber(current)}${queueText}; Soll ${formatNumber(target)}${enteredText}`;
    }

    function renderCostSummary() {
        if (!state.costSummaryElement) {
            return;
        }
        const contexts = applicableContexts();
        const spent = { wood: 0, stone: 0, iron: 0, pop: 0 };
        let unknownCostFields = 0;

        for (const context of contexts) {
            for (const entry of context.units.values()) {
                const amount = parseFormattedInt(entry.input.value) || 0;
                if (!amount) continue;
                if (!entry.cost) {
                    unknownCostFields += 1;
                    continue;
                }
                for (const resource of ['wood', 'stone', 'iron', 'pop']) {
                    spent[resource] += amount * entry.cost[resource];
                }
            }
        }

        const content = document.createDocumentFragment();
        content.append(document.createTextNode(mode === 'mass' ? 'Ausgewählte Dörfer: ' : 'Geplant: '));
        appendResourceValues(content, spent);

        if (contexts.length === 1 && contexts[0].budgetKnown && contexts[0].budget) {
            const remaining = Object.fromEntries(['wood', 'stone', 'iron', 'pop'].map((resource) => [
                resource,
                Math.max(0, contexts[0].budget[resource] - spent[resource])
            ]));
            content.append(document.createTextNode(' · verbleibt: '));
            appendResourceValues(content, remaining);
        }

        if (unknownCostFields) {
            content.append(document.createTextNode(` · ${unknownCostFields} Feld(er) ohne lesbare Kostendaten`));
        }
        state.costSummaryElement.replaceChildren(content);
    }

    function appendResourceValues(parent, values) {
        const resources = [
            ['wood', 'Holz'],
            ['stone', 'Lehm'],
            ['iron', 'Eisen'],
            ['pop', 'Bevölkerung']
        ];
        resources.forEach(([resource, label], index) => {
            if (index) parent.append(document.createTextNode('  '));
            const wrapper = element('span', { className: 'ds-tt-resource-value', title: label });
            const iconClass = resource === 'pop' ? 'population' : resource;
            wrapper.append(
                element('span', { className: `icon header ${iconClass}`, 'aria-hidden': 'true' }),
                document.createTextNode(` ${formatNumber(values[resource])}`)
            );
            parent.append(wrapper);
        });
    }

    async function applyTemplate() {
        if (mode === 'train' && !state.templateActive) {
            notify('Bitte zuerst eine Vorlage auswählen oder Sollbestände eingeben.', true);
            return;
        }

        const selectedContexts = applicableContexts();
        if (!selectedContexts.length) {
            notify('Kein sichtbares Dorf ist ausgewählt.', true);
            return;
        }
        const contexts = selectedContexts.filter(contextHasTemplate);
        const withoutTemplate = selectedContexts.length - contexts.length;
        if (!contexts.length) {
            notify('Für die ausgewählten Dörfer ist keine Vorlage festgelegt.', true);
            return;
        }

        setBusy(true);
        let failed = 0;
        let fieldsFilled = 0;
        let villagesFilled = 0;
        let unknownMaxima = 0;
        let unknownCosts = 0;

        try {
            await mapWithConcurrency(contexts, 2, async (context, index) => {
                if (needsSnapshot(context)) {
                    notify(`Bestände laden: ${index + 1}/${contexts.length} …`, false, true);
                    const ok = await hydrateContext(context);
                    if (!ok) failed += 1;
                }
            });

            for (const context of contexts) {
                const items = [];
                for (const entry of context.units.values()) {
                    if (entry.input.disabled || entry.input.readOnly || entry.total === null || entry.total === undefined) {
                        continue;
                    }
                    const queue = state.includeQueueInput.checked ? (entry.queued || 0) : 0;
                    const deficit = Math.max(0, readTargetForContext(context, entry.unit) - entry.total - queue);
                    if (!Number.isFinite(entry.max)) unknownMaxima += deficit > 0 ? 1 : 0;
                    if (!entry.cost) unknownCosts += deficit > 0 ? 1 : 0;
                    items.push({ unit: entry.unit, deficit, max: entry.max, cost: entry.cost });
                }

                const plan = calculatePlan(items, state.limitInput.checked, context.budget);
                let contextFields = 0;
                for (const entry of context.units.values()) {
                    if (!(entry.unit in plan) || entry.input.disabled || entry.input.readOnly) {
                        continue;
                    }
                    const amount = plan[entry.unit];
                    setRecruitValue(entry.input, amount);
                    if (amount > 0) {
                        fieldsFilled += 1;
                        contextFields += 1;
                    }
                }
                if (contextFields > 0) villagesFilled += 1;
                renderContext(context);
            }

            const notes = [`${formatNumber(fieldsFilled)} Felder in ${formatNumber(villagesFilled)} Dörfern gefüllt`];
            if (withoutTemplate) notes.push(`${withoutTemplate} Dörfer ohne Vorlage übersprungen`);
            if (failed) notes.push(`${failed} Dörfer nicht lesbar`);
            if (unknownMaxima && state.limitInput.checked) notes.push(`${unknownMaxima} Maximalwerte unbekannt`);
            if (unknownCosts && state.limitInput.checked) notes.push(`${unknownCosts} Kostensätze unbekannt`);
            notify(`${notes.join(' · ')}. Bitte prüfen und selbst auf „Rekrutieren“ klicken.`, failed > 0);
            renderCostSummary();
        } finally {
            setBusy(false);
        }
    }

    function applicableContexts() {
        if (mode === 'train') {
            return state.contexts.slice();
        }
        return state.contexts.filter((context) =>
            context.selectionInput?.checked && isVisible(context.scope)
        );
    }

    function needsSnapshot(context) {
        const totalsUnknown = [...context.units.values()].some((entry) => entry.total === null || entry.total === undefined);
        const queueUnknown = state.includeQueueInput.checked && [...context.units.values()].some((entry) => !entry.queueKnown);
        const costsUnknown = state.limitInput.checked && [...context.units.values()].some((entry) => !entry.cost);
        const budgetUnknown = state.limitInput.checked && !context.budgetKnown;
        return context.kind === 'mass' && !context.snapshotLoaded && (totalsUnknown || queueUnknown || costsUnknown || budgetUnknown);
    }

    async function hydrateContext(context) {
        if (!context.villageId) {
            markContextError(context, 'Dorf-ID fehlt');
            return false;
        }
        try {
            const snapshot = await loadVillageSnapshot(context.villageId);
            for (const [unit, entry] of context.units) {
                const remote = snapshot.units[unit];
                if (!remote) continue;
                if (entry.total === null || entry.total === undefined) entry.total = remote.total;
                if (!entry.queueKnown) entry.queued = remote.queued;
                entry.queueKnown = true;
                if (!Number.isFinite(entry.max)) entry.max = remote.max;
                if (!entry.cost) entry.cost = remote.cost;
                context.counts[unit] = entry.total;
                context.queued[unit] = entry.queued;
            }
            context.queueKnown = true;
            context.budget = snapshot.budget || context.budget;
            context.budgetKnown = Boolean(context.budget);
            context.snapshotLoaded = true;
            renderContext(context);
            return true;
        } catch (error) {
            markContextError(context, error.message || 'Bestand nicht lesbar');
            return false;
        }
    }

    async function loadVillageSnapshot(villageId) {
        if (state.snapshotCache.has(villageId)) {
            return state.snapshotCache.get(villageId);
        }

        const promise = (async () => {
            const url = new URL(window.location.href);
            url.searchParams.set('village', villageId);
            url.searchParams.set('screen', 'train');
            url.searchParams.set('mode', 'train');
            for (const key of ['action', 'ajaxaction', 'ajax', 'h']) {
                url.searchParams.delete(key);
            }

            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 15000);
            let response;
            try {
                response = await window.fetch(url.toString(), {
                    method: 'GET',
                    credentials: 'same-origin',
                    signal: controller.signal,
                    headers: { Accept: 'text/html' }
                });
            } finally {
                window.clearTimeout(timeout);
            }
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const form = doc.querySelector('#train_form');
            if (!form) {
                throw new Error('Rekrutierungsdaten fehlen');
            }
            const queueInfo = readQueuedCounts(doc);
            const entries = collectSingleEntries(form, queueInfo.counts, false);
            const remoteGameData = extractGameData(doc);
            return {
                units: Object.fromEntries([...entries].map(([unit, entry]) => [unit, {
                    total: entry.total,
                    queued: entry.queued,
                    max: entry.max,
                    cost: entry.cost
                }])),
                budget: readAvailableBudget(doc, remoteGameData)
            };
        })();

        state.snapshotCache.set(villageId, promise);
        try {
            return await promise;
        } catch (error) {
            state.snapshotCache.delete(villageId);
            throw error;
        }
    }

    function extractGameData(doc) {
        for (const script of doc.querySelectorAll('script')) {
            const text = script.textContent || '';
            if (!text.includes('TribalWars.updateGameData(')) continue;
            const match = text.match(/TribalWars\.updateGameData\((\{[\s\S]*?\})\);/);
            if (!match) continue;
            try {
                return JSON.parse(match[1]);
            } catch (_) {
                return null;
            }
        }
        return null;
    }

    async function mapWithConcurrency(items, concurrency, worker) {
        let nextIndex = 0;
        const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (nextIndex < items.length) {
                const index = nextIndex++;
                await worker(items[index], index);
            }
        });
        await Promise.all(runners);
    }

    function startIntegrationObserver() {
        if (state.observer) {
            return;
        }
        state.observer = new MutationObserver(() => {
            const nativeNodesStale = !state.anchor?.isConnected || state.contexts.some((context) =>
                !context.scope.isConnected || [...context.units.values()].some((entry) => !entry.input.isConnected)
            );
            if (!state.panel?.isConnected || nativeNodesStale) {
                scheduleIntegrationRefresh();
            }
        });
        state.observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    function scheduleIntegrationRefresh() {
        if (state.refreshTimer !== null) {
            return;
        }
        state.refreshTimer = window.setTimeout(() => {
            state.refreshTimer = null;
            refreshIntegration(false);
        }, 60);
    }

    function refreshIntegration(forceRender) {
        if (state.refreshingIntegration) {
            return;
        }

        const inputsStale = state.contexts.some((context) =>
            !context.scope.isConnected || [...context.units.values()].some((entry) => !entry.input.isConnected)
        );
        const anchorStale = !state.anchor?.isConnected;

        if (!anchorStale && !inputsStale && !state.panel?.isConnected) {
            state.anchor.parentNode?.insertBefore(state.panel, state.anchor);
            renderAllContexts();
            return;
        }
        if (!anchorStale && !inputsStale) {
            if (forceRender) renderAllContexts();
            return;
        }

        state.refreshingIntegration = true;
        try {
            const previousSelection = new Map(state.contexts.map((context, index) => [
                context.villageId || `index:${index}`,
                context.selectionInput?.checked ?? true
            ]));
            const screenState = discoverScreen();
            if (!screenState || !screenState.anchor.parentNode) {
                return;
            }
            state.anchor = screenState.anchor;
            state.contexts = screenState.contexts;
            initializeContextTemplates();
            state.anchor.parentNode.insertBefore(state.panel, state.anchor);
            if (!document.getElementById(`${SCRIPT_ID}-styles`)) {
                injectStyles();
            }
            if (mode === 'mass') {
                decorateMassContexts(previousSelection);
            }
            renderAllContexts();
        } finally {
            state.refreshingIntegration = false;
        }
    }

    function markContextError(context, message) {
        if (context.summaryElement) {
            context.summaryElement.textContent = message;
            context.summaryElement.className = 'ds-tt-village-summary is-error';
        }
    }

    function clearRecruitInputs() {
        const contexts = applicableContexts();
        if (!contexts.length) {
            notify('Kein sichtbares Dorf ist ausgewählt.', true);
            return;
        }
        let cleared = 0;
        for (const context of contexts) {
            for (const entry of context.units.values()) {
                if (!entry.input.disabled && !entry.input.readOnly && entry.input.value !== '') {
                    setRecruitValue(entry.input, 0);
                    cleared += 1;
                }
            }
            renderContext(context);
        }
        notify(`${formatNumber(cleared)} Rekrutierungsfelder geleert.`);
    }

    function setRecruitValue(input, amount) {
        input.value = amount > 0 ? String(amount) : '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function setBusy(busy) {
        state.applyButton.disabled = busy;
        state.applyButton.textContent = busy
            ? 'Bestände werden gelesen …'
            : (mode === 'mass' ? 'Zugewiesene Vorlagen eintragen' : 'Fehlbestand eintragen');
    }

    function templateById(id) {
        return id ? state.store.templates.find((template) => template.id === id) || null : null;
    }

    function defaultTemplateId() {
        return templateById(state.store.selectedTemplateId)?.id || state.store.templates[0]?.id || null;
    }

    function initializeContextTemplates() {
        let changed = false;
        state.store.villageTemplateIds ||= {};
        for (const context of state.contexts) {
            const storedId = context.villageId ? state.store.villageTemplateIds[context.villageId] : null;
            const templateId = templateById(storedId)?.id || defaultTemplateId();
            context.templateId = templateId;
            if (context.villageId && templateId && storedId !== templateId) {
                state.store.villageTemplateIds[context.villageId] = templateId;
                changed = true;
            } else if (context.villageId && storedId && !templateId) {
                delete state.store.villageTemplateIds[context.villageId];
                changed = true;
            }
        }
        if (changed) saveStore(state.store);
    }

    function persistVillageTemplate(villageId, templateId) {
        if (!villageId) return;
        state.store.villageTemplateIds ||= {};
        if (templateById(templateId)) {
            state.store.villageTemplateIds[villageId] = templateId;
        } else {
            delete state.store.villageTemplateIds[villageId];
        }
        saveStore(state.store);
    }

    function contextHasTemplate(context) {
        return context?.kind === 'mass' ? Boolean(templateById(context.templateId)) : state.templateActive;
    }

    function readTargetForContext(context, unit) {
        if (context?.kind === 'mass') {
            return sanitizeCount(templateById(context.templateId)?.units?.[unit]);
        }
        return readTarget(unit);
    }

    function startNewTemplate() {
        state.selectedTemplateId = null;
        state.templateSelect.value = '';
        state.templateNameInput.value = '';
        for (const input of state.targetInputs.values()) {
            input.value = '';
        }
        state.templateActive = false;
        state.store.selectedTemplateId = null;
        saveStore(state.store);
        renderAllContexts();
        notify('Neue, leere Vorlage begonnen.');
    }

    function saveCurrentTemplate() {
        const name = state.templateNameInput.value.trim();
        if (!name) {
            notify('Bitte einen Namen für die Vorlage eingeben.', true);
            state.templateNameInput.focus();
            return;
        }

        const units = readTargets();
        const now = new Date().toISOString();
        let template = state.store.templates.find((candidate) => candidate.id === state.selectedTemplateId);
        if (template) {
            template.name = name;
            template.units = units;
            template.updatedAt = now;
        } else {
            template = {
                id: createId(),
                name,
                units,
                createdAt: now,
                updatedAt: now
            };
            state.store.templates.push(template);
            state.selectedTemplateId = template.id;
        }

        state.templateActive = true;
        state.store.selectedTemplateId = template.id;
        if (mode === 'train') {
            const context = state.contexts[0];
            if (context) {
                context.templateId = template.id;
                persistVillageTemplate(context.villageId, template.id);
            }
        }
        saveStore(state.store);
        refreshTemplateSelect();
        state.templateSelect.value = template.id;
        renderAllContexts();
        notify(`Vorlage „${name}“ gespeichert.`);
    }

    function deleteCurrentTemplate() {
        const template = state.store.templates.find((candidate) => candidate.id === state.selectedTemplateId);
        if (!template) {
            notify('Keine gespeicherte Vorlage ausgewählt.', true);
            return;
        }
        if (!window.confirm(`Vorlage „${template.name}“ wirklich löschen?`)) {
            return;
        }
        state.store.templates = state.store.templates.filter((candidate) => candidate.id !== template.id);
        for (const [villageId, templateId] of Object.entries(state.store.villageTemplateIds || {})) {
            if (templateId === template.id) delete state.store.villageTemplateIds[villageId];
        }
        state.store.selectedTemplateId = null;
        state.selectedTemplateId = null;
        initializeContextTemplates();
        saveStore(state.store);
        refreshTemplateSelect();
        restoreSelectedTemplate();
        renderAllContexts();
        notify(`Vorlage „${template.name}“ gelöscht.`);
    }

    function onTemplateSelected() {
        const id = state.templateSelect.value;
        if (!id) {
            startNewTemplate();
            return;
        }
        const template = state.store.templates.find((candidate) => candidate.id === id);
        if (!template) {
            return;
        }
        loadTemplateIntoEditor(template);
        state.store.selectedTemplateId = id;
        if (mode === 'train') {
            const context = state.contexts[0];
            if (context) {
                context.templateId = id;
                persistVillageTemplate(context.villageId, id);
            }
        }
        saveStore(state.store);
        renderAllContexts();
    }

    function loadTemplateIntoEditor(template) {
        state.selectedTemplateId = template.id;
        state.templateActive = true;
        state.templateNameInput.value = template.name;
        for (const unit of worldUnits) {
            state.targetInputs.get(unit).value = String(template.units[unit] || 0);
        }
    }

    function refreshTemplateSelect() {
        const selected = state.selectedTemplateId || state.store.selectedTemplateId || '';
        fillTemplateSelect(state.templateSelect, selected, '– neue Vorlage –');
        if (mode === 'mass') {
            for (const context of state.contexts) {
                if (context.templateSelect) {
                    fillTemplateSelect(context.templateSelect, context.templateId, '– Vorlage wählen –');
                }
            }
        }
    }

    function fillTemplateSelect(select, selected, emptyLabel) {
        select.replaceChildren(element('option', { value: '', textContent: emptyLabel }));
        const sorted = state.store.templates.slice().sort((a, b) => a.name.localeCompare(b.name, 'de'));
        for (const template of sorted) {
            select.append(element('option', { value: template.id, textContent: template.name }));
        }
        select.value = sorted.some((template) => template.id === selected) ? selected : '';
    }

    function restoreSelectedTemplate() {
        const contextTemplateId = mode === 'train' ? state.contexts[0]?.templateId : null;
        const template = templateById(contextTemplateId)
            || templateById(state.store.selectedTemplateId)
            || state.store.templates[0];
        if (!template) {
            startNewTemplate();
            return;
        }
        loadTemplateIntoEditor(template);
        state.templateSelect.value = template.id;
        state.store.selectedTemplateId = template.id;
        if (mode === 'train' && state.contexts[0]) {
            state.contexts[0].templateId = template.id;
            persistVillageTemplate(state.contexts[0].villageId, template.id);
        }
        saveStore(state.store);
    }

    function readTargets() {
        return Object.fromEntries(worldUnits.map((unit) => [unit, readTarget(unit)]));
    }

    function readTarget(unit) {
        const input = state.targetInputs.get(unit);
        return Math.min(999999, Math.max(0, Math.floor(Number(input?.value) || 0)));
    }

    function loadStore() {
        const empty = { version: STORAGE_VERSION, selectedTemplateId: null, villageTemplateIds: {}, templates: [] };
        try {
            const parsed = JSON.parse(window.localStorage.getItem(storageKey()) || 'null');
            if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.templates)) {
                return empty;
            }
            const templates = parsed.templates
                .filter((template) => template && typeof template.id === 'string' && typeof template.name === 'string')
                .map((template) => ({
                    id: template.id,
                    name: template.name.slice(0, 60),
                    units: Object.fromEntries(STANDARD_UNITS.map((unit) => [unit, sanitizeCount(template.units?.[unit])])),
                    createdAt: template.createdAt || '',
                    updatedAt: template.updatedAt || ''
                }));
            const validTemplateIds = new Set(templates.map((template) => template.id));
            const villageTemplateIds = Object.fromEntries(
                Object.entries(parsed.villageTemplateIds || {})
                    .filter(([villageId, templateId]) => /^\d+$/.test(villageId) && validTemplateIds.has(templateId))
            );
            return {
                version: STORAGE_VERSION,
                selectedTemplateId: typeof parsed.selectedTemplateId === 'string' ? parsed.selectedTemplateId : null,
                villageTemplateIds,
                templates
            };
        } catch (_) {
            return empty;
        }
    }

    function saveStore(store) {
        try {
            window.localStorage.setItem(storageKey(), JSON.stringify(store));
        } catch (_) {
            notify('Vorlagen konnten nicht im Browser gespeichert werden.', true);
        }
    }

    function storageKey() {
        const world = gameData.world || window.location.hostname.split('.')[0] || 'world';
        const player = gameData.player?.id || 'player';
        return `${STORAGE_PREFIX}:v${STORAGE_VERSION}:${window.location.host}:${world}:${player}`;
    }

    function sanitizeCount(value) {
        return Math.min(999999, Math.max(0, Math.floor(Number(value) || 0)));
    }

    function createId() {
        if (window.crypto?.randomUUID) {
            return window.crypto.randomUUID();
        }
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function notify(message, error = false, quiet = false) {
        if (state.statusElement) {
            state.statusElement.textContent = message;
            state.statusElement.className = `ds-tt-panel-status ${error ? 'is-error' : ''}`;
        }
        if (quiet) {
            return;
        }
        try {
            if (error && typeof window.UI?.ErrorMessage === 'function') {
                window.UI.ErrorMessage(message, 3000);
            } else if (!error && typeof window.UI?.SuccessMessage === 'function') {
                window.UI.SuccessMessage(message, 2500);
            }
        } catch (_) {
            // Der Text im eingebetteten Statusfeld bleibt als Fallback sichtbar.
        }
    }

    function isVisible(node) {
        let current = node;
        while (current && current !== document.documentElement) {
            const style = window.getComputedStyle(current);
            if (style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }
            current = current.parentElement;
        }
        return true;
    }

    function formatNumber(value) {
        return new Intl.NumberFormat('de-DE').format(value || 0);
    }

    function element(tagName, properties = {}) {
        const node = document.createElement(tagName);
        for (const [key, value] of Object.entries(properties)) {
            if (key === 'className') {
                node.className = value;
            } else if (key === 'textContent') {
                node.textContent = value;
            } else if (key in node) {
                node[key] = value;
            } else {
                node.setAttribute(key, value);
            }
        }
        return node;
    }

    function injectStyles() {
        const style = element('style', { id: `${SCRIPT_ID}-styles` });
        style.textContent = `
            .ds-tt-panel { width: 100%; margin: 8px 0 12px; }
            .ds-tt-panel td { vertical-align: middle; }
            .ds-tt-label { width: 115px; font-weight: bold; white-space: nowrap; }
            .ds-tt-template-select { min-width: 180px; margin-right: 5px; }
            .ds-tt-name { width: 180px; margin-right: 5px; }
            .ds-tt-panel .btn { margin: 2px 4px 2px 0; }
            .ds-tt-target-grid { display: flex; flex-wrap: wrap; gap: 5px 9px; align-items: center; }
            .ds-tt-unit-target { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
            .ds-tt-unit-icon { display: inline-block; flex: 0 0 auto; }
            .ds-tt-unit-name { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
            .ds-tt-target { width: 62px; }
            .ds-tt-option { display: inline-block; margin: 3px 14px 3px 0; white-space: nowrap; }
            .ds-tt-panel-status { display: inline-block; margin-left: 8px; color: #3a5f0b; }
            .ds-tt-panel-status.is-error { color: #b11b0e; }
            .ds-tt-cost-summary { line-height: 22px; }
            .ds-tt-resource-value { display: inline-block; margin-right: 9px; white-space: nowrap; }
            .ds-tt-resource-value .icon { vertical-align: -3px; }
            .ds-tt-delta { display: block; margin-top: 2px; font-size: 11px; line-height: 1.25; white-space: nowrap; }
            .ds-tt-delta.is-missing { color: #b45200; font-weight: bold; }
            .ds-tt-delta.is-excess { color: #225f9c; font-weight: bold; }
            .ds-tt-delta.is-exact { color: #3a6d0b; }
            .ds-tt-delta.is-unknown { color: #777; }
            .ds-tt-panel-mass { margin: 4px 0 7px; }
            .ds-tt-panel-mass td, .ds-tt-panel-mass th { padding: 2px 4px !important; }
            .ds-tt-panel-mass .ds-tt-label { width: 88px; }
            .ds-tt-panel-mass .ds-tt-target-grid { gap: 2px 5px; }
            .ds-tt-panel-mass .ds-tt-unit-target { gap: 1px; }
            .ds-tt-panel-mass .ds-tt-target { width: 52px; padding: 1px 2px; }
            .ds-tt-panel-mass .ds-tt-option { margin: 1px 9px 1px 0; }
            .ds-tt-panel-mass .ds-tt-panel-status { display: block; margin: 1px 0 0; }
            .ds-tt-panel-mass .ds-tt-cost-summary { line-height: 18px; }
            .ds-tt-panel-mass .ds-tt-management-row td { border-top: 2px solid #c1a264; }
            .ds-tt-delta-mass { max-width: 76px; overflow: hidden; text-overflow: ellipsis; font-size: 10px; line-height: 1.05; }
            .ds-tt-village-choice { display: flex; align-items: center; gap: 4px; margin: 0 0 3px; font-size: 11px; white-space: nowrap; }
            .ds-tt-village-checkbox-label { white-space: nowrap; }
            .ds-tt-village-template-select { width: 124px; max-width: 124px; padding: 1px; font-size: 11px; }
            .ds-tt-village-summary { margin-left: 3px; color: #3a6d0b; }
            .ds-tt-village-summary.is-missing { color: #b45200; font-weight: bold; }
            .ds-tt-village-summary.is-excess { color: #225f9c; }
            .ds-tt-village-summary.is-error { color: #b11b0e; font-weight: bold; }
            @media (max-width: 900px) {
                .ds-tt-label { width: auto; }
                .ds-tt-template-select, .ds-tt-name { min-width: 0; width: 145px; }
                .ds-tt-option { display: block; margin-right: 0; }
            }
        `;
        document.head.append(style);
    }
})();
