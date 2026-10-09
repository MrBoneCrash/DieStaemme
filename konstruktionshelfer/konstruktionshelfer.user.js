// ==UserScript==
// @name         Die Stämme – Konstruktionshelfer
// @namespace    local.die-staemme.konstruktionshelfer
// @version      1.4.0
// @description  Lädt Bauvorlagen und reiht Ausbauten manuell oder automatisch mit Rohstoff-, Bauernhof- und Warteschlangenprüfung ein. Nutzung auf eigene Gefahr.
// @match        https://*.die-staemme.de/game.php?*screen=main*
// @exclude      /^[^?]+\?(?!(?=(?:[^#]*&)?screen=main(?:&|#|$))(?!(?:[^#]*&)?(?:try|action|ajax|ajaxaction)(?:=|&|#|$))(?!(?:[^#]*&)?mode=(?!(?:build)?(?:&|#|$))[^&#]*(?:&|#|$)))/
// @exclude      /^[^?]+\?(?:[^#]*&)?(screen|mode)=[^#]*&\1=/
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==

// Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.
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
        const listeners = new Set(), requests = new Set();
        const tab = `${now()}-${Math.random().toString(36).slice(2)}`;
        let channel, channelKey, lastStatus = 'running', generation = 0, memory = null;
        const data = () => (typeof unsafeWindow !== 'undefined' ? unsafeWindow : win).game_data;
        const page = () => typeof unsafeWindow !== 'undefined' ? unsafeWindow : win;
        const key = () => {
            const gd = data();
            return gd?.world && gd?.player?.id ? `ds-control:v1:${win.location?.host || env.host}:${gd.world}:${gd.player.id}` : null;
        };
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
        });
        win.addEventListener?.('pagehide', () => {
            try { if (key()) storage.removeItem(`${key()}:check:${tab}`); } catch { /* Optional. */ }
            channel?.close();
            for (const request of requests) request.abort();
        });
        connect(); changed();
        return { inspect, paused, assert, resume, state: read, fetch: request,
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
        win: window, doc: document, storage: localStorage, host: location.host, setInterval }, 'konstruktionshelfer');

    const ID = 'ds-konstruktionshelfer';
    // IDs anhand des Exportcodes und der zugehörigen Vorlagenliste verifiziert.
    // Unbekannte IDs werden abgelehnt, damit keine falschen Gebäude gebaut werden.
    const IDS = { 0: 'main', 1: 'barracks', 2: 'stable', 3: 'garage', 7: 'snob',
        8: 'smith', 9: 'place', 11: 'market', 12: 'wood', 13: 'stone', 14: 'iron',
        15: 'farm', 16: 'storage', 18: 'wall' };
    const NAMES = { main: 'Hauptgebäude', barracks: 'Kaserne', stable: 'Stall', garage: 'Werkstatt',
        snob: 'Adelshof', smith: 'Schmiede', place: 'Versammlungsplatz', market: 'Marktplatz',
        wood: 'Holzfällerlager', stone: 'Lehmgrube', iron: 'Eisenmine', farm: 'Bauernhof',
        storage: 'Speicher', hide: 'Versteck', wall: 'Wall' };
    const RES = ['wood', 'stone', 'iron'];
    const RN = { wood: 'Holz', stone: 'Lehm', iron: 'Eisen' };
    const escape = v => String(v).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    function number(v) {
        if (v === null || v === undefined || v === '' || typeof v === 'boolean') return NaN;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : NaN;
    }
    function decodeTemplate(code) {
        const clean = String(code).replace(/\s/g, '');
        if (!clean || clean.length > 40000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 === 1)
            throw new Error('Ungültiger Konstruktionsmanager-Exportcode.');
        let bytes;
        try { bytes = Uint8Array.from(atob(clean), c => c.charCodeAt(0)); }
        catch { throw new Error('Exportcode ist kein gültiges Base64.'); }
        const size = bytes[0] | (bytes[1] << 8), end = 2 + size;
        const delimiter = [244, 128, 128, 128];
        const atDelimiter = i => delimiter.every((v, j) => bytes[i + j] === v);
        if (!size || size % 2 || end + 10 > bytes.length || !atDelimiter(end + 2))
            throw new Error('Unbekanntes oder unvollständiges Vorlagenformat.');
        let nameEnd = end + 6;
        while (nameEnd < bytes.length && !atDelimiter(nameEnd)) nameEnd++;
        if (nameEnd >= bytes.length || !/^\d+$/.test(new TextDecoder().decode(bytes.slice(nameEnd + 4))))
            throw new Error('Vorlagenabschluss ist ungültig.');
        const levels = {}, steps = [];
        for (let i = 2; i < end; i += 2) {
            const building = IDS[bytes[i]], delta = bytes[i + 1];
            if (!building) throw new Error(`Gebäude-ID ${bytes[i]} wird noch nicht unterstützt.`);
            if (!delta || delta > 30) throw new Error('Abriss oder ungültige Stufenänderung wird nicht unterstützt.');
            levels[building] = (levels[building] || 0) + delta;
            steps.push({ building, level: levels[building] });
        }
        return { name: new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(end + 6, nameEnd)), steps };
    }
    function suggest(template, state) {
        const { buildings, village, premium, count } = state;
        if (!Number.isInteger(count) || count < 0 || typeof premium !== 'boolean')
            throw new Error('Premiumstatus oder Anzahl der Bauaufträge ist unbekannt. Seite neu laden.');
        const levels = {};
        for (const step of template.steps) {
            const b = buildings[step.building];
            // level_next enthält bereits alle eingereihten Ausbauten dieses Gebäudes.
            const current = number(village.buildings?.[step.building]);
            levels[step.building] = b ? number(b.level_next) - 1 : current;
            if (!Number.isInteger(levels[step.building]) || levels[step.building] < 0)
                throw new Error(`Gebäudestufe für ${NAMES[step.building]} fehlt.`);
        }
        const index = template.steps.findIndex(s => levels[s.building] < s.level);
        if (index < 0) return { done: true, reasons: [], count, premium };
        const step = template.steps[index], original = buildings[step.building];
        const reasons = [];
        let building = step.building, farm = false;
        if (!original) reasons.push('Gebäude ist in der Bauansicht noch nicht verfügbar. Voraussetzungen prüfen.');
        const pop = number(village.pop), max = number(village.pop_max), required = number(original?.pop);
        if (original && ![pop, max, required].every(Number.isFinite))
            reasons.push('Bevölkerungsdaten fehlen. Seite neu laden.');
        else if (original && building !== 'farm' && required > max - pop) {
            building = 'farm'; farm = true;
        }
        const b = buildings[building];
        if (count >= (premium ? 5 : 2)) reasons.push(`Warteschlange voll (${premium ? 5 : 2} Bauaufträge).`);
        if (state.confirmQueue) reasons.push('Das Spiel meldet Extrakosten für die Bauschleife. Dieser Bau wird nicht eingereiht.');
        if (!b) reasons.push(`${NAMES[building]} kann derzeit nicht ausgebaut werden.`);
        else {
            if (!(b.can_build === true || b.can_build === 1)) reasons.push('Bauvoraussetzungen nicht erfüllt.');
            if (!(number(b.level_next) <= number(b.max_level))) reasons.push('Maximale Gebäudestufe erreicht oder unbekannt.');
            if (farm && number(b.level_next) > number(b.level) + 1)
                reasons.push('Ein Bauernhof-Ausbau ist bereits eingereiht. Seine Fertigstellung abwarten.');
            if (number(b.pop) > max - pop) reasons.push('Auch für diesen Bau fehlt Bauernhofplatz.');
            for (const r of RES) {
                const stock = number(village[r]), base = number(b[r]);
                const extra = Object.hasOwn(b, `${r}_queue_factor`) ? number(b[`${r}_queue_factor`]) : base;
                const cost = Math.max(base, extra);
                if (extra > base) reasons.push(`${RN[r]}: Extrakosten für die Bauschleife. Dieser Bau wird nicht eingereiht.`);
                if (![stock, cost].every(Number.isFinite)) reasons.push(`${RN[r]}-Daten fehlen.`);
                else if (stock < cost) reasons.push(`${RN[r]}: ${Math.ceil(cost - stock).toLocaleString('de-DE')} fehlen.`);
            }
        }
        return { building, level: number(b?.level_next), index, step, farm, reasons, count, premium,
            costs: Object.fromEntries(RES.map(r => [r, Math.max(number(b?.[r]),
                Object.hasOwn(b || {}, `${r}_queue_factor`) ? number(b[`${r}_queue_factor`]) : number(b?.[r]))])) };
    }
    function fitsReward(reward, village) {
        const max = number(village.storage_max);
        return Number.isFinite(max) && RES.every(r => Number.isFinite(number(reward[r])) &&
            Number.isFinite(number(village[r])) && number(village[r]) + number(reward[r]) <= max);
    }
    function randomDelay(random = Math.random) { return 1000 + Math.floor(random() * 3001); }
    function createQuestController({ popup, finishButton, complete, close, open, rewardsTab,
        finishedQuests = () => [], selectFinished = async () => null,
        rewards, claim, fits, insufficient, delay, checked = false, saveChecked = () => {} }) {
        let job = null, ownPopup = false;
        const seen = new WeakSet(), observed = new WeakSet();
        function mark(value) { checked = value; saveChecked(value); }
        function locked(fn) {
            if (job) return job;
            // Start im Microtask, damit job auch bei synchronen Hooks bereits gesetzt ist.
            job = Promise.resolve().then(fn).finally(() => { job = null; });
            return job;
        }
        async function finishPopup() {
            const p = popup(), button = p && finishButton(p);
            if (!p || ownPopup) return;
            // Manuelles Öffnen erlaubt einen neuen Belohnungscheck, auch ohne fertige Quest.
            // Eigene Belohnungsfenster dürfen ihre Sitzungssperre nicht selbst zurücksetzen.
            if (!observed.has(p)) { observed.add(p); mark(false); }
            if (!button || seen.has(p)) return;
            seen.add(p);
            await delay();
            if (popup() !== p || finishButton(p) !== button) return;
            await complete(button);
            // Die native Abschließen-Funktion schließt das Dialogfenster oft bereits selbst.
            if (popup() === p) { await delay(); if (popup() === p) await close(p); }
        }
        return {
            handlePopup() { return locked(finishPopup); },
            needsPopup() {
                const p = popup();
                return !!p && !job && !ownPopup && (!observed.has(p) || (!seen.has(p) && !!finishButton(p)));
            },
            checkRewards() {
                return locked(async () => {
                    await finishPopup();
                    if (checked || !insufficient() || popup()) return;
                    mark(true); ownPopup = true;
                    let opened = null;
                    try {
                        await delay();
                        if (!insufficient() || popup()) return;
                        opened = await open();
                        if (!opened) return;
                        const submitted = new Set();
                        // Erst alle fertigen Aufgaben abgeben. Die native Funktion schließt
                        // dabei das Fenster; nach bestätigter Abgabe gegebenenfalls neu öffnen.
                        while (popup() === opened) {
                            const quest = finishedQuests(opened).find(q => !submitted.has(q.id));
                            if (!quest) break;
                            submitted.add(quest.id);
                            await delay();
                            if (popup() !== opened) return;
                            const button = await selectFinished(opened, quest);
                            if (!button) throw new Error('Fertige Aufgabe konnte nicht ausgewählt werden.');
                            await delay();
                            if (popup() !== opened || finishButton(opened) !== button) return;
                            if (await complete(button) === false) throw new Error('Quest-Abgabe wurde nicht bestätigt.');
                            if (!popup()) { await delay(); opened = await open(); }
                            else opened = popup();
                            if (!opened) return;
                        }
                        await delay();
                        if (popup() !== opened) return;
                        await rewardsTab(opened);
                        const attempted = new Set();
                        // Belohnungen einzeln abholen; kein Sammelknopf mit möglichem Überlauf.
                        while (popup() === opened) {
                            const reward = rewards(opened).find(r => !attempted.has(r.id) && fits(r));
                            if (!reward) break;
                            attempted.add(reward.id);
                            await delay();
                            if (popup() !== opened) break;
                            const current = rewards(opened).find(r => r.id === reward.id);
                            if (!current || !fits(current)) continue;
                            if (!await claim(current)) break;
                        }
                    } finally {
                        try {
                            if (opened && popup() === opened) { await delay(); if (popup() === opened) await close(opened); }
                        } finally { ownPopup = false; }
                    }
                });
            },
            get busy() { return job !== null; }
        };
    }
    function createAutoController({ proposal, submit, completion, prepare = async () => {}, now = Date.now,
        later = setTimeout, cancel = clearTimeout, onSchedule = () => {}, onError = () => {} }) {
        let enabled = false, running = false, timer = null, lastCount = null, revision = 0;
        function schedule(delay) {
            if (timer !== null) cancel(timer);
            timer = null;
            if (!enabled) return;
            delay = Math.min(2147483647, Math.max(2000, delay));
            onSchedule(now() + delay);
            timer = later(() => { timer = null; void run(); }, delay);
        }
        async function run() {
            if (!enabled || running) return;
            if (timer !== null) cancel(timer);
            timer = null; running = true;
            const started = revision;
            try {
                // Höchstens fünf bestätigte Aufträge pro Prüflauf. Jede Antwort neu prüfen.
                for (let i = 0; enabled && started === revision && i < 5; i++) {
                    await prepare();
                    if (!enabled || started !== revision) break;
                    const p = proposal();
                    if (p) lastCount = p.count;
                    if (!p || p.done || p.blocked || p.reasons.length) break;
                    if (!await submit(p)) break;
                    if (!enabled || started !== revision) break;
                    const updated = proposal();
                    if (updated) lastCount = updated.count;
                }
            } catch (e) { onError(e); }
            finally {
                running = false;
                if (enabled) {
                    // Eine zwischenzeitliche Pause beendet den alten Lauf vollständig.
                    if (started !== revision) { void run(); return; }
                    let end = NaN;
                    try { end = completion(); } catch (e) { onError(e); }
                    schedule(Number.isFinite(end) && end > now() ? end - now() + 2000 : 30000);
                }
            }
        }
        return {
            setEnabled(value) {
                if (enabled !== value) revision++;
                enabled = value;
                if (timer !== null) cancel(timer);
                timer = null;
                if (enabled) void run();
                else onSchedule(null);
            },
            queueChanged(count) {
                const shorter = Number.isInteger(count) && lastCount !== null && count < lastCount;
                if (Number.isInteger(count)) lastCount = count;
                // Eigene Ergänzungen und DOM-Änderungen der Anzeige lösen keinen Prüflauf aus.
                if (shorter && enabled && !running) schedule(2000);
            },
            run,
            get enabled() { return enabled; }
        };
    }
    if (typeof module === 'object' && module.exports) { module.exports = { decodeTemplate, suggest,
        createAutoController, createQuestController, fitsReward, randomDelay }; return; }
    function initialize() {
        const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
        const params = new URLSearchParams(location.search);
        if (window.top !== window.self || params.getAll('screen').length !== 1 || params.get('screen') !== 'main' ||
            params.getAll('mode').length > 1 || !['', 'build'].includes(params.get('mode') || '') ||
            ['action', 'try', 'ajax', 'ajaxaction'].some(k => params.has(k))) return true;
        if (document.getElementById(ID)) return true;
        const gd = page.game_data;
        // Nach einem Reload können die Spieldaten erst nach document-idle bereitstehen.
        if (!gd?.player?.id || !gd?.village?.id || !page.BuildingMain?.buildings) return false;
        if (Number(page.BuildingMain.mode) !== 0) return true;
        const key = `${ID}:v1:${location.host}:${gd.world}:${gd.player.id}`;
        const villageId = Number(gd.village.id);
        const autoKey = `${key}:auto:${villageId}`;
        const farmKey = `${autoKey}:farm-level`;
        let lastFarm = Number(page.BuildingMain?.buildings?.farm?.level ?? gd.village.buildings?.farm), farmCompletedAt = 0;
        try {
            const saved = localStorage.getItem(farmKey);
            if (saved !== null && Number.isFinite(Number(saved))) lastFarm = Number(saved);
        } catch { /* Event state is optional; hourly checks remain available. */ }
        function constructionState() {
            const village = page.game_data?.village, farm = Number(page.BuildingMain?.buildings?.farm?.level ?? village?.buildings?.farm);
            const population = (id, fallback) => {
                const text = document.getElementById(id)?.textContent?.replace(/[.\s\u00a0]/g, '');
                return /^\d+$/.test(text || '') ? Number(text) : fallback;
            };
            if (Number.isFinite(farm)) {
                if (Number.isFinite(lastFarm) && farm > lastFarm) {
                    farmCompletedAt = Date.now();
                    page.DSControlCenter?.farmCompleted?.(villageId);
                }
                lastFarm = farm;
                try { localStorage.setItem(farmKey, String(farm)); } catch { /* optional */ }
            }
            return { steps: template && $('[data-code]').value.trim() === loadedCode ? template.steps : null,
                buildings: Object.fromEntries(Object.entries(page.BuildingMain?.buildings || {}).map(([id, b]) =>
                    [id, { level_next: b.level_next, pop: b.pop, pop_factor: b.pop_factor }])),
                village: { pop: population('pop_current_label', village?.pop), pop_max: population('pop_max_label', village?.pop_max) }, farmLevel: farm, farmCompletedAt };
        }
        let template = null, loadedCode = '', displayed = null, busy = false, participant = null, autoNext = null;
        const root = document.createElement('section'); root.id = ID;
        root.innerHTML = `<style>
            #${ID}{--ink:#382819;--muted:#82694d;color:var(--ink);font:13px/1.5 Verdana,Arial,sans-serif;
                background:linear-gradient(110deg,#f8efd7,#eee0bf);border:1px solid #987345;border-radius:8px;
                margin:14px 0;box-shadow:0 3px 12px #45260818;overflow:hidden}
            #${ID} *{box-sizing:border-box} #${ID} summary{padding:12px 16px;cursor:pointer;font-weight:700;color:#654728}
            #${ID} .ds-body{padding:0 16px 16px} #${ID} label{display:block;font-size:12px;font-weight:700}
            #${ID} textarea{width:100%;margin:6px 0;padding:7px 9px;font:12px/1.4 Verdana,Arial,sans-serif;
                color:var(--ink);background:#fffaf0;border:1px solid #baa079;border-radius:5px;resize:vertical}
            #${ID} .ds-hint{color:var(--muted);font-size:11px} #${ID} .ds-actions{display:flex;gap:8px;flex-wrap:wrap;margin:9px 0}
            #${ID} button{padding:7px 11px;min-height:34px;border:1px solid #ad8a59;border-radius:5px;
                background:linear-gradient(#faf1d9,#e4cda1);color:#5b3a1c;font:700 11px/1.4 Verdana,Arial,sans-serif;cursor:pointer}
            #${ID} button.ds-primary{background:linear-gradient(#8f572f,#70401f);border-color:#643516;color:#fff5dc}
            #${ID} button[data-auto]{background:#a33d32;border-color:#7e2e26;color:#fff}
            #${ID} button[data-auto][aria-pressed=true]{background:#397c3b;border-color:#285b2a}
            #${ID} button:disabled{opacity:.45;cursor:default} #${ID} :is(button,textarea,summary):focus-visible{outline:2px solid #93602b;outline-offset:3px}
            #${ID} [data-status],#${ID} [data-result]{margin-top:9px;padding:9px;background:#f9f1df;border:1px solid #d4c19e;border-radius:5px}
            #${ID} [data-status][data-tone=error]{background:#fbede1;border-color:#c7977d;color:#953d28}
            #${ID} ol{padding-left:24px;max-height:210px;overflow:auto}
        </style><details><summary>Konstruktionshelfer <span data-progress>0 / 0</span></summary><div class="ds-body">
            <p class="ds-hint">Vorlage laden und einen Ausbau einreihen oder die Automatik einschalten.</p>
            <label>Vorlagencode<textarea data-code rows="3" spellcheck="false" placeholder="Exportcode einfügen"></textarea></label>
            <div class="ds-actions"><button type="button" data-load>Vorlage laden</button><button type="button" data-refresh>Vorschlag aktualisieren</button></div>
            <div data-info class="ds-hint"></div><div data-result aria-live="polite">Noch keine Vorlage geladen.</div>
            <div class="ds-actions"><button type="button" class="ds-primary" data-build disabled>In Warteschlange einreihen</button>
                <button type="button" data-auto aria-pressed="false">Automatisch einreihen: Aus</button></div>
            <div data-auto-info class="ds-hint">Automatik ausgeschaltet.</div>
            <div data-status role="status">Bereit.</div><details><summary>Baufolge</summary><ol data-steps></ol></details>
            <p class="ds-hint">Nutzung auf eigene Gefahr. Vor jedem Bau den Vorschlag prüfen.</p>
        </div></details>`;
        function mount() {
            if (root.isConnected) return false;
            const route = new URLSearchParams(location.search);
            if (route.get('screen') !== 'main' || !['', 'build'].includes(route.get('mode') || '') ||
                ['action', 'try', 'ajax', 'ajaxaction'].some(k => route.has(k)) ||
                (page.game_data?.screen && page.game_data.screen !== 'main') || Number(page.BuildingMain?.mode) !== 0) return false;
            const target = document.getElementById('content_value') || document.getElementById('building_wrapper')?.parentElement;
            if (!target?.isConnected) return false;
            // Dasselbe Element wieder einsetzen: Eingaben, aufklappbare Bereiche und Listener bleiben erhalten.
            target.prepend(root);
            return true;
        }
        mount();
        const $ = s => root.querySelector(s);
        function status(message, error = false) {
            const paused = dsControl.state().status === 'pause';
            $('[data-status]').textContent = paused ? 'Kontrollzentrum: Skripte pausiert. Freigabe erfolgt im Kontrollzentrum.' : message;
            $('[data-status]').dataset.tone = paused ? '' : error ? 'error' : '';
            participant?.publish();
        }
        function readState() {
            dsControl.assert();
            const data = page.game_data, bm = page.BuildingMain;
            const route = new URLSearchParams(location.search);
            if (!root.isConnected || Number(data?.village?.id) !== villageId || Number(bm?.mode) !== 0 ||
                route.get('screen') !== 'main' || !['', 'build'].includes(route.get('mode') || '') ||
                ['action', 'try', 'ajax', 'ajaxaction'].some(k => route.has(k)) ||
                (data.screen && data.screen !== 'main'))
                throw new Error('Dorf oder Bauansicht geändert. Seite neu laden.');
            const feature = data.features?.Premium?.active;
            const premium = typeof feature === 'boolean' ? feature : page.premium;
            return { buildings: bm.buildings, village: data.village, premium,
                count: Number(bm.order_count), pending: bm.pending, confirmQueue: bm.confirm_queue };
        }
        function signature(p) { return JSON.stringify([p.building, p.level, p.index, p.count, p.premium, p.costs]); }
        function refresh() {
            $('[data-build]').disabled = true;
            const paused = dsControl.paused();
            $('[data-auto]').disabled = paused;
            if (paused) { displayed = null; status(''); return; }
            try {
                const state = readState();
                const limit = state.premium ? 5 : 2;
                $('[data-info]').textContent = `Premium: ${state.premium === true ? 'aktiv' : state.premium === false ? 'inaktiv' : 'unbekannt'} · Warteschlange: ${state.count} belegt · ${Math.max(0, limit - state.count)} von ${limit} Plätzen frei · keine Extrakosten`;
                if (!template) return;
                const p = suggest(template, state); displayed = p;
                const fulfilled = template.steps.filter(s => {
                    const b = state.buildings[s.building];
                    return (b ? number(b.level_next) - 1 : number(state.village.buildings?.[s.building])) >= s.level;
                }).length;
                $('[data-progress]').textContent = `${fulfilled} / ${template.steps.length}`;
                const name = NAMES[p.building] || p.building;
                $('[data-result]').innerHTML = p.done ? `<strong>${escape(template.name || 'Vorlage')}: abgeschlossen.</strong>` :
                    `<strong>${escape(template.name || 'Vorlage')} · Schritt ${p.index + 1}/${template.steps.length}: ${escape(name)} → Stufe ${p.level}</strong>
                    ${p.farm ? `<p>Bauernhofplatz reicht für ${escape(NAMES[p.step.building])} nicht. Bauernhof wird vorgezogen.</p>` : ''}
                    <p>${RES.map(r => `${RN[r]}: ${Number.isFinite(p.costs[r]) ? p.costs[r].toLocaleString('de-DE') : '?'}`).join(' · ')}</p>
                    <div>${p.reasons.length ? p.reasons.map(escape).join('<br>') : 'Rohstoffe, Bauernhofplatz und Warteschlange geprüft.'}</div>`;
                $('[data-build]').textContent = p.done ? 'Vorlage abgeschlossen' : `${name} einreihen`;
                $('[data-build]').disabled = busy || quests.busy || !!questPopup() || !!state.pending || p.done || p.reasons.length > 0 || $('[data-code]').value.trim() !== loadedCode;
            } catch (e) { displayed = null; status(e.message, true); }
        }
        function load(code, save) {
            const parsed = decodeTemplate(code); template = parsed; loadedCode = code.trim();
            $('[data-steps]').innerHTML = parsed.steps.map(s => `<li>${escape(NAMES[s.building])} → Stufe ${s.level}</li>`).join('');
            refresh(); status(`${parsed.steps.length} Bauschritte geladen.`);
            if (save) {
                try { localStorage.setItem(key, loadedCode); }
                catch { status('Vorlage geladen; lokaler Speicher ist nicht verfügbar.', true); }
            }
        }
        $('[data-load]').addEventListener('click', () => {
            try { load($('[data-code]').value, true); }
            catch (e) { template = null; displayed = null; $('[data-progress]').textContent = '0 / 0'; $('[data-result]').textContent = 'Keine gültige Vorlage geladen.'; $('[data-steps]').replaceChildren(); refresh(); status(e.message, true); }
        });
        $('[data-code]').addEventListener('input', refresh);
        $('[data-refresh]').addEventListener('click', () => { refresh(); if (auto.enabled) void auto.run(); });
        const actionDelay = async () => {
            const token = dsControl.token();
            await new Promise(resolve => setTimeout(resolve, randomDelay()));
            dsControl.assert(token);
        };
        async function enqueue(p, automatic = false) {
            if (busy || page.BuildingMain.pending) return false;
            busy = true; $('[data-build]').disabled = true;
            participant?.publish();
            try {
                const token = dsControl.token();
                await actionDelay();
                await quests.handlePopup();
                dsControl.assert(token);
                if (automatic && !auto.enabled) return false;
                const before = readState();
                if (questPopup() || $('[data-code]').value.trim() !== loadedCode || !template || before.pending) return false;
                const current = suggest(template, before);
                if (current.done || current.reasons.length || signature(p) !== signature(current)) return false;
                const previousLevel = number(before.buildings[p.building]?.level_next);
                dsControl.assert(token);
                page.BuildingMain.build(p.building);
                status(`${NAMES[p.building]} an das Spiel übergeben.`);
                // Nur die Antwort dieses Auftrags abwarten; keine neuen Bauversuche während pending.
                for (let i = 0; i < 80; i++) {
                    await new Promise(resolve => setTimeout(resolve, 250));
                    dsControl.assert(token);
                    const state = readState();
                    if (!state.pending) {
                        if (number(state.buildings[p.building]?.level_next) > previousLevel) {
                            status(`${NAMES[p.building]} wurde eingereiht.`);
                            return true;
                        }
                        status('Kein bestätigter Ausbau. Spielmeldung prüfen; nächste Prüfung erfolgt später.', true);
                        return false;
                    }
                }
                status('Spielantwort ausstehend. Es wird kein weiterer Auftrag übergeben.', true);
                return false;
            } catch (e) { status(`Bau konnte nicht übergeben werden: ${e.message}`, true); return false; }
            finally { busy = false; refresh(); participant?.publish(); }
        }
        $('[data-build]').addEventListener('click', async () => {
            if (dsControl.paused() || busy || !template || !displayed || $('[data-code]').value.trim() !== loadedCode) return;
            const previous = displayed;
            page.BuildingMain.updateBuildableState(); refresh();
            if (!displayed || displayed.done || displayed.reasons.length || $('[data-build]').disabled) return;
            if (signature(previous) !== signature(displayed)) { status('Vorschlag hat sich geändert. Neuen Vorschlag prüfen und erneut klicken.'); return; }
            await enqueue(displayed);
        });
        function serverNow() {
            try {
                const value = page.Timing?.getCurrentServerTime?.();
                if (value instanceof Date) return value.getTime();
                const t = Number(value);
                if (Number.isFinite(t) && t > 0) return t > 1e12 ? t : t * 1000;
            } catch { /* Lokale Uhr als Fallback. */ }
            return Date.now();
        }
        function questPopup() {
            const p = document.getElementById('popup_box_quest');
            return p?.isConnected ? p : null;
        }
        function visible(element) {
            return !!element?.isConnected && !element.hasAttribute('disabled') &&
                !element.classList.contains('hidden') && element.getClientRects().length > 0;
        }
        async function waitFor(predicate) {
            const token = dsControl.token();
            for (let i = 0; i < 40; i++) {
                dsControl.assert(token);
                const result = predicate();
                if (result) return result;
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            return null;
        }
        function resourceShortage() {
            if (!template || $('[data-code]').value.trim() !== loadedCode) return false;
            try {
                const state = readState(), p = suggest(template, state);
                return !p.done && RES.some(r => Number.isFinite(p.costs[r]) && number(state.village[r]) < p.costs[r]);
            } catch { return false; }
        }
        function rewardRows(p) {
            return [...p.querySelectorAll('#reward-system-rewards .reward-system-claim-button')]
                .filter(visible).map(button => {
                    const row = button.closest('tr'), reward = {};
                    for (const r of RES) {
                        const text = row.querySelector(`.icon.header.${r}`)?.parentElement.textContent.trim().replace(/\./g, '');
                        reward[r] = /^\d+$/.test(text || '') ? Number(text) : NaN;
                    }
                    return { id: button.getAttribute('data-reward-id'), reward, button };
                });
        }
        const rewardCheckKey = `${autoKey}:rewards-checked`;
        let rewardChecked = false;
        try { rewardChecked = sessionStorage.getItem(rewardCheckKey) === 'true'; } catch { /* Speicher optional. */ }
        const quests = createQuestController({
            checked: rewardChecked,
            saveChecked(value) { try { sessionStorage.setItem(rewardCheckKey, String(value)); } catch { /* Speicher optional. */ } },
            popup: questPopup,
            finishButton: p => [...p.querySelectorAll('.active-tab .quest-complete-btn')].find(visible),
            finishedQuests: p => [...p.querySelectorAll('.quest-state-finished .quest-link')]
                .map(link => ({ id: link.getAttribute('data-quest-id'), link })),
            async selectFinished(p, quest) {
                const { link } = quest;
                const tab = link.closest('.tab');
                if (tab && !tab.classList.contains('active-tab')) {
                    const nav = [...p.querySelectorAll('.tab-link')].find(n => n.getAttribute('data-tab') === tab.id);
                    if (!visible(nav)) return null;
                    dsControl.click(nav); await actionDelay();
                }
                if (!visible(link)) {
                    const header = link.parentElement.parentElement.previousElementSibling;
                    if (!visible(header) || !header.classList.contains('questline-header')) return null;
                    dsControl.click(header); await actionDelay();
                }
                if (!visible(link) || questPopup() !== p) return null;
                dsControl.click(link);
                return waitFor(() => [...p.querySelectorAll('.active-tab .quest-complete-btn')].find(visible));
            },
            async complete(button) {
                status('Questpopup: Aufgabe abschließen. Bauen pausiert.');
                const id = page.Questlines?._getSelectedQuestId?.();
                dsControl.click(button);
                if (id != null && page.Quests?.hasQuest)
                    return !!await waitFor(() => !page.Quests.hasQuest(id));
                return !!await waitFor(() => !button.isConnected || !questPopup());
            },
            async close(p) {
                const button = p.querySelector('.popup_box_close');
                if (visible(button)) { dsControl.click(button); await waitFor(() => questPopup() !== p); }
            },
            async open() {
                const button = document.getElementById('new_quest');
                if (!visible(button)) return null;
                status('Rohstoffe fehlen: Questbelohnungen prüfen.'); dsControl.click(button);
                return waitFor(() => {
                    const p = questPopup();
                    return p?.querySelector('#reward-system-rewards') ? p : null;
                });
            },
            async rewardsTab(p) {
                const button = p.querySelector('.tab-link[data-tab="reward-tab"]');
                if (!visible(button)) throw new Error('Belohnungs-Tab nicht verfügbar.');
                dsControl.click(button);
                await waitFor(() => p.querySelector('#reward-tab.active-tab'));
            },
            rewards: rewardRows,
            fits: r => fitsReward(r.reward, page.game_data.village),
            insufficient: resourceShortage,
            async claim(r) {
                status(`Passende Questbelohnung ${r.id} abholen.`); dsControl.click(r.button);
                return !!await waitFor(() => !rewardRows(questPopup() || { querySelectorAll: () => [] }).some(x => x.id === r.id));
            },
            delay: actionDelay
        });
        const auto = createAutoController({
            now: serverNow,
            proposal() {
                if (dsControl.paused()) return null;
                refresh();
                if (!template || !displayed || $('[data-code]').value.trim() !== loadedCode) return null;
                const state = readState();
                return { ...displayed, blocked: busy || quests.busy || !!questPopup() || !!state.pending };
            },
            async prepare() {
                if (dsControl.paused()) return;
                await quests.handlePopup();
                if (auto.enabled && !busy && !page.BuildingMain.pending) await quests.checkRewards();
            },
            async submit(p) {
                // Native Anzeige und alle Bauprüfungen unmittelbar vor jedem einzelnen Auftrag erneuern.
                page.BuildingMain.updateBuildableState(); refresh();
                if (!auto.enabled || !displayed || displayed.done || displayed.reasons.length ||
                    $('[data-build]').disabled || signature(p) !== signature(displayed)) return false;
                return enqueue(displayed, true);
            },
            completion() {
                const times = [...document.querySelectorAll('#buildqueue [data-endtime]')]
                    .map(n => Number(n.getAttribute('data-endtime')) * 1000)
                    .filter(t => Number.isFinite(t) && t > serverNow());
                return times.length ? Math.min(...times) : NaN;
            },
            onSchedule(time) {
                autoNext = time;
                $('[data-auto-info]').textContent = dsControl.state().status === 'pause' ? 'Durch das Kontrollzentrum pausiert.' : time === null ? 'Automatik ausgeschaltet.' :
                    `Automatik aktiv · nächste Prüfung: ${new Date(time).toLocaleTimeString('de-DE')}`;
                participant?.publish();
            },
            onError(e) { status(`Automatik wartet: ${e.message}`, true); }
        });
        let suspendedAuto = false;
        function setAuto(enabled, save = true) {
            if (enabled && dsControl.paused()) { suspendedAuto = true; enabled = false; }
            const paused = dsControl.state().status === 'pause';
            $('[data-auto]').setAttribute('aria-pressed', String(enabled || suspendedAuto));
            $('[data-auto]').disabled = paused;
            $('[data-auto]').textContent = `Automatisch einreihen: ${paused ? 'Pausiert' : enabled ? 'An' : 'Aus'}`;
            if (save) {
                try { localStorage.setItem(autoKey, String(enabled)); }
                catch { status('Automatikstatus konnte nicht gespeichert werden.', true); }
            }
            auto.setEnabled(enabled);
            participant?.publish();
        }
        dsControl.onChange(state => {
            if (state.status === 'pause') {
                suspendedAuto = auto.enabled || suspendedAuto;
                setAuto(false, false);
                status('Kontrollzentrum: Aktivitätscheck – Automatik pausiert.');
            } else {
                const restart = suspendedAuto;
                suspendedAuto = false;
                setAuto(restart, false); // Frischer Prüflauf; keine alten Bauaufträge wiederholen.
                status('Kontrollzentrum: Pause aufgehoben. Bauvorschlag wird neu geprüft.');
            }
            refresh();
        });
        $('[data-auto]').addEventListener('click', () => { if (!dsControl.paused()) setAuto(!auto.enabled); });
        try { const stored = localStorage.getItem(key); if (stored) { $('[data-code]').value = stored; load(stored, false); } }
        catch (e) { status(`Gespeicherte Vorlage konnte nicht geladen werden: ${e.message}`, true); }
        refresh();
        // Das Spiel ersetzt bei Bauabschlüssen auch den gesamten Seiteninhalt per AJAX.
        // Tampermonkey startet dabei nicht erneut; den Helfer deshalb wieder einhängen.
        let observedQuestPopup = questPopup();
        const observer = new MutationObserver(() => {
            if (mount()) refresh();
            auto.queueChanged(Number(page.BuildingMain?.order_count));
            const currentPopup = questPopup(), popupClosed = !!observedQuestPopup && !currentPopup;
            observedQuestPopup = currentPopup;
            if (!dsControl.paused() && quests.needsPopup()) {
                void quests.handlePopup().then(() => { refresh(); if (auto.enabled) void auto.run(); })
                    .catch(e => status(`Questpopup: ${e.message}`, true));
            } else if (!dsControl.paused() && popupClosed && auto.enabled && !quests.busy) {
                // Nach manuellem Schließen nicht bis zum nächsten Bauabschluss warten.
                void auto.run();
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        dsControl.interval(() => { mount(); if (root.isConnected && !auto.enabled) refresh(); }, 30000);
        try { setAuto(localStorage.getItem(autoKey) === 'true', false); }
        catch { setAuto(false, false); }
        if (!dsControl.paused() && quests.needsPopup()) void quests.handlePopup().then(refresh).catch(e => status(e.message, true));
        participant = dsControl.registerScript('konstruktionshelfer', {
            version: '1.4.0',
            state: () => ({ auto: auto.enabled || suspendedAuto, busy: busy || quests.busy || !!page.BuildingMain.pending || !!questPopup(),
                status: $('[data-status]').textContent, nextAt: autoNext, construction: constructionState() }),
            setAuto(enabled) {
                if (dsControl.paused()) {
                    suspendedAuto = enabled;
                    localStorage.setItem(autoKey, String(enabled));
                    setAuto(false, false);
                } else { suspendedAuto = false; setAuto(enabled); }
                refresh();
            }
        });
        window.addEventListener('pageshow', () => { root.querySelectorAll('details').forEach(d => { d.open = false; }); refresh(); });
        return true;
    }
    if (!initialize()) {
        const startup = dsControl.interval(() => { if (initialize()) clearInterval(startup); }, 250);
    }
})();
