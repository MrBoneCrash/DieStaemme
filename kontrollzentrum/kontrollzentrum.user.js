// ==UserScript==
// @name         Die Stämme – Kontrollzentrum
// @namespace    local.die-staemme.kontrollzentrum
// @version      1.4.1
// @description  Pausiert eingebundene Skripte bei Aktivitätschecks und erlaubt anschließend die manuelle Freigabe.
// @match        https://*.die-staemme.de/game.php*
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
    function decideControlRoute({ screen, mode, paused, now, raid, builder, flow }) {
        if (paused) return null;
        if (screen === 'main' && ['', 'build'].includes(mode || '') && raid?.auto &&
            Number.isFinite(raid.nextAt) && raid.nextAt <= now && !(builder?.live && builder.busy) &&
            !(flow?.retryAfter > now)) return { target: 'raid', startedAt: now, completedAt: raid.completedAt || 0 };
        if (screen === 'place' && mode === 'scavenge' && flow?.target === 'raid') {
            if (raid?.live && !raid.busy && ((raid.completedAt || 0) > flow.completedAt || !raid.auto))
                return { target: 'main' };
            if (!raid?.live && now - flow.startedAt >= 15000) return { target: 'main', missing: true };
        }
        return null;
    }
    function orderRaidVillages(villages) {
        return [...villages].sort((a, b) => Number(b.auto) - Number(a.auto) ||
            (Number.isFinite(a.nextAt) ? a.nextAt : Infinity) - (Number.isFinite(b.nextAt) ? b.nextAt : Infinity) ||
            String(a.villageId).localeCompare(String(b.villageId), 'de', { numeric: true }));
    }
    function decideVillageRoute({ screen, mode, paused, now, villages, currentVillageId, builder, flow, recruitments = [], command, recruiter }) {
        if (paused) return null;
        const next = exclude => orderRaidVillages(villages).find(v => v.auto && Number.isFinite(v.nextAt) && v.nextAt <= now && v.villageId !== exclude);
        const visit = village => ({ target: 'raid', villageId: village.villageId, startedAt: now, completedAt: village.completedAt || 0 });
        const recruitNext = () => {
            const pending = recruitments.filter(v => !(flow?.target === 'train' && v.villageId === String(currentVillageId)));
            const ready = pending.find(v => v.ready);
            if (ready) return { target: 'train', villageId: ready.villageId, startedAt: now };
            const due = pending.filter(v => v.due).sort((a, b) => a.nextAt - b.nextAt)[0];
            return due ? { target: 'capacity', villageId: due.villageId, startedAt: now } : null;
        };
        if (screen === 'main' && flow?.target === 'capacity' && flow.villageId === String(currentVillageId) && !builder?.live && now - flow.startedAt >= 15000)
            return { target: 'main', missingBuilder: true };
        if (screen === 'main' && ['', 'build'].includes(mode || '') && !(builder?.live && builder.busy) && !(flow?.retryAfter > now)) {
            const due = next();
            if (due) return visit(due);
            const recruitment = recruitNext();
            if (recruitment) return recruitment;
            if (flow?.target === 'capacity' && flow.villageId === String(currentVillageId)) return { target: 'main' };
            return null;
        }
        if (screen === 'train' && ['', 'train'].includes(mode || '') && flow?.target === 'train' && flow.villageId === String(currentVillageId)) {
            const missing = !recruiter?.live && now - flow.startedAt >= 15000;
            const done = !recruiter?.busy && ['confirmed', 'failed', 'unknown'].includes(command?.status);
            if (!done && !missing) return null;
            const due = next();
            return { ...(due ? visit(due) : recruitNext() || { target: 'main' }), ...(missing ? { missingRecruiter: true } : {}) };
        }
        if (screen !== 'place' || mode !== 'scavenge' || flow?.target !== 'raid' || flow.villageId !== String(currentVillageId)) return null;
        const raid = villages.find(v => v.villageId === String(currentVillageId));
        const done = raid?.live && !raid.busy && ((raid.completedAt || 0) > flow.completedAt || !raid.auto);
        const missing = !raid?.live && now - flow.startedAt >= 15000;
        if (!done && !missing) return null;
        const due = next(String(currentVillageId));
        return { ...(due ? visit(due) : recruitNext() || { target: 'main' }), ...(missing ? { missing: true } : {}) };
    }
    if (typeof module === 'object' && module.exports) { module.exports = { activityCheck, createControlClient, constructionSurplus, recruitmentPlan, decideControlRoute, orderRaidVillages, decideVillageRoute }; return; }
    const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    if (window.top !== window.self || page.DSControlCenter || document.getElementById('ds-kontrollzentrum')) return;
    const control = createControlClient({ win: window, doc: document, storage: localStorage }, 'Kontrollzentrum');
    page.DSControlCenter = Object.freeze({
        version: '1.4.1', isPaused: control.paused, assertActive: control.assert, beforeReload,
        state: control.state, onChange: control.onChange,
        farmCompleted(villageId) {
            const check = readRecruit('check', String(villageId));
            if (check) {
                try { localStorage.setItem(recruitKey('check', String(villageId)), JSON.stringify({ ...check, nextAt: 0 })); } catch { /* Metadata still signals completion. */ }
            }
            queueMicrotask(render);
        },
        planRecruitmentNow(villageId, snapshot, commandId) {
            control.assert();
            villageId = String(villageId);
            const command = readRecruit('command', villageId);
            if (villageId !== String(page.game_data?.village?.id) || command?.id !== commandId || command.status !== 'processing' ||
                !snapshot?.budget || snapshot.templateId !== command.templateId || JSON.stringify(snapshot.targets) !== command.targetsSignature)
                throw new Error('Rekrutierungsplanung gehört nicht zum aktuellen Auftrag.');
            const units = recruitmentPlan(snapshot.items, { ...snapshot.budget,
                pop: Math.max(0, Math.min(command.surplus, snapshot.budget.pop - command.reservedPop)) });
            localStorage.setItem(recruitKey('command', villageId), JSON.stringify({ ...command, units }));
            return units;
        }
    });
    const root = document.createElement('section'); root.id = 'ds-kontrollzentrum';
    root.innerHTML = `<style>
        #ds-kontrollzentrum{--ink:#382819;--muted:#82694d;color:var(--ink);font:13px/1.5 Verdana,Arial,sans-serif}
        #ds-kontrollzentrum *{box-sizing:border-box}
        #ds-kontrollzentrum [hidden]{display:none!important}
        #ds-kontrollzentrum .ds-panel,#ds-kontrollzentrum .ds-dialog{background:linear-gradient(110deg,#f8efd7,#eee0bf);
            border:1px solid #987345;border-radius:8px;box-shadow:0 3px 12px #45260830;overflow:hidden}
        #ds-kontrollzentrum .ds-panel{position:fixed;right:16px;bottom:16px;z-index:8000;width:min(340px,calc(100vw - 32px))}
        #ds-kontrollzentrum summary{padding:12px 16px;cursor:pointer;font-weight:700;color:#654728}
        #ds-kontrollzentrum .ds-body{padding:0 16px 16px;max-height:calc(100vh - 100px);overflow:auto}
        #ds-kontrollzentrum .ds-hint{color:var(--muted);font-size:11px}
        #ds-kontrollzentrum .ds-overlay{position:fixed;inset:0;background:#38281955;z-index:8500;display:grid;place-items:center;padding:16px;pointer-events:none}
        #ds-kontrollzentrum .ds-dialog{width:min(440px,100%);padding:20px;pointer-events:auto}
        #ds-kontrollzentrum h2{margin:0 0 12px;font-size:17px;color:#654728}
        #ds-kontrollzentrum button{padding:7px 11px;min-height:34px;border:1px solid #643516;border-radius:5px;
            background:linear-gradient(#8f572f,#70401f);color:#fff5dc;font:700 11px/1.4 Verdana,Arial,sans-serif;cursor:pointer}
        #ds-kontrollzentrum button:focus-visible{outline:2px solid #93602b;outline-offset:3px}
        #ds-kontrollzentrum .ds-script{padding:10px 0;border-top:1px solid #d4c19e}
        #ds-kontrollzentrum .ds-script strong{display:block}
        #ds-kontrollzentrum [data-toggle],#ds-kontrollzentrum [data-village-toggle],#ds-kontrollzentrum [data-recruit-toggle]{background:#a33d32;border-color:#7e2e26;color:#fff;margin-top:6px}
        #ds-kontrollzentrum [data-toggle][aria-pressed=true],#ds-kontrollzentrum [data-village-toggle][aria-pressed=true],#ds-kontrollzentrum [data-recruit-toggle][aria-pressed=true]{background:#397c3b;border-color:#285b2a}
        #ds-kontrollzentrum button:disabled{opacity:.45;cursor:default}
        #ds-kontrollzentrum [data-error]{color:#953d28}
        #ds-kontrollzentrum .ds-villages{border-top:1px solid #d4c19e;margin-top:10px}
        #ds-kontrollzentrum .ds-villages summary{padding:10px 0}
        #ds-kontrollzentrum .ds-village{padding:9px 0;border-top:1px solid #d4c19e;display:grid;grid-template-columns:1fr auto;gap:3px 8px}
        #ds-kontrollzentrum .ds-village strong{overflow-wrap:anywhere}
        #ds-kontrollzentrum .ds-village small{grid-column:1;color:var(--muted)}
        #ds-kontrollzentrum .ds-village button{grid-column:2;grid-row:1 / 3;align-self:center;margin:0}
        #ds-kontrollzentrum .ds-village[data-current=true]{border-left:3px solid #a7793d;padding-left:8px}
    </style><details class="ds-panel"><summary>Kontrollzentrum · <span data-status>Aktiv</span></summary>
        <div class="ds-body"><p data-current-village>Steuerung für das aktuelle Dorf.</p>
        <div class="ds-script"><strong>Konstruktionshelfer</strong><span data-script-status="konstruktionshelfer"></span><br>
            <button type="button" data-toggle="konstruktionshelfer" aria-pressed="false" disabled>Automatik: Aus</button></div>
        <div class="ds-script"><strong>Raubzug-Helfer</strong><span data-script-status="raubzug-helfer"></span><br>
            <button type="button" data-toggle="raubzug-helfer" aria-pressed="false" disabled>Automatik: Aus</button>
            <p class="ds-hint" data-schedule></p></div>
        <div class="ds-script"><strong>Truppenvorlagen · normale Rekrutierung</strong><span data-script-status="truppenvorlagen"></span><br>
            <button type="button" data-toggle="truppenvorlagen" aria-pressed="false" disabled>Automatik: Aus</button>
            <p class="ds-hint" data-recruit-info></p></div>
        <p class="ds-hint" data-control-message></p>
        <details class="ds-villages"><summary data-village-summary>Raubzug-Dörfer</summary><div data-villages></div></details>
        <details class="ds-villages ds-recruit-villages"><summary data-recruit-summary>Rekrutierungs-Dörfer</summary><div data-recruit-villages></div></details>
        <p class="ds-hint">Aktivitätschecks pausieren die Skripte bis zur manuellen Freigabe.</p></div></details>
        <div class="ds-overlay" hidden><div class="ds-dialog" role="dialog" aria-labelledby="ds-control-title">
        <h2 id="ds-control-title">Skripte pausiert</h2><p data-message></p><p data-time></p>
        <p data-error role="status"></p><button type="button" data-resume hidden>Pause aufheben</button></div></div>`;
    const $ = selector => root.querySelector(selector);
    const uiKey = `${control.scope()}:ui`, reloadKey = `${uiKey}:reload`;
    function beforeReload() {
        try { sessionStorage.setItem(reloadKey, JSON.stringify({ url: window.location.href, at: Date.now() })); } catch { /* optional UI persistence */ }
    }
    try {
        const marker = JSON.parse(sessionStorage.getItem(reloadKey) || 'null');
        sessionStorage.removeItem(reloadKey);
        const automatic = marker?.url === window.location.href && Date.now() - marker.at < 15000;
        if (window.performance?.getEntriesByType('navigation')[0]?.type === 'reload' && !automatic) {
            sessionStorage.removeItem(uiKey); sessionStorage.removeItem(`${uiKey}:villages`); sessionStorage.removeItem(`${uiKey}:recruitment`);
        }
        $('.ds-panel').open = sessionStorage.getItem(uiKey) === 'open';
        $('.ds-villages').open = sessionStorage.getItem(`${uiKey}:villages`) === 'open';
        $('.ds-recruit-villages').open = sessionStorage.getItem(`${uiKey}:recruitment`) === 'open';
    } catch { /* a blocked store must not prevent the control UI */ }
    $('.ds-panel').addEventListener('toggle', () => {
        try { sessionStorage.setItem(uiKey, $('.ds-panel').open ? 'open' : 'closed'); } catch { /* optional UI persistence */ }
    });
    $('.ds-villages').addEventListener('toggle', () => {
        try { sessionStorage.setItem(`${uiKey}:villages`, $('.ds-villages').open ? 'open' : 'closed'); } catch { /* optional UI persistence */ }
    });
    $('.ds-recruit-villages').addEventListener('toggle', () => {
        try { sessionStorage.setItem(`${uiKey}:recruitment`, $('.ds-recruit-villages').open ? 'open' : 'closed'); } catch { /* optional UI persistence */ }
    });
    let previousMode = '', mounted = false, navigating = false, navigationTimer = null, pendingTarget = null;
    const scriptIds = ['konstruktionshelfer', 'raubzug-helfer', 'truppenvorlagen'];
    const flowKey = () => `${control.scope()}:route`;
    function readFlow() { try { return JSON.parse(sessionStorage.getItem(flowKey()) || 'null'); } catch { return null; } }
    const recruitKey = (type, villageId) => `${control.scope()}:recruit-${type}:${villageId}`;
    function readRecruit(type, villageId) { try { return JSON.parse(localStorage.getItem(recruitKey(type, villageId)) || 'null'); } catch { return null; } }
    function prepareRecruitment(paused) {
        if (paused) return;
        const villageId = String(page.game_data?.village?.id);
        if (page.game_data?.screen !== 'main' || !villageId) return;
        const builder = control.scriptState('konstruktionshelfer', true), recruiter = control.scriptState('truppenvorlagen');
        if (!builder?.live || builder.busy || !recruiter?.auto || !recruiter.recruitment) return;
        const construction = builder.construction, snapshot = recruiter.recruitment;
        let check = readRecruit('check', villageId), command = readRecruit('command', villageId);
        const signature = JSON.stringify([construction?.steps, snapshot.templateId, snapshot.targets]);
        const farmChanged = (construction?.farmCompletedAt || 0) > (check?.farmCompletedAt || 0) || construction?.farmLevel > check?.farmLevel;
        const queued = command?.status === 'queued';
        if (!queued && check?.nextAt > Date.now() && !farmChanged && check.signature === signature) return;
        const calculation = constructionSurplus(construction);
        const village = page.game_data.village;
        const budget = { wood: Number(village.wood), stone: Number(village.stone), iron: Number(village.iron), pop: calculation.surplus };
        // Stored counts/maxima can be stale after a farm completion or troop loss.
        // Use them to plan the visit, then ask the controller again with fresh train data.
        let items = snapshot.items.map(item => ({ ...item, max: item.deficit }));
        if (!items.some(item => item.deficit > 0)) items = snapshot.items.map(item => ({ ...item,
            deficit: snapshot.targets[item.unit] || 0, max: snapshot.targets[item.unit] || 0 }));
        const units = calculation.known ? recruitmentPlan(items, budget) : {};
        check = { at: Date.now(), nextAt: Date.now() + 3600000, farmCompletedAt: construction?.farmCompletedAt || 0,
            farmLevel: construction?.farmLevel, signature, calculation };
        try {
            localStorage.setItem(recruitKey('check', villageId), JSON.stringify(check));
            if (Object.values(units).some(n => n > 0)) {
                command = { id: queued ? command.id : `${Date.now()}-${Math.random().toString(36).slice(2)}`, scope: control.scope(), villageId,
                    status: 'queued', issuedAt: queued ? command.issuedAt : Date.now(), templateId: snapshot.templateId,
                    targetsSignature: JSON.stringify(snapshot.targets), units, reservedPop: calculation.reserved, surplus: calculation.surplus };
                localStorage.setItem(recruitKey('command', villageId), JSON.stringify(command));
            } else if (queued) localStorage.setItem(recruitKey('command', villageId), JSON.stringify({ ...command, status: 'failed', completedAt: Date.now(), message: 'Kein Überschuss mehr verfügbar.' }));
        } catch { $('[data-control-message]').textContent = 'Rekrutierungsprüfung konnte nicht gespeichert werden.'; }
    }
    function recruitmentJobs() {
        return control.scriptVillages('truppenvorlagen').filter(v => v.auto).map(v => {
            const check = readRecruit('check', v.villageId), command = readRecruit('command', v.villageId);
            const builder = control.scriptState('konstruktionshelfer', false, v.villageId);
            const farmChanged = (builder?.construction?.farmCompletedAt || 0) > (check?.farmCompletedAt || 0) || builder?.construction?.farmLevel > check?.farmLevel;
            const signature = JSON.stringify([builder?.construction?.steps, v.recruitment?.templateId, v.recruitment?.targets]);
            return { villageId: v.villageId, ready: command?.status === 'queued', nextAt: check?.nextAt || 0,
                due: command?.status !== 'queued' && !!builder && (!check || check.nextAt <= Date.now() || farmChanged || check.signature !== signature) };
        });
    }
    let recruitSignature = '';
    function renderRecruitments(paused) {
        const villages = control.scriptVillages('truppenvorlagen'), current = String(page.game_data?.village?.id);
        const info = readRecruit('check', current);
        $('[data-recruit-info]').textContent = info?.nextAt ? `Nächster Check: ${new Date(info.nextAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} Uhr.` : villages.some(v => v.villageId === current) ? 'Nächster Check: ausstehend.' : '';
        $('[data-recruit-summary]').textContent = `Rekrutierungs-Dörfer · ${villages.length} erkannt`;
        const rows = villages.map(v => { const builder = control.scriptState('konstruktionshelfer', false, v.villageId); return { ...v,
            calculation: builder?.construction ? constructionSurplus(builder.construction) : null, check: readRecruit('check', v.villageId), command: readRecruit('command', v.villageId) }; });
        const signature = JSON.stringify([paused, current, rows.map(v => [v.villageId, v.villageName, v.auto, v.check?.at, v.calculation?.surplus, v.command?.status])]);
        if (signature === recruitSignature) return; recruitSignature = signature;
        const container = $('[data-recruit-villages]'); container.replaceChildren();
        if (!rows.length) { container.textContent = 'Normale Rekrutierung jedes gewünschten Dorfes einmal öffnen und eine Vorlage speichern.'; return; }
        for (const village of rows) {
            const row = document.createElement('div'); row.className = 'ds-village'; row.dataset.current = String(village.villageId === current);
            const title = document.createElement('strong'); title.textContent = villageLabel(village);
            const text = document.createElement('small'), c = village.calculation || village.check?.calculation;
            text.textContent = paused ? 'Pausiert' : !village.auto ? 'Automatik aus' : village.command?.status === 'queued' ? 'Rekrutierung bereit' :
                ['processing', 'submitted'].includes(village.command?.status) ? 'Rekrutierung läuft' : ['failed', 'unknown'].includes(village.command?.status) ? village.command.message : c?.known ? `${c.surplus} Überschuss${village.check?.nextAt ? ` · Check ${new Date(village.check.nextAt).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' })}` : ''}` : c?.reason || 'Kapazitätscheck ausstehend';
            const button = document.createElement('button'); button.type = 'button'; button.dataset.recruitToggle = village.villageId;
            button.textContent = village.auto ? 'An' : 'Aus'; button.setAttribute('aria-pressed', String(village.auto)); button.setAttribute('aria-label', `Rekrutierungsautomatik ${villageLabel(village)}`); button.disabled = paused;
            button.addEventListener('click', () => {
                const latest = control.scriptState('truppenvorlagen', false, village.villageId);
                if (latest && !control.paused()) control.setScriptAuto('truppenvorlagen', !latest.auto, village.villageId);
                render();
            });
            row.append(title, text, button); container.append(row);
        }
    }
    const villageLabel = state => `${state.villageName || `Dorf ${state.villageId}`}${state.villageCoords ? ` (${state.villageCoords})` : ''}`;
    let villageSignature = '';
    function renderVillages(paused) {
        const villages = orderRaidVillages(control.scriptVillages('raubzug-helfer'));
        const enabled = villages.filter(v => v.auto), due = enabled.filter(v => Number.isFinite(v.nextAt) && v.nextAt <= Date.now());
        const flow = readFlow(), current = String(page.game_data?.village?.id);
        $('[data-current-village]').textContent = `Aktuelles Dorf: ${villageLabel({ villageId: current, villageName: page.game_data?.village?.name || '' })}`;
        $('[data-village-summary]').textContent = `Raubzug-Dörfer · ${villages.length} erkannt · ${due.length} fällig`;
        const active = villages.find(v => flow?.target === 'raid' && v.villageId === current && v.villageId === flow.villageId);
        const signature = JSON.stringify([paused, current, active?.villageId, villages.map(v => [v.villageId, v.villageName, v.villageCoords, v.auto, v.nextAt, v.live && v.busy, v.auto && Number.isFinite(v.nextAt) && v.nextAt <= Date.now()])]);
        if (signature === villageSignature) return villages;
        villageSignature = signature;
        const container = $('[data-villages]'); container.replaceChildren();
        if (!villages.length) { container.textContent = 'Zum Einrichten die Raubzug-Ansicht jedes gewünschten Dorfes einmal öffnen.'; return villages; }
        for (const village of villages) {
            const row = document.createElement('div'); row.className = 'ds-village'; row.dataset.current = String(village.villageId === current);
            const name = document.createElement('strong'); name.textContent = villageLabel(village);
            const info = document.createElement('small'); info.textContent = paused ? 'Pausiert' : village.live && village.busy ? 'Arbeitet …' : !village.auto ? 'Automatik aus' :
                Number.isFinite(village.nextAt) ? village.nextAt <= Date.now() ? 'Fällig · wartet auf Verarbeitung' : `Check: ${new Date(village.nextAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}` : 'Kein Prüftermin';
            const button = document.createElement('button'); button.type = 'button'; button.dataset.villageToggle = village.villageId;
            button.textContent = village.auto ? 'An' : 'Aus'; button.setAttribute('aria-pressed', String(village.auto)); button.setAttribute('aria-label', `Raubzug-Automatik ${villageLabel(village)}`); button.disabled = paused;
            button.addEventListener('click', () => {
                const latest = control.scriptState('raubzug-helfer', false, village.villageId);
                if (control.paused() || !latest) return;
                $('[data-control-message]').textContent = control.setScriptAuto('raubzug-helfer', !latest.auto, village.villageId) ? '' : 'Automatik konnte nicht gespeichert werden.';
                render();
            });
            row.append(name, info, button); container.append(row);
        }
        return villages;
    }
    for (const id of scriptIds) $(`[data-toggle="${id}"]`).addEventListener('click', () => {
        const state = control.scriptState(id);
        if (!state || control.paused()) return;
        $('[data-control-message]').textContent = control.setScriptAuto(id, !state.auto) ? '' : 'Automatik konnte nicht gespeichert werden.';
        render();
    });
    function renderScripts(paused) {
        const states = {};
        for (const id of scriptIds) {
            const state = states[id] = control.scriptState(id, true);
            $(`[data-script-status="${id}"]`).textContent = !state ? 'nicht installiert' : paused ? 'pausiert' :
                state.busy && state.live ? 'arbeitet' : !state.auto ? 'Automatik aus' : state.live ? 'Automatik aktiv' : 'auf anderer Spielansicht';
            const button = $(`[data-toggle="${id}"]`);
            button.textContent = `Automatik: ${state?.auto ? 'An' : 'Aus'}`;
            button.setAttribute('aria-pressed', String(!!state?.auto));
            button.disabled = !state || paused;
        }
        const raid = states['raubzug-helfer'];
        $('[data-schedule]').textContent = raid?.auto && Number.isFinite(raid.nextAt) ?
            `Nächster Raubzug-Check: ${new Date(raid.nextAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} Uhr.` : '';
        return states;
    }
    function cancelNavigation() {
        if (navigationTimer !== null) window.clearTimeout(navigationTimer);
        navigationTimer = null; pendingTarget = null;
    }
    function coordinate(states, paused, afterDelay = false) {
        if (paused) { cancelNavigation(); return; }
        if (navigating || !window.location?.href || !page.game_data?.village?.id) return;
        const url = new URL(window.location.href), p = url.searchParams;
        if (['action', 'try', 'ajax', 'ajaxaction'].some(key => p.has(key))) return;
        if (p.get('village') && p.get('village') !== String(page.game_data.village.id)) return;
        let flow = readFlow();
        const decision = decideVillageRoute({ screen: p.get('screen'), mode: p.get('mode'), paused, now: Date.now(),
            villages: control.scriptVillages('raubzug-helfer'), currentVillageId: page.game_data.village.id,
            builder: p.get('screen') === 'main' ? control.scriptState('konstruktionshelfer', true) : states.konstruktionshelfer, flow,
            recruitments: recruitmentJobs(), recruiter: control.scriptState('truppenvorlagen', true), command: readRecruit('command', String(page.game_data.village.id)) });
        if (!decision) { cancelNavigation(); return; }
        if (!afterDelay) {
            const target = `${decision.target}:${decision.villageId || ''}`;
            if (navigationTimer !== null && pendingTarget === target) return;
            cancelNavigation(); pendingTarget = target;
            navigationTimer = window.setTimeout(() => {
                navigationTimer = null; pendingTarget = null;
                coordinate({ 'raubzug-helfer': control.scriptState('raubzug-helfer', true),
                    konstruktionshelfer: control.scriptState('konstruktionshelfer', true) }, control.paused(), true);
            }, 1000 + Math.floor(Math.random() * 3001));
            return;
        }
        let destination;
        if (decision.missing) control.forgetScript('raubzug-helfer', String(page.game_data.village.id));
        if (decision.missingRecruiter) {
            control.forgetScript('truppenvorlagen', String(page.game_data.village.id));
            const command = readRecruit('command', String(page.game_data.village.id));
            if (command) localStorage.setItem(recruitKey('command', command.villageId), JSON.stringify({ ...command, status: 'failed', message: 'Truppenskript nicht gefunden.' }));
        }
        if (decision.missingBuilder) control.forgetScript('konstruktionshelfer', String(page.game_data.village.id));
        if (['raid', 'train', 'capacity'].includes(decision.target)) {
            destination = new URL('/game.php', url.origin);
            destination.searchParams.set('village', decision.villageId);
            destination.searchParams.set('screen', decision.target === 'raid' ? 'place' : decision.target === 'train' ? 'train' : 'main');
            if (decision.target !== 'capacity') destination.searchParams.set('mode', decision.target === 'raid' ? 'scavenge' : 'train');
            flow = { ...decision, returnUrl: flow?.returnUrl && ['raid', 'train', 'capacity'].includes(flow.target) ? flow.returnUrl : url.href };
        } else {
            try { destination = new URL(flow.returnUrl); } catch { return; }
            if (destination.origin !== url.origin || destination.pathname !== '/game.php' || destination.searchParams.get('screen') !== 'main' ||
                ['action', 'try', 'ajax', 'ajaxaction'].some(key => destination.searchParams.has(key))) return;
            flow = { retryAfter: Date.now() + 5000 };
        }
        try { sessionStorage.setItem(flowKey(), JSON.stringify(flow)); } catch { return; }
        if (control.paused()) return;
        if (destination.href === url.href) { cancelNavigation(); return; }
        navigating = true; window.location.assign(destination.href);
    }
    function render() {
        if (!page.game_data?.player?.id || !page.game_data?.world) return;
        if (!root.isConnected) { document.body.append(root); mounted = true; }
        const check = control.inspect(), state = control.state();
        const mode = check === 'full' ? 'full' : state.status === 'pause' ? (check ? 'check' : 'resume') : 'running';
        $('.ds-panel').hidden = mode === 'full';
        $('.ds-overlay').hidden = mode === 'full' || mode === 'running';
        $('[data-status]').textContent = state.status === 'pause' ? 'Pause' : 'Aktiv';
        const scripts = renderScripts(state.status === 'pause');
        prepareRecruitment(state.status === 'pause');
        renderVillages(state.status === 'pause');
        renderRecruitments(state.status === 'pause');
        $('[data-message]').textContent = mode === 'check' ?
            'Bitte führe den Aktivitätscheck unter dem Quest-Icon manuell durch. Alle eingebundenen Skripte sind pausiert.' :
            'Der Aktivitätscheck ist nicht mehr sichtbar. Du kannst die Pause jetzt aufheben.';
        $('[data-time]').textContent = state.detectedAt ? `Check erkannt am ${new Date(state.detectedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} Uhr.` : 'Zeitpunkt des Checks unbekannt.';
        $('[data-resume]').hidden = mode !== 'resume';
        if (mode !== previousMode) {
            $('[data-error]').textContent = '';
            if (mode === 'resume') $('[data-resume]').focus({ preventScroll: true });
            previousMode = mode;
        }
        coordinate(scripts, state.status === 'pause');
    }
    $('[data-resume]').addEventListener('click', () => {
        const result = control.resume(); render();
        if (!result.ok) $('[data-error]').textContent = result.reason;
    });
    // Änderungen im selben Dokument sofort erkennen; Hintergrundtabs prüfen beim Zurückkehren erneut.
    let scheduled = false;
    const observer = new MutationObserver(records => {
        if (records.every(record => root.contains(record.target)) || scheduled) return;
        scheduled = true;
        queueMicrotask(() => { scheduled = false; render(); });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['data-bot-protect', 'class', 'style', 'hidden', 'aria-hidden'] });
    control.onChange(() => queueMicrotask(render));
    const timer = window.setInterval(render, 1000);
    window.addEventListener('focus', render);
    document.addEventListener('visibilitychange', render);
    window.addEventListener('pagehide', () => { cancelNavigation(); window.clearInterval(timer); observer.disconnect(); });
    window.addEventListener('pageshow', event => { if (event.persisted && mounted) { beforeReload(); window.location.reload(); } });
    render();
})();
