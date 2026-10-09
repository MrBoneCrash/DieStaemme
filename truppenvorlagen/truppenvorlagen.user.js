// ==UserScript==
// @name         Die Stämme – Truppenvorlagen in der Rekrutierung
// @namespace    local.die-staemme.truppenvorlagen
// @version      0.5.1
// @description  Truppenvorlagen; normale Rekrutierung über Kontrollzentrum, Massenrekrutierung manuell.
// @author       Lokal
// @match        https://*.die-staemme.de/game.php?*screen=train*
// @exclude      /^[^?]+\?(?!(?=(?:[^#]*&)?screen=train(?:&|#|$))(?!(?:[^#]*&)?mode=(?!(?:train|mass)?(?:&|#|$))[^&#]*(?:&|#|$)))/
// @exclude      /^[^?]+\?(?:[^#]*&)?(screen|mode)=[^#]*&\1=/
// @grant        unsafeWindow
// @noframes
// @run-at       document-idle
// ==/UserScript==

// Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.
// Vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen prüfen.

(function () {
    'use strict';
    // CONTROL-CLIENT-BEGIN
    // Gemeinsamer Baustein; über sync-clients.cjs in eigenständige Userscripts eingebettet.
    function constructionSurplus(construction) {
        const fail = reason => ({ known: false, reason, free: null, reserved: null, surplus: 0 });
        if (!construction?.steps || !construction.buildings) return fail('Bauvorlage oder Gebäudedaten fehlen.');
        const { buildings, village, steps } = construction;
        const free = Number(village?.pop_max) - Number(village?.pop);
        if (!Number.isFinite(free) || village?.pop == null || village?.pop_max == null) return fail('Bauernhofkapazität unbekannt.');
        const levels = {}, costs = [];
        for (const [id, building] of Object.entries(buildings)) levels[id] = Number(building.level_next) - 1;
        let nextFarm = null;
        for (const step of steps) {
            const building = buildings[step.building], current = levels[step.building];
            if (!Number.isInteger(current) || current < 0 || !building) return fail(`Gebäudedaten für ${step.building} fehlen.`);
            if (current >= step.level) continue;
            if (step.building === 'farm') { nextFarm = step.level; break; }
            const pop = Number(building.pop), factor = Number(building.pop_factor);
            if (building.pop == null || !Number.isFinite(pop) || pop < 0) return fail(`Platzbedarf für ${step.building} unbekannt.`);
            for (let level = current + 1; level <= step.level; level++) {
                const offset = level - Number(building.level_next);
                if (offset > 0 && (!Number.isFinite(factor) || factor < 1)) return fail(`Platzbedarf weiterer ${step.building}-Stufen unbekannt.`);
                // Native next-level population is rounded. Reserve an upper bound for
                // later levels instead of releasing possibly needed building slots.
                costs.push(offset === 0 ? pop : Math.ceil((pop + 1) * Math.pow(factor, offset)));
            }
            levels[step.building] = step.level;
        }
        const reserved = costs.reduce((sum, cost) => sum + cost, 0);
        if (!Number.isSafeInteger(reserved)) return fail('Platzbedarf nicht berechenbar.');
        return { known: true, free, reserved, surplus: Math.max(0, free - reserved), nextFarm };
    }
    function recruitmentPlan(items, budget) {
        const resources = ['wood', 'stone', 'iron', 'pop'], plan = {};
        if (!budget || resources.some(r => !Number.isFinite(budget[r]) || budget[r] < 0)) return plan;
        const active = (items || []).filter(item => Number.isSafeInteger(item.deficit) && item.deficit > 0 &&
            Number.isFinite(item.max) && item.max > 0 && item.cost && resources.every(r => Number.isFinite(item.cost[r]) && item.cost[r] >= 0) && item.cost.pop > 0);
        let low = 0, high = 1;
        for (let i = 0; i < 42; i++) {
            const ratio = (low + high) / 2;
            const fits = resources.every(r => active.reduce((sum, item) => sum + Math.min(item.max, Math.floor(item.deficit * ratio)) * item.cost[r], 0) <= budget[r]);
            if (fits) low = ratio; else high = ratio;
        }
        const left = { ...budget };
        for (const item of active) {
            plan[item.unit] = Math.min(Math.floor(item.max), Math.floor(item.deficit * low));
            for (const r of resources) left[r] -= plan[item.unit] * item.cost[r];
        }
        for (const item of [...active].sort((a, b) => (b.deficit - plan[b.unit]) / b.deficit - (a.deficit - plan[a.unit]) / a.deficit)) {
            const more = Math.max(0, Math.min(item.deficit - plan[item.unit], Math.floor(item.max) - plan[item.unit],
                ...resources.filter(r => item.cost[r] > 0).map(r => Math.floor(left[r] / item.cost[r]))));
            plan[item.unit] += more;
            for (const r of resources) left[r] -= more * item.cost[r];
        }
        return plan;
    }
    function activityCheck(doc, win) {
        function visible(node) {
            if (!node || node.hidden || !node.isConnected) return false;
            for (let parent = node; parent; parent = parent.parentElement) {
                const style = win.getComputedStyle?.(parent);
                if (style?.display === 'none' || style?.visibility === 'hidden') return false;
            }
            return !!node.getClientRects?.().length;
        }
        const full = visible(doc.getElementById('popup_box_bot_protection')) ||
            [...(doc.querySelectorAll?.('iframe[title="hCaptcha-Herausforderung"]') || [])].some(visible);
        const small = visible(doc.getElementById('botprotection_quest')) ||
            doc.body?.getAttribute('data-bot-protect') === 'pending';
        return full ? 'full' : small ? 'small' : null;
    }

    function createControlClient(env, name) {
        const { win, doc, storage, now = Date.now } = env;
        const detector = env.controller === true, leases = new Map();
        const leaseDuration = 90000, handoffDuration = 10000;
        let closed = false, lastAnnouncement = -Infinity;
        const listeners = new Set(), requests = new Set();
        const tab = `${now()}-${Math.random().toString(36).slice(2)}`;
        let channel, channelKey, lastStatus = 'running', generation = 0, memory = null;
        const data = () => (typeof unsafeWindow !== 'undefined' ? unsafeWindow : win).game_data;
        const page = () => typeof unsafeWindow !== 'undefined' ? unsafeWindow : win;
        const key = () => {
            const gd = data();
            return gd?.world && gd?.player?.id ? `ds-control:v1:${win.location?.host || env.host}:${gd.world}:${gd.player.id}` : null;
        };
        function announceController(duration = leaseDuration) {
            if (!detector || !key()) return;
            const expiresAt = now() + duration;
            leases.set(tab, expiresAt); lastAnnouncement = now();
            try { storage.setItem(`${key()}:controller:${tab}`, String(expiresAt)); } catch { /* Broadcast fallback. */ }
            try { channel?.postMessage({ type: 'controller', tab, expiresAt }); } catch { /* Storage fallback. */ }
        }
        function controllerActive() {
            if (detector && !closed) return true;
            if ([...leases.values()].some(expiresAt => expiresAt > now())) return true;
            try {
                const prefix = `${key()}:controller:`;
                for (let i = 0; i < storage.length; i++) {
                    const entry = storage.key(i);
                    if (entry?.startsWith(prefix) && Number(storage.getItem(entry)) > now()) return true;
                }
            } catch { /* Locally received leases still apply. */ }
            return false;
        }
        function read() {
            try {
                const raw = key() && storage.getItem(key());
                const parsed = raw ? JSON.parse(raw) : null;
                if (parsed && !['running', 'pause'].includes(parsed.status)) throw new Error('Ungültiger Status');
                if (memory?.status === 'pause') return memory;
                return parsed || memory || { status: 'running', detectedAt: null };
            } catch {
                return memory || { status: 'pause', detectedAt: null, reason: 'Speicher nicht lesbar' };
            }
        }
        function changed() {
            const state = read();
            if (state.status !== lastStatus) {
                lastStatus = state.status;
                generation++;
                if (state.status === 'pause') for (const request of requests) request.abort();
                for (const listener of listeners) {
                    try { listener(state); } catch (error) { win.console?.error('Kontrollzentrum: Pause-Empfänger', error); }
                }
            }
            return state;
        }
        function connect() {
            const current = key();
            if (!current || current === channelKey) return;
            channel?.close(); channelKey = current;
            try {
                if (win.BroadcastChannel) {
                    channel = new win.BroadcastChannel(current);
                    channel.onmessage = event => {
                        if (event.data?.type === 'controller') {
                            leases.set(event.data.tab, event.data.expiresAt); changed(); return;
                        }
                        // Pause-Nachrichten sind auch bei nicht verfügbarem Storage wirksam.
                        if (event.data?.state?.status === 'pause') memory = event.data.state;
                        if (event.data?.state?.status === 'running') memory = null;
                        changed();
                    };
                }
            } catch { /* Storage bleibt als Transport verfügbar. */ }
        }
        function write(state) {
            memory = state;
            let saved = false;
            try { if (key()) { storage.setItem(key(), JSON.stringify(state)); saved = true; } } catch { /* Lokal gesperrt bleiben. */ }
            connect();
            try { channel?.postMessage({ type: 'state', state, source: name }); } catch { /* Storage-Fallback. */ }
            changed();
            return saved;
        }
        function pause() {
            const old = read();
            if (old.status === 'pause') {
                // Spieldaten können nach dem ersten DOM-Hinweis eintreffen.
                try { if (key() && !storage.getItem(key())) write(old); } catch { /* Lokal pausiert bleiben. */ }
                changed(); return old;
            }
            const state = { status: 'pause', detectedAt: now(), reason: 'Aktivitätscheck' };
            write(state);
            return state;
        }
        function inspect() {
            connect();
            if (!detector || closed) { changed(); return null; }
            if (now() - lastAnnouncement >= 1000) announceController();
            const check = activityCheck(doc, win);
            if (check) {
                pause();
                try { if (key()) storage.setItem(`${key()}:check:${tab}`, String(now())); } catch { /* Sperre bleibt lokal aktiv. */ }
            } else {
                try { if (key()) storage.removeItem?.(`${key()}:check:${tab}`); } catch { /* Abgelaufene Meldungen werden ignoriert. */ }
            }
            changed();
            return check;
        }
        function paused() { inspect(); return read().status === 'pause'; }
        function assert(expected = generation) {
            if (paused() || expected !== generation) throw new Error('Kontrollzentrum: Skripte pausiert. Vorgang erneut starten.');
        }
        function resume() {
            if (closed || (!detector && controllerActive())) return { ok: false, reason: 'Bitte die Pause im aktiven Kontrollzentrum aufheben.' };
            if (inspect()) return { ok: false, reason: 'Bitte zuerst den Aktivitätscheck manuell durchführen.' };
            try {
                const prefix = `${key()}:check:`;
                for (let i = 0; i < storage.length; i++) {
                    const entry = storage.key(i);
                    if (entry?.startsWith(prefix) && now() - Number(storage.getItem(entry)) < 5000)
                        return { ok: false, reason: 'In einem anderen Tab ist noch ein Aktivitätscheck geöffnet.' };
                }
            } catch { return { ok: false, reason: 'Browserspeicher nicht verfügbar. Pause kann nicht sicher aufgehoben werden.' }; }
            const previous = read();
            const state = { ...previous, status: 'running', resumedAt: now() };
            if (!write(state)) {
                write(previous);
                return { ok: false, reason: 'Pause konnte nicht dauerhaft aufgehoben werden.' };
            }
            return { ok: true };
        }
        function bindResume(button, errorElement) {
            if (!button) return () => {};
            const update = () => {
                button.hidden = read().status !== 'pause' || controllerActive();
                if (errorElement) errorElement.hidden = button.hidden || !errorElement.textContent;
            };
            button.addEventListener('click', () => {
                const result = resume();
                if (errorElement) errorElement.textContent = result.ok ? '' : result.reason;
                update();
            });
            listeners.add(update); update();
            const timer = win.setInterval?.(update, 1000);
            win.addEventListener?.('pagehide', () => { if (timer !== undefined) win.clearInterval?.(timer); });
            return update;
        }
        async function request(url, options = {}) {
            assert();
            const expected = generation, controller = new win.AbortController();
            requests.add(controller);
            const abort = () => controller.abort();
            const cleanup = () => {
                requests.delete(controller);
                options.signal?.removeEventListener('abort', abort);
            };
            controller.signal.addEventListener('abort', cleanup, { once: true });
            if (options.signal?.aborted) abort();
            options.signal?.addEventListener('abort', abort, { once: true });
            // Auch das Lesen des Antwortkörpers wird beim Pausieren abgebrochen.
            try {
                const response = await win.fetch(url, { ...options, signal: controller.signal });
                assert(expected);
                for (const method of ['text', 'json', 'blob', 'arrayBuffer', 'formData', 'bytes']) {
                    if (typeof response[method] !== 'function') continue;
                    const original = response[method].bind(response);
                    response[method] = async (...args) => {
                        try { const body = await original(...args); assert(expected); return body; }
                        finally { cleanup(); }
                    };
                }
                return response;
            } catch (error) { cleanup(); throw error; }
        }
        const knownScripts = ['konstruktionshelfer', 'raubzug-helfer', 'truppenvorlagen'];
        const scriptKey = (id, villageId = data()?.village?.id) => `${key()}:script:${id}:${villageId}`;
        const commandKey = (id, villageId) => `${scriptKey(id, villageId)}:auto`;
        function scriptState(id, refresh = false, villageId = data()?.village?.id) {
            if (!knownScripts.includes(id) || !key()) return null;
            const provider = page().DSControlParticipants?.[id];
            const scope = scriptKey(id, villageId);
            if (refresh && provider?.scope === scope) provider.publish();
            try {
                const state = JSON.parse(storage.getItem(scope) || 'null');
                // On another game view, use the helper's saved browser-clock check time.
                // An outstanding on/off command has priority until the helper consumes it.
                if (state?.auto && id === 'raubzug-helfer' && !storage.getItem(commandKey(id, villageId)) && provider?.scope !== scope) {
                    const gd = data();
                    const schedule = JSON.parse(storage.getItem(`ds-raubzug-helfer:${gd.world}:${gd.player.id}:${villageId}:schedule`) || 'null');
                    if (schedule && Object.hasOwn(schedule, 'wakeAt')) state.nextAt = Number.isFinite(schedule.wakeAt) ? schedule.wakeAt : null;
                }
                return state?.installed ? { ...state, villageId: String(villageId), live: provider?.scope === scope } : null;
            } catch { return null; }
        }
        function scriptVillages(id) {
            if (!knownScripts.includes(id) || !key()) return [];
            const prefix = `${key()}:script:${id}:`, villageIds = [];
            try {
                for (let index = 0; index < storage.length; index++) {
                    const itemKey = storage.key(index);
                    if (itemKey?.startsWith(prefix) && /^\d+$/.test(itemKey.slice(prefix.length))) villageIds.push(itemKey.slice(prefix.length));
                }
            } catch { return []; }
            return villageIds.map(villageId => scriptState(id, true, villageId)).filter(Boolean);
        }
        function registerScript(id, api) {
            if (!knownScripts.includes(id) || !key()) throw new Error('Unbekannter Helfer oder fehlende Spieldaten.');
            const scope = scriptKey(id);
            function publish() {
                const state = api.state();
                const record = { installed: true, auto: !!state.auto, busy: !!state.busy,
                    status: String(state.status || ''), nextAt: Number.isFinite(state.nextAt) ? state.nextAt : null,
                    completedAt: Number.isFinite(state.completedAt) ? state.completedAt : 0,
                    construction: state.construction || null, recruitment: state.recruitment || null,
                    version: api.version, detectedAt: now(), villageId: String(data().village?.id),
                    villageName: String(data().village?.name || ''),
                    villageCoords: data().village?.x != null && data().village?.y != null ? `${data().village.x}|${data().village.y}` : '' };
                try {
                    const old = JSON.parse(storage.getItem(scope) || 'null');
                    if (old) record.detectedAt = old.detectedAt;
                    const value = JSON.stringify(record);
                    if (storage.getItem(scope) !== value) storage.setItem(scope, value);
                } catch { /* Helfer kann weiter lokal bedient werden. */ }
                return record;
            }
            function consume() {
                if (scriptKey(id) !== scope) return;
                try {
                    const raw = storage.getItem(commandKey(id));
                    if (!raw) return;
                    const command = JSON.parse(raw);
                    if (typeof command.enabled !== 'boolean') return;
                    storage.removeItem(commandKey(id));
                    api.setAuto(command.enabled);
                    publish();
                } catch (error) { win.console?.error('Kontrollzentrum: Automatiksteuerung', error); }
            }
            const provider = { scope, publish, consume };
            (page().DSControlParticipants ||= {})[id] = provider;
            consume(); publish();
            win.addEventListener?.('storage', event => { if (event.key === commandKey(id)) consume(); });
            win.addEventListener?.('pagehide', () => {
                if (page().DSControlParticipants?.[id] === provider) delete page().DSControlParticipants[id];
            });
            return provider;
        }
        function setScriptAuto(id, enabled, villageId = data()?.village?.id) {
            const state = scriptState(id, false, villageId);
            if (!state || typeof enabled !== 'boolean') return false;
            try {
                storage.setItem(commandKey(id, villageId), JSON.stringify({ enabled, issuedAt: now() }));
                const provider = page().DSControlParticipants?.[id];
                if (provider?.scope === scriptKey(id, villageId)) provider.consume();
                else if (storage.getItem(commandKey(id, villageId))) storage.setItem(scriptKey(id, villageId), JSON.stringify({ ...state, live: undefined, auto: enabled,
                    busy: false, nextAt: enabled && id === 'raubzug-helfer' ? state.nextAt || now() : null }));
                return true;
            } catch { return false; }
        }
        win.addEventListener?.('storage', event => {
            if (event.key === key()) { memory = null; changed(); }
            else if (event.key?.startsWith(`${key()}:controller:`)) changed();
        });
        win.addEventListener?.('pagehide', () => {
            // Preserve pause across navigation while the next page's loader starts.
            if (detector) { closed = true; announceController(handoffDuration); }
            try { if (key()) storage.removeItem(`${key()}:check:${tab}`); } catch { /* Optional. */ }
            channel?.close();
            for (const request of requests) request.abort();
        });
        connect(); if (detector) announceController(); changed();
        return { inspect, paused, assert, resume, state: read, fetch: request,
            controllerActive, ownsControl: () => detector && !closed, bindResume,
            registerScript, scriptState, scriptVillages, setScriptAuto,
            forgetScript(id, villageId) { if (knownScripts.includes(id)) storage.removeItem(scriptKey(id, villageId)); },
            scope: key,
            token() { assert(); return generation; },
            onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
            track(handle) { if (handle?.abort) requests.add(handle); return () => requests.delete(handle); },
            click(element) { assert(); element.click(); },
            interval(callback, delay, ...args) {
                return (win.setInterval || env.setInterval)(() => { if (!paused()) callback(...args); }, delay);
            }
        };
    }
    // CONTROL-CLIENT-END

    const VERSION = '0.5.1';
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

    const gamePage = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    const gameData = gamePage.game_data || {};
    const search = new URLSearchParams(window.location.search);
    const mode = search.get('mode') || gameData.mode || 'train';

    if (!['train', 'mass'].includes(mode)) {
        return;
    }
    if (window.top !== window.self) return;
    const dsControl = mode === 'train' ? createControlClient({ win: window, doc: document, storage: window.localStorage }, 'Truppenvorlagen') : null;

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

    gamePage.DSTroopTemplates = Object.freeze({
        version: VERSION,
        refresh: () => refreshIntegration(true),
        calculatePlan
    });
    if (mode === 'train') integrateRecruitment();

    function integrateRecruitment() {
        const villageId = String(gameData.village.id), scope = dsControl.scope();
        const autoKey = `${scope}:recruit-auto:${villageId}`, commandKey = `${scope}:recruit-command:${villageId}`;
        let activeCommand = null, revision = 0, participant;
        const enabled = () => window.localStorage.getItem(autoKey) !== 'false';
        const updateResume = dsControl.bindResume(document.querySelector(`#${SCRIPT_ID}-panel [data-resume]`), document.querySelector(`#${SCRIPT_ID}-panel [data-resume-error]`));
        const center = () => gamePage.DSControlCenter?.isActive?.() &&
            typeof gamePage.DSControlCenter.planRecruitmentNow === 'function' ? gamePage.DSControlCenter : null;
        function requireCenter() {
            if (!center()) throw new Error('Kontrollzentrum nicht aktiv. Kein automatischer Rekrutierungsauftrag.');
        }
        function snapshot() {
            const context = state.contexts[0], form = document.querySelector('#train_form');
            const stored = loadStore(), templateId = stored.villageTemplateIds[villageId];
            const template = stored.templates.find(t => t.id === templateId);
            if (!form || !context || !template) return null;
            const entries = collectSingleEntries(form, readQueuedCounts(document).counts, false);
            const items = [...entries.values()].map(e => ({ unit: e.unit, total: e.total, queued: e.queued, max: Number.isFinite(e.max) ? e.max : null,
                cost: e.cost, deficit: e.total === null ? 0 : Math.max(0, (template.units[e.unit] || 0) - e.total - e.queued),
                disabled: e.input.disabled || e.input.readOnly }));
            const budget = readAvailableBudget(document, gamePage.game_data);
            const nativeNumber = id => {
                const text = document.getElementById(id)?.textContent?.replace(/[.\s\u00a0]/g, '');
                return /^\d+$/.test(text || '') ? Number(text) : null;
            };
            if (budget) {
                for (const r of ['wood', 'stone', 'iron']) { const current = nativeNumber(r); if (current !== null) budget[r] = Math.min(budget[r], current); }
                const pop = nativeNumber('pop_current_label'), max = nativeNumber('pop_max_label');
                if (pop !== null && max !== null) budget.pop = Math.min(budget.pop, Math.max(0, max - pop));
            }
            return { templateId, targets: template.units, items,
                budget, at: Date.now() };
        }
        function readCommand() { try { return JSON.parse(window.localStorage.getItem(commandKey) || 'null'); } catch { return null; } }
        function saveCommand(command) { window.localStorage.setItem(commandKey, JSON.stringify(command)); }
        function finish(command, status, message) {
            saveCommand({ ...command, status, message, completedAt: Date.now() });
            notify(message, status !== 'confirmed'); participant?.publish();
        }
        const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));
        async function process() {
            if (activeCommand || !center() || dsControl.paused()) return;
            if (!window.navigator.locks?.request) {
                const command = readCommand();
                if (command?.status === 'queued') finish(command, 'failed', 'Browser unterstützt keine sichere Tab-Sperre.');
                return;
            }
            await window.navigator.locks.request(commandKey, { ifAvailable: true }, async lock => { if (lock) await execute(); });
        }
        async function execute() {
            const command = readCommand();
            if (!command || activeCommand || !center() || !['queued', 'processing', 'submitted'].includes(command.status) || dsControl.paused()) return;
            if (['action', 'try', 'ajax', 'ajaxaction'].some(k => search.has(k))) return;
            if (command.villageId !== villageId || command.scope !== scope || command.issuedAt > Date.now() || Date.now() - command.issuedAt > 600000) {
                finish(command, 'failed', 'Rekrutierungsbefehl ungültig oder abgelaufen.'); return;
            }
            if (command.status === 'processing') { finish(command, 'failed', 'Unterbrochener Auftrag wird nicht erneut abgeschickt.'); return; }
            activeCommand = command.id; const started = revision;
            try {
                if (command.status === 'queued') {
                    if (!enabled()) throw new Error('Rekrutierungsautomatik ausgeschaltet.');
                    saveCommand({ ...command, status: 'processing' });
                    const token = dsControl.token();
                    await wait(1000 + Math.floor(Math.random() * 3001));
                    dsControl.assert(token);
                    requireCenter();
                    if (started !== revision || !enabled()) throw new Error('Rekrutierung durch Pause oder Automatikänderung angehalten.');
                    refreshIntegration(true);
                    const live = snapshot();
                    if (!live?.budget || live.templateId !== command.templateId || JSON.stringify(live.targets) !== command.targetsSignature)
                        throw new Error('Truppenvorlage oder Bestandsdaten geändert.');
                    if (!Number.isSafeInteger(command.reservedPop) || command.reservedPop < 0 || !Number.isSafeInteger(command.surplus) || command.surplus <= 0) throw new Error('Baureserve oder Überschuss fehlt.');
                    const budget = { ...live.budget, pop: Math.max(0, Math.min(command.surplus, live.budget.pop - command.reservedPop)) };
                    const validItems = live.items.filter(item => !item.disabled);
                    command.units = center().planRecruitmentNow(villageId, { ...live, items: validItems }, command.id);
                    const requested = validItems.filter(item => item.cost && Number.isFinite(item.max)).map(item => ({ ...item,
                        deficit: Math.min(item.deficit, Number.isSafeInteger(command.units[item.unit]) && command.units[item.unit] > 0 ? command.units[item.unit] : 0) }));
                    const units = calculatePlan(requested, true, budget);
                    if (!Object.values(units).some(n => n > 0)) { finish(command, 'confirmed', 'Keine neuen Einheiten nötig oder innerhalb der Baureserve finanzierbar.'); return; }
                    const form = document.querySelector('#train_form');
                    const submit = form?.querySelector('input[type="submit"], button[type="submit"], button:not([type])');
                    if (!submit || submit.disabled || !isVisible(submit)) throw new Error('Rekrutieren-Button nicht verfügbar.');
                    const entries = collectSingleEntries(form, readQueuedCounts(document).counts, false);
                    if ([...entries.values()].some(e => Number(e.input.value) > 0)) throw new Error('Rekrutierungsfelder sind bereits manuell belegt.');
                    dsControl.assert(token);
                    for (const entry of entries.values()) if (!entry.input.disabled && !entry.input.readOnly) setRecruitValue(entry.input, units[entry.unit] || 0);
                    await wait(1000 + Math.floor(Math.random() * 3001));
                    dsControl.assert(token);
                    if (started !== revision || !enabled()) throw new Error('Rekrutierung vor dem Abschicken angehalten.');
                    requireCenter();
                    if ([...entries.values()].some(entry => !entry.input.isConnected || Number(entry.input.value || 0) !== (units[entry.unit] || 0)))
                        throw new Error('Rekrutierungsfelder vor dem Abschicken geändert.');
                    // Native maxima (and cost previews) may already subtract the entered order.
                    // Read an unallocated snapshot synchronously, then restore the same inputs.
                    // Real resource losses, queue changes and native limits remain visible.
                    let refreshed;
                    const entered = [...entries.values()].map(entry => [entry.input, entry.input.value]);
                    try {
                        for (const [input] of entered) if (!input.disabled && !input.readOnly) setRecruitValue(input, 0);
                        refreshed = snapshot();
                    } finally {
                        for (const [input, value] of entered) {
                            input.value = value;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                    if (!refreshed?.budget || refreshed.templateId !== command.templateId || JSON.stringify(refreshed.targets) !== command.targetsSignature)
                        throw new Error('Vorlage vor dem Abschicken geändert.');
                    const finalBudget = { ...refreshed.budget, pop: Math.max(0, Math.min(command.surplus, refreshed.budget.pop - command.reservedPop)) };
                    const finalItems = refreshed.items.filter(item => (units[item.unit] || 0) > 0);
                    if (!finalItems.length || finalItems.some(item => item.disabled || !item.cost || item.deficit < units[item.unit] || !Number.isFinite(item.max) || item.max < units[item.unit]))
                        throw new Error('Truppenbestände oder Rekrutierungsgrenzen vor dem Abschicken geändert.');
                    if (!['wood', 'stone', 'iron', 'pop'].every(r => finalItems.reduce((sum, item) => sum + units[item.unit] * item.cost[r], 0) <= finalBudget[r]))
                        throw new Error('Rohstoffe oder freie Bauernhofkapazität vor dem Abschicken nicht mehr ausreichend.');
                    if ([...entries.values()].some(entry => !entry.input.isConnected || Number(entry.input.value || 0) !== (units[entry.unit] || 0)))
                        throw new Error('Rekrutierungsfelder vor dem Abschicken geändert.');
                    if (!submit.isConnected || submit.disabled || !isVisible(submit)) throw new Error('Rekrutieren-Button vor dem Abschicken geändert.');
                    command.units = units; command.baselineQueued = Object.fromEntries(live.items.map(i => [i.unit, i.queued]));
                    command.baselinePop = Number(gamePage.game_data.village.pop);
                    command.spentPop = requested.reduce((sum, item) => sum + (units[item.unit] || 0) * item.cost.pop, 0);
                    command.status = 'submitted'; command.submittedAt = Date.now();
                    saveCommand(command); // Persist before native submit; never repeat after navigation.
                    requireCenter();
                    dsControl.click(submit);
                }
                for (let i = 0; i < 60; i++) {
                    dsControl.assert();
                    const queued = readQueuedCounts(document).counts;
                    if (Object.entries(command.units).filter(([, n]) => n > 0).every(([unit, n]) => (queued[unit] || 0) >= (command.baselineQueued[unit] || 0) + n) ||
                        Number(gamePage.game_data?.village?.pop) >= command.baselinePop + command.spentPop) {
                        finish(command, 'confirmed', 'Rekrutierungsauftrag vom Spiel bestätigt.'); return;
                    }
                    await wait(250);
                }
                finish(command, 'unknown', 'Spielbestätigung fehlt. Auftrag wird nicht wiederholt.');
            } catch (error) {
                finish(command, command.status === 'submitted' ? 'unknown' : 'failed', error.message);
            } finally { activeCommand = null; participant?.publish(); }
        }
        participant = dsControl.registerScript('truppenvorlagen', {
            version: VERSION, state: () => {
                const command = readCommand(), recruitment = snapshot();
                return { auto: enabled() && !!recruitment, busy: !!activeCommand, completedAt: command?.completedAt || 0,
                    recruitment, status: command?.message || 'Bereit für normale Rekrutierung.' };
            },
            setAuto(value) { revision++; window.localStorage.setItem(autoKey, String(value)); }
        });
        dsControl.onChange(() => { revision++; if (!dsControl.paused()) void process(); });
        const timer = window.setInterval(() => { updateResume(); participant.publish(); void process(); }, 1000);
        window.addEventListener('pagehide', () => { revision++; window.clearInterval(timer); });
        void process();
    }

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
        const budget = readAvailableBudget(root, gamePage.game_data || gameData);

        return {
            kind: 'single',
            scope: form,
            villageId: String(gamePage.game_data?.village?.id || gameData.village?.id || search.get('village') || ''),
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
            if (decorate) attachRecruitInputListener(entry);
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
            const native = cell.cloneNode(true);
            native.querySelectorAll('.ds-tt-delta').forEach(node => node.remove());
            const match = native.textContent.match(/^\s*([0-9][0-9.\s\u00a0]*)\s*\/\s*([0-9][0-9.\s\u00a0]*)\s*$/);
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
                const managerCost = gamePage.unit_managers?.units?.[unit]?.[resource];
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
        if (mode === 'train') actionCell.append(element('button', { type: 'button', 'data-resume': '', textContent: 'Fortsetzen', hidden: true }),
            element('span', { 'data-resume-error': '', role: 'status', hidden: true }));

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
        if (dsControl?.paused()) { notify('Kontrollzentrum: normale Rekrutierung pausiert.', true); return; }
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
            if (error && typeof gamePage.UI?.ErrorMessage === 'function') {
                gamePage.UI.ErrorMessage(message, 3000);
            } else if (!error && typeof gamePage.UI?.SuccessMessage === 'function') {
                gamePage.UI.SuccessMessage(message, 2500);
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
