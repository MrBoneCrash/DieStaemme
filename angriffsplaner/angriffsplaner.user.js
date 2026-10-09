// ==UserScript==
// @name         Die Stämme – Angriffsplaner
// @namespace    local.die-staemme.angriffsplaner
// @version      1.5.4
// @description  Plant Fakes und Offs aus eigenen Beständen mit TWForge-Berichten, Zeitfenstern und Workbench-Export. Nutzung auf eigene Gefahr.
// @match        https://*.die-staemme.de/game.php?*screen=place*
// @exclude      /^[^?]+\?(?!(?=(?:[^#]*&)?screen=place(?:&|#|$))(?!(?:[^#]*&)?(?:try|action)(?:=|&|#|$))(?!(?:[^#]*&)?mode=(?!(?:command)?(?:&|#|$))[^&#]*(?:&|#|$)))/
// @exclude      /^[^?]+\?(?:[^#]*&)?(screen|mode)=[^#]*&\1=/
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      twforge.net
// @run-at       document-idle
// ==/UserScript==

// Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.
// Vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen prüfen.

(function () {
    'use strict';
    const ID = 'ds-angriffsplaner';
    const OFF = ['axe', 'light', 'marcher', 'ram', 'catapult'];
    const FILL = ['spy', 'axe', 'sword', 'archer', 'light', 'marcher', 'heavy'];
    const NAMES = { spear: 'Speerträger', sword: 'Schwertkämpfer', axe: 'Axtkämpfer', archer: 'Bogenschütze',
        spy: 'Späher', light: 'Leichte Kavallerie', marcher: 'Berittener Bogenschütze', heavy: 'Schwere Kavallerie',
        ram: 'Rammbock', catapult: 'Katapult', knight: 'Paladin', snob: 'Adelsgeschlecht' };
    const DAY = 86400000, LIMIT = 20000;
    const timingCaches = new WeakMap();
    const escape = value => String(value).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric',
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    function parts(time) {
        return Object.fromEntries(formatter.formatToParts(time).filter(p => p.type !== 'literal').map(p => [p.type, +p.value]));
    }
    function formatTime(time) {
        const p = parts(time), pad = n => String(n).padStart(2, '0');
        return `${pad(p.day)}.${pad(p.month)}.${p.year} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
    }
    function parseTime(value) {
        const m = String(value).trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
        if (!m) throw new Error('Zeit als TT.MM.JJJJ HH:MM:SS eingeben.');
        const [, d, mo, y, h, mi, s] = m.map(Number), wall = Date.UTC(y, mo - 1, d, h, mi, s), found = [];
        for (const offset of [60, 120]) {
            const t = wall - offset * 60000, p = parts(t);
            if (p.day === d && p.month === mo && p.year === y && p.hour === h && p.minute === mi && p.second === s) found.push(t);
        }
        if (found.length !== 1) throw new Error('Ungültige oder durch die Zeitumstellung doppeldeutige Serverzeit.');
        return found[0];
    }
    function amount(value) {
        if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : NaN;
        const s = String(value ?? '').trim().replace(/[\s\u00a0\u202f]/g, '');
        return /^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(s) ? Number(s.replace(/\./g, '')) : NaN;
    }
    function decode(value) { try { return decodeURIComponent(String(value).replace(/\+/g, ' ')); } catch { throw new Error('Ungültige Weltdaten.'); } }
    function parseMap(playerText, villageText, allyText = '') {
        const players = new Map(), villages = new Map(), byCoords = new Map(), byPlayer = new Map(), allies = new Map(), byAlly = new Map();
        for (const line of allyText.trim().split(/\r?\n/)) {
            const [id, name, tag] = line.split(',');
            if (/^\d+$/.test(id) && name && tag) allies.set(+id, { id: +id, name: decode(name), tag: decode(tag) });
        }
        for (const line of playerText.trim().split(/\r?\n/)) {
            const [id, name, ally] = line.split(',');
            if (/^\d+$/.test(id) && name) {
                const p = { id: +id, name: decode(name), ally: +ally || 0 };
                players.set(p.name.toLocaleLowerCase('de'), p);
                if (!byAlly.has(p.ally)) byAlly.set(p.ally, []);
                byAlly.get(p.ally).push(p);
            }
        }
        for (const line of villageText.trim().split(/\r?\n/)) {
            const [id, name, x, y, player, points] = line.split(',');
            if (!/^\d+$/.test(id) || !/^\d+$/.test(player) || !/^\d+$/.test(x) || !/^\d+$/.test(y) || !Number.isFinite(amount(points))) continue;
            const v = { id: +id, name: decode(name), x: +x, y: +y, coords: `${+x}|${+y}`, player: +player, points: amount(points) };
            villages.set(v.id, v); byCoords.set(v.coords, v);
            if (!byPlayer.has(v.player)) byPlayer.set(v.player, []);
            byPlayer.get(v.player).push(v);
        }
        if (!players.size || !villages.size) throw new Error('Spieler- oder Dorfkarte nicht lesbar.');
        return { players, villages, byCoords, byPlayer, allies, byAlly };
    }
    function resolveTargets(text, map, ownPlayer) {
        const tokens = String(text).split(/[\n,;]+/).map(t => t.trim()).filter(Boolean), targets = new Map(), validation = [];
        for (const token of tokens) {
            const coordinate = token.match(/^(\d{1,3})\s*\|\s*(\d{1,3})$/),
                p = !coordinate && map.players.get(token.toLocaleLowerCase('de')),
                allyMatch = token.match(/^Stamm-ID:(\d+)$/i),
                namedAllies = !coordinate && !p && !allyMatch ? [...(map.allies?.values() || [])].filter(a =>
                    [a.name, a.tag, `[${a.tag}]`].some(name => name.toLocaleLowerCase('de') === token.toLocaleLowerCase('de'))) : [],
                ally = allyMatch ? map.allies?.get(+allyMatch[1]) : namedAllies.length === 1 ? namedAllies[0] : null;
            const matched = ally ? (map.byAlly.get(ally.id) || []).flatMap(p => map.byPlayer.get(p.id) || []) : coordinate ? [map.byCoords.get(`${+coordinate[1]}|${+coordinate[2]}`)].filter(Boolean) : p ? map.byPlayer.get(p.id) || [] : [];
            const enemies = matched.filter(v => v.player !== Number(ownPlayer));
            validation.push({ token, valid: enemies.length > 0, count: enemies.length,
                message: enemies.length ? `${ally ? `[${ally.tag}] ${ally.name}` : p?.name || token}: ${enemies.length} Ziel${enemies.length === 1 ? '' : 'e'}` : namedAllies.length > 1 ? `${token}: mehrdeutiger Stammname, eindeutigen Namen oder Tag eingeben` : matched.length ? `${token}: eigenes Dorf / eigener Spieler` : `${token}: nicht gefunden oder ohne Dörfer` });
            enemies.forEach(v => targets.set(v.id, v));
        }
        return { targets: [...targets.values()], validation, valid: tokens.length > 0 && validation.every(v => v.valid) };
    }
    function readTemplates(raw) {
        if (!raw || raw.version !== 1 || !Array.isArray(raw.templates)) return [];
        return raw.templates.filter(t => typeof t?.id === 'string' && typeof t.name === 'string')
            .map(t => ({ id: t.id, name: t.name.slice(0, 60), units: Object.fromEntries(OFF.map(u => [u, Number.isFinite(amount(t.units?.[u])) ? amount(t.units[u]) : 0])) }))
            .filter(t => Object.values(t.units).some(n => n > 0));
    }
    function minimumPop(source, world) {
        if (!Number.isFinite(source.points) || source.points < 0) throw new Error(`Dorfpunkte fehlen für ${source.coords}.`);
        return Math.max(1, Math.ceil(source.points * world.fakeLimit / 100 - 1e-9));
    }
    function fakeMinimumPop(source, world) { return minimumPop(source, world) + 3; }
    function population(troops, world) { return Object.entries(troops).reduce((sum, [u, n]) => sum + n * (world.units[u]?.pop || 0), 0); }
    function offensivePopulation(stock, world) { return population(Object.fromEntries(OFF.map(u => [u, stock[u] || 0])), world); }
    function minimumOff(config) { return typeof config.minimumOff === 'number' ? config.minimumOff : 1; }
    function meetsOff(stock, world, config) {
        const minima = config.minimumOffUnits || {};
        return OFF.every(u => (stock[u] || 0) >= (minima[u] || 0)) && attack(stock, world) > 0 &&
            offensivePopulation(stock, world) >= minimumOff(config);
    }
    function canFake(source, stock, world, config) {
        return source.role !== 'off' || !meetsOff(stock, world, config);
    }
    function attack(troops, world) { return Object.entries(troops).reduce((sum, [u, n]) => sum + n * (world.units[u]?.attack || 0), 0); }
    function fakePacket(stock, source, world) {
        const siege = world.units.catapult && stock.catapult > 0 ? 'catapult' : world.units.ram && stock.ram > 0 ? 'ram' : null;
        if (!siege) return null;
        const scout = world.units.spy && stock.spy > 0 ? 1 : 0;
        const minimum = fakeMinimumPop(source, world), scoutPop = scout * (world.units.spy?.pop || 0);
        // Möglichst Katapulte + genau einen Späher; nur bei knappen Katapulten weitere Fülltruppen.
        const count = siege === 'catapult' ? Math.min(stock.catapult, Math.max(1, Math.ceil((minimum - scoutPop) / world.units.catapult.pop))) : 1;
        const troops = { [siege]: count, ...(scout ? { spy: 1 } : {}) };
        let missing = minimum - count * world.units[siege].pop - scoutPop;
        for (const u of FILL) {
            if (!(missing > 0)) break;
            if (!world.units[u] || !(stock[u] > 0)) continue;
            const n = Math.min(stock[u] - (troops[u] || 0), Math.ceil(missing / world.units[u].pop));
            if (n > 0) { troops[u] = (troops[u] || 0) + n; missing -= n * world.units[u].pop; }
        }
        return missing <= 0 ? troops : null;
    }
    function normalizeReport(data, world, now, ageDays) {
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) return null;
        const fresh = seconds => Number.isFinite(+seconds) && +seconds > 0 && now - +seconds * 1000 >= 0 && now - +seconds * 1000 <= ageDays * DAY;
        const units = Object.keys(world.units).filter(u => u !== 'knight');
        function readTroops(obj, losses) {
            if (!obj || typeof obj !== 'object') return null;
            const troops = {};
            for (const u of units) {
                const count = amount(obj[u]);
                if (!Number.isFinite(count)) return null; // Unbekannt ist nicht null Truppen.
                const loss = obj[`loss_${u}`] == null ? 0 : amount(obj[`loss_${u}`]);
                if (!Number.isFinite(loss) || loss > count) return null;
                troops[u] = losses ? count - loss : count;
            }
            return troops;
        }
        const candidates = [];
        if (fresh(data.unit_time)) {
            const troops = readTroops(data, false);
            if (troops) candidates.push({ troops, time: +data.unit_time * 1000, id: null, kind: 'Bestand im Dorf' });
        }
        if (fresh(data.defend_report?.fighttime)) {
            const troops = readTroops(data.defend_report, true);
            if (troops) candidates.push({ troops, time: +data.defend_report.fighttime * 1000, id: data.defend_report.report_id, kind: 'Verteidigungsbericht' });
        }
        candidates.sort((a, b) => b.time - a.time);
        const stationary = candidates[0] || null, outside = fresh(data.attack_report?.fighttime) ? readTroops(data.attack_report, true) : null;
        if (!stationary && !outside) return null;
        const hasAG = (stationary?.troops.snob || 0) > 0 || (outside?.snob || 0) > 0;
        const isOff = Number(data.type) === 1 || attack(stationary?.troops || outside || {}, world) > 0 &&
            population(Object.fromEntries(OFF.map(u => [u, (stationary?.troops || outside)[u] || 0])), world) >
            population(Object.fromEntries(['spear', 'sword', 'archer', 'heavy'].map(u => [u, (stationary?.troops || outside)[u] || 0])), world);
        // Angriffsberichte belegen eigene Truppen außerhalb des Dorfes, keine stationierte Verteidigung.
        return { ...stationary, time: stationary?.time || +data.attack_report.fighttime * 1000,
            id: stationary?.id || data.attack_report?.report_id || null, troops: stationary?.troops || null,
            kind: stationary?.kind || 'Nur auswärtige Angriffstruppen', category: hasAG ? 'AG' : isOff ? 'Off' : 'Deff',
            priority: hasAG ? 3 : isOff ? 2 : 1, outsideAG: (outside?.snob || 0) > 0 };
    }
    function defense(report, troops, world) {
        if (!report?.troops) return null;
        const weights = { infantry: 0, cavalry: 0, archer: 0 };
        for (const [u, n] of Object.entries(troops)) {
            const group = u === 'marcher' ? 'archer' : ['light', 'heavy', 'knight'].includes(u) ? 'cavalry' : 'infantry';
            weights[group] += n * world.units[u].attack;
        }
        const power = Object.values(weights).reduce((a, b) => a + b, 0);
        if (!power) return 0;
        return Object.entries(report.troops).reduce((total, [u, n]) => {
            const info = world.units[u];
            return total + n * (weights.infantry * info.defense + weights.cavalry * info.defense_cavalry +
                weights.archer * info.defense_archer) / power;
        }, 0);
    }
    function offPacket(stock, source, target, world, config, already = 0) {
        const full = Object.fromEntries(OFF.filter(u => stock[u] > 0 && world.units[u]).map(u => [u, stock[u]]));
        const power = attack(full, world);
        const minPopulation = Math.max(minimumPop(source, world), minimumOff(config));
        if (!meetsOff(full, world, config) || population(full, world) < minPopulation) return null;
        const estimate = defense(target.report, full, world);
        if (estimate !== null) {
            if (estimate <= already) return null; // Keine weiteren Offs gegen bereits abgedeckte oder bekannte leere Bestände.
            const reference = config.template ? attack(config.template.units, world) : power;
            const need = Math.max(reference * 0.1, Math.max(0, estimate - already) * config.reserve / 100);
            // Berichte bestimmen geeignete Ziele, niemals die Paketgröße: immer die gesamte Off senden.
            if (power + 1e-6 < need) return null;
        }
        return full;
    }
    function inNight(time, night) {
        if (!night.active) return false;
        const h = parts(time).hour;
        return night.start === night.end || (night.start < night.end ? h >= night.start && h < night.end : h >= night.start || h < night.end);
    }
    function nextDaylight(time, night) {
        if (!inNight(time, night)) return time;
        if (night.start === night.end) return Infinity;
        // Kleine Schritte finden auch Sommer-/Winterzeitwechsel ohne feste Tageslänge.
        let t = Math.floor(time / 3600000) * 3600000 + 3600000;
        for (let n = 0; n < 27; n++, t += 3600000) if (!inNight(t, night)) return t;
        return Infinity;
    }
    function defaultWindows(timestamp, night) {
        const sendStart = Math.ceil((timestamp + 300000) / 60000) * 60000;
        const baseArrival = sendStart + 6 * 3600000, daylight = nextDaylight(baseArrival, night);
        const arrivalStart = Number.isFinite(daylight) ? daylight : baseArrival;
        const interval = daytimeIntervals(arrivalStart, arrivalStart + 3600000, night)[0];
        return { sendStart: formatTime(sendStart), sendEnd: formatTime(sendStart + 3600000),
            arrivalStart: formatTime(arrivalStart), arrivalEnd: formatTime(interval?.[1] ?? arrivalStart + 3600000) };
    }
    function persistentSettings(raw) {
        const { sendStart, sendEnd, arrivalStart, arrivalEnd, useSend, useArrival, ...settings } = raw;
        return settings;
    }
    function dbPayload(apiKey, coords, boundary) {
        const key = String(apiKey).trim(), match = String(coords).match(/^(\d{1,3})\|(\d{1,3})$/);
        if (!key || /[\r\n\x00]/.test(key)) throw new Error('TWForge-Schlüssel muss vollständig in einer Zeile stehen.');
        if (!match) throw new Error('Ungültige Koordinaten für TWForge.');
        return [['Key', key], ['X', match[1]], ['Y', match[2]]].map(([name, value]) =>
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join('') + `--${boundary}--\r\n`;
    }
    function dbError(status, response, world = '') {
        let raw = {}; try { raw = JSON.parse(response); } catch {}
        const code = /^[A-Z0-9_-]{1,40}$/.test(raw.code || '') ? ` · ${raw.code}` : '';
        const fields = Array.isArray(raw.rejectedArguments) ? [...new Set(raw.rejectedArguments.flatMap(a =>
            ['Key', 'X', 'Y', 'world', 'action'].filter(f => a === f || a?.name === f || a?.field === f || a?.argument === f || a?.path === f)))] : [];
        const worldMissing = status === 400 && raw.code === 'COMMON-1' && fields.includes('world');
        const explanation = [401, 403].includes(status) ? 'Schlüssel wurde vom Server nicht zur Datenbankabfrage zugelassen. DB-Info-Zugriff für diese Welt und den dazugehörigen Schlüssel prüfen.' :
            worldMissing ? `Welt${world ? ` ${world}` : ''} wird für diese DB-Info-Abfrage nicht gefunden. Weltverknüpfung und Zugriff in TWForge prüfen.` :
            status === 400 ? `Server lehnt Anfrageparameter ab${fields.length ? `: ${fields.join(', ')}` : ''}. Vollständigen DB-Info-Schlüssel und ausgewählte Welt prüfen.` : 'Abfrage fehlgeschlagen.';
        const e = new Error(`TWForge (HTTP ${status}${code}): ${explanation}`); e.auth = status === 401 || status === 403;
        e.configuration = worldMissing;
        return e;
    }
    function daytimeIntervals(lo, hi, night) {
        if (!night.active) return [[lo, hi]];
        if (night.start === night.end) return [];
        const intervals = [];
        let t = lo;
        while (t <= hi) {
            t = nextDaylight(t, night);
            if (t > hi) break;
            let end = Math.floor(t / 3600000) * 3600000 + 3600000;
            while (end <= hi && !inNight(end, night)) end += 3600000;
            intervals.push([t, Math.min(hi, end - 1000)]);
            t = end;
        }
        return intervals.filter(([a, b]) => a <= b);
    }
    function timing(source, target, troops, world, config) {
        const unit = Object.keys(troops).reduce((slow, u) => !slow || world.units[u].speed > world.units[slow].speed ? u : slow, null);
        const distance = Math.hypot(source.x - target.x, source.y - target.y);
        if (!distance || !unit) return null;
        const duration = Math.round(distance * world.units[unit].speed * 60) * 1000;
        let cache = timingCaches.get(config);
        if (!cache) { cache = new Map(); timingCaches.set(config, cache); }
        const key = `${duration}:${unit}:${world.night.active}:${world.night.start}:${world.night.end}`;
        if (cache.has(key)) { const cached = cache.get(key); return cached ? { ...cached, distance } : null; }
        const lo = Math.max(config.arrivalStart, config.sendStart + duration), hi = Math.min(config.arrivalEnd, config.sendEnd + duration);
        if (hi < lo) { cache.set(key, null); return null; }
        const intervals = daytimeIntervals(lo, hi, world.night);
        const info = intervals.length ? { unit, distance, duration, intervals } : null;
        cache.set(key, info); return info;
    }
    function counts(total, fakePercent) { const fakes = Math.round(total * fakePercent / 100); return { fakes, offs: total - fakes }; }
    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
    function subtract(stock, troops) { for (const [u, n] of Object.entries(troops)) stock[u] -= n; }
    function chooseArrival(info, anchor) {
        let best = null;
        for (const [a, b] of info.intervals) {
            const t = clamp(anchor, a, b), diff = Math.abs(t - anchor);
            if (!best || diff < best.diff) best = { time: t, diff };
        }
        return best.time;
    }
    function bounds(rows) {
        if (!rows.length) return { launchSpan: 0, arrivalSpan: 0, launchMin: null, launchMax: null, arrivalMin: null, arrivalMax: null };
        const launches = rows.map(r => r.launch), arrivals = rows.map(r => r.arrival);
        const launchMin = Math.min(...launches), launchMax = Math.max(...launches), arrivalMin = Math.min(...arrivals), arrivalMax = Math.max(...arrivals);
        return { launchSpan: launchMax - launchMin, arrivalSpan: arrivalMax - arrivalMin, launchMin, launchMax, arrivalMin, arrivalMax };
    }
    function allocate(sources, targets, world, config, total, anchor, referenceDuration, offLimit = counts(total, config.fakePercent).offs) {
        const desired = counts(total, config.fakePercent), stocks = sources.map(s => ({ ...s, stock: { ...s.troops } }));
        const rows = [], hits = new Map(), damage = new Map(), fakePairs = new Set(), offPairs = new Set(), offSources = new Set(), fakeSources = new Set(), offPlayers = new Map(), visibleOffSources = new Set();
        let offCount = 0, fakeCount = 0;
        function take(type, replaceMissingOffs = false) {
            let best = null;
            for (const s of stocks) {
                if (type === 'off' ? s.role === 'fake' || offSources.has(s.id) : !replaceMissingOffs && !canFake(s, s.stock, world, config)) continue;
                let offStock = s.stock;
                // Tarnfakes bleiben übrig, wenn sie höchstens 5 % Off-Kraft kosten und alle Mindestmengen erhalten bleiben.
                if (type === 'off' && s.role === 'both' && targets.length > 1) {
                    let remaining = { ...s.stock }, spent = 0;
                    const budget = attack(Object.fromEntries(OFF.map(u => [u, s.stock[u] || 0])), world) * 0.05;
                    const masks = Math.min(targets.length - 1, config.maskSlots ?? (config.offOnly ? 1 : Math.max(0, Math.ceil((total - Math.min(offLimit, stocks.length)) / stocks.length))));
                    for (let n = 0; n < masks; n++) {
                        const mask = fakePacket(remaining, s, world), next = { ...remaining };
                        if (!mask) break;
                        subtract(next, mask);
                        if (!meetsOff(next, world, config) || !(next.ram || next.catapult) || spent + attack(mask, world) > budget) break;
                        spent += attack(mask, world); remaining = next; offStock = remaining;
                    }
                }
                const packet = type === 'fake' ? fakePacket(s.stock, s, world) : null;
                if (type === 'fake' && !packet) continue;
                for (const target of targets) {
                    const pair = `${s.id}:${target.id}`;
                    if (type === 'fake' && (fakePairs.has(pair) || offPairs.has(pair))) continue;
                    const troops = packet || offPacket(offStock, s, target, world, config, damage.get(target.id) || 0) ||
                        (type === 'off' ? offPacket(s.stock, s, target, world, config, damage.get(target.id) || 0) : null);
                    if (!troops) continue;
                    const info = timing(s, target, troops, world, config);
                    if (!info) continue;
                    const arrival = chooseArrival(info, anchor), launch = arrival - info.duration;
                    const temporal = Math.abs(arrival - anchor) + Math.abs(info.duration - referenceDuration);
                    const targetHits = hits.get(`${type}:${target.id}`) || 0;
                    const remainingDefense = Math.max(0, (defense(target.report, troops, world) || 0) - (damage.get(target.id) || 0));
                    const lossPotential = Math.min(attack(troops, world), remainingDefense);
                    const samePlayer = Number(target.player) > 0 && offPlayers.get(s.id) === Number(target.player);
                    const rank = type === 'off' ? [target.report?.troops ? remainingDefense > 0 ? 2 : 0 : 1,
                        target.report?.priority || 0, lossPotential / (1 + targetHits)] :
                        [offSources.has(s.id) && !fakeSources.has(s.id) ? 2 : offSources.has(s.id) && !visibleOffSources.has(s.id) ? 1 : 0, samePlayer ? 1 : 0, -targetHits];
                    const candidate = { source: s, target, troops, ...info, arrival, launch, temporal, rank, type };
                    if (!best || compare(candidate, best) < 0) best = candidate;
                }
            }
            if (!best) return false;
            subtract(best.source.stock, best.troops);
            hits.set(`${type}:${best.target.id}`, (hits.get(`${type}:${best.target.id}`) || 0) + 1);
            if (type === 'off') {
                offPairs.add(`${best.source.id}:${best.target.id}`);
                offSources.add(best.source.id);
                offPlayers.set(best.source.id, Number(best.target.player));
                damage.set(best.target.id, (damage.get(best.target.id) || 0) + attack(best.troops, world) / (config.reserve / 100));
                offCount++;
            } else {
                fakeCount++; fakePairs.add(`${best.source.id}:${best.target.id}`); fakeSources.add(best.source.id);
                if (Number(best.target.player) > 0 && offPlayers.get(best.source.id) === Number(best.target.player)) visibleOffSources.add(best.source.id);
                else if (!(offPlayers.get(best.source.id) > 0)) visibleOffSources.add(best.source.id);
            }
            rows.push({ id: best.source.id, source: best.source.coords, sourceName: best.source.name, target: best.target,
                type, troops: best.troops, unit: best.unit, duration: best.duration, distance: best.distance,
                arrival: best.arrival, launch: best.launch, intervals: best.intervals });
            return true;
        }
        // Offs werden immer zuerst fest reserviert. Fakes dürfen diese Pakete niemals verdrängen.
        while (offCount < offLimit && take('off')) {}
        // Off-Anteil ist ein Wunschwert. Fehlende Offs durch zusätzliche Fakes ersetzen.
        if (!config.offOnly) while (fakeCount < total - offCount && take('fake', offCount < desired.offs)) {}
        return { rows, complete: rows.length === total, offCount, fakeCount,
            requestedOffs: desired.offs, requestedFakes: desired.fakes, fallbackFakes: desired.offs - offCount };
    }
    function compare(a, b) {
        for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return b.rank[i] - a.rank[i];
        return a.temporal - b.temporal || a.source.id - b.source.id || a.target.id - b.target.id;
    }
    function optimizeTimes(rows, world, config, anchor) {
        let best = null;
        const arrivals = [anchor, ...rows.map(r => r.arrival)],
            launches = [config.sendStart, ...rows.map(r => r.launch)];
        // Zwei Zielgrößen: Ankunft bündeln und Abschickspanne reduzieren. Beide Strategien werden bewertet.
        for (const mode of ['arrival', 'launch']) {
            const values = mode === 'arrival' ? arrivals : launches;
            const sampled = [...new Set(values)].sort((a, b) => a - b).filter((_, i, all) => i === 0 || i === all.length - 1 || i % Math.max(1, Math.floor(all.length / 16)) === 0);
            for (const value of sampled) {
                const candidate = rows.map((r, index) => {
                    const arrival = chooseArrival(r, mode === 'arrival' ? value : value + r.duration);
                    return { ...r, arrival, launch: arrival - r.duration, mix: Math.imul(index + 1, 2654435761) >>> 0 };
                });
                // Der manuelle Abschickabstand gilt global, auch beim Wechsel des Quelldorfs.
                let previousLaunch = null, valid = true;
                candidate.sort((a, b) => a.launch - b.launch || a.mix - b.mix || a.target.id - b.target.id);
                for (const r of candidate) {
                    const minLaunch = previousLaunch == null ? r.launch : Math.max(r.launch, previousLaunch + config.gap);
                    const need = minLaunch + r.duration;
                    const interval = r.intervals.find(([, hi]) => hi >= need);
                    if (!interval) { valid = false; break; }
                    r.arrival = Math.max(need, interval[0]); r.launch = r.arrival - r.duration;
                    if (inNight(r.arrival, world.night)) { valid = false; break; }
                    previousLaunch = r.launch;
                }
                if (!valid) continue;
                candidate.sort((a, b) => a.launch - b.launch || a.mix - b.mix);
                const b = bounds(candidate), score = b.arrivalSpan + b.launchSpan;
                if (!best || score < best.score || score === best.score && b.arrivalSpan < best.metrics.arrivalSpan)
                    best = { rows: candidate, score, metrics: b };
            }
        }
        return best;
    }
    function anchors(sources, targets, world, config) {
        const durations = [];
        for (const source of sources) for (const target of targets) {
            const packet = fakePacket(source.troops, source, world) || Object.fromEntries(OFF.filter(u => source.troops[u] > 0).map(u => [u, source.troops[u]]));
            const info = timing(source, target, packet, world, config);
            if (info) durations.push({ duration: info.duration, lo: info.intervals[0][0] });
        }
        if (!durations.length) return [];
        durations.sort((a, b) => a.duration - b.duration);
        const selected = [durations[0], durations[Math.floor(durations.length / 2)], durations[durations.length - 1]];
        return selected.map(d => ({ duration: d.duration,
            arrival: nextDaylight(clamp(Math.max(d.lo, config.sendStart + d.duration), config.arrivalStart, config.arrivalEnd), world.night) }));
    }
    function plan(sources, targets, world, config, total, thorough = true) {
        const options = anchors(sources, targets, world, config);
        if (!options.length || !total) return { rows: [], complete: total === 0, offCount: 0, fakeCount: 0, metrics: bounds([]) };
        let best = null;
        for (const option of thorough ? options : options.slice(1, 2)) {
            const requestedOffs = counts(total, config.fakePercent).offs;
            const offLimit = config.maxOffs != null ? Math.min(total, config.fakePercent === 100 ? 0 : config.maxOffs) : requestedOffs;
            {
                let result = allocate(sources, targets, world, config, total, option.arrival, option.duration, offLimit);
                if (result.offCount < offLimit && !config.offOnly) {
                    const protectedOffs = allocate(sources, targets, world, { ...config, maskSlots: 1 }, total, option.arrival, option.duration, offLimit);
                    if (protectedOffs.offCount > result.offCount) result = protectedOffs;
                }
                let rows = result.rows, optimized = optimizeTimes(rows, world, config, option.arrival);
                // Bei engen Fenstern nur Fakes entfernen, niemals eine passende Off durch Fakes ersetzen.
                if (!optimized && rows.some(r => r.type === 'fake')) {
                    const offs = rows.filter(r => r.type === 'off'), fakes = rows.filter(r => r.type === 'fake');
                    let low = 0, high = fakes.length;
                    while (low < high) {
                        const middle = Math.ceil((low + high) / 2);
                        if (optimizeTimes([...offs, ...fakes.slice(0, middle)], world, config, option.arrival)) low = middle;
                        else high = middle - 1;
                    }
                    rows = [...offs, ...fakes.slice(0, low)]; optimized = optimizeTimes(rows, world, config, option.arrival);
                }
                if (!optimized && config.offOnly) {
                    let low = 0, high = rows.length;
                    while (low < high) {
                        const middle = Math.ceil((low + high) / 2);
                        if (optimizeTimes(rows.slice(0, middle), world, config, option.arrival)) low = middle;
                        else high = middle - 1;
                    }
                    rows = rows.slice(0, low); optimized = optimizeTimes(rows, world, config, option.arrival);
                }
                if (!optimized) continue;
                const candidate = { ...result, ...optimized, complete: rows.length === total,
                    offCount: rows.filter(r => r.type === 'off').length, fakeCount: rows.filter(r => r.type === 'fake').length };
                if (!best || candidate.offCount > best.offCount || candidate.offCount === best.offCount &&
                    (candidate.rows.length > best.rows.length || candidate.rows.length === best.rows.length && candidate.score < best.score)) best = candidate;
            }
        }
        return best || { rows: [], complete: false, offCount: 0, fakeCount: 0, metrics: bounds([]) };
    }
    function capacityUpper(sources, world, config) {
        let fake = 0, off = 0;
        for (const source of sources) {
            // Auch ein Off-Dorf kann nach einer Off einen Restbestand unterhalb der Mindest-Off-Größe für Fakes nutzen.
            const min = fakeMinimumPop(source, world), siege = (source.troops.ram || 0) + (source.troops.catapult || 0);
            const usable = Object.fromEntries([...OFF, ...FILL].filter((u, i, a) => a.indexOf(u) === i).map(u => [u, source.troops[u] || 0]));
            fake += Math.min(siege, Math.floor(population(usable, world) / min));
            if (source.role !== 'fake' && meetsOff(source.troops, world, config) && offensivePopulation(source.troops, world) >= minimumPop(source, world)) off++;
        }
        return Math.min(LIMIT, config.fakePercent === 100 ? fake : fake + off);
    }
    async function findCapacity(sources, targets, world, config, progress = async () => {}) {
        const offPlan = plan(sources, targets, world, { ...config, fakePercent: 0, offOnly: true }, LIMIT);
        const maxOffs = offPlan.offCount;
        const upper = Math.min(capacityUpper(sources, world, config), sources.length * targets.length + maxOffs);
        await progress(upper);
        // Bei großen Anzahlen feste Off-Kapazität reservieren, erst anschließend Fake-Restbestände nutzen.
        const available = plan(sources, targets, world, { ...config, maxOffs }, upper);
        return { maximum: available.rows.length, maxOffs, upper, limited: upper === LIMIT };
    }
    // Dedicated worker: the allocation search must not freeze the game UI on large accounts.
    function workerSource() {
        const functions = [parts, formatTime, minimumPop, fakeMinimumPop, population, offensivePopulation, minimumOff, meetsOff, canFake, attack, fakePacket, defense, offPacket,
            inNight, nextDaylight, daytimeIntervals, timing, counts, clamp, subtract, chooseArrival, bounds,
            allocate, compare, optimizeTimes, anchors, plan, capacityUpper, findCapacity];
        return `'use strict';const OFF=${JSON.stringify(OFF)},FILL=${JSON.stringify(FILL)},DAY=${DAY},LIMIT=${LIMIT},timingCaches=new WeakMap();
            const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
            ${functions.map(fn => fn.toString()).join('\n')}
            onmessage=async({data})=>{try{const {sources,targets,world,config,total,operation}=data;
                const result=operation==='capacity'?await findCapacity(sources,targets,world,config,async count=>postMessage({progress:count})):plan(sources,targets,world,config,total);
                postMessage({result});}catch(e){postMessage({error:e.message});}};`;
    }
    function parseWorld(configDoc, unitDoc, available) {
        const number = (doc, selector) => { const node = doc.querySelector(selector); return node && node.textContent.trim() !== '' ? Number(node.textContent) : NaN; };
        if (configDoc.querySelector('parsererror') || unitDoc.querySelector('parsererror')) throw new Error('Weltkonfiguration ist kein gültiges XML.');
        const fakeLimit = number(configDoc, 'game > fake_limit'), active = number(configDoc, 'night > active');
        const start = number(configDoc, 'night > start_hour'), end = number(configDoc, 'night > end_hour');
        if (!Number.isFinite(fakeLimit) || fakeLimit < 0 || ![0, 1].includes(active) || active &&
            (![start, end].every(n => Number.isInteger(n) && n >= 0 && n < 24))) throw new Error('Fakelimit oder Nachtbonus der Welt fehlt.');
        const units = {};
        for (const u of available.filter(u => NAMES[u])) {
            const data = Object.fromEntries(['pop', 'speed', 'attack', 'defense', 'defense_cavalry', 'defense_archer'].map(field => [field, number(unitDoc, `config > ${u} > ${field}`)]));
            if (Object.values(data).some(n => !Number.isFinite(n) || n < 0) || !data.pop || !data.speed) throw new Error(`Einheitenwerte für ${NAMES[u]} fehlen.`);
            units[u] = data;
        }
        if (!units.ram && !units.catapult) throw new Error('Diese Welt hat keine unterstützten Belagerungseinheiten.');
        const gap = number(configDoc, 'commands > attack_gap');
        return { fakeLimit, night: { active: !!active, start, end }, units, gap: Number.isFinite(gap) ? Math.max(1, gap) : 200 };
    }
    function parsePlace(doc, units, expectedId) {
        const form = doc.querySelector('#command-data-form, form[action*="screen=place"]');
        if (!form) throw new Error('Versammlungsplatz nicht lesbar; Anmeldung oder Urlaubsmodus prüfen.');
        const match = doc.documentElement.innerHTML.match(/\bgame_data\s*=\s*(\{[^\n]+\})\s*;/);
        if (match) {
            try { if (Number(JSON.parse(match[1]).village.id) !== expectedId) throw new Error('Falsches Quelldorf geladen.'); }
            catch (e) { if (e.message === 'Falsches Quelldorf geladen.') throw e; }
        }
        const troops = {};
        for (const u of units) {
            const input = form.querySelector(`#unit_input_${u}, input[name="${u}"]`),
                all = form.querySelector(`#units_entry_all_${u}`),
                raw = input?.getAttribute('data-all-count') ?? all?.getAttribute('data-count') ?? all?.textContent?.replace(/[()]/g, '');
            const n = amount(raw);
            if (!Number.isFinite(n)) throw new Error(`Verfügbare ${NAMES[u]} in Dorf ${expectedId} nicht lesbar.`);
            troops[u] = n;
        }
        return troops;
    }
    function workbench(row, encode = btoa) {
        // DS Workbench: Attack.FAKE_TYPE=14, Attack.CLEAN_TYPE=2 (StandardAttack / ImageManager).
        const type = row.type === 'fake' ? 14 : 2;
        return `${row.id}&${row.target.id}&${row.unit}&${row.arrival}&${type}&false&false&` +
            Object.entries(row.troops).filter(([, n]) => n > 0).map(([u, n]) => `${u}=${encode(String(n))}`).join('/') + '&1\n';
    }
    const core = { amount, parts, formatTime, parseTime, parseMap, resolveTargets, readTemplates, minimumPop, fakeMinimumPop, population, offensivePopulation, meetsOff, dbPayload, dbError,
        attack, fakePacket, normalizeReport, defense, offPacket, inNight, nextDaylight, daytimeIntervals, timing, counts,
        bounds, plan, capacityUpper, findCapacity, parseWorld, parsePlace, workbench, workerSource, defaultWindows, persistentSettings, LIMIT };
    if (typeof module === 'object' && module.exports) { module.exports = core; return; }

    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (!win.game_data || !win.game_data.player?.id) return;
    const existing = document.getElementById(ID);
    if (existing) { existing.querySelectorAll('details').forEach(e => { e.open = false; }); return; }
    const gd = win.game_data, units = gd.units.filter(u => NAMES[u]);
    const key = `${ID}:${location.host}:${gd.world}:${gd.player.id}`;
    let world, map, templates = [], sources = [], targets = [], result = null, capacity = null, desiredAttackCount = null,
        busy = false, generation = 0, validationTimer, preview = null, clockBase = 0, clockAt = 0;
    const abort = new AbortController();
    let activeWorker, cancelCompute;
    const root = document.createElement('section'); root.id = ID;
    const $ = selector => root.querySelector(selector);
    function now() {
        const t = win.Timing?.getCurrentServerTime?.();
        if (Number.isFinite(t) && t > 1e12) return t;
        const time = parseTime(`${document.querySelector('#serverDate')?.textContent.trim()} ${document.querySelector('#serverTime')?.textContent.trim()}`);
        if (time !== clockBase) { clockBase = time; clockAt = performance.now(); }
        return time + performance.now() - clockAt;
    }
    function stored(suffix, fallback) { try { return JSON.parse(localStorage.getItem(`${key}:${suffix}`)) ?? fallback; } catch { return fallback; } }
    function save(suffix, value) { try { localStorage.setItem(`${key}:${suffix}`, JSON.stringify(value)); } catch { message('Browserspeicher nicht verfügbar.', true); } }
    function gameURL(screen, parameters = {}) {
        const url = new URL('/game.php', location.origin);
        url.search = new URLSearchParams({ village: gd.village.id, screen, ...parameters });
        if (Number(gd.player.sitter) > 0) url.searchParams.set('t', gd.player.id);
        return url;
    }
    async function request(url) {
        const response = await fetch(url, { credentials: 'same-origin', signal: abort.signal });
        if (!response.ok) throw new Error(`Datenabruf fehlgeschlagen (HTTP ${response.status}).`);
        return response.text();
    }
    async function pool(items, task, width = 2) {
        const results = new Array(items.length); let index = 0;
        await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
            while (index < items.length) { const i = index++; results[i] = await task(items[i], i); }
        }));
        return results;
    }
    function compute(operation, selected, destination, config, total) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(new Blob([workerSource()], { type: 'application/javascript' }));
            try { activeWorker = new Worker(url); }
            catch { URL.revokeObjectURL(url); reject(new Error('Rechen-Worker konnte nicht gestartet werden. Browser-Einstellungen für Userscripts prüfen.')); return; }
            const worker = activeWorker;
            $('[data-cancel]').hidden = false; $('[data-cancel]').disabled = false;
            const cleanup = () => {
                worker.terminate(); URL.revokeObjectURL(url); if (activeWorker === worker) activeWorker = null;
                cancelCompute = null; $('[data-cancel]').hidden = true;
            };
            cancelCompute = () => { cleanup(); reject(new Error('Berechnung abgebrochen. Weniger Quelldörfer oder Ziele wählen, um die Suche zu verkleinern.')); };
            worker.onerror = () => { cleanup(); reject(new Error('Planungs-Worker fehlgeschlagen.')); };
            worker.onmessage = ({ data }) => {
                if (data.progress != null) { message(`Kapazität berechnen: ${data.progress.toLocaleString('de-DE')} Angriffe prüfen …`); return; }
                cleanup(); if (data.error) reject(new Error(data.error)); else resolve(data.result);
            };
            worker.postMessage({ operation, sources: selected, targets: destination, world, config, total });
        });
    }
    function message(text, error = false) { $('[data-status]').textContent = text; $('[data-status]').dataset.tone = error ? 'error' : busy ? 'loading' : 'info'; }
    function setBusy(value) {
        busy = value; root.setAttribute('aria-busy', String(value));
        root.querySelectorAll('input, select, button, textarea:not([data-export])').forEach(e => { e.disabled = value; });
        if (!value) {
            if ($('[data-status]').dataset.tone === 'loading') $('[data-status]').dataset.tone = 'info';
            $('[data-count]').disabled = !capacity?.maximum; $('[data-plan]').disabled = !preview?.complete; tick();
        }
    }
    function invalidate() {
        generation++; result = null; capacity = null; preview = null;
        $('[data-plan]').disabled = true; $('[data-count]').disabled = true; $('[data-export-wrap]').hidden = true;
        $('[data-result-tools]').hidden = true;
        $('[data-results]').innerHTML = ''; $('[data-summary]').textContent = 'Einstellungen geändert. Kapazität neu berechnen.';
        $('[data-maximum]').textContent = '–'; $('[data-wb]').disabled = true;
    }
    function rawSettings() {
        return { targets: $('[data-targets]').value, fakePercent: +$('[data-ratio]').value, template: $('[data-template]').value, resultView: $('[data-result-view]').value,
            maxAge: $('[data-age]').value, reserve: $('[data-reserve]').value, gap: $('[data-gap]').value,
            minimumOffUnits: Object.fromEntries([...root.querySelectorAll('[data-min-off]')].map(e => [e.dataset.minOff, e.value])), apiKey: $('[data-db-key]').value.trim(), attackCount: desiredAttackCount,
            useSend: $('[data-use-send]').checked, useArrival: $('[data-use-arrival]').checked,
            sendStart: $('[data-send-start]').value, sendEnd: $('[data-send-end]').value,
            arrivalStart: $('[data-arrival-start]').value, arrivalEnd: $('[data-arrival-end]').value,
            useDB: $('[data-db]').checked };
    }
    function persist() {
        save('settings', persistentSettings(rawSettings()));
        if (sources.length) save('sources', Object.fromEntries(sources.map(s => [s.id, { selected: s.selected, role: s.role }])));
    }
    function resetWindows() {
        const defaults = defaultWindows(now(), world.night);
        for (const [name, selector] of Object.entries({ sendStart: 'send-start', sendEnd: 'send-end', arrivalStart: 'arrival-start', arrivalEnd: 'arrival-end' }))
            $(`[data-${selector}]`).value = defaults[name];
        $('[data-use-send]').checked = false; $('[data-use-arrival]').checked = false;
    }
    function readConfig() {
        const raw = rawSettings(), t = Math.ceil((now() + 120000) / 1000) * 1000;
        const maxAge = Number(raw.maxAge), reserve = Number(raw.reserve), gap = Number(raw.gap) * 1000;
        if (!Number.isFinite(maxAge) || maxAge <= 0 || maxAge > 365) throw new Error('Berichtsalter zwischen 0 und 365 Tagen wählen.');
        if (!Number.isFinite(reserve) || reserve < 100 || reserve > 500) throw new Error('Kraftreserve zwischen 100 und 500 % wählen.');
        if (!Number.isFinite(gap) || gap < 1000 || gap > 60000) throw new Error('Abschickabstand zwischen 1 und 60 Sekunden wählen.');
        const minimumOffUnits = Object.fromEntries(Object.entries(raw.minimumOffUnits).map(([u, n]) => [u, amount(n)]));
        if (Object.values(minimumOffUnits).some(n => !Number.isFinite(n) || n > 1000000)) throw new Error('Mindestmengen je Off-Einheit zwischen 0 und 1.000.000 wählen.');
        const sendStart = raw.useSend ? Math.max(t, parseTime(raw.sendStart)) : t,
            sendEnd = raw.useSend ? parseTime(raw.sendEnd) : t + 30 * DAY,
            arrivalStart = raw.useArrival ? parseTime(raw.arrivalStart) : t,
            arrivalEnd = raw.useArrival ? parseTime(raw.arrivalEnd) : sendEnd + 100 * DAY;
        if (sendStart > sendEnd || arrivalStart > arrivalEnd || arrivalEnd < t) throw new Error('Zeitfenster sind abgelaufen oder Anfang liegt hinter dem Ende.');
        if (sendEnd - sendStart > 31 * DAY || raw.useArrival && arrivalEnd - arrivalStart > 31 * DAY) throw new Error('Ein gewähltes Zeitfenster darf höchstens 31 Tage umfassen.');
        const { apiKey, ...planningSettings } = raw; // Schlüssel weder an Worker noch in den WB-Export weitergeben.
        return { ...planningSettings, maxAge, reserve, minimumOffUnits, gap: Math.ceil(Math.max(world.gap, gap) / 1000) * 1000, sendStart, sendEnd, arrivalStart, arrivalEnd,
            template: templates.find(t => t.id === raw.template) || null };
    }
    function validateTargets() {
        if (!map) return;
        const parsed = resolveTargets($('[data-targets]').value, map, gd.player.id);
        targets = parsed.targets;
        $('[data-validation]').replaceChildren(...parsed.validation.map(v => {
            const e = document.createElement('span'); e.className = `ds-chip ${v.valid ? '' : 'ds-invalid'}`; e.textContent = v.message; return e;
        }));
        $('[data-targets]').setAttribute('aria-invalid', String(!parsed.valid));
        $('[data-target-count]').textContent = `${targets.length} Zieldörfer`;
        return parsed;
    }
    function troopHTML(troops) {
        return `<div class="ds-troops">${Object.entries(troops).filter(([, n]) => n > 0).map(([u, n]) =>
            `<span class="ds-troop" title="${NAMES[u]}"><img src="/graphic/unit/unit_${u}.webp" alt="${NAMES[u]}">${n.toLocaleString('de-DE')}</span>`).join('')}</div>`;
    }
    function renderSources() {
        const search = $('[data-source-search]').value.toLocaleLowerCase('de');
        $('[data-sources]').innerHTML = sources.filter(s => `${s.name} ${s.coords}`.toLocaleLowerCase('de').includes(search)).map(s =>
            `<div class="ds-source"><label><input type="checkbox" data-source="${s.id}" ${s.selected ? 'checked' : ''}><strong>${escape(s.name)}</strong><small>${s.coords} · ${s.points.toLocaleString('de-DE')} Punkte · Fake ≥ ${fakeMinimumPop(s, world)} BH (inkl. +3)</small></label>
            <select data-role="${s.id}" aria-label="Rolle für ${s.coords}">${[['both', 'Offs + Fakes'], ['off', 'Nur Offs'], ['fake', 'Nur Fakes']].map(([v, n]) => `<option value="${v}" ${s.role === v ? 'selected' : ''}>${n}</option>`).join('')}</select>${troopHTML(s.troops)}</div>`).join('');
        $('[data-source-count]').textContent = `${sources.filter(s => s.selected).length} / ${sources.length} gewählt`;
    }
    async function loadSources() {
        let done = 0;
        const listed = (map.byPlayer.get(Number(gd.player.id)) || []).slice();
        // Öffentliche Karte enthält keine Truppen. Der native Versammlungsplatz liefert ausschließlich abschickbare Bestände.
        // Neu gegründetes aktuelles Dorf ergänzen, falls die stündliche Karte noch fehlt.
        if (!listed.some(v => v.id === +gd.village.id) && Number.isFinite(+gd.village.x) && Number.isFinite(+gd.village.y))
            listed.push({ id: +gd.village.id, name: gd.village.name, x: +gd.village.x, y: +gd.village.y,
                coords: `${gd.village.x}|${gd.village.y}`, player: +gd.player.id, points: +gd.village.points });
        if (!listed.length) throw new Error('Keine eigenen Dörfer in den Weltdaten gefunden.');
        const choices = stored('sources', {});
        sources = await pool(listed, async s => {
            const doc = new DOMParser().parseFromString(await request(gameURL('place', { village: s.id })), 'text/html');
            const troops = parsePlace(doc, units, s.id);
            // Aktuelle Punkte bevorzugen, falls die native Seite sie als game_data ausgibt.
            const data = doc.documentElement.innerHTML.match(/\bgame_data\s*=\s*(\{[^\n]+\})\s*;/);
            if (data) try { const v = JSON.parse(data[1]).village; if (+v.id === s.id && Number.isFinite(amount(v.points))) s.points = amount(v.points); } catch {}
            message(`Eigene Bestände laden: ${++done} / ${listed.length} Dörfer …`);
            return { ...s, troops, selected: choices[s.id]?.selected ?? true,
                role: ['both', 'off', 'fake'].includes(choices[s.id]?.role) ? choices[s.id].role : 'both' };
        });
        renderSources();
    }
    function dbRequest(target, apiKey) {
        const url = `https://twforge.net/api/db-info/userscript?action=tribalwars&world=${encodeURIComponent(gd.world)}`;
        // Nur der konfigurierte TWForge-Endpunkt erhält den Schlüssel, keine fremden serverConfig-URLs.
        // Der TWForge-Endpunkt erwartet Multipart wie das offizielle DB-Info-Skript.
        const boundary = `dsplanner${crypto.randomUUID().replace(/-/g, '')}`;
        const body = dbPayload(apiKey, target.coords, boundary);
        if (typeof GM_xmlhttpRequest !== 'function') throw new Error('TWForge benötigt Tampermonkey mit GM_xmlhttpRequest.');
        return new Promise((resolve, reject) => {
            const handle = GM_xmlhttpRequest({ method: 'POST', url, data: body, anonymous: true,
                // Native DB-Info-XHR sendet diesen Header automatisch. TWForge bestimmt darüber die Spielwelt.
                // Die Welt im URL-Parameter allein reicht nicht; der Erweiterungskontext besitzt keinen Spiel-Origin.
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Origin: location.origin },
                timeout: 20000, // Explizites Multipart vermeidet FormData-Serialisierungsfehler verschiedener Userscript-Manager.
                onload: r => {
                    if (r.status !== 200) {
                        reject(dbError(r.status, r.responseText, gd.world)); return;
                    }
                    try { const data = JSON.parse(r.responseText); if (data?.error) throw new Error('TWForge meldet einen API-Fehler.'); resolve(data); }
                    catch { reject(new Error('TWForge liefert keine gültigen Berichtsdaten.')); }
                }, onerror: () => reject(new Error('TWForge-Verbindungsfehler.')), ontimeout: () => reject(new Error('TWForge-Zeitüberschreitung.')),
                onabort: () => reject(new Error('Abfrage abgebrochen.')) });
            abort.signal.addEventListener('abort', () => handle?.abort(), { once: true });
        });
    }
    async function loadReports(config) {
        if (!config.useDB) { targets = targets.map(t => ({ ...t, report: null })); return { fresh: 0, missing: targets.length, failed: 0 }; }
        const apiKey = $('[data-db-key]').value.trim() || localStorage.getItem('dbkey');
        if (!apiKey) throw new Error('TWForge-Schlüssel fehlt. DB-Info konfigurieren oder unter Berichtseinstellungen eingeben.');
        let done = 0, fresh = 0, failed = 0, authenticationError, lastError;
        targets = await pool(targets, async t => {
            let report = null;
            if (!authenticationError) {
                try { report = normalizeReport(await dbRequest(t, apiKey), world, now(), config.maxAge); }
                catch (e) { failed++; lastError = e; if (e.auth || e.configuration) authenticationError = e; }
            } else failed++;
            if (report) fresh++;
            message(`TWForge prüfen: ${++done} / ${targets.length} Ziele …`);
            return { ...t, report };
        });
        if (authenticationError) throw authenticationError;
        if (failed === targets.length) throw new Error(`Keine TWForge-Abfrage erfolgreich. ${lastError?.message || 'Verbindung prüfen.'}`);
        return { fresh, missing: targets.length - fresh, failed, error: lastError?.message || '' };
    }
    async function checkDB() {
        const apiKey = $('[data-db-key]').value.trim() || localStorage.getItem('dbkey');
        if (!apiKey) throw new Error('TWForge-Schlüssel fehlt. API-Schlüssel eingeben.');
        const destination = validateTargets()?.targets[0] || { coords: `${gd.village.x}|${gd.village.y}` };
        const data = await dbRequest(destination, apiKey);
        const report = normalizeReport(data, world, now(), +$('[data-age]').value || 7);
        message(`TWForge-Verbindung erfolgreich (HTTP 200) · ${destination.coords}${report ? ' · aktueller Bericht verfügbar.' : ' · kein aktueller vollständiger Bericht verfügbar.'}`);
    }
    function span(ms) { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
    function renderResult() {
        const rows = result.rows, b = result.metrics;
        const covered = new Set(rows.filter(r => r.type === 'fake').map(r => r.target.id)).size;
        const offSources = new Set(rows.filter(r => r.type === 'off').map(r => r.id)), fakeSources = new Set(rows.filter(r => r.type === 'fake').map(r => r.id));
        const camouflaged = [...offSources].filter(id => fakeSources.has(id)).length;
        $('[data-summary]').textContent = `${rows.length} Angriffe: ${result.fakeCount} Fakes + ${result.offCount} Offs · Abschickspanne ${span(b.launchSpan)} · Ankunftsspanne ${span(b.arrivalSpan)} · Fakes auf ${covered} / ${capacity.targets.length} Ziele${offSources.size ? ` · ${camouflaged} / ${offSources.size} Off-Dörfer mit Tarnfakes` : ''}${result.fallbackFakes > 0 ? ` · ${result.fallbackFakes} fehlende Offs durch Fakes ersetzt` : ''}`;
        $('[data-result-tools]').hidden = false;
        $('[data-results]').innerHTML = rows.length ? `<table class="ds-table"><thead><tr><th>Auswahl</th><th>Art / Quelle</th><th>Ziel / Bericht</th><th>Truppen</th><th>Abschicken</th><th>Ankunft</th><th>Export</th></tr></thead><tbody>${rows.map((r, i) => {
            const report = r.target.report, link = report?.id ? `https://twforge.net/db-info?page=showReport&id=${encodeURIComponent(report.id)}&world=${encodeURIComponent(gd.world)}` : '';
            return `<tr data-row="${i}"><td data-label="Auswahl"><input type="checkbox" data-result="${i}" ${r.selected ? 'checked' : ''} aria-label="${r.type === 'fake' ? 'Fake' : 'Off'} aus ${r.source} auswählen"></td>
                <td data-label="Art / Quelle"><span class="ds-chip ${r.type === 'off' ? 'ds-off' : ''}">${r.type === 'off' ? 'Off' : 'Fake'}</span><strong>${escape(r.source)}</strong><small>${escape(r.sourceName)}</small></td>
                <td data-label="Ziel / Bericht"><a target="_blank" rel="noopener" href="${escape(gameURL('info_village', { id: r.target.id }))}">${r.target.coords}</a><small>${escape(r.target.name)}</small>
                <small>${report ? `${report.category}${report.outsideAG ? ' · AG auswärts belegt' : ''} · ${formatTime(report.time)}` : 'Kein aktueller Bericht'}</small>${link ? `<a target="_blank" rel="noopener" href="${escape(link)}">Bericht ↗</a>` : ''}</td>
                <td data-label="Truppen">${troopHTML(r.troops)}<small>${population(r.troops, world)} BH · ${NAMES[r.unit]} · ${r.distance.toFixed(2)} Felder</small></td>
                <td data-label="Abschicken"><strong>${formatTime(r.launch)}</strong><small data-countdown></small></td><td data-label="Ankunft"><strong>${formatTime(r.arrival)}</strong></td>
                <td data-label="Export"><button type="button" data-row-wb="${i}">WB kopieren</button></td></tr>`;
        }).join('')}</tbody></table>` : '<div class="ds-empty">Keine vollständige Planung möglich. Zeitfenster erweitern oder Verhältnis ändern.</div>';
        const view = $('[data-result-view]').value;
        if (rows.length && view !== 'time') {
            const original = $('[data-results] .ds-table'), heading = original.querySelector('thead'), rowNodes = [...original.querySelectorAll('[data-row]')];
            const villages = view === 'source' ? capacity.sources : capacity.targets;
            const groups = new Map(villages.map(v => [v.id, { village: v, rows: [] }]));
            rows.forEach((r, i) => groups.get(view === 'source' ? r.id : r.target.id)?.rows.push({ r, i }));
            $('[data-results]').replaceChildren();
            for (const { village, rows: entries } of [...groups.values()].sort((a, b) => a.village.coords.localeCompare(b.village.coords))) {
                const group = document.createElement('details'); group.className = 'ds-plan-group'; group.dataset.group = String(village.id);
                const offs = entries.filter(({ r }) => r.type === 'off').length, fakes = entries.length - offs;
                const counterparts = new Set(entries.map(({ r }) => view === 'source' ? r.target.id : r.id)).size;
                const b = bounds(entries.map(({ r }) => r));
                const summary = document.createElement('summary');
                summary.innerHTML = `<strong>${escape(village.coords)} · ${escape(village.name)}</strong><span class="ds-hint">${entries.length} Angriffe · ${offs} Offs + ${fakes} Fakes · ${counterparts} ${view === 'source' ? 'Zieldörfer' : 'Quelldörfer'}</span>${entries.length ? `<span class="ds-hint">Abschicken: ${formatTime(b.launchMin)} – ${formatTime(b.launchMax)}<br>Ankunft: ${formatTime(b.arrivalMin)} – ${formatTime(b.arrivalMax)}</span>` : '<span class="ds-hint">Keine Angriffe im Plan.</span>'}`;
                group.append(summary);
                if (entries.length) {
                    const table = document.createElement('table'); table.className = 'ds-table'; table.append(heading.cloneNode(true));
                    const body = document.createElement('tbody'); entries.forEach(({ i }) => body.append(rowNodes[i])); table.append(body); group.append(table);
                }
                $('[data-results]').append(group);
            }
        }
        tick();
    }
    function tick() {
        if (!result) { $('[data-wb]').disabled = true; return; }
        let time; try { time = now(); } catch { $('[data-wb]').disabled = true; return; }
        root.querySelectorAll('[data-row]').forEach(e => {
            const r = result.rows[+e.dataset.row], expired = r.launch <= time;
            e.classList.toggle('ds-expired', expired);
            e.querySelector('[data-countdown]').textContent = expired ? 'Abgelaufen' : `in ${span(r.launch - time)}`;
            e.querySelector('[data-result]').disabled = busy || expired; e.querySelector('[data-row-wb]').disabled = busy || expired;
        });
        const active = result.rows.filter(r => r.launch > time), selected = active.filter(r => r.selected);
        $('[data-wb]').disabled = busy || !selected.length;
        $('[data-wb]').textContent = `WB kopieren (${selected.length})`;
        const all = $('[data-all-results]');
        if (all) { all.checked = active.length > 0 && active.length === selected.length; all.indeterminate = selected.length > 0 && selected.length < active.length; all.disabled = busy || !active.length; }
    }
    async function copy(rows) {
        if (!rows.length) throw new Error('Keine noch abschickbaren Befehle ausgewählt.');
        const field = $('[data-export]'); field.value = rows.map(r => workbench(r)).join(''); $('[data-export-wrap]').hidden = false;
        try { await navigator.clipboard.writeText(field.value); message(`${rows.length} Workbench-Befehle kopiert.`); }
        catch { field.focus(); field.select(); message('WB-Code steht zum Kopieren bereit: Strg+C.'); }
    }
    async function calculateCapacity() {
        if (!world || !map) throw new Error('Welt und eigene Dörfer zuerst über „Bestände neu laden“ laden.');
        const parsed = validateTargets();
        if (!parsed?.valid) throw new Error('Alle Zieleingaben müssen gültig sein. Ungültige Namen oder Koordinaten korrigieren.');
        if (!sources.some(s => s.selected)) throw new Error('Mindestens ein Quelldorf auswählen.');
        const config = readConfig();
        const preferredCount = desiredAttackCount;
        persist();
        invalidate();
        const mine = generation;
        const reportInfo = await loadReports(config);
        const selectedIds = new Set(sources.filter(s => s.selected).map(s => s.id));
        // Erneute Bestandsaufnahme vor jeder Kapazitätsberechnung.
        let done = 0;
        await pool(sources.filter(s => selectedIds.has(s.id)), async s => {
            const doc = new DOMParser().parseFromString(await request(gameURL('place', { village: s.id })), 'text/html');
            s.troops = parsePlace(doc, units, s.id);
            message(`Bestände aktualisieren: ${++done} / ${selectedIds.size} …`);
        });
        const selected = sources.filter(s => selectedIds.has(s.id));
        const estimated = await compute('capacity', selected, targets, config);
        if (mine !== generation) return;
        capacity = { ...estimated, config: { ...config, maxOffs: estimated.maxOffs }, sources: selected.map(s => ({ ...s, troops: { ...s.troops } })),
            targets: targets.map(t => ({ ...t })), time: now(), reportInfo };
        $('[data-maximum]').textContent = `${estimated.maximum.toLocaleString('de-DE')} Angriffe · maximal ${estimated.maxOffs} Offs`;
        $('[data-count]').max = String(Math.max(1, estimated.maximum));
        const ratioCount = estimated.maxOffs && config.fakePercent < 100 ? Math.round(estimated.maxOffs / (1 - config.fakePercent / 100)) : estimated.maximum;
        $('[data-count]').value = String(clamp(Number.isInteger(preferredCount) && preferredCount > 0 ? preferredCount : ratioCount, 1, Math.max(1, estimated.maximum)));
        desiredAttackCount = +$('[data-count]').value;
        updateCounts(); renderSources(); await previewPlan();
        $('[data-summary]').textContent = `${reportInfo.fresh} aktuelle Berichte · ${reportInfo.missing} Ziele ohne aktuelle Daten${reportInfo.failed ? ` · ${reportInfo.failed} DB-Abfragen fehlgeschlagen (als unbekannt geplant)` : ''}. ${estimated.limited ? `Rechenlimit: ${LIMIT.toLocaleString('de-DE')} Angriffe. ` : ''}Kapazität unter diesen Einstellungen: ${estimated.maximum}.`;
        persist();
        message(estimated.maximum ? 'Kapazität ermittelt. Angriffszahl wählen und Plan erstellen.' : 'Keine vollständige Planung für dieses Verhältnis und diese Zeitfenster möglich.', !estimated.maximum);
    }
    function updateCounts() {
        const total = +$('[data-count]').value, ratio = +$('[data-ratio]').value;
        $('[data-ratio-label]').textContent = `${ratio} % Fakes · ${100 - ratio} % Offs (Wunsch)`;
        $('[data-count-label]').textContent = !capacity ? 'Kapazität noch nicht berechnet' : capacity.maximum === 0 ? '0 Angriffe möglich' : preview ? `${preview.rows.length.toLocaleString('de-DE')} Angriffe · ${preview.fakeCount} Fakes + ${preview.offCount} Offs` : `${total.toLocaleString('de-DE')} Angriffe · Vorschau nach Loslassen`;
    }
    async function previewPlan() {
        if (!capacity?.maximum) return;
        preview = null; updateCounts(); $('[data-plan]').disabled = true;
        $('[data-count-label]').textContent = `${Number($('[data-count]').value).toLocaleString('de-DE')} Angriffe · Vorschau wird berechnet …`;
        const total = +$('[data-count]').value;
        preview = await compute('plan', capacity.sources, capacity.targets, capacity.config, total);
        updateCounts();
        if (!preview.complete) message(`Es passen ${preview.offCount} Offs + ${preview.fakeCount} Fakes. Angriffszahl reduzieren; Offs werden nicht durch Fakes verdrängt.`, true);
        else message(`Vorschau bereit: ${preview.offCount} Offs fest reserviert, ${preview.fakeCount} Fakes.`);
    }
    async function makePlan() {
        if (!capacity?.maximum) throw new Error('Zuerst Kapazität berechnen.');
        if (now() - capacity.time > 300000) { invalidate(); throw new Error('Bestandsaufnahme älter als fünf Minuten. Kapazität neu berechnen.'); }
        const total = +$('[data-count]').value;
        if (!Number.isInteger(total) || total < 1 || total > capacity.maximum) throw new Error('Angriffszahl liegt außerhalb der berechneten Kapazität.');
        const planned = preview;
        if (!planned?.complete || planned.rows.length !== total) throw new Error('Vorschau noch nicht fertig.');
        if (planned.rows.some(r => r.launch <= now() + 10000)) { invalidate(); throw new Error('Vorschau ist zeitlich abgelaufen. Kapazität neu berechnen.'); }
        result = { ...planned, rows: planned.rows.map(r => ({ ...r, selected: true })) };
        renderResult(); message('Plan erstellt. Truppen sind je Befehl reserviert; Zeiten in deutscher Serverzeit.');
    }
    function refreshTemplates() {
        let raw; try { raw = JSON.parse(localStorage.getItem(`ds-troop-templates:v1:${location.host}:${gd.world}:${gd.player.id}`)); } catch {}
        templates = readTemplates(raw);
        const current = $('[data-template]').value;
        $('[data-template]').innerHTML = '<option value="">Alle vorhandenen Off-Truppen als Referenz</option>' + templates.map(t => `<option value="${escape(t.id)}">${escape(t.name)}</option>`).join('');
        if (templates.some(t => t.id === current)) $('[data-template]').value = current;
    }
    root.innerHTML = `<style>
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
        #${ID} .ds-fields{grid-template-columns:repeat(2,minmax(0,1fr));margin:10px 0}
        #${ID} label{display:block;margin:8px 0;font-size:11px;font-weight:700}
        #${ID} label>input:not([type=checkbox]),#${ID} label>textarea,#${ID} label>select{display:block;width:100%;margin-top:5px}
        #${ID} input[type=range]{accent-color:#805125;padding:0;min-height:28px}
        #${ID} input[type=checkbox]{width:15px;height:15px;min-height:0;margin:0 6px 0 0;accent-color:#805125}
        #${ID} .ds-check{display:flex;align-items:center;gap:4px}
        #${ID} .ds-validation{display:flex;gap:5px;flex-wrap:wrap}
        #${ID} .ds-chip{display:inline-block;border:1px solid #c9b28a;background:#eee0bf;border-radius:4px;padding:2px 6px;font-size:10px;margin-right:5px}
        #${ID} .ds-invalid{color:#953d28;background:#fbede1;border-color:#c7977d}
        #${ID} .ds-off{background:#8b4e2b;color:#fff5dc;border-color:#70401f}
        #${ID} .ds-sources{max-height:360px;overflow:auto;margin:9px 0}
        #${ID} .ds-source{display:grid;grid-template-columns:minmax(140px,1fr) 125px minmax(160px,1.5fr);gap:10px;align-items:center;padding:9px;border:1px solid #d9c8a6;border-radius:5px;background:#fff8e9;margin-bottom:5px}
        #${ID} .ds-source label{margin:0;font-weight:400;overflow-wrap:anywhere}
        #${ID} small{display:block;color:#8a7152;font-size:10px;margin-top:4px}
        #${ID} .ds-source .ds-troops{max-width:none}
        #${ID} [data-summary]{margin:10px 0;font-weight:700}
        #${ID} [data-results]{margin-top:10px}
        #${ID} [data-row]>td:first-child{width:28px}
        #${ID} [data-targets]{resize:vertical;min-height:105px}
        #${ID} details{margin-top:12px}
        #${ID} summary{cursor:pointer;font-weight:700}
        #${ID} .ds-plan-group{border:1px solid var(--line);border-radius:5px;background:#fff8e9;overflow:hidden}
        #${ID} .ds-plan-group>summary{padding:10px 12px}
        #${ID} .ds-plan-group>summary .ds-hint{margin-top:3px}
        #${ID} .ds-plan-group .ds-table{margin:0}
        #${ID} [data-result-tools]{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:12px 0}
        #${ID} [data-result-tools] select{width:auto;max-width:100%}
        #${ID} details.ds-planner-toggle{margin:0}
        #${ID} .ds-planner-toggle>summary{padding:12px 16px;font:700 17px Georgia,'Times New Roman',serif;color:#573a21}
        #${ID} .ds-planner-toggle[open]>summary{border-bottom:1px solid var(--line)}
        @media(max-width:760px){#${ID} .ds-source{grid-template-columns:minmax(120px,1fr) 125px}#${ID} .ds-source>.ds-troops{grid-column:1/-1}#${ID} .ds-fields{grid-template-columns:1fr}#${ID} [data-row]>td:first-child{width:auto}}
    </style>
    <details class="ds-planner-toggle" data-planner-toggle><summary>Angriffsplaner</summary>
    <div class="ds-body">
        <h3>Ziele & Verhältnis <span class="ds-result-count" data-target-count>0 Zieldörfer</span></h3>
        <div class="ds-fields"><label class="ds-target-field">Spieler, Stammname oder Dorfkoordinaten<textarea data-targets rows="3" placeholder="Spielername; Stammname oder Stamm-Tag; 500|500&#10;Ein Eintrag pro Zeile ist ebenfalls möglich." aria-describedby="ds-attack-validation"></textarea></label>
        <div><label>Fake-Anteil <strong data-ratio-label></strong><input type="range" data-ratio min="0" max="100" value="70"></label>
        <label>Off-Vorlage aus der Rekrutierung<select data-template></select></label><span class="ds-hint">Kraftreferenz für die Zielprüfung. Jede Off enthält den gesamten offensiven Bestand abzüglich der Tarnfake-Reserve; höchstens eine Off je Quelldorf.</span></div></div>
        <p><strong>Mindest-Off-Mengen je Einheit</strong></p><div class="ds-fields">${OFF.filter(u => units.includes(u)).map(u => `<label>${NAMES[u]}<input type="number" data-min-off="${u}" min="0" max="1000000" value="${u === 'axe' ? 1000 : 0}"></label>`).join('')}</div>
        <p class="ds-hint">Alle eingetragenen Mindestmengen müssen erfüllt sein. 0 = keine Mindestmenge. Kleinere Bestände werden für Fakes genutzt. Vorhandene Offs werden zuerst reserviert, danach mit Fakes aufgefüllt. Der Wunschanteil bestimmt die anfängliche Angriffszahl; beim Erhöhen kommen Fakes hinzu. 100 % Fakes plant ausschließlich Fakes.</p>
        <p class="ds-hint">Off-Dörfer mit „Offs + Fakes“ liefern nach Möglichkeit Tarnfakes auf andere Dörfer desselben Zielspielers. Dafür werden höchstens 5 % ihrer Off-Angriffskraft reserviert, ohne die Mindestmengen zu unterschreiten. Mindestmengen bestimmen nur die Off-Eignung, nicht die Versandgröße. Jedes Quell-Ziel-Paar erhält höchstens einen Fake.</p>
        <div id="ds-attack-validation" data-validation class="ds-validation" aria-live="polite"></div>
        <details><summary>Zeitfenster & Berichtseinstellungen</summary><p class="ds-hint">Alle Zeiten: deutsche Serverzeit. Ankünfte im Nachtbonus werden ausgeschlossen. Beide Zeitfenster können unabhängig gewählt werden.</p>
        <div class="ds-fields"><fieldset><label class="ds-check"><input type="checkbox" data-use-send> Abschickzeitraum begrenzen</label><label>Von<input data-send-start placeholder="TT.MM.JJJJ HH:MM:SS"></label><label>Bis<input data-send-end placeholder="TT.MM.JJJJ HH:MM:SS"></label></fieldset>
        <fieldset><label class="ds-check"><input type="checkbox" data-use-arrival> Ankunftszeitraum begrenzen</label><label>Von<input data-arrival-start placeholder="TT.MM.JJJJ HH:MM:SS"></label><label>Bis<input data-arrival-end placeholder="TT.MM.JJJJ HH:MM:SS"></label></fieldset></div>
        <div class="ds-fields"><div><label class="ds-check"><input type="checkbox" data-db checked> TWForge-Berichte berücksichtigen</label>
        <label>Maximales Berichtsalter (Tage)<input type="number" data-age min="0.01" max="365" step="0.1" value="7"></label>
        <label>TWForge-API-Schlüssel<input type="password" data-db-key autocomplete="off" placeholder="Verwendet den Schlüssel aus DB-Info"></label><span class="ds-hint">Wird zusammen mit den übrigen Einstellungen lokal für diese Welt und diesen Spieler gespeichert.</span>
        <button type="button" data-check-db>TWForge-Verbindung prüfen</button></div>
        <div><label>Kraftreserve für bekannte Verteidigung (%)<input type="number" data-reserve min="100" max="500" value="125"></label>
        <label>Abstand zwischen allen Abschickzeiten im Plan (Sekunden)<input type="number" data-gap min="1" max="60" value="1"></label>
        <p class="ds-hint">Off-Priorität: aktuelle Berichte mit Truppen, dann AG → Off → Deff. Stärke ist eine Schätzung aus Einheitenwerten; Wall, Moral, Forschung und Sonderboni sind darin nicht enthalten.</p></div></div>
        <p class="ds-hint" data-world>Welteinstellungen werden geladen …</p></details>
    </div>
    <div class="ds-result-area"><div class="ds-result-heading"><h3>Quelldörfer <span class="ds-result-count" data-source-count>0 gewählt</span></h3>
        <div class="ds-export-tools"><button type="button" data-all-sources>Alle</button><button type="button" data-no-sources>Keine</button><button type="button" data-reload>Bestände neu laden</button></div></div>
        <input data-source-search placeholder="Dorfname oder Koordinaten filtern" aria-label="Quelldörfer filtern"><div class="ds-sources" data-sources></div>
        <div class="ds-run"><button class="ds-primary" type="button" data-capacity>Kapazität berechnen →</button><strong data-maximum>–</strong></div>
        <p data-status role="status" aria-live="polite">Welt und eigene Dörfer werden geladen …</p><button type="button" data-cancel hidden>Berechnung abbrechen</button></div>
    <div class="ds-result-area"><div class="ds-result-heading"><h3>Angriffe planen</h3><button type="button" data-wb disabled>WB kopieren</button></div>
        <label>Angriffszahl <strong data-count-label></strong><input type="range" data-count min="1" max="1" value="1" disabled></label>
        <div class="ds-run"><button type="button" class="ds-primary" data-plan disabled>Plan erstellen →</button></div><p class="ds-hint" data-summary>Noch keine Kapazität berechnet.</p>
        <div data-result-tools hidden><label>Ansicht <select data-result-view><option value="time">Zeitliste</option><option value="source">Quelldorf → seine Ziele</option><option value="target">Zieldorf ← seine Angreifer</option></select></label><label class="ds-check"><input type="checkbox" data-all-results> Alle Befehle auswählen</label><span class="ds-hint">Gruppen zum Aufklappen. Die WB-Auswahl bleibt beim Ansichtswechsel erhalten.</span></div><div data-results></div></div>
    <div class="ds-export-box" data-export-wrap hidden><label>DS-Util / DS Workbench Import<textarea data-export readonly rows="6" spellcheck="false" aria-label="Workbench-Importcode"></textarea></label></div></details>`;
    (document.querySelector('#content_value, #mobileContent, #contentContainer') || document.body).prepend(root);
    // Auch bei Rückkehr über den Browser-Verlauf keinen geöffneten Zustand wiederherstellen.
    win.addEventListener('pageshow', event => {
        root.querySelectorAll('details').forEach(e => { e.open = false; });
        if (event.persisted && world) { resetWindows(); invalidate(); }
    });
    async function run(action) {
        if (busy) return;
        setBusy(true);
        try { await action(); } catch (e) { message(e.message || 'Unbekannter Fehler.', true); }
        finally { setBusy(false); }
    }
    root.addEventListener('input', event => {
        if (event.target.matches('[data-source-search]')) { renderSources(); return; }
        if (event.target.matches('[data-count]')) {
            desiredAttackCount = +$('[data-count]').value;
            preview = null; $('[data-plan]').disabled = true;
            result = null; $('[data-results]').innerHTML = ''; $('[data-export-wrap]').hidden = true;
            $('[data-result-tools]').hidden = true;
            $('[data-wb]').disabled = true; updateCounts(); persist();
            return;
        }
        if (event.target.matches('[data-targets], [data-ratio], [data-age], [data-reserve], [data-gap], [data-min-off], [data-db-key], [data-send-start], [data-send-end], [data-arrival-start], [data-arrival-end]')) {
            invalidate(); updateCounts(); persist();
            if (event.target.matches('[data-targets]')) { clearTimeout(validationTimer); validationTimer = setTimeout(validateTargets, 180); }
        }
    });
    root.addEventListener('change', event => {
        const e = event.target;
        if (e.matches('[data-count]')) { run(previewPlan); return; }
        if (e.matches('[data-result-view]')) { if (result) renderResult(); persist(); return; }
        if (e.matches('[data-result], [data-all-results]')) {
            if (e.matches('[data-all-results]')) { for (const r of result.rows) r.selected = e.checked; root.querySelectorAll('[data-result]').forEach(c => { c.checked = e.checked; }); }
            else result.rows[+e.dataset.result].selected = e.checked;
            $('[data-export-wrap]').hidden = true; tick(); return;
        }
        if (e.matches('[data-source]')) { sources.find(s => s.id === +e.dataset.source).selected = e.checked; renderSources(); }
        if (e.matches('[data-role]')) sources.find(s => s.id === +e.dataset.role).role = e.value;
        if (e.matches('select, [data-source], [data-use-send], [data-use-arrival], [data-db]')) { invalidate(); persist(); }
    });
    root.addEventListener('click', event => {
        const b = event.target.closest('button'); if (!b || b.disabled) return;
        if (b.matches('[data-capacity]')) run(calculateCapacity);
        else if (b.matches('[data-check-db]')) run(checkDB);
        else if (b.matches('[data-plan]')) run(makePlan);
        else if (b.matches('[data-reload]')) run(async () => {
            if (!world || !map) { await init(); return; }
            save('sources', Object.fromEntries(sources.map(s => [s.id, { selected: s.selected, role: s.role }])));
            invalidate(); refreshTemplates(); await loadSources(); message('Eigene Bestände und Vorlagen aktualisiert.');
        });
        else if (b.matches('[data-cancel]')) cancelCompute?.();
        else if (b.matches('[data-all-sources], [data-no-sources]')) { sources.forEach(s => { s.selected = b.matches('[data-all-sources]'); }); invalidate(); renderSources(); persist(); }
        else if (b.matches('[data-wb], [data-row-wb]')) run(async () => {
            const rows = b.matches('[data-row-wb]') ? [result.rows[+b.dataset.rowWb]].filter(r => r.launch > now()) : result.rows.filter(r => r.selected && r.launch > now());
            await copy(rows);
        });
    });
    win.addEventListener('storage', event => { if (event.key?.startsWith('ds-troop-templates:')) { refreshTemplates(); invalidate(); } });
    async function init() {
        const values = stored('settings', {});
        desiredAttackCount = Number.isInteger(values.attackCount) && values.attackCount > 0 ? values.attackCount : null;
        for (const [k, selector] of Object.entries({ targets: 'targets', fakePercent: 'ratio', maxAge: 'age', reserve: 'reserve', gap: 'gap' }))
            if (values[k] != null) $(`[data-${selector}]`).value = values[k];
        root.querySelectorAll('[data-min-off]').forEach(e => { if (values.minimumOffUnits?.[e.dataset.minOff] != null) e.value = values.minimumOffUnits[e.dataset.minOff]; });
        if (['time', 'source', 'target'].includes(values.resultView)) $('[data-result-view]').value = values.resultView;
        for (const [k, selector] of Object.entries({ useDB: 'db' }))
            if (values[k] != null) $(`[data-${selector}]`).checked = !!values[k];
        $('[data-db-key]').value = values.apiKey ?? localStorage.getItem('dbkey') ?? '';
        refreshTemplates(); if (values.template) $('[data-template]').value = values.template;
        updateCounts();
        const [cfg, info, players, villages, allies] = await Promise.all([
            request('/interface.php?func=get_config'), request('/interface.php?func=get_unit_info'), request('/map/player.txt'), request('/map/village.txt'), request('/map/ally.txt')]);
        world = parseWorld(new DOMParser().parseFromString(cfg, 'application/xml'), new DOMParser().parseFromString(info, 'application/xml'), units);
        resetWindows();
        map = parseMap(players, villages, allies);
        validateTargets();
        $('[data-world]').textContent = `Welt ${gd.world} · Fakelimit ${world.fakeLimit} % der Quelldorfpunkte + 3 Einwohner Reserve · Fakes bevorzugt Katapulte + 1 Späher, ohne Speere · ${world.night.active ? `Nachtbonus ${world.night.start}:00–${world.night.end}:00` : 'Kein Nachtbonus'} · Laufzeiten aus der Weltkonfiguration.`;
        await loadSources(); persist(); message('Ziele eingeben, Quelldörfer wählen und Kapazität berechnen.');
    }
    run(init);
    const timer = setInterval(() => { if (!root.isConnected) { clearInterval(timer); abort.abort(); activeWorker?.terminate(); return; } tick(); }, 1000);
})();
