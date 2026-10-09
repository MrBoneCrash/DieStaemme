// ==UserScript==
// @name         Die Stämme – Einzelziel-Snipe
// @namespace    local.die-staemme.einzelziel-snipe
// @version      1.3.0
// @description  Berechnet Abschickzeiten für ein Ziel und exportiert alle ausgewählten verfügbaren Einheiten nach Workbench. Nutzung auf eigene Gefahr.
// @match        https://*.die-staemme.de/game.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.
// Vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen prüfen.

// Neuimplementierung nach Single Village Snipe (Marcel Wollbaum / RedAlert).
// Referenz: https://cdn.jsdelivr.net/gh/Marcel2511/tribal-wars-schnellleisten-skripte@v1.0.0/SingleVillageSnipedFixed.js
(function () {
    'use strict';
    const ID = 'ds-einzelziel-snipe';
    const NAMES = { spear: 'Speerträger', sword: 'Schwertkämpfer', axe: 'Axtkämpfer',
        archer: 'Bogenschütze', spy: 'Späher', light: 'Leichte Kavallerie',
        marcher: 'Berittener Bogenschütze', heavy: 'Schwere Kavallerie', ram: 'Rammbock',
        catapult: 'Katapult', knight: 'Paladin', snob: 'Adelsgeschlecht' };
    const DEFAULT_UNITS = ['spear', 'sword', 'archer', 'heavy'];
    const OFFENSE_UNITS = ['axe', 'light', 'marcher', 'ram', 'catapult'];
    const dateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
        minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const escape = value => String(value).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    function amount(value) {
        if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : NaN;
        const text = String(value ?? '').trim().replace(/[\s\u00a0\u202f]/g, '');
        if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(text)) return NaN;
        const n = Number(text.replace(/\./g, ''));
        return Number.isSafeInteger(n) ? n : NaN;
    }

    function coords(value) {
        const m = String(value).trim().match(/^(\d{1,3})\s*\|\s*(\d{1,3})$/);
        if (!m) throw new Error('Zielkoordinaten im Format 500|500 eingeben.');
        return `${Number(m[1])}|${Number(m[2])}`;
    }

    function dateParts(timestamp) {
        return Object.fromEntries(dateFormatter.formatToParts(timestamp)
            .filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    }

    function formatTime(timestamp) {
        timestamp = Math.trunc(timestamp);
        const p = dateParts(timestamp), pad = n => String(n).padStart(2, '0');
        const milliseconds = ((timestamp % 1000) + 1000) % 1000;
        return `${pad(p.day)}.${pad(p.month)}.${p.year} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
            (milliseconds ? `.${String(milliseconds).padStart(3, '0')}` : '');
    }

    // Explizite Serverzeitzone statt der Zeitzone des Computers; kein Date.parse auf Freitext.
    function parseTime(value) {
        const m = String(value).trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:[.:](\d{1,3}))?$/);
        if (!m) throw new Error('Ankunft als TT.MM.JJJJ HH:MM:SS eingeben (Millisekunden optional).');
        const [, day, month, year, hour, minute, second] = m.map(Number);
        const ms = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
        const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
        const matches = [];
        for (const offset of [60, 120]) {
            const candidate = wall - offset * 60000, p = dateParts(candidate);
            if (p.year === year && p.month === month && p.day === day && p.hour === hour &&
                p.minute === minute && p.second === second) matches.push(candidate);
        }
        if (matches.length !== 1) throw new Error(matches.length ?
            'Diese Uhrzeit ist bei der Winterzeitumstellung doppeldeutig. Eine andere Zeit wählen.' :
            'Das Datum oder die Uhrzeit ist ungültig (gegebenenfalls Sommerzeitumstellung).');
        return matches[0];
    }

    function validateConfig(raw, units) {
        if (!raw || typeof raw !== 'object') throw new Error('Ungültige Konfiguration.');
        const target = coords(raw.target), arrival = parseTime(raw.arrival);
        const minimum = amount(raw.minimum), bonus = Number(String(raw.bonus).replace(',', '.'));
        const selected = [...new Set(Array.isArray(raw.selected) ? raw.selected : [])];
        if (!Number.isFinite(minimum) || minimum < 1) throw new Error('Die Mindestmenge muss mindestens 1 sein.');
        if (String(raw.bonus ?? '').trim() === '' || !Number.isFinite(bonus) || bonus < 0 || bonus > 1000)
            throw new Error('Geschwindigkeitsbonus zwischen 0 und 1000 Prozent eingeben.');
        if (!selected.length || selected.some(u => !units.includes(u))) throw new Error('Mindestens eine verfügbare Einheit auswählen.');
        return { target, arrival: formatTime(arrival), minimum, bonus, selected };
    }

    function selectedTroops(troops, selected) {
        return Object.fromEntries(selected.filter(u => Object.hasOwn(NAMES, u))
            .map(u => [u, amount(troops[u])]).filter(([, n]) => n > 0));
    }

    function plan(villages, speeds, config, now) {
        const arrival = parseTime(config.arrival), [tx, ty] = coords(config.target).split('|').map(Number);
        const results = [];
        for (const village of villages) {
            const troops = selectedTroops(village.troops, config.selected), entries = Object.entries(troops);
            // Ein AG benötigt 1 Exemplar; es senkt nicht die Mindestmenge anderer Einheiten.
            if (!entries.some(([u, n]) => n >= (u === 'snob' ? 1 : config.minimum))) continue;
            for (const [unit] of entries) {
                if (!(Number(speeds[unit]) > 0)) throw new Error(`Laufzeit für ${NAMES[unit]} fehlt.`);
            }
            const unit = entries.reduce((slowest, [u]) => Number(speeds[u]) > Number(speeds[slowest]) ? u : slowest, entries[0][0]);
            const [x, y] = coords(village.coords).split('|').map(Number), distance = Math.hypot(x - tx, y - ty);
            if (!distance) continue;
            // Der Welt-Endpunkt liefert bereits Minuten/Feld. Laufzeit auf ganze Sekunden runden.
            const duration = Math.round(distance * Number(speeds[unit]) * 60 / (1 + config.bonus / 100)) * 1000;
            const launch = arrival - duration;
            if (launch > now) results.push({ ...village, troops, unit, distance, duration, launch, arrival });
        }
        return results.sort((a, b) => a.launch - b.launch || a.id - b.id);
    }

    function workbench(row, targetId, encode = btoa) {
        if (!Number.isSafeInteger(Number(targetId)) || Number(targetId) < 1) throw new Error('Die Ziel-Dorf-ID fehlt.');
        const entries = Object.entries(row.troops).filter(([u, n]) => Object.hasOwn(NAMES, u) && amount(n) > 0);
        if (!entries.length) throw new Error('Keine Einheiten zum Exportieren.');
        const type = row.troops.snob > 0 ? 11 : entries.some(([u]) => ['axe', 'light', 'marcher', 'ram', 'catapult'].includes(u)) ? 8 : 0;
        return `${row.id}&${Number(targetId)}&${row.unit}&${row.arrival}&${type}&false&false&` +
            entries.map(([u, n]) => `${u}=${encode(String(n))}`).join('/') + '&1\n';
    }

    function sortResults(rows, sorting) {
        const value = (row, key) => key === 'troops' ? Object.values(row.troops).reduce((sum, n) => sum + n, 0) :
            key === 'distance' ? row.distance : row.launch;
        const totals = new Map(rows.map(row => [row, sorting.troops ? value(row, 'troops') : 0]));
        return rows.slice().sort((a, b) => {
            // Truppen zuerst; das räumliche oder zeitliche Kriterium entscheidet bei Gleichstand.
            if (sorting.troops) {
                const difference = (totals.get(a) - totals.get(b)) * sorting.troops;
                if (difference) return difference;
            }
            return sorting.other ? (value(a, sorting.other.key) - value(b, sorting.other.key)) * sorting.other.direction : 0;
        });
    }

    function unitFromImage(image) {
        return image?.getAttribute('src')?.match(/(?:^|\/)unit_([a-z]+)(?:@2x)?\.(?:webp|png|gif)(?:\?.*)?$/i)?.[1];
    }

    function parseTroops(doc, units) {
        const villages = new Map();
        function add(container, troops) {
            const quick = container.querySelector('.quickedit-vn');
            const link = container.querySelector('a[href*="info_village"], a[href*="screen=overview"]');
            const id = Number(quick?.getAttribute('data-id') || (link && new URL(link.getAttribute('href'), 'https://example.org')
                .searchParams.get(link.getAttribute('href').includes('info_village') ? 'id' : 'village')));
            const label = quick?.querySelector('.quickedit-label')?.textContent || quick?.textContent || link?.textContent || '';
            const coordinate = label.match(/\b\d{1,3}\|\d{1,3}\b/)?.[0];
            if (!id || !coordinate) throw new Error('Dorf-ID oder Koordinaten fehlen in der Truppenübersicht.');
            for (const u of units) if (!Number.isFinite(troops[u])) throw new Error(`Bestand für ${NAMES[u]} in ${coordinate} nicht lesbar.`);
            villages.set(id, { id, name: label.trim(), coords: coords(coordinate), troops });
        }
        const table = doc.querySelector('#combined_table');
        if (table) {
            const header = [...table.rows].find(r => [...r.cells].some(c => unitFromImage(c.querySelector('img'))));
            if (!header) throw new Error('Einheitenspalten fehlen in der Truppenübersicht.');
            const columns = [...header.cells].map(c => unitFromImage(c.querySelector('img')));
            for (const row of table.querySelectorAll('tr')) {
                if (!row.querySelector('.quickedit-vn')) continue;
                const troops = {};
                columns.forEach((u, index) => { if (units.includes(u)) troops[u] = amount(row.cells[index]?.textContent); });
                add(row, troops);
            }
        } else {
            for (const container of doc.querySelectorAll('.overview-container > div')) {
                if (!container.querySelector('.quickedit-vn')) continue;
                const troops = {};
                for (const item of container.querySelectorAll('.overview-units-row .unit-row-item')) {
                    const u = unitFromImage(item.querySelector('img'));
                    if (units.includes(u)) troops[u] = amount(item.querySelector('.unit-row-name')?.textContent);
                }
                add(container, troops);
            }
            if (!doc.querySelector('.overview-container')) throw new Error('Truppenübersicht nicht gefunden. Premium oder Anmeldung prüfen.');
        }
        return [...villages.values()];
    }

    const core = { amount, coords, formatTime, parseTime, validateConfig, selectedTroops, plan, workbench, parseTroops, sortResults };
    if (typeof module === 'object' && module.exports) { module.exports = core; return; }
    if (!window.game_data || game_data.screen !== 'info_village') return;
    if (window[ID]) { window[ID].scrollIntoView({ block: 'start' }); return; }

    const gd = game_data, units = gd.units.filter(u => Object.hasOwn(NAMES, u));
    const key = `${ID}:${location.host}:${gd.world}:${gd.player.id}`;
    let rows = [], calculated = null, targetId = null, busy = false, worldPromise, mapPromise;
    const sorting = { troops: 0, other: { key: 'launch', direction: 1 } };
    const sortNames = { troops: 'Truppen', distance: 'Felder', launch: 'Abschickzeit', remaining: 'Verbleibend' };
    const sortHelp = 'Klick: aufsteigend → absteigend → aus. Truppen zählt alle enthaltenen Einheiten, nicht ihre Stärke. Truppen kann mit Felder, Abschickzeit oder Verbleibend kombiniert werden. Bei zwei Sortierungen gilt Truppen zuerst (1), bei gleicher Anzahl die andere Spalte (2). Felder und Zeit ersetzen einander. Ohne aktive Sortierung gilt die ursprüngliche Reihenfolge.';
    const abort = new AbortController();
    const panel = document.createElement('section'); panel.id = ID; window[ID] = panel;
    const $ = selector => panel.querySelector(selector);
    function stored(suffix, fallback = null) {
        try { return JSON.parse(localStorage.getItem(`${key}:${suffix}`)) ?? fallback; } catch { return fallback; }
    }
    function save(suffix, value) {
        try { localStorage.setItem(`${key}:${suffix}`, JSON.stringify(value)); }
        catch { message('Einstellungen konnten nicht gespeichert werden.'); }
    }
    function message(text, error = false) {
        $('[data-status]').textContent = text;
        $('[data-status]').dataset.tone = error ? 'error' : busy ? 'loading' : 'info';
    }
    function gameURL(screen, parameters = {}) {
        const url = new URL('/game.php', location.origin);
        url.search = new URLSearchParams({ village: gd.village.id, screen, ...parameters });
        if (Number(gd.player.sitter) > 0) url.searchParams.set('t', gd.player.id);
        return url;
    }
    async function request(url, json = false) {
        const response = await fetch(url, { credentials: 'same-origin', signal: abort.signal,
            headers: json ? { 'TribalWars-Ajax': '1' } : {} });
        if (!response.ok) throw new Error(`Datenabruf fehlgeschlagen (HTTP ${response.status}).`);
        return json ? response.json() : response.text();
    }
    function targetCoords() {
        for (const row of document.querySelectorAll('#content_value tr, .mobileKeyValue > div')) {
            const cells = [...row.children];
            if (/^Koordinaten\s*:?$/i.test(cells[0]?.textContent.trim())) return cells[1]?.textContent.match(/\d+\|\d+/)?.[0] || '';
        }
        const info = window.VillageInfo;
        return info && Number.isFinite(Number(info.x)) && Number.isFinite(Number(info.y)) ? `${info.x}|${info.y}` : '';
    }
    const initialTarget = targetCoords();
    const preferences = stored('preferences', {}), saved = stored(`target:${initialTarget}`, {});
    panel.innerHTML = `<style>
        #${ID}{--ink:#3e2c1d;--muted:#766149;--line:#c9b28a;--accent:#794322;--paper:#faf3df;
            color:var(--ink);font:13px/1.5 Verdana,Arial,sans-serif;background:linear-gradient(110deg,#f8efd7,#eee0bf);
            border:1px solid #987345;border-radius:8px;margin:14px 0;box-shadow:0 3px 12px #45260818;overflow:hidden;isolation:isolate}
        #${ID} *,#${ID} *::before,#${ID} *::after{box-sizing:border-box}
        #${ID} [hidden]{display:none!important}
        #${ID} h2,#${ID} h3,#${ID} p{margin:0;padding:0}
        #${ID} .ds-close{float:right;padding:0!important;width:25px;min-height:25px!important;background:transparent!important;
            border-color:#b5986e!important;box-shadow:none!important;color:#674b2e!important;font-size:19px!important}
        #${ID} .ds-body{padding:12px 16px}
        #${ID} fieldset{min-width:0;margin:0 0 12px;padding:0;border:0}
        #${ID} legend{display:flex;align-items:center;gap:8px;padding:0;margin:0 0 8px;font-size:12px;font-weight:700;color:#573a21}
        #${ID} .ds-step{display:inline-grid;place-items:center;width:23px;height:23px;border:1px solid #bda075;
            border-radius:50%;background:#e9d7b3;font-size:11px;color:#714c29}
        #${ID} .ds-fields{display:grid;grid-template-columns:minmax(140px,1fr) minmax(225px,1.7fr) minmax(140px,1fr);gap:10px}
        #${ID} .ds-field{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:700}
        #${ID} .ds-hint{display:block;color:var(--muted);font-size:11px;font-weight:400;line-height:1.5}
        #${ID} input:not([type=checkbox]),#${ID} select,#${ID} textarea{width:100%;min-width:0;margin:0;padding:7px 9px;
            font:13px/1.3 Verdana,Arial,sans-serif;color:var(--ink);background:#fffaf0;border:1px solid #baa079;
            border-radius:5px;box-shadow:inset 0 1px 3px #6f4b1610}
        #${ID} [data-target]{font-size:16px!important;font-weight:700;letter-spacing:1px}
        #${ID} [data-arrival]{font-variant-numeric:tabular-nums}
        #${ID} :is(input,select,textarea,button,a,summary):focus-visible{outline:2px solid #93602b;outline-offset:3px}
        #${ID} input:disabled,#${ID} select:disabled{opacity:.6}
        #${ID} .ds-unit-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px;flex-wrap:wrap}
        #${ID} .ds-unit-heading legend{margin:0}
        #${ID} .ds-selection-count{color:var(--muted);font-size:11px;font-weight:400}
        #${ID} .ds-presets{display:flex;gap:5px;flex-wrap:wrap}
        #${ID} .ds-units{display:flex;flex-wrap:wrap;gap:5px}
        #${ID} .ds-unit{position:relative;display:grid;place-items:center;width:43px;height:39px;padding:6px;border:1px solid #cebc9a;
            border-radius:5px;background:#faf3e2;cursor:pointer;user-select:none;font-size:11px;transition:background .15s,border-color .15s}
        #${ID} .ds-unit:hover{background:#f0e1bf;border-color:#aa8553}
        #${ID} .ds-unit:has(input:checked){background:#ead4a6;border-color:#a7793e;box-shadow:inset 0 0 0 1px #fff5}
        #${ID} .ds-unit input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
        #${ID} .ds-unit:has(input:focus-visible){outline:2px solid #93602b;outline-offset:2px}
        #${ID} .ds-unit:has(input:checked)::after{content:'✓';position:absolute;right:2px;bottom:0;color:#684118;font-size:10px;font-weight:700;pointer-events:none}
        #${ID} img{width:20px;height:20px;object-fit:contain;vertical-align:middle;flex:none}
        #${ID} .ds-unit img{width:23px;height:23px}
        #${ID} .ds-rule{margin-top:6px;color:var(--muted);font-size:10px}
        #${ID} details{border-top:1px solid #c9b28a80;padding:8px 0;margin-top:9px}
        #${ID} summary{cursor:pointer;color:#654728;font-size:12px;font-weight:700;width:fit-content}
        #${ID} .ds-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:12px 0}
        #${ID} .ds-config-tools{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
        #${ID} button,#${ID} a.ds-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;
            margin:0;padding:7px 11px;border:1px solid #ad8a59;border-radius:5px;background:linear-gradient(#faf1d9,#e4cda1);
            box-shadow:inset 0 1px #fff9;color:#5b3a1c;font:700 11px/1.4 Verdana,Arial,sans-serif;text-decoration:none;
            text-shadow:none;white-space:normal;cursor:pointer;transition:filter .15s}
        #${ID} button:hover:not(:disabled),#${ID} a.ds-button[href]:hover{filter:brightness(1.04);border-color:#845829}
        #${ID} button:disabled,#${ID} a.ds-button:not([href]){opacity:.45;cursor:default;box-shadow:none}
        #${ID} .ds-presets button{min-height:27px;padding:3px 8px;font-size:10px;background:#f6ead0;box-shadow:none}
        #${ID} .ds-primary{background:linear-gradient(#8f572f,#70401f);border-color:#643516;color:#fff5dc;
            box-shadow:inset 0 1px #c99c70,0 2px 3px #4b2c1620;min-height:35px;font-size:12px;padding:7px 14px}
        #${ID} .ds-run{display:flex;align-items:center;gap:10px;border-top:1px solid var(--line);padding-top:10px}
        #${ID} .ds-run .ds-hint{max-width:400px}
        #${ID} [data-status]{display:flex;align-items:center;gap:7px;margin:9px 0 0;padding:7px 9px;background:#f9f1df;
            border:1px solid #d4c19e;border-radius:5px;color:#695336;font-size:11px}
        #${ID} [data-status]::before{content:'';display:block;flex:none;width:7px;height:7px;border-radius:50%;background:#a5814e}
        #${ID} [data-status][data-tone=error]{background:#fbede1;border-color:#c7977d;color:#953d28}
        #${ID} [data-status][data-tone=error]::before{background:#a5442f}
        #${ID} [data-status][data-tone=loading]::before{width:12px;height:12px;background:none;border:2px solid #d4c19e;
            border-top-color:#805125;animation:ds-snipe-spin 1s linear infinite}
        @keyframes ds-snipe-spin{to{transform:rotate(360deg)}}
        #${ID} .ds-result-area{border-top:1px solid #bfa272;background:#f9f2e0;padding:12px 16px}
        #${ID} .ds-result-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:9px}
        #${ID} h3{font:700 17px Georgia,'Times New Roman',serif;color:#573a21;display:flex;align-items:center;gap:8px}
        #${ID} .ds-result-count{display:inline-grid;place-items:center;min-width:25px;height:23px;padding:0 7px;border-radius:4px;
            background:#e7d3ad;color:#775029;font:700 11px Verdana,Arial,sans-serif}
        #${ID} h3{position:relative}
        #${ID} button.ds-sort-help{min-height:18px;width:18px;padding:0;border-radius:50%;border-color:#b79b71;
            background:none;box-shadow:none;font:700 11px Georgia,serif;color:#846846;filter:none!important}
        #${ID} .ds-sort-tooltip{display:none;position:absolute;z-index:10;top:calc(100% + 6px);left:0;width:min(330px,calc(100vw - 60px));
            padding:10px 12px;border:1px solid #b79b71;border-radius:5px;background:#fff8e7;box-shadow:0 3px 9px #45260825;
            font:400 11px/1.6 Verdana,Arial,sans-serif;color:var(--ink);text-align:left;white-space:normal;cursor:default}
        #${ID} .ds-sort-help:hover .ds-sort-tooltip,#${ID} .ds-sort-help:focus-visible .ds-sort-tooltip,
        #${ID} .ds-sort-help[aria-expanded=true] .ds-sort-tooltip{display:block}
        #${ID} button.ds-sort{min-height:24px;padding:2px 0;border:0;background:none;box-shadow:none;font-size:10px;color:#614224;gap:4px;white-space:nowrap}
        #${ID} button.ds-sort:hover{filter:none;text-decoration:underline}
        #${ID} .ds-sort-icon{display:inline-block;min-width:12px;font-size:13px;color:#9b805a}
        #${ID} .ds-sort[data-direction]:not([data-direction="0"]) .ds-sort-icon{color:#70401f;font-weight:700}
        #${ID} .ds-sort-priority{font-size:8px;color:#846846;align-self:flex-start;min-width:5px}
        #${ID} .ds-mobile-sort{display:none}
        #${ID} .ds-result-context{font-size:11px;color:var(--muted);margin-top:4px}
        #${ID} .ds-export-tools{display:flex;gap:6px;flex-wrap:wrap}
        #${ID} .ds-picked-count{font-size:10px;color:var(--muted);align-self:center}
        #${ID} .ds-result-pick,#${ID} .ds-source-head{display:flex;align-items:center;gap:7px}
        #${ID} [data-option],#${ID} [data-select-all]{width:15px;height:15px;margin:0;accent-color:#805125;cursor:pointer;flex:none}
        #${ID} .ds-unselected td{opacity:.65}
        #${ID} .ds-empty{display:flex;align-items:center;justify-content:center;gap:10px;text-align:left;padding:17px 12px;
            border:1px dashed #ccb792;border-radius:5px;background:#f4ead4;color:#7b6548}
        #${ID} .ds-empty-icon{font-size:27px;color:#b0956b}
        #${ID} .ds-empty strong{display:block;color:#705638;font-size:12px;margin-bottom:3px}
        #${ID} .ds-empty p{font-size:11px;max-width:480px}
        #${ID} .ds-table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #cab18a;border-radius:5px;
            overflow:hidden;font-size:11px;table-layout:auto}
        #${ID} .ds-table th{padding:10px 8px;background:linear-gradient(#e6d2ac,#ddc398);color:#614224;text-align:left;
            border-bottom:1px solid #bea071;font-size:10px;font-weight:700;white-space:nowrap}
        #${ID} .ds-table td{padding:8px;vertical-align:top;border-bottom:1px solid #e0cfad;background:#fff8e9}
        #${ID} .ds-table tr:nth-child(even) td{background:#f5ecd8}
        #${ID} .ds-table tr:last-child td{border-bottom:0}
        #${ID} .ds-table tr:hover td{background:#f1e2c2}
        #${ID} .ds-table a:not(.ds-button){color:#76502a;text-decoration:none;font-weight:700;overflow-wrap:anywhere}
        #${ID} .ds-table a:not(.ds-button):hover{text-decoration:underline}
        #${ID} .ds-source-coord{display:block;margin-top:4px;color:#8a7152;font-size:10px;white-space:nowrap}
        #${ID} .ds-troops{display:flex;flex-wrap:wrap;gap:4px;max-width:260px}
        #${ID} .ds-troop{display:inline-flex;align-items:center;gap:4px;padding:3px 5px;border:1px solid #d9c8a6;
            border-radius:4px;background:#f7ecd4;font-variant-numeric:tabular-nums;white-space:nowrap}
        #${ID} .ds-troop img{width:17px;height:17px}
        #${ID} .ds-slowest{font-size:10px}
        #${ID} .ds-slowest img{display:block;margin-bottom:4px}
        #${ID} .ds-launch{font-variant-numeric:tabular-nums;white-space:nowrap}
        #${ID} .ds-launch strong{display:block;font-size:12px}
        #${ID} .ds-launch small{color:#8a7152;font-size:10px}
        #${ID} [data-countdown]{font:700 13px/1.5 Consolas,monospace;color:#654322;white-space:nowrap}
        #${ID} .ds-soon [data-countdown]{color:#9b4126}
        #${ID} .ds-row-actions{display:flex;flex-direction:column;gap:5px;min-width:104px}
        #${ID} .ds-row-actions :is(a,button){min-height:28px;padding:5px 8px;font-size:10px}
        #${ID} .ds-expired td{opacity:.55}
        #${ID} .ds-export-box{padding:16px 22px;background:#eedeBC;border-top:1px solid #c9b28a}
        #${ID} .ds-export-box label{display:block;font-weight:700;font-size:12px;margin-bottom:4px}
        #${ID} .ds-export-box .ds-hint{margin-bottom:9px}
        #${ID} [data-export]{min-height:120px;resize:vertical;font:11px/1.6 Consolas,monospace;background:#fff9ec;word-break:break-all}
        #${ID} .ds-export-box button{margin-top:9px}
        #${ID} .ds-sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
        @media(max-width:1050px){
            #${ID} .ds-table th,#${ID} .ds-table td{padding-left:6px;padding-right:6px}
            #${ID} .ds-troops{max-width:180px} #${ID} .ds-body,#${ID} .ds-result-area{padding-left:16px;padding-right:16px}
        }
        @media(max-width:760px){
            #${ID} .ds-mobile-sort{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;padding:0 0 8px}
            #${ID} .ds-fields{grid-template-columns:1fr 1fr} #${ID} .ds-field-arrival{grid-column:1/-1;grid-row:2}
            #${ID} .ds-table,#${ID} .ds-table tbody{display:block;border:0;background:none;overflow:visible}
            #${ID} .ds-table thead{display:none}
            #${ID} .ds-table tr{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:10px;border:1px solid #cab18a;
                border-radius:6px;overflow:hidden;background:#fff8e9}
            #${ID} .ds-table td{display:block;border:0!important;background:none!important;padding:9px 12px;min-width:0}
            #${ID} .ds-table td::before{content:attr(data-label);display:block;font:400 10px/1.5 Verdana,Arial,sans-serif;color:#8a7152;margin-bottom:3px}
            #${ID} .ds-table td:first-child{grid-column:1/-1;background:#ead7b4!important;border-bottom:1px solid #d7bd92!important;padding:10px 12px}
            #${ID} .ds-table td:first-child::before{display:none}
            #${ID} .ds-table td:nth-child(2){grid-column:1/-1} #${ID} .ds-troops{max-width:none}
            #${ID} .ds-slowest img{display:inline-block;margin:0 4px 0 0}
            #${ID} .ds-table td:last-child{grid-column:1/-1;padding-top:5px}
            #${ID} .ds-table td:last-child::before{display:none}
            #${ID} .ds-row-actions{flex-direction:row} #${ID} .ds-row-actions :is(a,button){flex:1;min-height:36px}
        }
        @media(max-width:480px){
            #${ID}{margin:8px 0;border-radius:6px}
            #${ID} .ds-body,#${ID} .ds-result-area,#${ID} .ds-export-box{padding:10px}
            #${ID} .ds-fields{gap:9px} #${ID} .ds-field{font-size:11px} #${ID} input:not([type=checkbox]),#${ID} select{font-size:12px;padding:7px 8px}
            #${ID} .ds-unit{width:41px;height:39px} #${ID} .ds-unit img{width:22px;height:22px}
            #${ID} .ds-run{align-items:stretch;flex-direction:column;gap:6px} #${ID} .ds-primary{width:100%;min-height:38px}
            #${ID} .ds-result-heading{align-items:stretch;flex-direction:column;gap:10px} #${ID} .ds-export-tools button{flex:1}
            #${ID} .ds-options{grid-template-columns:1fr;gap:12px} #${ID} .ds-empty{padding:22px 12px;align-items:flex-start}
        }
        @media(prefers-reduced-motion:reduce){#${ID} *,#${ID} *::before{animation:none!important;transition:none!important}}
    </style>
    <div class="ds-body">
    <button type="button" class="ds-close" data-action="close" aria-label="Snipe-Planer schließen" title="Schließen">×</button>
    <fieldset><legend><span class="ds-step" aria-hidden="true">1</span> Ziel &amp; Ankunft</legend><div class="ds-fields">
        <label class="ds-field">Zielkoordinaten<input data-target placeholder="500|500" autocomplete="off" spellcheck="false"></label>
        <label class="ds-field ds-field-arrival">Gewünschte Ankunft<input data-arrival placeholder="TT.MM.JJJJ HH:MM:SS" autocomplete="off" spellcheck="false" aria-describedby="ds-snipe-time-hint">
            <span class="ds-hint" id="ds-snipe-time-hint">Serverzeit · TT.MM.JJJJ HH:MM:SS</span></label>
        <label class="ds-field">Dorfgruppe<select data-group title="Nur Dörfer dieser Spielgruppe durchsuchen"><option value="0">Alle Dörfer</option></select></label>
    </div></fieldset>
    <fieldset><legend><span class="ds-step" aria-hidden="true">2</span> Einheiten wählen <span class="ds-selection-count" data-selection-count></span></legend>
        <div class="ds-unit-heading"><div class="ds-presets" aria-label="Einheitenauswahl">
            <button type="button" data-action="units-defense">Defensive</button><button type="button" data-action="units-offense">Offensive</button><button type="button" data-action="units-all">Alle</button>
            <button type="button" data-action="units-none">Keine</button></div></div>
        <div class="ds-units">${units.map(u => `<label class="ds-unit" title="${NAMES[u]}"><input type="checkbox" data-unit="${u}" aria-label="${NAMES[u]}">
        <img src="/graphic/unit/unit_${u}.webp" alt="" aria-hidden="true"></label>`).join('')}</div>
        <p class="ds-rule">Alle ausgewählten Bestände werden übernommen. Die langsamste Einheit bestimmt die Laufzeit.</p>
    </fieldset>
    <details><summary>Filter &amp; weitere Einstellungen</summary><div class="ds-options">
        <label class="ds-field">Mindestmenge je Einheit<input data-minimum type="number" min="1" step="1" aria-describedby="ds-snipe-min-hint">
            <span class="ds-hint" id="ds-snipe-min-hint">Eine ausgewählte Einheit muss diese Menge erreichen. Beim AG reicht 1.
            Kleinere Bestände anderer gewählter Einheiten kommen ebenfalls mit.</span></label>
        <label class="ds-field">Geschwindigkeitsbonus (%)<input data-bonus type="number" min="0" max="1000" step="0.1" aria-describedby="ds-snipe-bonus-hint">
            <span class="ds-hint" id="ds-snipe-bonus-hint">Ohne Bonus: 0. Zum Beispiel 20 für 20 % höhere Geschwindigkeit.</span></label>
        </div><div class="ds-config-tools">
        <button type="button" data-action="config-export">Einstellungen exportieren</button>
        <button type="button" data-action="config-import">Einstellungen importieren</button>
        <button type="button" data-action="reset">Zurücksetzen</button></div></details>
    <div class="ds-run"><button type="button" class="ds-primary" data-action="calculate">Passende Dörfer finden <span aria-hidden="true">→</span></button>
        </div>
    <p data-status role="status" aria-live="polite"></p></div>
    <section class="ds-result-area" aria-labelledby="ds-snipe-results-title">
        <div class="ds-result-heading"><div><h3 id="ds-snipe-results-title">Passende Befehle <span class="ds-result-count" data-result-count>0</span>
        <button type="button" class="ds-sort-help" data-action="sort-help" aria-label="Sortierung erklären" aria-expanded="false" aria-describedby="ds-snipe-sort-hint">i
        <span class="ds-sort-tooltip" id="ds-snipe-sort-hint" role="tooltip">${sortHelp}</span></button></h3>
        <p class="ds-result-context" data-result-context>Nach Abschickzeit sortiert · frühester Befehl zuerst</p></div>
        <div class="ds-export-tools"><label class="ds-result-pick" title="Alle noch abschickbaren Befehle auswählen"><input type="checkbox" data-select-all disabled aria-label="Alle Befehle auswählen"><span class="ds-picked-count" data-picked-count>0 ausgewählt</span></label>
        <button type="button" data-action="wb" disabled>Alle nach Workbench</button>
        <button type="button" data-action="bb" disabled>BBCode kopieren</button></div></div>
        <div data-results></div>
    </section>
    <div class="ds-export-box" data-export-label hidden><label for="ds-snipe-export" data-export-title>Export</label>
        <span class="ds-hint" data-export-hint>Du kannst den Text auch direkt markieren und kopieren.</span>
        <textarea id="ds-snipe-export" data-export spellcheck="false"></textarea>
        <button type="button" class="ds-primary" data-action="import-apply" hidden>Einstellungen übernehmen</button></div>`;
    (document.querySelector('#content_value, #mobileContent, #contentContainer') || document.body).prepend(panel);

    function fill(config) {
        $('[data-target]').value = config.target ?? initialTarget;
        $('[data-arrival]').value = config.arrival ?? formatTime(serverNow() + 3600000);
        $('[data-bonus]').value = config.bonus ?? 0;
        $('[data-minimum]').value = config.minimum ?? 50;
        $('[data-group]').value = config.group ?? '0';
        const chosen = Array.isArray(config.selected) ? config.selected : DEFAULT_UNITS;
        panel.querySelectorAll('[data-unit]').forEach(e => { e.checked = chosen.includes(e.dataset.unit); });
        selectionCount();
    }
    function selectionCount() {
        const count = panel.querySelectorAll('[data-unit]:checked').length;
        $('[data-selection-count]').textContent = `${count} von ${units.length}`;
    }
    function emptyResults(title = 'Dein Plan beginnt mit einem Ziel.', description = 'Wähle Einheiten und eine Ankunftszeit. Danach findest du hier die passenden Dörfer mit ihren Abschickzeiten.') {
        $('[data-results]').innerHTML = `<div class="ds-empty"><span class="ds-empty-icon" aria-hidden="true">⌖</span>
            <div><strong>${escape(title)}</strong><p>${escape(description)}</p></div></div>`;
    }
    let clockBase = 0, clockAt = 0;
    function serverNow() {
        const native = window.Timing?.getCurrentServerTime?.();
        if (Number.isFinite(native) && native > 1e12) return native;
        const text = `${document.querySelector('#serverDate')?.textContent.trim()} ${document.querySelector('#serverTime')?.textContent.trim()}`;
        try {
            const timestamp = parseTime(text);
            if (timestamp !== clockBase) { clockBase = timestamp; clockAt = performance.now(); }
            return clockBase + performance.now() - clockAt;
        } catch { throw new Error('Serverzeit nicht lesbar. Die Dorfseite neu laden.'); }
    }
    function readConfig() {
        return { ...validateConfig({ target: $('[data-target]').value, arrival: $('[data-arrival]').value,
            bonus: $('[data-bonus]').value, minimum: $('[data-minimum]').value,
            selected: [...panel.querySelectorAll('[data-unit]:checked')].map(e => e.dataset.unit) }, units),
        group: $('[data-group]').value };
    }
    function invalidate() {
        rows = []; calculated = null; emptyResults();
        $('[data-result-count]').textContent = '0';
        $('[data-result-context]').textContent = 'Nach Abschickzeit sortiert · frühester Befehl zuerst';
        $('[data-action="wb"]').disabled = $('[data-action="bb"]').disabled = true;
        $('[data-export-label]').hidden = true;
        updateResultSelection();
    }
    function updateResultSelection(now = rows.length ? serverNow() : 0) {
        const available = rows.filter(r => r.launch > now), selected = available.filter(r => r.selected);
        const all = available.length > 0 && selected.length === available.length;
        const checkbox = $('[data-select-all]');
        checkbox.checked = all;
        checkbox.indeterminate = selected.length > 0 && !all;
        checkbox.disabled = busy || !available.length;
        $('[data-picked-count]').textContent = `${selected.length} / ${available.length} ausgewählt`;
        $('[data-action="wb"]').textContent = !available.length || all ? 'Alle nach Workbench' : 'Ausgewählte nach Workbench';
        $('[data-action="wb"]').disabled = $('[data-action="bb"]').disabled = busy || !selected.length;
        panel.querySelectorAll('[data-row]').forEach(e => { e.classList.toggle('ds-unselected', !rows[Number(e.dataset.row)].selected); });
    }
    async function speeds() {
        if (!worldPromise) worldPromise = (async () => {
            const cache = stored('speeds');
            if (cache && Date.now() - cache.time >= 0 && Date.now() - cache.time < 86400000 &&
                units.every(u => Number(cache.data?.[u]) > 0)) return cache.data;
            const xml = new DOMParser().parseFromString(await request('/interface.php?func=get_unit_info'), 'application/xml');
            const data = Object.fromEntries(units.map(u => [u, Number(xml.querySelector(`config > ${u} > speed`)?.textContent)]));
            if (xml.querySelector('parsererror') || units.some(u => !(data[u] > 0))) throw new Error('Einheitenlaufzeiten der Welt fehlen.');
            save('speeds', { time: Date.now(), data }); return data;
        })().catch(error => { worldPromise = null; throw error; });
        return worldPromise;
    }
    async function loadTroops(group) {
        const pending = [gameURL('overview_villages', { mode: 'combined', group, page: '-1' })];
        const seen = new Set(), all = new Map();
        while (pending.length) {
            const url = pending.shift(); if (seen.has(url.href)) continue;
            if (seen.size >= 100) throw new Error('Zu viele Übersichtsseiten. Eine kleinere Dorfgruppe wählen.');
            seen.add(url.href);
            const doc = new DOMParser().parseFromString(await request(url), 'text/html');
            for (const village of parseTroops(doc, units)) all.set(village.id, village);
            for (const link of doc.querySelectorAll('a[href*="page="]')) {
                const next = new URL(link.getAttribute('href'), url);
                const p = next.searchParams;
                if (next.origin === location.origin && p.get('screen') === 'overview_villages' &&
                    p.get('mode') === 'combined' && /^\d+$/.test(p.get('page') ?? '') &&
                    (p.get('group') ?? '0') === String(group)) {
                    const page = gameURL('overview_villages', { mode: 'combined', group, page: p.get('page') });
                    if (!seen.has(page.href)) pending.push(page);
                }
            }
        }
        return [...all.values()];
    }
    async function resolveTarget(coordinate) {
        const pageId = Number(window.VillageInfo?.village_id || new URL(location.href).searchParams.get('id'));
        if (initialTarget && coordinate === coords(initialTarget) && pageId > 0) return pageId;
        if (!mapPromise) mapPromise = request('/map/village.txt').catch(error => { mapPromise = null; throw error; });
        const [x, y] = coordinate.split('|');
        for (const line of (await mapPromise).split('\n')) {
            const [id, , vx, vy] = line.trim().split(',');
            if (vx === x && vy === y) return Number(id);
        }
        throw new Error('Ziel-Dorf nicht in den Weltdaten gefunden. Seine Dorfinfo öffnen und dort berechnen.');
    }
    function commandURL(row) {
        const [x, y] = calculated.target.split('|');
        return gameURL('place', { village: row.id, x, y, ...row.troops }).href;
    }
    function sortButton(key) {
        const tooltip = key === 'troops' ? 'Nach Gesamtanzahl aller enthaltenen Einheiten sortieren, nicht nach Stärke.' :
            key === 'distance' ? 'Nach Entfernung in Feldern sortieren.' :
            key === 'remaining' ? 'Nach verbleibender Zeit bis zum Abschicken sortieren.' : 'Nach Abschickdatum und Uhrzeit sortieren.';
        return `<button type="button" class="ds-sort" data-action="sort" data-sort="${key}" title="${tooltip}" aria-label="${sortNames[key]} sortieren">
            ${sortNames[key]}<span class="ds-sort-icon" aria-hidden="true">↕</span><sup class="ds-sort-priority" aria-hidden="true"></sup></button>`;
    }
    function applySorting() {
        const tbody = $('[data-results] tbody');
        if (tbody) {
            const indices = new Map(rows.map((row, index) => [row, index]));
            const elements = new Map([...tbody.children].map(element => [Number(element.dataset.row), element]));
            for (const row of sortResults(rows, sorting)) tbody.append(elements.get(indices.get(row)));
        }
        panel.querySelectorAll('[data-sort]').forEach(button => {
            const key = button.dataset.sort;
            const direction = key === 'troops' ? sorting.troops : sorting.other?.key === key ? sorting.other.direction : 0;
            const both = sorting.troops && sorting.other;
            button.dataset.direction = String(direction);
            button.querySelector('.ds-sort-icon').textContent = direction > 0 ? '↑' : direction < 0 ? '↓' : '↕';
            button.querySelector('.ds-sort-priority').textContent = direction && both ? key === 'troops' ? '1' : '2' : '';
            button.setAttribute('aria-label', `${sortNames[key]}: ${direction > 0 ? 'aufsteigend' : direction < 0 ? 'absteigend' : 'Sortierung aus'}. Klick schaltet weiter.`);
            const th = button.closest('th');
            // aria-sort bezeichnet nur das Hauptkriterium; die zweite Priorität steht am Icon und im Hilfetext.
            if (th) {
                if (direction && (key === 'troops' || !sorting.troops)) th.setAttribute('aria-sort', direction > 0 ? 'ascending' : 'descending');
                else th.removeAttribute('aria-sort');
            }
        });
        const names = [];
        if (sorting.troops) names.push(`Truppen ${sorting.troops > 0 ? '↑' : '↓'}`);
        if (sorting.other) names.push(`${sortNames[sorting.other.key]} ${sorting.other.direction > 0 ? '↑' : '↓'}`);
        const order = names.length ? names.join(', dann ') : 'ursprüngliche Reihenfolge';
        if (calculated) $('[data-result-context]').textContent = `Ziel ${calculated.target} · Ankunft ${calculated.arrival} · ${order}`;
        const caption = $('[data-results] caption');
        if (caption) caption.textContent = `Mögliche Befehle: ${order}`;
    }
    function render() {
        $('[data-result-count]').textContent = String(rows.length);
        $('[data-result-context]').textContent = `Ziel ${calculated.target} · Ankunft ${calculated.arrival} · frühester Befehl zuerst`;
        if (!rows.length) {
            emptyResults('Keine passenden Dörfer gefunden.', 'Prüfe die Einheiten, senke bei Bedarf die Mindestmenge oder wähle eine spätere Ankunft.');
            return;
        }
        $('[data-results]').innerHTML = `<div class="ds-mobile-sort" role="group" aria-label="Ergebnisse sortieren">${Object.keys(sortNames).map(sortButton).join('')}</div>
        <table class="ds-table"><caption class="ds-sr-only">Mögliche Befehle nach Abschickzeit sortiert</caption><thead><tr>
        <th>Herkunft</th><th>${sortButton('troops')}</th><th>Tempo durch</th><th>${sortButton('distance')}</th><th>${sortButton('launch')}</th><th>${sortButton('remaining')}</th><th>Befehl</th>
        </tr></thead><tbody>${rows.map((r, i) => {
            const [day, time] = formatTime(r.launch).split(' ');
            const name = r.name.replace(/\s*\(\d+\|\d+\)\s*K\d+\s*$/, '');
            return `<tr data-row="${i}"><td data-label="Herkunft"><div class="ds-source-head"><input type="checkbox" data-option="${i}" ${r.selected ? 'checked' : ''} aria-label="Befehl aus ${escape(r.coords)} auswählen"><a target="_blank" rel="noopener noreferrer" href="${escape(gameURL('info_village', { id: r.id }))}">${escape(name)}</a></div>
            <span class="ds-source-coord">${escape(r.coords)} · K${r.coords.split('|').map(Number).map(n => Math.floor(n / 100)).reverse().join('')}</span></td>
            <td data-label="Truppen"><div class="ds-troops">${Object.entries(r.troops).map(([u, n]) =>
                `<span class="ds-troop" title="${NAMES[u]}: ${n.toLocaleString('de-DE')}"><img src="/graphic/unit/unit_${u}.webp" alt="${NAMES[u]}">${n.toLocaleString('de-DE')}</span>`).join('')}</div></td>
            <td class="ds-slowest" data-label="Tempo durch"><img src="/graphic/unit/unit_${r.unit}.webp" alt="" aria-hidden="true">${NAMES[r.unit]}</td>
            <td data-label="Entfernung">${r.distance.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="ds-launch" data-label="Abschickzeit"><strong>${time}</strong><small>${day}</small></td><td data-label="Verbleibend"><span data-countdown></span></td>
            <td data-label="Befehl"><div class="ds-row-actions"><a class="ds-button" data-place target="_blank" rel="noopener noreferrer" href="${escape(commandURL(r))}">Versammlungsplatz <span aria-hidden="true">↗</span></a>
            <button type="button" data-action="row-wb" data-index="${i}" aria-label="Workbench-Befehl aus ${escape(r.coords)} kopieren">WB kopieren</button></div></td></tr>`;
        }).join('')}</tbody></table>`;
        applySorting();
        tick();
    }
    function tick() {
        if (!rows.length) return;
        let now; try { now = serverNow(); } catch (error) { invalidate(); message(error.message, true); return; }
        panel.querySelectorAll('[data-row]').forEach(element => {
            const remaining = rows[Number(element.dataset.row)].launch - now, expired = remaining <= 0;
            element.classList.toggle('ds-expired', expired);
            element.classList.toggle('ds-soon', !expired && remaining <= 60000);
            const seconds = Math.max(0, Math.ceil(remaining / 1000));
            element.querySelector('[data-countdown]').textContent = expired ? 'Abgelaufen' :
                `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
            element.querySelector('button').disabled = expired;
            element.querySelector('[data-option]').disabled = expired;
            const link = element.querySelector('[data-place]');
            if (expired) { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); }
        });
        const active = rows.filter(r => r.launch > now).length;
        $('[data-result-count]').textContent = String(active);
        $('[data-result-count]').setAttribute('aria-label', `${active} noch abschickbare Befehle`);
        updateResultSelection(now);
    }
    async function copy(text, title = 'Workbench-Import') {
        $('[data-export-label]').hidden = false; $('[data-action="import-apply"]').hidden = true;
        $('[data-export-title]').textContent = title;
        $('[data-export-hint]').textContent = 'Du kannst den Text auch direkt markieren und kopieren.';
        const field = $('[data-export]'); field.readOnly = true; field.value = text;
        try { await navigator.clipboard.writeText(text); message('Export kopiert.'); }
        catch {
            field.focus(); field.select();
            message(document.execCommand('copy') ? 'Export kopiert.' : 'Kopieren nicht erlaubt. Den markierten Export mit Strg+C kopieren.');
        }
    }
    async function calculate() {
        const config = readConfig();
        if (parseTime(config.arrival) <= serverNow()) throw new Error('Die Ankunft muss in der Zukunft liegen.');
        busy = true; invalidate();
        panel.setAttribute('aria-busy', 'true');
        $('[data-action="calculate"]').textContent = 'Dörfer werden geprüft …';
        emptyResults('Dörfer werden geprüft …', 'Aktuelle Truppenbestände und Laufzeiten werden geladen.');
        panel.querySelectorAll('input, select, button:not([data-action="close"])').forEach(e => { e.disabled = true; });
        message('Aktuelle Bestände und Laufzeiten werden geladen …');
        try {
            const [villages, info, destination] = await Promise.all([loadTroops(config.group), speeds(), resolveTarget(config.target)]);
            rows = plan(villages, info, config, serverNow()).map(row => ({ ...row, selected: true })); calculated = config; targetId = destination;
            save('preferences', { selected: config.selected, group: config.group }); save(`target:${config.target}`, config);
            render(); message(`${rows.length} mögliche Befehle aus ${villages.length} Dörfern. Bestände geladen: ${formatTime(Math.floor(serverNow() / 1000) * 1000)}.`);
        } finally {
            busy = false; panel.querySelectorAll('input, select, button').forEach(e => { e.disabled = false; });
            panel.setAttribute('aria-busy', 'false');
            $('[data-action="calculate"]').innerHTML = 'Passende Dörfer finden <span aria-hidden="true">→</span>';
            if ($('[data-status]').dataset.tone === 'loading') $('[data-status]').dataset.tone = 'info';
            if (!calculated) emptyResults('Berechnung nicht abgeschlossen.', 'Beachte den Hinweis oben und starte die Berechnung erneut.');
            $('[data-action="wb"]').disabled = $('[data-action="bb"]').disabled = !rows.length;
            tick();
            updateResultSelection();
        }
    }
    panel.addEventListener('input', event => {
        if (event.target.matches('input:not([data-option]):not([data-select-all]), select')) { invalidate(); selectionCount(); message('Filter geändert. Bitte neu berechnen.'); }
    });
    panel.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.target.matches('input:not([type=checkbox])') && !busy) {
            event.preventDefault(); $('[data-action="calculate"]').click();
        }
    });
    panel.addEventListener('change', event => {
        if (event.target.matches('[data-option], [data-select-all]')) {
            const now = serverNow();
            if (event.target.matches('[data-select-all]')) {
                for (const row of rows) if (row.launch > now) row.selected = event.target.checked;
                panel.querySelectorAll('[data-option]').forEach(e => { e.checked = rows[Number(e.dataset.option)].selected; });
            } else {
                const row = rows[Number(event.target.dataset.option)];
                if (row && row.launch > now) row.selected = event.target.checked;
            }
            $('[data-export-label]').hidden = true; updateResultSelection(now);
            return;
        }
        if (event.target.matches('[data-group]')) { invalidate(); message('Dorfgruppe geändert. Bitte neu berechnen.'); }
    });
    panel.addEventListener('click', async event => {
        const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
        try {
            const action = button.dataset.action;
            if (action === 'close') { abort.abort(); clearInterval(timer); document.removeEventListener('click', commandClick); panel.remove(); delete window[ID]; return; }
            if (busy) return;
            if (action === 'sort-help') {
                button.setAttribute('aria-expanded', button.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
                return;
            }
            if (action === 'sort') {
                const key = button.dataset.sort;
                const old = key === 'troops' ? sorting.troops : sorting.other?.key === key ? sorting.other.direction : 0;
                const direction = old === 0 ? 1 : old === 1 ? -1 : 0;
                if (key === 'troops') sorting.troops = direction;
                else sorting.other = direction ? { key, direction } : null;
                applySorting();
                $('[data-export-label]').hidden = true;
                return;
            }
            if (action.startsWith('units-')) {
                const chosen = action === 'units-all' ? units : action === 'units-defense' ? DEFAULT_UNITS : action === 'units-offense' ? OFFENSE_UNITS : [];
                panel.querySelectorAll('[data-unit]').forEach(e => { e.checked = chosen.includes(e.dataset.unit); });
                selectionCount(); invalidate(); message('Einheitenauswahl geändert. Bitte neu berechnen.');
            }
            if (action === 'calculate') await calculate();
            if (action === 'row-wb') {
                const row = rows[Number(button.dataset.index)];
                if (!row || row.launch <= serverNow()) throw new Error('Dieser Befehl ist bereits abgelaufen.');
                await copy(workbench(row, targetId));
            }
            const future = sortResults(rows, sorting).filter(r => r.selected && r.launch > serverNow());
            if (action === 'wb' || action === 'bb') {
                if (!future.length) throw new Error('Keine zukünftigen Befehle zum Exportieren ausgewählt.');
                await copy(action === 'wb' ? future.map(r => workbench(r, targetId)).join('') :
                    `[b]Ziel: [coord]${calculated.target}[/coord] – Ankunft: ${calculated.arrival}[/b]\n` + future.map(r =>
                        `[coord]${r.coords}[/coord] – ${Object.entries(r.troops).map(([u, n]) => `${NAMES[u]}: ${n}`).join(', ')} – Abschicken: ${formatTime(r.launch)}`).join('\n'),
                    action === 'wb' ? 'Workbench-Import' : 'BBCode');
            }
            if (action === 'config-export') await copy(JSON.stringify(readConfig(), null, 2), 'Einstellungen exportieren');
            if (action === 'config-import') {
                $('[data-export-label]').hidden = false; $('[data-export]').readOnly = false; $('[data-export]').value = '';
                $('[data-export-title]').textContent = 'Einstellungen importieren';
                $('[data-export-hint]').textContent = 'Eine zuvor exportierte JSON-Konfiguration einfügen und übernehmen.';
                $('[data-action="import-apply"]').hidden = false; $('[data-export]').focus();
                $('[data-export-label]').scrollIntoView({ block: 'nearest' });
                message('JSON-Konfiguration einfügen und übernehmen.');
            }
            if (action === 'import-apply') {
                const raw = JSON.parse($('[data-export]').value), config = validateConfig(raw, units);
                const group = String(raw.group ?? '0');
                if (![...$('[data-group]').options].some(o => o.value === group)) throw new Error('Diese Dorfgruppe ist nicht verfügbar.');
                invalidate(); fill({ ...config, group }); message('Konfiguration übernommen. Bitte berechnen.');
            }
            if (action === 'reset') {
                for (const k of Object.keys(localStorage)) if (k.startsWith(`${key}:`)) localStorage.removeItem(k);
                invalidate(); worldPromise = null; fill({}); message('Einstellungen zurückgesetzt.');
            }
        } catch (error) { if (error.name !== 'AbortError') message(error.message, true); }
    });
    function commandClick(event) {
        if (busy || event.target.closest('a, button, input')) return;
        const row = event.target.closest('#commands_incomings tr.command-row, #commands_outgoings tr.command-row');
        if (!row) return;
        try {
            const end = row.querySelector('[data-endtime]')?.getAttribute('data-endtime');
            let timestamp = Number(end) * 1000;
            if (!end || !Number.isFinite(timestamp) || timestamp < 1e12) {
                const text = row.cells[1]?.textContent.trim() || '';
                const time = text.match(/\d{1,2}:\d{2}:\d{2}(?:[.:]\d{1,3})?/)?.[0];
                if (!time) throw new Error('Ankunftszeit dieses Befehls nicht lesbar.');
                const date = text.match(/\d{1,2}[./]\d{1,2}[./]\d{4}/)?.[0];
                if (date) timestamp = parseTime(`${date} ${time}`);
                else {
                    const day = dateParts(serverNow());
                    const tomorrow = /morgen/i.test(text);
                    if (!tomorrow && !/heute/i.test(text)) throw new Error('Ankunftsdatum nicht lesbar. Bitte manuell eingeben.');
                    const nextDay = new Date(Date.UTC(day.year, day.month - 1, day.day + Number(tomorrow), 12));
                    timestamp = parseTime(`${nextDay.getUTCDate()}.${nextDay.getUTCMonth() + 1}.${nextDay.getUTCFullYear()} ${time}`);
                }
            }
            invalidate(); $('[data-arrival]').value = formatTime(timestamp); message('Ankunft aus dem angeklickten Befehl übernommen.');
        } catch (error) { message(error.message, true); }
    }
    document.addEventListener('click', commandClick);
    const timer = setInterval(tick, 250);
    try {
        emptyResults();
        fill({ ...preferences, ...saved });
        const landing = Number(new URL(location.href).searchParams.get('landingTime'));
        if (Number.isFinite(landing) && landing > 1e12) $('[data-arrival]').value = formatTime(landing);
        if (!gd.features?.Premium?.active) message('Für die Truppenübersicht wird ein Premium-Account benötigt.', true);
        else message('Ziel und Ankunft prüfen, dann berechnen. Eine Befehlszeile übernimmt ihre Ankunftszeit.');
    } catch (error) { message(error.message, true); }
    request(gameURL('groups', { mode: 'overview', ajax: 'load_group_menu' }), true).then(data => {
        const result = data.result ?? data.response?.result;
        if (!result || typeof result !== 'object') throw new Error('Gruppenliste fehlt.');
        for (const group of Object.values(result)) {
            const id = String(group.group_id);
            if (/^\d+$/.test(id) && id !== '0' && typeof group.name === 'string') $('[data-group]').add(new Option(group.name, id));
        }
        if (!busy && !calculated) $('[data-group]').value = String(saved.group ?? preferences.group ?? '0');
        if (!$('[data-group]').value) $('[data-group]').value = '0';
    }).catch(error => { if (error.name !== 'AbortError') message('Dorfgruppen konnten nicht geladen werden. „Alle Dörfer“ bleibt verfügbar.', true); });
})();
