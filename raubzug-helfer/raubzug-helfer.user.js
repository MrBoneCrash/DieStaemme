// ==UserScript==
// @name         Die Stämme – Raubzug-Helfer
// @namespace    local.die-staemme.raubzug-helfer
// @version      1.4.1
// @description  Optimiert ganzzahlige Raubzuggruppen nach Rohstoffen pro Stunde, mit Rückkehrgrenze und optionaler Automatik.
// @match        https://*.die-staemme.de/game.php?*screen=place*
// @exclude      /^[^?]+\?(?!(?=(?:[^#]*&)?screen=place(?:&|#|$))(?=(?:[^#]*&)?mode=scavenge(?:&|#|$))(?!(?:[^#]*&)?(?:try|action|ajax|ajaxaction)(?:=|&|#|$)))/
// @exclude      /^[^?]+\?(?:[^#]*&)?(screen|mode|village)=[^#]*&\1=/
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==

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
    const dsControl = typeof window === 'undefined' ? null : createControlClient({
        win: window, doc: document, storage: localStorage, host: location.host, setInterval }, 'raubzug-helfer');

    const ID = 'ds-raubzug-helfer';
    const NAMES = { spear: 'Speerträger', sword: 'Schwertkämpfer', axe: 'Axtkämpfer', archer: 'Bogenschütze',
        light: 'Leichte Kavallerie', marcher: 'Berittener Bogenschütze', heavy: 'Schwere Kavallerie', knight: 'Paladin' };
    const finite = (n, min = 0) => typeof n === 'number' && Number.isFinite(n) && n >= min;
    const integer = n => Number.isSafeInteger(n) && n >= 0;
    // Identical to the Konstruktionshelfer: inclusive 1,000–4,000 ms.
    function randomDelay(random = Math.random) { return 1000 + Math.floor(random() * 3001); }
    const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    function isPage(search) {
        const p = new URLSearchParams(search);
        return p.getAll('screen').length === 1 && p.get('screen') === 'place' && p.getAll('mode').length === 1 &&
            p.get('mode') === 'scavenge' && p.getAll('village').length <= 1 &&
            !['try', 'action', 'ajax', 'ajaxaction'].some(k => p.has(k));
    }
    function metrics(capacity, o) {
        if (capacity <= 0) return { loot: 0, seconds: 0, rate: 0 };
        const loot = capacity * o.loot, seconds = (Math.pow(loot * loot * 100, o.exponent) + o.initial) * o.factor;
        return { loot, seconds, rate: loot * 3600 / seconds };
    }
    function derivative(c, o) {
        const p = o.exponent * 2, x = Math.pow(c * o.loot * 10, p);
        return 3600 * o.loot / o.factor * (o.initial + (1 - p) * x) / Math.pow(o.initial + x, 2);
    }
    function maxCapacity(seconds, o) {
        const inner = seconds / o.factor - o.initial;
        return inner > 0 ? Math.pow(inner, 1 / (2 * o.exponent)) / (10 * o.loot) : 0;
    }
    function checkInput(input) {
        if (!Array.isArray(input.units) || !Array.isArray(input.options) || input.options.length > 4 ||
            !input.units.every(u => typeof u.name === 'string' && integer(u.count) && finite(u.carry, Number.MIN_VALUE) && finite(u.pop, Number.MIN_VALUE)) ||
            !input.options.every(o => integer(o.id) && o.id > 0 && finite(o.loot, Number.MIN_VALUE) && finite(o.factor, Number.MIN_VALUE) &&
                finite(o.exponent, Number.MIN_VALUE) && o.exponent <= 0.5 && finite(o.initial, Number.MIN_VALUE)) ||
            !integer(input.minCount) || !integer(input.minPop) || !(input.maxSeconds === Infinity || finite(input.maxSeconds)))
            throw new Error('Raubzugdaten fehlen oder die Laufzeitformel wird nicht unterstützt.');
    }
    function validatePlan(plan, input) {
        checkInput(input);
        const spent = input.units.map(() => 0), ids = new Set();
        for (const row of plan) {
            const o = input.options.find(o => o.id === row.id);
            if (!o || ids.has(row.id) || !Array.isArray(row.counts) || row.counts.length !== input.units.length) return false;
            ids.add(row.id);
            let count = 0, pop = 0, capacity = 0;
            for (let u = 0; u < input.units.length; u++) {
                const n = row.counts[u];
                if (!integer(n)) return false;
                spent[u] += n; count += n; pop += n * input.units[u].pop; capacity += n * input.units[u].carry;
            }
            if (count < input.minCount || pop < input.minPop || capacity <= 0 ||
                Math.ceil(metrics(capacity, o).seconds) > input.maxSeconds) return false;
        }
        return spent.every((n, u) => n <= input.units[u].count);
    }
    // Continuous relaxation supplies an upper bound, never an allocation to send.
    // For 0 < 2*exponent <= 1, c*loot/duration(c) is increasing and concave.
    function relaxation(low, high, total, options) {
        if (low.reduce((a, b) => a + b, 0) > total + 1e-7) return null;
        const at = lambda => options.map((o, k) => {
            if (derivative(low[k], o) <= lambda) return low[k];
            if (derivative(high[k], o) >= lambda) return high[k];
            let l = low[k], h = high[k];
            for (let i = 0; i < 35; i++) { const m = (l + h) / 2; if (derivative(m, o) > lambda) l = m; else h = m; }
            return (l + h) / 2;
        });
        let l = 0, h = Math.max(...options.map((o, k) => derivative(low[k], o)));
        for (let i = 0; i < 40; i++) {
            const m = (l + h) / 2;
            if (at(m).reduce((a, b) => a + b, 0) > total) l = m; else h = m;
        }
        // Tangent + total-capacity constraint is a conservative bound even if bisection isn't exact.
        const target = at(h), slopes = options.map((o, k) => derivative(target[k], o));
        const lambda = h;
        let bound = lambda * total;
        for (let k = 0; k < options.length; k++) {
            bound += metrics(target[k], options[k]).rate - slopes[k] * target[k] +
                (slopes[k] - lambda) * (slopes[k] >= lambda ? high[k] : low[k]);
        }
        return { target, slopes, bound: bound + 1e-7 * Math.max(1, Math.abs(bound)) };
    }
    function* optimize(input) {
        checkInput(input);
        // Equal carry and population are interchangeable for every constraint.
        // Merge them before searching, then reconstruct real, available unit counts.
        const groups = [];
        input.units.forEach((unit, i) => {
            let group = groups.find(g => g.carry === unit.carry && g.pop === unit.pop);
            if (!group) { group = { name: unit.name, carry: unit.carry, baseCarry: unit.baseCarry, pop: unit.pop, count: 0, indices: [] }; groups.push(group); }
            group.count += unit.count; group.indices.push(i);
        });
        if (groups.length < input.units.length) {
            const iterator = optimize({ ...input, units: groups }); let step;
            do { step = iterator.next(); if (!step.done) yield step.value; } while (!step.done);
            const left = input.units.map(u => u.count);
            const rows = step.value.rows.map(row => {
                const counts = Array(input.units.length).fill(0);
                groups.forEach((group, g) => { let n = row.counts[g]; for (const i of group.indices) { const take = Math.min(n, left[i]); counts[i] = take; n -= take; left[i] -= take; } });
                return { id: row.id, counts };
            });
            return { ...step.value, rows };
        }
        const U = input.units.length, stock = input.units.map(u => u.count), all = input.options;
        let best = [], bestRate = 0, visited = 0;
        const score = rows => rows.reduce((sum, r) => sum + metrics(r.counts.reduce((c, n, u) => c + n * input.units[u].carry, 0), all.find(o => o.id === r.id)).rate, 0);
        const accept = rows => {
            if (!validatePlan(rows, input)) return;
            const rate = score(rows);
            if (rate > bestRate) { bestRate = rate; best = rows.map(r => ({ id: r.id, counts: [...r.counts] })); }
        };
        for (let mask = 1; mask < (1 << all.length); mask++) {
            const options = all.filter((_, k) => mask & (1 << k)), K = options.length;
            const caps = options.map(o => input.maxSeconds === Infinity ? Infinity : maxCapacity(Math.floor(input.maxSeconds), o));
            if (stock.reduce((a, b) => a + b, 0) < K * input.minCount ||
                input.units.reduce((a, u) => a + u.count * u.pop, 0) < K * input.minPop) continue;
            // A single unit type is separable discrete concave resource allocation:
            // after seeding the minima, the largest marginal gain gives the exact optimum.
            if (U === 1) {
                const unit = input.units[0], minimum = Math.max(1, input.minCount, Math.ceil(input.minPop / unit.pop));
                const counts = options.map(() => minimum);
                if (minimum * K > unit.count || counts.some((n, k) => n * unit.carry > caps[k])) continue;
                for (let n = minimum * K; n < unit.count; n++) {
                    let chosen = -1, gain = -Infinity;
                    for (let k = 0; k < K; k++) {
                        if ((counts[k] + 1) * unit.carry > caps[k]) continue;
                        const delta = metrics((counts[k] + 1) * unit.carry, options[k]).rate - metrics(counts[k] * unit.carry, options[k]).rate;
                        if (delta > gain) { gain = delta; chosen = k; }
                    }
                    if (chosen < 0) break;
                    counts[chosen]++;
                    if (++visited % 500 === 0) yield { visited, rate: bestRate };
                }
                accept(options.map((o, k) => ({ id: o.id, counts: [counts[k]] })));
                continue;
            }
            if (!U) continue;
            // Fast certificate for mixed armies: first solve the relaxed problem on
            // the exact carrying-capacity lattice, then find an actual troop witness.
            // A witness attains that upper bound and proves optimality immediately.
            const scale = input.carryFactor ?? 1, basis = input.units.map(u => u.baseCarry ?? u.carry);
            if (finite(scale, Number.MIN_VALUE) && input.units.every((u, i) => Number.isSafeInteger(basis[i]) && basis[i] * scale === u.carry)) {
                const gcd = (a, b) => { while (b) { const r = a % b; a = b; b = r; } return a; };
                const quantum = basis.reduce((g, carry) => gcd(g, carry), 0);
                const minimumCapacity = Math.max(quantum, input.minCount * Math.min(...basis),
                    input.minPop * Math.min(...input.units.map((u, i) => basis[i] / u.pop)));
                const minimum = Math.ceil(minimumCapacity / quantum), ticks = Array(K).fill(minimum);
                const maxima = caps.map(c => c === Infinity ? Infinity : Math.floor(c / scale / quantum));
                const totalTicks = input.units.reduce((sum, u, i) => sum + u.count * basis[i] / quantum, 0);
                if (ticks.every((t, k) => t <= maxima[k]) && K * minimum <= totalTicks) {
                    for (let n = K * minimum; n < totalTicks; n++) {
                        let chosen = -1, gain = -Infinity;
                        for (let k = 0; k < K; k++) if (ticks[k] < maxima[k]) {
                            const delta = metrics((ticks[k] + 1) * quantum * scale, options[k]).rate - metrics(ticks[k] * quantum * scale, options[k]).rate;
                            if (delta > gain) { chosen = k; gain = delta; }
                        }
                        if (chosen < 0) break;
                        ticks[chosen]++;
                        if (++visited % 500 === 0) yield { visited, rate: bestRate };
                    }
                    const order = input.units.map((_, u) => u).sort((a, b) => input.units[b].carry - input.units[a].carry);
                    const remaining = [...stock], witness = options.map(o => ({ id: o.id, counts: Array(U).fill(0) }));
                    let tries = 0;
                    function match(k, position, capacity, count, pop) {
                        if (++tries > 20000) return false; // only abandon this certificate, not the exact search
                        if (capacity === 0) {
                            if (count < input.minCount || pop < input.minPop) return false;
                            return k + 1 === K || match(k + 1, 0, ticks[k + 1] * quantum, 0, 0);
                        }
                        if (position === U || capacity < 0) return false;
                        const u = order[position], unit = input.units[u], unitCarry = basis[u];
                        let suffixCapacity = 0, suffixGcd = 0;
                        for (let j = position + 1; j < U; j++) {
                            const v = order[j]; suffixCapacity += remaining[v] * basis[v];
                            if (remaining[v]) suffixGcd = gcd(suffixGcd, basis[v]);
                        }
                        const lower = Math.max(0, Math.ceil((capacity - suffixCapacity) / unitCarry));
                        const upper = Math.min(remaining[u], Math.floor(capacity / unitCarry));
                        if (lower > upper) return false;
                        const totalRemainingCapacity = input.units.reduce((c, unit, u) => c + remaining[u] * basis[u], 0);
                        const target = Math.max(lower, Math.min(upper, Math.round(remaining[u] * capacity / totalRemainingCapacity)));
                        for (let distance = 0; distance <= Math.max(upper - target, target - lower); distance++) {
                            for (const n of distance ? [target - distance, target + distance] : [target]) {
                                if (n < lower || n > upper) continue;
                                const rest = capacity - n * unitCarry;
                                if (suffixGcd ? rest % suffixGcd !== 0 : rest !== 0) continue;
                                remaining[u] -= n; witness[k].counts[u] = n;
                                if (match(k, position + 1, rest, count + n, pop + n * unit.pop)) return true;
                                remaining[u] += n; witness[k].counts[u] = 0;
                            }
                        }
                        return false;
                    }
                    if (match(0, 0, ticks[0] * quantum, 0, 0) && validatePlan(witness, input)) {
                        accept(witness); continue;
                    }
                }
            }
            // A feasible incumbent speeds up the proof; it is never sent before the
            // complete search certifies that no better integer allocation exists.
            const seed = options.map(o => ({ id: o.id, counts: Array(U).fill(0) })), left = [...stock];
            const seedCap = Array(K).fill(0);
            let seeded = true;
            for (let k = 0; k < K && seeded; k++) {
                let count = 0, pop = 0;
                while (count < input.minCount || pop < input.minPop || count === 0) {
                    const choices = input.units.map((unit, u) => ({ unit, u })).filter(({ unit, u }) => left[u] && seedCap[k] + unit.carry <= caps[k]);
                    choices.sort((a, b) => a.unit.carry - b.unit.carry);
                    if (!choices.length) { seeded = false; break; }
                    const { unit, u } = choices[0]; seed[k].counts[u]++; left[u]--; count++; pop += unit.pop; seedCap[k] += unit.carry;
                }
            }
            if (seeded) {
                while (left.some(n => n > 0)) {
                    let chosen = null, gain = -Infinity;
                    for (let u = 0; u < U; u++) if (left[u]) for (let k = 0; k < K; k++) {
                        if (seedCap[k] + input.units[u].carry > caps[k]) continue;
                        const delta = metrics(seedCap[k] + input.units[u].carry, options[k]).rate - metrics(seedCap[k], options[k]).rate;
                        if (delta > gain) { gain = delta; chosen = { k, u }; }
                    }
                    if (!chosen) break;
                    const { k, u } = chosen; seed[k].counts[u]++; left[u]--; seedCap[k] += input.units[u].carry;
                    if (++visited % 500 === 0) yield { visited, rate: bestRate };
                }
                accept(seed);
            }
            // Integer boxes: each variable is the number of a unit type in one group.
            // Branching partitions the entire feasible set. No cut-off or heuristic fallback.
            const root = { lo: Array(K * U).fill(0), hi: Array.from({ length: K * U }, (_, i) => stock[i % U]) };
            const stack = [root];
            while (stack.length) {
                const node = stack.pop(), { lo, hi } = node;
                let valid = true;
                for (let pass = 0; pass < 3 && valid; pass++) {
                    for (let u = 0; u < U; u++) {
                        let used = 0; for (let k = 0; k < K; k++) used += lo[k * U + u];
                        if (used > stock[u]) { valid = false; break; }
                        for (let k = 0; k < K; k++) { const i = k * U + u; hi[i] = Math.min(hi[i], stock[u] - used + lo[i]); }
                    }
                    for (let k = 0; k < K && valid; k++) {
                        let minCap = 0, maxCount = 0, maxPop = 0;
                        for (let u = 0; u < U; u++) { const i = k * U + u; minCap += lo[i] * input.units[u].carry; maxCount += hi[i]; maxPop += hi[i] * input.units[u].pop; }
                        if (minCap > caps[k] + 1e-8 || maxCount < input.minCount || maxPop < input.minPop) { valid = false; break; }
                        for (let u = 0; u < U; u++) {
                            const i = k * U + u, unit = input.units[u];
                            hi[i] = Math.min(hi[i], Math.floor((caps[k] - minCap) / unit.carry + lo[i] + 1e-9));
                            lo[i] = Math.max(lo[i], input.minCount - maxCount + hi[i], Math.ceil((input.minPop - maxPop) / unit.pop + hi[i]));
                            if (lo[i] > hi[i]) { valid = false; break; }
                        }
                    }
                }
                if (++visited % 500 === 0) yield { visited, rate: bestRate };
                if (!valid) continue;
                const low = options.map((_, k) => input.units.reduce((c, unit, u) => c + lo[k * U + u] * unit.carry, 0));
                const high = options.map((_, k) => Math.min(caps[k], input.units.reduce((c, unit, u) => c + hi[k * U + u] * unit.carry, 0)));
                if (low.some((c, k) => c > high[k] + 1e-8)) continue;
                const total = input.units.reduce((c, unit) => c + unit.count * unit.carry, 0), relaxed = relaxation(low, high, total, options);
                if (!relaxed || relaxed.bound < bestRate) continue;
                // Also bound the tangent by each unit type's actual stock and box limits.
                let tangent = options.reduce((sum, o, k) => sum + metrics(relaxed.target[k], o).rate - relaxed.slopes[k] * relaxed.target[k], 0);
                for (let u = 0; u < U; u++) {
                    let left = stock[u];
                    for (let k = 0; k < K; k++) { const n = lo[k * U + u]; left -= n; tangent += n * input.units[u].carry * relaxed.slopes[k]; }
                    const order = options.map((_, k) => k).sort((a, b) => relaxed.slopes[b] - relaxed.slopes[a]);
                    for (const k of order) { const n = Math.min(left, hi[k * U + u] - lo[k * U + u]); tangent += n * input.units[u].carry * relaxed.slopes[k]; left -= n; }
                }
                if (tangent + 1e-7 * Math.max(1, tangent) < bestRate) continue;
                let split = -1, width = 0;
                for (let i = 0; i < lo.length; i++) {
                    const w = (hi[i] - lo[i]) * input.units[i % U].carry;
                    if (w > width) { width = w; split = i; }
                }
                if (split < 0) { accept(options.map((o, k) => ({ id: o.id, counts: lo.slice(k * U, (k + 1) * U) }))); continue; }
                const mid = Math.floor((lo[split] + hi[split]) / 2);
                const a = { lo: [...lo], hi: [...hi] }, b = { lo: [...lo], hi: [...hi] };
                a.hi[split] = mid; b.lo[split] = mid + 1;
                const k = Math.floor(split / U), preferHigh = relaxed.target[k] > (low[k] + high[k]) / 2;
                stack.push(preferHigh ? a : b, preferHigh ? b : a);
            }
        }
        return { rows: best, rate: bestRate, visited, exact: true };
    }
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    function formatTime(t) {
        const p = Object.fromEntries(formatter.formatToParts(t).map(p => [p.type, p.value]));
        return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}:${p.second}`;
    }
    function parseTime(s) {
        if (!String(s).trim()) return null;
        const m = String(s).trim().match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
        if (!m) throw new Error('Rückkehrzeit als TT.MM.JJJJ HH:MM:SS eingeben.');
        const [, d, mo, y, h, mi, se] = m.map(Number), wall = Date.UTC(y, mo - 1, d, h, mi, se);
        const candidates = [60, 120].map(offset => wall - offset * 60000).filter(t => formatTime(t) === s.trim());
        if (candidates.length !== 1) throw new Error('Ungültige oder durch die Zeitumstellung doppeldeutige Rückkehrzeit.');
        return candidates[0];
    }
    function snapshot(screen, selected, maxSeconds = Infinity) {
        const village = screen?.village, definitions = screen?.sendable_units;
        if (!village?.options || !village.unit_counts_home || !definitions || !finite(Number(village.unit_carry_factor), Number.MIN_VALUE))
            throw new Error('Aktuelle Dorf- und Einheitendaten der Raubzugseite sind nicht lesbar.');
        const units = Object.keys(definitions).filter(u => NAMES[u] && selected.includes(u)).map(name => {
            const stats = definitions[name], count = Number(village.unit_counts_home[name]);
            return { name, count, baseCarry: Number(stats.carry), carry: Number(stats.carry) * Number(village.unit_carry_factor), pop: Number(stats.pop) };
        }).filter(u => u.count !== 0);
        const options = Object.entries(village.options).filter(([, o]) => !o.is_locked && !o.unlock_time && !o.scavenging_squad).map(([id, o]) => ({
            id: Number(o.id ?? o.base?.id ?? id), loot: Number(o.base?.loot_factor), factor: Number(o.base?.duration_factor),
            exponent: Number(o.base?.duration_exponent), initial: Number(o.base?.duration_initial_seconds)
        }));
        // The native candidate-squad model can supply stricter world-specific minima.
        const nativeMinPop = screen.candidate_squad?.min_pop_to_send;
        const minCount = Number(screen.candidate_squad?.min_unit_count ?? screen.min_unit_count ?? (nativeMinPop === undefined ? 10 : 0));
        const minPop = Number(nativeMinPop ?? screen.candidate_squad?.min_pop ?? screen.min_pop ?? 0);
        const input = { units, options, carryFactor: Number(village.unit_carry_factor), minCount, minPop, maxSeconds: Math.max(0, maxSeconds) };
        checkInput(input); return input;
    }
    function nextEvent(options, now) {
        const times = Object.values(options).flatMap(o => [o.scavenging_squad?.return_time, o.unlock_time])
            .map(t => Number(t) * 1000).filter(t => finite(t, now));
        return times.length ? Math.min(...times) : null;
    }
    if (typeof module === 'object' && module.exports) {
        module.exports = { randomDelay, isPage, metrics, derivative, maxCapacity, relaxation, optimize, validatePlan, snapshot, nextEvent, parseTime, formatTime };
        return;
    }
    if (!isPage(location.search) || document.getElementById(ID)) return;
    const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    let attempts = 0;
    const ready = setInterval(() => {
        if (page.ScavengeScreen?.village && document.getElementById('scavenge_screen')) {
            clearInterval(ready); initialize();
        } else if (++attempts >= 100) clearInterval(ready);
    }, 200);
    function initialize() {
        const screen = () => page.ScavengeScreen, villageId = String(page.game_data.village.id);
        const pageStarted = performance.timeOrigin || Date.now();
        const key = `${ID}:${page.game_data.world}:${page.game_data.player.id}:${villageId}`;
        const available = Object.keys(screen().sendable_units || {}).filter(u => NAMES[u]);
        let settings = { selected: available.filter(u => u !== 'knight'), deadline: '', auto: false, unlock: true };
        try { const saved = JSON.parse(localStorage.getItem(key)); if (saved) settings = { ...settings, ...saved }; } catch { /* defaults */ }
        if (!Array.isArray(settings.selected)) settings.selected = [];
        const style = document.createElement('style');
        style.textContent = `#${ID}{--ink:#4c351e;color:var(--ink);font:13px/1.5 Verdana,Arial,sans-serif;background:linear-gradient(110deg,#f8efd7,#eee0bf);border:1px solid #987345;border-radius:8px;padding:14px 16px;margin:0 0 15px;box-shadow:0 3px 10px #45260822}
            #${ID} summary{cursor:pointer;font-weight:700;color:#684118} #${ID} [data-summary]{font:11px Verdana,Arial,sans-serif;color:#7b6548;margin-left:8px}
            #${ID} .ds-body{padding-top:8px} #${ID} fieldset{border:1px solid #cbb58b;border-radius:5px;margin:10px 0;padding:10px}
            #${ID} .ds-units{display:flex;gap:5px;flex-wrap:wrap} #${ID} .ds-unit{position:relative;display:grid;place-items:center;width:43px;height:39px;border:1px solid #cebc9a;border-radius:5px;background:#faf3e2;cursor:pointer}
            #${ID} .ds-unit input{position:absolute;inset:0;width:100%;height:100%;opacity:0;margin:0;cursor:pointer} #${ID} .ds-unit:has(input:checked){background:#ead4a6;border-color:#a7793e}
            #${ID} .ds-unit:has(input:checked)::after{content:'✓';position:absolute;right:2px;bottom:0;color:#684118} #${ID} .ds-unit:has(input:focus-visible){outline:2px solid #93602b} #${ID} .ds-unit img{width:23px;height:23px}
            #${ID} input[type=text]{display:block;box-sizing:border-box;max-width:100%;width:290px;padding:8px;margin-top:5px;background:#fffaf0;border:1px solid #baa079;border-radius:5px;color:var(--ink)}
            #${ID} .ds-actions{display:flex;justify-content:space-between;gap:10px;margin-top:13px;flex-wrap:wrap} #${ID} button{padding:8px 12px;border:1px solid #643516;border-radius:5px;font:700 12px Verdana,Arial,sans-serif;cursor:pointer}
            #${ID} [data-send]{background:linear-gradient(#8f572f,#70401f);color:#fff5dc} #${ID} [data-auto]{background:#a33d32;border-color:#7e2e26;color:#fff} #${ID} [data-auto][aria-pressed=true]{background:#397c3b;border-color:#285b2a}
            #${ID} button:disabled{opacity:.55;cursor:wait} #${ID} .ds-hint{font-size:11px;color:#7b6548;margin:6px 0} #${ID} [data-status]{margin-top:10px;padding:9px;background:#f9f1df;border:1px solid #d4c19e;border-radius:5px;overflow-wrap:anywhere}
            #${ID} [data-status][data-error=true]{color:#953d28;background:#fbede1} #${ID} table{width:100%;margin-top:10px;border-collapse:collapse;font-size:11px} #${ID} th,#${ID} td{text-align:left;padding:6px;border-bottom:1px solid #d4c19e} #${ID} .ds-table{overflow-x:auto}`;
        document.head.append(style);
        const panel = document.createElement('section'); panel.id = ID;
        panel.innerHTML = `<details><summary>Raubzug-Helfer <span data-summary></span></summary><div class="ds-body"><fieldset><legend>Welche Truppen sollen mit?</legend><div class="ds-units">${available.map(u => {
            const image = document.querySelector(`#scavenge_screen img[src*="unit_${u}."]`)?.src || `/graphic/unit/unit_${u}.png`;
            return `<label class="ds-unit" title="${NAMES[u]}"><input type="checkbox" data-unit="${u}" aria-label="${NAMES[u]}"><img src="${escape(image)}" alt=""></label>`;
        }).join('')}</div></fieldset><label>Alle neu gesendeten Truppen spätestens zurück (Serverzeit Berlin)<input type="text" data-deadline placeholder="TT.MM.JJJJ HH:MM:SS" autocomplete="off"></label>
            <p class="ds-hint">Leer = keine Grenze. Der Zeitpunkt bleibt bis zur manuellen Änderung gespeichert. Bereits laufende Raubzüge können nicht zurückgerufen werden.</p>
            <label><input type="checkbox" data-unlock> Weitere Raubzüge bei genügend Rohstoffen freischalten</label>
            <div class="ds-actions"><button type="button" data-send>Raubzug abschicken</button><button type="button" data-auto aria-pressed="false">Automatisch abschicken: Aus</button><button type="button" data-resume hidden>Fortsetzen</button></div><span data-resume-error hidden role="status"></span>
            <p class="ds-hint">Optimiert die Summe aus Beute / individueller Laufzeit. Automatik funktioniert, solange dieser Spieltab geöffnet bleibt.</p>
            <div data-status role="status">Bereit.</div><div class="ds-table" data-result></div><p class="ds-hint" data-next></p></div></details>`;
        document.getElementById('scavenge_screen').before(panel);
        const $ = selector => panel.querySelector(selector);
        panel.querySelectorAll('[data-unit]').forEach(e => { e.checked = settings.selected.includes(e.dataset.unit); });
        $('[data-deadline]').value = String(settings.deadline || ''); $('[data-unlock]').checked = Boolean(settings.unlock);
        let busy = false, revision = 0, worker = null, cancelCalculation = null, timer = null;
        let participant = null, nextActionAt = null, completedAt = 0, resumePending = false;
        function updateSummary() {
            const paused = dsControl.state().status === 'pause';
            const running = Object.values(options()).filter(o => o.scavenging_squad).length;
            $('[data-summary]').textContent = `${paused ? 'Pause' : busy ? 'Arbeitet' : settings.auto ? 'Automatik an' : 'Automatik aus'} · ${running} unterwegs${nextActionAt !== null ? ` · Check ${formatTime(nextActionAt)}` : ''}`;
        }
        function reloadAutomatically() { page.DSControlCenter?.beforeReload?.(); location.reload(); }
        const now = () => {
            try {
                const value = page.Timing?.getCurrentServerTime?.();
                if (Object.prototype.toString.call(value) === '[object Date]') return value.getTime();
                const t = Number(value);
                if (Number.isFinite(t) && t > 0) return t > 1e12 ? t : t * 1000;
            } catch { /* local clock fallback */ }
            return Date.now();
        };
        const status = (text, error = false) => {
            $('[data-status]').textContent = dsControl.state().status === 'pause' ? `Skripte pausiert. ${dsControl.controllerActive() ? 'Bitte im Kontrollzentrum freigeben.' : 'Mit Fortsetzen die gemeinsame Pause aufheben.'}` : text;
            $('[data-status]').dataset.error = String(error);
            updateSummary();
            participant?.publish();
        };
        function save() { localStorage.setItem(key, JSON.stringify(settings)); }
        const updateResume = dsControl.bindResume($('[data-resume]'), $('[data-resume-error]'));
        function updateAuto() {
            updateResume();
            const paused = dsControl.state().status === 'pause';
            $('[data-auto]').textContent = `Automatisch abschicken: ${paused ? 'Pausiert' : settings.auto ? 'An' : 'Aus'}`;
            $('[data-auto]').setAttribute('aria-pressed', String(Boolean(settings.auto)));
            $('[data-auto]').disabled = paused; $('[data-send]').disabled = paused || busy;
            updateSummary();
            participant?.publish();
        }
        function stopped() { return dsControl.paused(); }
        async function actionDelay(started) {
            const token = dsControl.token();
            if (stopped() || started !== revision) throw new Error('Aktion durch Pause oder geänderte Einstellungen angehalten.');
            await new Promise(resolve => setTimeout(resolve, randomDelay()));
            dsControl.assert(token);
            if (stopped() || started !== revision) throw new Error('Aktion durch Pause oder geänderte Einstellungen angehalten.');
        }
        function options() { return screen().village.options; }
        function optionElement(id) {
            const elements = [...document.querySelectorAll('#scavenge_screen .scavenge-option')];
            const ids = Object.keys(options()).sort((a, b) => Number(a) - Number(b));
            return elements.find(e => String(e.dataset.id ?? e.dataset.optionId) === String(id)) ||
                (elements.length === ids.length ? elements[ids.indexOf(String(id))] : null);
        }
        function currentInput() {
            const deadline = parseTime(settings.deadline);
            return snapshot(screen(), settings.selected, deadline === null ? Infinity : Math.max(0, Math.floor((deadline - now()) / 1000) - 2));
        }
        function calculate(input) {
            return new Promise((resolve, reject) => {
                const source = [finite, integer, metrics, derivative, maxCapacity, checkInput, validatePlan, relaxation, optimize]
                    .map(f => `const ${f.name} = ${f.toString()};`).join('\n') + `\nself.onmessage=e=>{try{const iterator=optimize(e.data);let step;do{step=iterator.next();if(!step.done)postMessage({progress:step.value});}while(!step.done);postMessage({result:step.value});}catch(error){postMessage({error:error.message});}};`;
                const blob = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
                try { worker = new Worker(blob); } catch (e) { URL.revokeObjectURL(blob); reject(new Error(`Berechnungs-Worker nicht verfügbar: ${e.message}`)); return; }
                URL.revokeObjectURL(blob);
                const finish = (error, result) => { worker?.terminate(); worker = null; cancelCalculation = null; error ? reject(error) : resolve(result); };
                cancelCalculation = () => finish(new Error('Berechnung durch geänderte Einstellungen abgebrochen.'));
                worker.onmessage = e => {
                    if (e.data.error) finish(new Error(e.data.error));
                    else if (e.data.result) finish(null, e.data.result);
                    else status(`Exakte Ganzzahloptimierung läuft … ${e.data.progress.visited.toLocaleString('de-DE')} geprüfte Bereiche. Noch keine Truppen gesendet.`);
                };
                worker.onerror = e => finish(new Error(e.message)); worker.postMessage(input);
            });
        }
        function display(result, input) {
            $('[data-result]').innerHTML = `<table><thead><tr><th>Raubzug</th><th>Truppen</th><th>Beute gesamt</th><th>Rohstoffe/Stunde</th><th>Rückkehr spätestens</th></tr></thead><tbody>${result.rows.map(r => {
                const o = input.options.find(o => o.id === r.id), m = metrics(r.counts.reduce((c, n, u) => c + n * input.units[u].carry, 0), o);
                return `<tr><td>${r.id}</td><td>${r.counts.map((n, u) => n ? `${n} ${NAMES[input.units[u].name]}` : '').filter(Boolean).join(', ')}</td><td>${m.loot.toLocaleString('de-DE', { maximumFractionDigits: 2 })}</td><td>${m.rate.toLocaleString('de-DE', { maximumFractionDigits: 2 })}</td><td>${formatTime(now() + Math.ceil(m.seconds) * 1000)}</td></tr>`;
            }).join('')}</tbody></table>`;
        }
        async function waitFor(test, timeout = 15000) {
            const end = Date.now() + timeout;
            while (Date.now() < end) { if (test()) return; if (stopped()) throw new Error('Aktivitätscheck / Pause: Aktionen angehalten.'); await new Promise(r => setTimeout(r, 150)); }
            throw new Error('Keine Bestätigung vom Spiel erhalten. Bestand vor einem erneuten Versuch aktualisieren.');
        }
        async function unlock(started) {
            if (!settings.unlock || stopped() || started !== revision) return false;
            function canUnlock(id) {
                const o = options()[id];
                if (!settings.unlock || !o?.is_locked || o.unlock_time) return false;
                const cost = o.base?.unlock_cost;
                const resources = screen().village.res || page.game_data.village;
                if (!cost || !['wood', 'stone', 'iron'].every(u => finite(Number(cost[u])) && Number(resources[u]) >= Number(cost[u]))) return false;
                const prerequisites = o.base?.prerequisite_option_ids || Object.keys(options()).filter(previousId => Number(previousId) < Number(id));
                return prerequisites.every(previousId => options()[previousId] && !options()[previousId].is_locked);
            }
            const dialogFor = id => document.getElementById(`popup_box_unlock-option-${id}`)?.querySelector('.scavenge-option-unlock-dialog');
            for (const id of Object.keys(options()).sort((a, b) => Number(a) - Number(b))) {
                if (!canUnlock(id)) continue;
                if (!dialogFor(id)) {
                    await actionDelay(started);
                    if (!canUnlock(id)) continue;
                    const button = optionElement(id)?.querySelector('.unlock-button, .unlock_button');
                    if (!button || button.disabled || button.classList.contains('btn-disabled') || !button.getClientRects().length) continue;
                    status(`Freischaltbestätigung für Raubzug ${id} öffnen …`);
                    button.click();
                    await waitFor(() => !!options()[id]?.unlock_time || !options()[id]?.is_locked || dialogFor(id));
                }
                if (options()[id]?.is_locked && !options()[id]?.unlock_time) {
                    await actionDelay(started);
                    // Re-read the exact option dialog after the delay. Never select
                    // generic confirmation buttons belonging to other popups.
                    const confirm = dialogFor(id)?.querySelector('a.btn.btn-default');
                    if (!canUnlock(id) || !confirm || confirm.disabled || confirm.classList.contains('btn-disabled') ||
                        confirm.classList.contains('btn-pp') || confirm.getAttribute('aria-disabled') === 'true' || !confirm.getClientRects().length)
                        throw new Error('Freischaltung ist nicht mehr möglich oder die Bestätigung wurde geschlossen.');
                    status(`Raubzug ${id} freischalten …`);
                    confirm.click();
                    await waitFor(() => !!options()[id]?.unlock_time || !options()[id]?.is_locked);
                }
                remember(true);
                return true;
            }
            return false;
        }
        async function send(row, input, started) {
            await actionDelay(started);
            const latest = currentInput(), counts = latest.units.map(u => row.counts[input.units.findIndex(x => x.name === u.name)] || 0);
            if (input.units.some((u, i) => row.counts[i] > 0 && !latest.units.some(x => x.name === u.name)))
                throw new Error('Ausgewählte Truppen sind nicht mehr verfügbar. Neu berechnen.');
            if (!validatePlan([{ id: row.id, counts }], latest)) throw new Error('Truppenbestand, Raubzugstatus oder Rückkehrgrenze hat sich geändert. Neu berechnen.');
            const root = document.getElementById('scavenge_screen');
            for (const u of Object.keys(screen().sendable_units)) {
                const field = root.querySelector(`input.unitsInput[name="${u}"], input[name="${u}"]`);
                if (!field) throw new Error(`Eingabefeld für ${u} fehlt.`);
                const i = input.units.findIndex(x => x.name === u);
                field.value = String(i < 0 ? 0 : row.counts[i]);
                if (page.$) page.$(field).trigger('input').trigger('change').trigger('keyup');
                else { field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); }
            }
            await actionDelay(started);
            const fresh = currentInput(), freshCounts = fresh.units.map(u => row.counts[input.units.findIndex(x => x.name === u.name)] || 0);
            if (input.units.some((u, i) => row.counts[i] > 0 && !fresh.units.some(x => x.name === u.name)) ||
                !validatePlan([{ id: row.id, counts: freshCounts }], fresh)) throw new Error('Abschicken angehalten: Bestand oder Rückkehrgrenze geändert.');
            // If native fields were edited while waiting, do not send a different squad.
            for (const u of Object.keys(screen().sendable_units)) {
                const field = root.querySelector(`input.unitsInput[name="${u}"], input[name="${u}"]`), i = input.units.findIndex(x => x.name === u);
                if (!field || Number(field.value) !== (i < 0 ? 0 : row.counts[i])) throw new Error('Truppenfelder wurden während der Verzögerung geändert. Neu berechnen.');
            }
            const button = optionElement(row.id)?.querySelector('.free_send_button');
            if (!button || button.disabled || button.classList.contains('btn-disabled') || !button.getClientRects().length)
                throw new Error('Das Spiel akzeptiert diese Gruppe nicht. Es wurden keine weiteren Raubzüge gestartet.');
            if (stopped() || started !== revision) throw new Error('Abschicken angehalten: Daten geändert.');
            status(`Raubzug ${row.id} abschicken …`); button.click();
            await waitFor(() => !!options()[row.id]?.scavenging_squad);
            remember(true);
        }
        function remember(newAction = false) {
            const previous = JSON.parse(localStorage.getItem(`${key}:schedule`) || 'null');
            // A freshly loaded server page supersedes older cached returns. Preserve
            // only actions another tab performed after this page was loaded.
            const returns = Object.fromEntries(Object.entries(previous?.updatedLocal > pageStarted ? previous.returns || {} : {}).filter(([, t]) => t > now()));
            Object.entries(options()).forEach(([id, o]) => { if (o.scavenging_squad?.return_time) returns[id] = Number(o.scavenging_squad.return_time) * 1000; });
            const times = [nextEvent(options(), now()), ...Object.values(returns)].filter(t => t !== null && t > now());
            const time = times.length ? Math.min(...times) : null;
            localStorage.setItem(`${key}:schedule`, JSON.stringify({ next: time, wakeAt: nextActionAt, returns, updated: now(), updatedLocal: newAction ? Date.now() : previous?.updatedLocal || 0 }));
            return time;
        }
        function schedule() {
            clearTimeout(timer); timer = null;
            nextActionAt = null;
            const time = remember();
            $('[data-next]').textContent = time ? `Nächste Rückkehr / Freischaltung: ${formatTime(time)}.` : 'Keine laufenden Raubzüge oder Freischaltungen.';
            updateSummary();
            if (!settings.auto) { participant?.publish(); return; }
            let deadline;
            try { deadline = parseTime(settings.deadline); } catch { participant?.publish(); return; }
            if (deadline !== null && deadline <= now()) { status('Rückkehrgrenze erreicht. Keine weiteren Starts; Zeitvorgabe bleibt gespeichert.'); return; }
            // A known return/unlock is the next useful check. Poll only if no event exists.
            const check = time === null ? now() + 60000 : time;
            const delay = Math.min(2147483647, Math.max(2000, check - now()));
            nextActionAt = Date.now() + delay;
            const saved = JSON.parse(localStorage.getItem(`${key}:schedule`) || '{}');
            localStorage.setItem(`${key}:schedule`, JSON.stringify({ ...saved, wakeAt: nextActionAt }));
            $('[data-next]').textContent += ` Nächster Raubzug-Check: ${formatTime(nextActionAt)} (Browserzeit Berlin; danach 1–4 Sekunden Wartezeit).`;
            updateSummary();
            participant?.publish();
            if (stopped()) return;
            timer = setTimeout(async () => {
                timer = null;
                if (!settings.auto || busy || stopped()) { schedule(); return; }
                const started = revision;
                try {
                    await actionDelay(started);
                    if (settings.auto && !busy) reloadAutomatically(); else schedule();
                } catch (e) {
                    if (started === revision) { status(e.message, true); schedule(); }
                }
            }, delay);
        }
        async function run(automatic = false) {
            if (busy || stopped() || (automatic && !settings.auto)) return;
            busy = true; $('[data-send]').disabled = true; clearTimeout(timer);
            nextActionAt = null;
            remember(); updateSummary();
            participant?.publish();
            const started = revision;
            try {
                const limit = parseTime(settings.deadline);
                if (limit !== null && limit <= now()) throw new Error('Rückkehrgrenze erreicht. Zeitvorgabe manuell ändern oder entfernen.');
                const task = async () => {
                    if (stopped()) throw new Error('Aktivitätscheck / Pause: Aktionen angehalten.');
                    const deadline = parseTime(settings.deadline);
                    if (deadline !== null && deadline <= now()) throw new Error('Rückkehrgrenze erreicht. Zeitvorgabe manuell ändern oder entfernen.');
                    await unlock(started);
                    const input = currentInput();
                    if (!input.options.length || !input.units.length) { status('Keine freien Raubzüge oder ausgewählten Truppen verfügbar.'); return; }
                    status('Exakte Ganzzahloptimierung läuft …');
                    const result = await calculate(input);
                    if (started !== revision || stopped() || (automatic && !settings.auto)) return;
                    display(result, input);
                    if (!result.rows.length) { status('Keine zulässige Gruppe innerhalb der Mindestmenge und Rückkehrgrenze.'); return; }
                    for (const row of result.rows) await send(row, input, started);
                    status(`${result.rows.length} Raubzüge bestätigt. Berechneter Gesamtertrag: ${result.rate.toLocaleString('de-DE', { maximumFractionDigits: 2 })} Rohstoffe/Stunde.`);
                };
                if (!navigator.locks?.request) throw new Error('Browser unterstützt keine Tab-Sperre. Abschicken ist zur Vermeidung doppelter Starts gesperrt.');
                await navigator.locks.request(key, { ifAvailable: true }, async lock => {
                    if (!lock) { status('Ein anderer Tab verarbeitet dieses Dorf.'); return; }
                    const saved = JSON.parse(localStorage.getItem(`${key}:schedule`) || 'null');
                    if (saved?.returns && Object.entries(saved.returns).some(([id, t]) => t > now() && !options()[id]?.scavenging_squad)) {
                        status('Ein anderer Tab hat Raubzüge gestartet. Seite wird aktualisiert.');
                        await actionDelay(started); reloadAutomatically(); return;
                    }
                    await task();
                });
            } catch (e) { status(e.message, true); }
            finally {
                busy = false; updateAuto();
                if (!stopped() && resumePending && settings.auto) {
                    resumePending = false; void run(true);
                } else {
                    if (!stopped()) completedAt = Date.now();
                    schedule();
                }
            }
        }
        function change() {
            revision++; cancelCalculation?.();
            settings.selected = [...panel.querySelectorAll('[data-unit]:checked')].map(e => e.dataset.unit);
            settings.deadline = $('[data-deadline]').value; settings.unlock = $('[data-unlock]').checked;
            try { save(); parseTime(settings.deadline); status('Einstellungen gespeichert.'); } catch (e) { status(e.message, true); }
            schedule();
        }
        panel.querySelectorAll('input').forEach(e => e.addEventListener('input', change));
        $('[data-send]').addEventListener('click', () => void run());
        function setAuto(enabled) {
            settings.auto = enabled; revision++; cancelCalculation?.();
            try { save(); updateAuto(); if (settings.auto) void run(true); else { status('Automatik ausgeschaltet.'); schedule(); } }
            catch (e) { settings.auto = false; updateAuto(); status(e.message, true); }
        }
        $('[data-auto]').addEventListener('click', () => { if (!stopped()) setAuto(!settings.auto); });
        dsControl.onChange(state => {
            revision++; cancelCalculation?.(); clearTimeout(timer); timer = null;
            updateAuto();
            if (state.status === 'pause') { status(''); participant?.publish(); }
            else {
                resumePending = settings.auto;
                if (!busy && resumePending) { resumePending = false; void run(true); }
                else schedule();
            }
        });
        window.addEventListener('storage', async e => {
            if (e.key !== key) return;
            revision++; cancelCalculation?.();
            const started = revision;
            try {
                const incoming = JSON.parse(e.newValue);
                if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.selected)) throw new Error('Ungültige Einstellungen aus anderem Tab.');
                settings = incoming;
                await actionDelay(started); reloadAutomatically();
            } catch {
                if (started !== revision) return;
                if (settings) { settings.auto = false; updateAuto(); }
                status('Aktualisieren durch Pause oder geänderte Einstellungen angehalten.', true);
            }
        });
        window.addEventListener('pagehide', () => { revision++; cancelCalculation?.(); clearTimeout(timer); });
        updateAuto(); schedule();
        participant = dsControl.registerScript('raubzug-helfer', {
            version: '1.4.1', state: () => ({ auto: settings.auto, busy, nextAt: nextActionAt, completedAt,
                status: $('[data-status]').textContent }), setAuto
        });
        if (settings.auto) void run(true);
    }
})();
