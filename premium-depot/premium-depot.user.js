// ==UserScript==
// @name         Die Stämme – Premium-Depot-Verkaufshelfer
// @namespace    local.die-staemme.premium-depot
// @version      1.0.2
// @description  Plant Verkäufe mit Depotkapazität, Händlerlimit, Reserven und Kursprüfung im Bestätigungsdialog. Nutzung auf eigene Gefahr.
// @match        https://*.die-staemme.de/game.php?*screen=market*mode=exchange*
// @match        https://*.die-staemme.de/game.php?*mode=exchange*screen=market*
// @exclude      /^[^?]+\?(?!(?=(?:[^#]*&)?screen=market(?:&|#|$))(?=(?:[^#]*&)?mode=exchange(?:&|#|$)))/
// @exclude      /^[^?]+\?(?:[^#]*&)?(screen|mode)=[^#]*&\1=/
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.
// Vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen prüfen.

(function () {
    'use strict';
    const RES = ['wood', 'stone', 'iron'];
    const LABEL = { wood: 'Holz', stone: 'Lehm', iron: 'Eisen' };
    const ID = 'ds-premium-seller';
    const number = value => {
        const s = String(value ?? '').trim().replace(/[.\s\u00a0]/g, '');
        return /^\d+$/.test(s) ? Number(s) : NaN;
    };
    const integer = value => Number.isSafeInteger(value) && value >= 0;

    // Identische Kostenkurve wie PremiumExchange.calculateCost der mitgelieferten Seite.
    function revenue(data, resource, amount) {
        const stock = Number(data.stock[resource]);
        const capacity = Number(data.capacity[resource]);
        const c = data.constants;
        const price = s => Number(c.resource_base_price) - Number(c.resource_price_elasticity) * s /
            (capacity + Number(c.stock_size_modifier));
        return (1 + Number(data.tax.sell)) * (price(stock) + price(stock + amount)) * amount / 2;
    }

    function plan(data, resource, available, merchants, carry, settings) {
        const free = Number(data.capacity[resource]) - Number(data.stock[resource]);
        const reserve = settings.reserve[resource];
        const budget = settings.merchants ? Math.min(merchants, settings.merchants) : merchants;
        if (![available, merchants, carry, reserve, budget, settings.merchants, settings.maxRate[resource]].every(integer) || carry === 0 ||
            !Number.isFinite(free)) return null;
        const cap = Math.floor(Math.min(free, Math.max(0, available - reserve), budget * carry));
        if (cap <= 0) return null;
        const income = revenue(data, resource, cap);
        // Die Kurve muss im gesamten Verkaufsintervall steigen.
        const c = data.constants;
        const endSlope = (1 + Number(data.tax.sell)) * (Number(c.resource_base_price) -
            Number(c.resource_price_elasticity) * (Number(data.stock[resource]) + cap) /
            (Number(data.capacity[resource]) + Number(c.stock_size_modifier)));
        if (!Number.isFinite(income) || !(endSlope > 0)) return null;
        const points = Math.floor(income + 1e-10);
        if (points < 1) return null;
        // Größter ganzer PP-Betrag innerhalb der Grenzen; zugehörige Menge per binärer Suche.
        let low = 1, high = cap;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (revenue(data, resource, mid) + 1e-10 >= points) high = mid;
            else low = mid + 1;
        }
        const amount = low;
        const rate = amount / points;
        if (settings.maxRate[resource] > 0 && rate > settings.maxRate[resource]) return null;
        return { resource, amount, points, rate, cap, merchants: Math.ceil(amount / carry),
            efficiency: amount / (Math.ceil(amount / carry) * carry) };
    }

    function choose(plans) {
        return plans.filter(Boolean).sort((a, b) => b.amount - a.amount ||
            a.merchants - b.merchants || b.points - a.points)[0] || null;
    }

    function checkQuote(transactions, pending, state, settings) {
        if (!Array.isArray(transactions) || transactions.length !== 1) return { ok: false, reason: 'Unerwartetes oder gemischtes Angebot.' };
        const t = transactions[0];
        const amount = -Number(t.amount), points = -Number(t.cost), merchants = Number(t.merchants_required);
        if (t.error || t.resource !== pending.resource || !integer(amount) || amount === 0 ||
            !Number.isFinite(points) || points <= 0 || !integer(merchants) || merchants === 0 || !t.rate_hash) {
            return { ok: false, reason: 'Kein gültiges Verkaufsangebot vom Spiel.' };
        }
        const r = t.resource;
        if (!settings.enabled[r] || ![settings.reserve[r], settings.maxRate[r], settings.merchants, state.merchants, state.carry].every(integer) || state.carry === 0) {
            return { ok: false, reason: 'Rohstoff abgewählt oder Einstellungen ungültig.' };
        }
        const free = Number(state.data.capacity[r]) - Number(state.data.stock[r]);
        const available = state.available[r] - settings.reserve[r];
        const budget = settings.merchants ? Math.min(state.merchants, settings.merchants) : state.merchants;
        if (![free, available, budget, state.carry].every(Number.isFinite)) return { ok: false, reason: 'Aktuelle Bestände fehlen.' };
        if (amount > pending.cap || amount > free || amount > available || amount > budget * state.carry ||
            merchants > budget || merchants < Math.ceil(amount / state.carry)) {
            return { ok: false, reason: 'Das angepasste Angebot überschreitet Kapazität, Reserve oder Händlerlimit.' };
        }
        if (settings.maxRate[r] > 0 && amount / points > settings.maxRate[r]) {
            return { ok: false, reason: 'Der tatsächliche Kurs überschreitet deine Kursgrenze.' };
        }
        return { ok: true, amount, points, merchants, rate: amount / points,
            efficiency: amount / (merchants * state.carry) };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { number, revenue, plan, choose, checkQuote };
        return;
    }
    const exchange = window.PremiumExchange;
    const form = document.querySelector('#premium_exchange_form');
    if (!exchange || !form || document.getElementById(ID)) return;
    const key = `${ID}:${location.host}:${window.game_data?.player?.id}:${window.game_data?.village?.id}`;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) { /* Standardwerte */ }
    let pending = null, quote = null, requesting = false;
    const fmt = n => Number(n).toLocaleString('de-DE', { maximumFractionDigits: 2 });
    const panel = document.createElement('div');
    panel.id = ID;
    panel.innerHTML = `<h3>Premium-Depot-Verkaufshelfer</h3>
        <p>Maximale Menge zum ganzen Premium-Punkt, begrenzt durch Depot, Dorf und Händler.
        Niedrigere Rohstoffe pro PP bedeuten einen besseren Verkaufskurs.</p>
        <div style="overflow-x:auto"><table class="vis" style="width:100%"><thead><tr>
        <th>Verkaufen</th><th>Reserve im Dorf</th><th>Max. Rohstoffe/PP<br>(0 = beliebig)</th>
        <th>Depot frei / Kurs</th><th>Vorschlag / Händler</th><th></th>
        </tr></thead><tbody>${RES.map(r => `<tr data-res="${r}"><td><label><input type="checkbox" data-setting="enabled" data-res="${r}"> ${LABEL[r]}</label></td>
        <td><input type="number" min="0" step="1" data-setting="reserve" data-res="${r}" style="width:90px"></td>
        <td><input type="number" min="0" step="1" data-setting="maxRate" data-res="${r}" style="width:90px"></td>
        <td data-info="${r}"></td><td data-plan="${r}"></td>
        <td><button type="button" class="btn" data-sell="${r}">Angebot prüfen</button></td></tr>`).join('')}</tbody></table></div>
        <p><label>Händlerlimit (0 = alle verfügbaren): <input type="number" min="0" step="1" data-setting="merchants" style="width:80px"></label>
        <button type="button" class="btn" data-best>Größte Menge prüfen</button>
        <button type="button" class="btn" data-refresh>Neu berechnen</button></p>
        <p data-status aria-live="polite"></p>`;
    form.before(panel);
    panel.querySelectorAll('[data-setting]').forEach(input => {
        const kind = input.dataset.setting, r = input.dataset.res;
        const value = r ? saved[kind]?.[r] : saved[kind];
        if (kind === 'enabled') input.checked = value !== false;
        else input.value = integer(value) ? value : 0;
    });
    const message = text => { panel.querySelector('[data-status]').textContent = text; };
    function settings() {
        const out = { enabled: {}, reserve: {}, maxRate: {}, merchants: 0 };
        panel.querySelectorAll('[data-setting]').forEach(input => {
            const kind = input.dataset.setting, r = input.dataset.res;
            const value = kind === 'enabled' ? input.checked : number(input.value);
            if (r) out[kind][r] = value; else out[kind] = value;
        });
        return out;
    }
    function state() {
        const merchants = number(document.querySelector('#market_merchant_available_count')?.textContent);
        const transport = number(document.querySelector('#market_merchant_max_transport')?.textContent);
        const carry = merchants > 0 ? transport / merchants : 0;
        const available = {};
        RES.forEach(r => {
            const displayed = number(document.getElementById(r)?.textContent);
            const game = Number(window.game_data?.village?.[r]);
            // Native Validierung verwendet game_data; der kleinere Bestand ist sicherer.
            available[r] = Number.isFinite(displayed) && Number.isFinite(game) ? Math.min(displayed, game) : NaN;
        });
        return { data: exchange.data, available, merchants, carry };
    }
    function plans(s, config) {
        try { return RES.map(r => config.enabled[r] ? plan(s.data, r, s.available[r], s.merchants, s.carry, config) : null); }
        catch (_) { return []; }
    }
    function visibleDialog() {
        const dialog = document.querySelector('#premium_exchange');
        return dialog && dialog.getClientRects().length ? dialog : null;
    }
    function refresh() {
        const s = state(), config = settings(), list = plans(s, config);
        RES.forEach(r => {
            const proposal = list.find(p => p?.resource === r);
            const free = Number(s.data?.capacity?.[r]) - Number(s.data?.stock?.[r]);
            let rate;
            try { rate = exchange.calculateRateForOnePoint(r); } catch (_) { rate = NaN; }
            panel.querySelector(`[data-info="${r}"]`).textContent = `${fmt(free)} frei / ${fmt(rate)} pro PP`;
            panel.querySelector(`[data-plan="${r}"]`).textContent = proposal ?
                `${fmt(proposal.amount)} → ca. ${fmt(proposal.points)} PP / ${proposal.merchants} Händler (${fmt(proposal.efficiency * 100)} %)` : 'Kein passender Verkauf';
            panel.querySelector(`[data-sell="${r}"]`).disabled = !proposal || requesting || !!visibleDialog();
        });
        panel.querySelector('[data-best]').disabled = !choose(list) || requesting || !!visibleDialog();
        inspectDialog();
    }
    function inspectDialog() {
        const dialog = visibleDialog();
        if (!pending || !quote || !dialog) return;
        let result;
        try { result = checkQuote(quote, pending, state(), settings()); }
        catch (_) { result = { ok: false, reason: 'Angebot kann nicht sicher geprüft werden.' }; }
        let note = dialog.querySelector('[data-depot-check]');
        if (!note) {
            note = document.createElement('p');
            note.dataset.depotCheck = '';
            dialog.querySelector('.confirmation-buttons')?.before(note);
        }
        note.style.cssText = `padding:8px;border:2px solid ${result.ok ? '#42732d' : '#a02020'}`;
        const text = result.ok ? `Geprüft: ${fmt(result.amount)} ${LABEL[pending.resource]} → ${fmt(result.points)} PP; ` +
            `${result.merchants} Händler, ${fmt(result.efficiency * 100)} % ausgelastet; ${fmt(result.rate)} Rohstoffe/PP. Bitte selbst bestätigen.` :
            `${result.reason} Abbrechen und ein neues Angebot berechnen.`;
        if (note.textContent !== text) note.textContent = text;
        dialog.querySelectorAll('.btn-confirm-yes').forEach(button => { button.disabled = !result.ok; });
        return result;
    }
    // Die Antwort enthält die echten Mengen, PP und Händler, auch bei einer Kursänderung.
    const originalShow = exchange.showConfirmationDialog;
    exchange.showConfirmationDialog = function (transactions) {
        if (pending) { quote = transactions; requesting = false; }
        const result = originalShow.apply(this, arguments);
        inspectDialog();
        refresh();
        return result;
    };
    // Vor dem nativen Bestätigungshandler nochmals gegen aktuelle Werte prüfen.
    document.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target.closest('#premium_exchange .btn-confirm-yes') : null;
        if (!target || !pending) return;
        const result = inspectDialog();
        if (!result?.ok) {
            event.preventDefault(); event.stopImmediatePropagation();
            message(result?.reason || 'Angebot ist noch nicht geprüft.');
        }
    }, true);
    function submit(resource) {
        if (requesting || visibleDialog()) return;
        const config = settings(), s = state();
        const list = plans(s, config);
        const p = resource ? list.find(p => p?.resource === resource) : choose(list);
        const nativeSubmit = form.querySelector('[type="submit"]');
        if (!p || !nativeSubmit || nativeSubmit.disabled) {
            message('Kein passendes Angebot oder das Spiel befindet sich noch im Cooldown.'); return;
        }
        form.querySelectorAll('.premium-exchange-input').forEach(input => { input.value = ''; });
        form.querySelectorAll('.premium-exchange-input').forEach(input => {
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        // updateUI hebt die gegenseitige Sperre der nativen Einzelfelder auf.
        exchange.updateUI();
        const input = form.querySelector(`[name="sell_${p.resource}"]`);
        if (!input || input.disabled) { message('Das Depot nimmt diesen Rohstoff derzeit nicht an.'); return; }
        input.value = String(p.amount);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (Object.keys(exchange.errors).length) { message('Das Spiel lehnt die Menge ab. Bitte neu berechnen.'); return; }
        pending = p; quote = null; requesting = true;
        message(`Angebot für ${fmt(p.amount)} ${LABEL[p.resource]} wird vom Spiel geprüft …`);
        form.requestSubmit(nativeSubmit);
        refresh();
    }
    panel.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.hasAttribute('data-sell')) submit(button.dataset.sell);
        else if (button.hasAttribute('data-best')) submit();
        else if (button.hasAttribute('data-refresh')) { refresh(); message('Vorschläge anhand der aktuellen Seitenwerte neu berechnet.'); }
    });
    panel.addEventListener('change', () => {
        try { localStorage.setItem(key, JSON.stringify(settings())); } catch (_) { message('Einstellungen können nicht dauerhaft gespeichert werden.'); }
        refresh();
    });
    form.addEventListener('submit', () => {
        // Ein direkt im Originalformular gestarteter Handel gehört nicht zu unserem Vorschlag.
        if (!requesting) { pending = null; quote = null; }
    }, true);
    // Kein eigener Netzwerk-Poller: das Spiel aktualisiert seine Depotdaten selbst.
    window.setInterval(() => {
        if (requesting && !visibleDialog() && !form.querySelector('[type="submit"]')?.disabled) {
            requesting = false; pending = null; quote = null;
            message('Keine offene Bestätigung. Du kannst ein neues Angebot prüfen.');
        } else if (pending && !requesting && !visibleDialog()) { pending = null; quote = null; }
        refresh();
    }, 1000);
    refresh();
    message('Rohstoff wählen oder die größte Menge prüfen. Der tatsächliche Handel steht im Bestätigungsdialog.');
})();
