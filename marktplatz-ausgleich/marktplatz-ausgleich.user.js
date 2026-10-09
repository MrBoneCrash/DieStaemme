// ==UserScript==
// @name         Die Stämme – Marktplatz-Ausgleich
// @namespace    local.die-staemme.marktplatz-ausgleich
// @version      0.6.2
// @description  Plant Tauschangebote für auswählbare eigene Dörfer und stellt jede geprüfte Angebotsgruppe erst nach einem eigenen Klick ein. Nutzung auf eigene Gefahr.
// @author       Lokal
// @match        https://*.die-staemme.de/game.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// Warnhinweis: Die Nutzung erfolgt auf eigene Gefahr.
// Vor dem Einsatz die aktuellen Spielregeln und alle vorgeschlagenen Aktionen prüfen.

(function () {
    'use strict';

    const SCRIPT_ID = 'ds-market-balance';
    const RESOURCES = ['wood', 'stone', 'iron'];
    const NAMES = { wood: 'Holz', stone: 'Lehm', iron: 'Eisen' };
    const TROOP_NAMES = { spear:'Speer', sword:'Schwert', axe:'Axt', archer:'Bogen', spy:'Späher', light:'LK', marcher:'BB', heavy:'SK', ram:'Rammbock', catapult:'Katapult' };
    const DEFAULTS = Object.freeze({
        weights: { wood: 1, stone: 1, iron: 1 },
        reserve: { wood: 1000, stone: 1000, iron: 1000 },
        sellPerOffer: 1000,
        buyPerOffer: 1000,
        minDifference: 1000,
        maxOffersPerGroup: 10,
        maxGroupsPerVillage: 6,
        maxTravelHours: 10,
        includeOpenOffers: true,
        preferForeignOffers: false,
        ownMode: 'balance',
        troopTemplateIds: null,
        clusterHours: 2,
        allowCrossCluster: false
    });

    function parseIntLocalized(value) {
        const digits = String(value ?? '').replace(/[^0-9]/g, '');
        return digits ? Number(digits) : null;
    }

    function boundedInt(value, fallback, min, max) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
    }

    function normalizeConfig(input) {
        const source = input && typeof input === 'object' ? input : {};
        return {
            weights: Object.fromEntries(RESOURCES.map((key) => [key,
                boundedInt(source.weights?.[key], DEFAULTS.weights[key], 1, 100)
            ])),
            reserve: Object.fromEntries(RESOURCES.map((key) => [key,
                boundedInt(source.reserve?.[key], DEFAULTS.reserve[key], 0, 10000000)
            ])),
            sellPerOffer: boundedInt(source.sellPerOffer, DEFAULTS.sellPerOffer, 10, 100000),
            buyPerOffer: boundedInt(source.buyPerOffer, DEFAULTS.buyPerOffer, 10, 100000),
            minDifference: boundedInt(source.minDifference, DEFAULTS.minDifference, 0, 1000000),
            maxOffersPerGroup: boundedInt(source.maxOffersPerGroup, DEFAULTS.maxOffersPerGroup, 1, 100),
            maxGroupsPerVillage: boundedInt(source.maxGroupsPerVillage, DEFAULTS.maxGroupsPerVillage, 1, 30),
            maxTravelHours: boundedInt(source.maxTravelHours, DEFAULTS.maxTravelHours, 1, 1000),
            includeOpenOffers: source.includeOpenOffers === undefined ? DEFAULTS.includeOpenOffers : source.includeOpenOffers === true,
            preferForeignOffers: source.preferForeignOffers === undefined ? DEFAULTS.preferForeignOffers : source.preferForeignOffers === true,
            ownMode: ['balance', 'build', 'noble', 'troops'].includes(source.ownMode) ? source.ownMode : DEFAULTS.ownMode,
            troopTemplateIds: Array.isArray(source.troopTemplateIds) ? [...new Set(source.troopTemplateIds.filter(id=>typeof id==='string'))] : null,
            clusterHours: boundedInt(source.clusterHours, DEFAULTS.clusterHours, 1, 100),
            allowCrossCluster: source.allowCrossCluster === true
        };
    }

    function sharesFromWeights(weights) {
        const total = RESOURCES.reduce((sum, key) => sum + (Number(weights[key]) || 1), 0);
        const raw = Object.fromEntries(RESOURCES.map((key) => [key, 100 * (Number(weights[key]) || 1) / total]));
        const shares = Object.fromEntries(RESOURCES.map((key) => [key, Math.max(1, Math.floor(raw[key]))]));
        while (RESOURCES.reduce((sum, key) => sum + shares[key], 0) < 100) {
            const key = [...RESOURCES].sort((a, b) => (raw[b] - shares[b]) - (raw[a] - shares[a]))[0];
            shares[key] += 1;
        }
        while (RESOURCES.reduce((sum, key) => sum + shares[key], 0) > 100) {
            const key = [...RESOURCES].filter((entry) => shares[entry] > 1)
                .sort((a, b) => (shares[b] - raw[b]) - (shares[a] - raw[a]))[0];
            shares[key] -= 1;
        }
        return shares;
    }

    function redistributeShares(shares, changedKey, requested) {
        const value = boundedInt(requested, shares[changedKey], 1, 98);
        const other = RESOURCES.filter((key) => key !== changedKey);
        const otherTotal = Math.max(1, shares[other[0]] + shares[other[1]]);
        const remaining = 100 - value;
        const first = Math.min(remaining - 1, Math.max(1, Math.round(remaining * shares[other[0]] / otherTotal)));
        return { ...shares, [changedKey]: value, [other[0]]: first, [other[1]]: remaining - first };
    }

    function targetFor(stock, config) {
        const total = RESOURCES.reduce((sum, key) => sum + stock[key], 0);
        const weightTotal = RESOURCES.reduce((sum, key) => sum + config.weights[key], 0);
        return Object.fromEntries(RESOURCES.map((key) => [key,
            Math.max(config.reserve[key], Math.round(total * config.weights[key] / weightTotal))
        ]));
    }

    function deviation(stock, config) {
        const target = targetFor(stock, config);
        return RESOURCES.reduce((sum, key) => sum + Math.abs(stock[key] - target[key]), 0);
    }

    /** Eine Gruppe entspricht einem nativen Formular mit dem Feld „multi“. */
    function planVillage(village, configInput) {
        const config = normalizeConfig(configInput);
        const stock = Object.fromEntries(RESOURCES.map((key) => [key,
            Math.max(0, Math.floor(Number(village.resources?.[key]) || 0))
        ]));
        // Erwartete Lieferungen zählen für das Ziel, bleiben aber bis zur
        // Ankunft vom tatsächlich anbietbaren Lagerbestand getrennt.
        const sellable = Object.fromEntries(RESOURCES.map((key) => [key,
            Math.max(0, Math.floor(Number(village.sellable?.[key] ?? village.resources?.[key]) || 0))
        ]));
        let merchants = Math.max(0, Math.floor(Number(village.merchants) || 0));
        const perOfferMerchants = Math.ceil(config.sellPerOffer / 1000);
        const groups = [];

        for (let index = 0; index < config.maxGroupsPerVillage; index += 1) {
            const target = targetFor(stock, config);
            const sells = RESOURCES.map((key) => ({
                key, amount: Math.max(0, Math.min(stock[key] - target[key], sellable[key] - config.reserve[key]))
            })).filter((entry) => entry.amount >= config.minDifference && entry.amount >= config.sellPerOffer)
                .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
            const buys = RESOURCES.map((key) => ({
                key, amount: Math.max(0, target[key] - stock[key])
            })).filter((entry) => entry.amount >= config.minDifference && entry.amount >= config.buyPerOffer)
                .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
            let best = null;
            for (const sell of sells) {
                for (const buy of buys) {
                    if (sell.key === buy.key) continue;
                    const count = Math.min(
                        Math.floor(sell.amount / config.sellPerOffer),
                        Math.floor(buy.amount / config.buyPerOffer),
                        Math.floor(merchants / perOfferMerchants),
                        config.maxOffersPerGroup
                    );
                    if (count < 1) continue;
                    const next = { ...stock };
                    next[sell.key] -= count * config.sellPerOffer;
                    next[buy.key] += count * config.buyPerOffer;
                    const improvement = deviation(stock, config) - deviation(next, config);
                    if (improvement <= 0) continue;
                    const candidate = { sell: sell.key, buy: buy.key, count, improvement };
                    if (!best || candidate.improvement > best.improvement) best = candidate;
                }
            }
            if (!best) break;
            groups.push({ villageId: String(village.id), ...best,
                sellEach: config.sellPerOffer, buyEach: config.buyPerOffer,
                merchants: best.count * perOfferMerchants,
                reserve: config.reserve[best.sell] });
            stock[best.sell] -= best.count * config.sellPerOffer;
            stock[best.buy] += best.count * config.buyPerOffer;
            sellable[best.sell] -= best.count * config.sellPerOffer;
            merchants -= best.count * perOfferMerchants;
        }
        return groups;
    }

    function summarizeGroups(groups) {
        const offered = { wood: 0, stone: 0, iron: 0 };
        const wanted = { wood: 0, stone: 0, iron: 0 };
        let merchants = 0;
        for (const group of groups) {
            offered[group.sell] += group.sellEach * group.count;
            wanted[group.buy] += group.buyEach * group.count;
            merchants += group.merchants;
        }
        return { offered, wanted, merchants };
    }

    function projectedStock(resources, incoming, openWanted, includeOpenOffers = true) {
        return Object.fromEntries(RESOURCES.map((key) => [key,
            Math.max(0, Number(resources[key]) || 0) + Math.max(0, Number(incoming[key]) || 0)
                + (includeOpenOffers ? Math.max(0, Number(openWanted[key]) || 0) : 0)
        ]));
    }

    // JSON aus gespeicherten Spielseiten lesen, ohne Seitencode auszuführen.
    function extractJsonObject(source, marker) {
        const offset = source.indexOf(marker);
        if (offset < 0) return null;
        const start = source.indexOf('{', offset + marker.length);
        if (start < 0) return null;
        let depth = 0, quoted = false, escaped = false;
        for (let i = start; i < source.length; i += 1) {
            const char = source[i];
            if (quoted) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') quoted = false;
            } else if (char === '"') quoted = true;
            else if (char === '{') depth += 1;
            else if (char === '}' && --depth === 0) {
                try { return JSON.parse(source.slice(start, i + 1)); } catch (_) { return null; }
            }
        }
        return null;
    }
    const zeroResources = () => ({ wood: 0, stone: 0, iron: 0 });
    const totalResources = (values) => RESOURCES.reduce((sum, key) => sum + values[key], 0);
    function recruitmentStore(raw) {
        if (!raw || raw.version !== 1 || !Array.isArray(raw.templates)) return { templates:[], villageTemplateIds:{} };
        const templates = raw.templates.filter(t=>t && typeof t.id==='string' && typeof t.name==='string').map(t=>({
            id:t.id, name:t.name.slice(0,60), units:Object.fromEntries(Object.keys(TROOP_NAMES).map(unit=>[unit,boundedInt(t.units?.[unit],0,0,999999)]))
        }));
        const ids=new Set(templates.map(t=>t.id));
        return { templates, villageTemplateIds:Object.fromEntries(Object.entries(raw.villageTemplateIds||{}).filter(([v,id])=>/^\d+$/.test(v)&&ids.has(id))) };
    }
    function troopBatch(items, budget, cap = Infinity) {
        const active=items.filter(item=>item.deficit>0);
        const counts=Object.fromEntries(items.map(item=>[item.unit,0]));
        const remaining={...budget};
        const keys=[...RESOURCES,'pop'];
        const costOf=values=>Object.fromEntries(keys.map(key=>[key,items.reduce((s,item)=>s+(values[item.unit]||0)*item.cost[key],0)]));
        let low=0,high=1;
        for(let i=0;i<42;i++) {
            const scale=(low+high)/2;
            const values=Object.fromEntries(active.map(item=>[item.unit,Math.floor(item.deficit*scale)]));
            const cost=costOf(values), count=Object.values(values).reduce((s,n)=>s+n,0);
            if(count<=cap && keys.every(key=>cost[key]<=budget[key])) low=scale; else high=scale;
        }
        for(const item of active) counts[item.unit]=Math.floor(item.deficit*low);
        const initial=costOf(counts);
        for(const key of keys) remaining[key]-=initial[key];
        let number=Object.values(counts).reduce((s,n)=>s+n,0);
        while(number<cap) {
            const next=active.filter(item=>counts[item.unit]<item.deficit && keys.every(key=>item.cost[key]<=remaining[key]))
                .sort((a,b)=>(b.deficit-counts[b.unit])/b.deficit-(a.deficit-counts[a.unit])/a.deficit || a.unit.localeCompare(b.unit))[0];
            if(!next) break;
            counts[next.unit]++; number++;
            for(const key of keys) remaining[key]-=next.cost[key];
        }
        return { counts, cost:costOf(counts), number };
    }
    function travelSeconds(source, target) {
        return Math.ceil(Math.hypot(source.x - target.x, source.y - target.y) * source.secondsPerField);
    }
    function clusterVillages(villages, maxSeconds) {
        const clusters = [];
        // Alle Dorfpaare eines Clusters müssen innerhalb der Grenze liegen.
        // Eine Kette naher Nachbarn verbindet so keine weit entfernten Enden.
        for (const village of [...villages].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
            const candidates = clusters.filter((group) => group.every((other) =>
                Math.max(travelSeconds(village, other), travelSeconds(other, village)) <= maxSeconds));
            candidates.sort((a, b) => Math.min(...a.map((v) => travelSeconds(village, v)))
                - Math.min(...b.map((v) => travelSeconds(village, v))));
            if (candidates.length) candidates[0].push(village);
            else clusters.push([village]);
        }
        return Object.fromEntries(clusters.flatMap((group, index) => group.map((v) => [v.id, index + 1])));
    }
    function nextBuildJobs(template, buildings, levels, populationFree, farmPriority = 0) {
        const effective = { ...levels };
        const jobs = [];
        const ordered = [...template];
        if (farmPriority > 0 && buildings.farm && effective.farm < buildings.farm.max_level) {
            ordered.unshift({ building: 'farm', level: Number(effective.farm) + 1 });
        }
        let free = populationFree;
        for (const entry of ordered) {
            const data = buildings[entry.building];
            if (!data || entry.level <= Number(effective[entry.building] || 0)) continue;
            if (entry.level > data.max_level || entry.level !== Number(effective[entry.building] || 0) + 1) break;
            if (Object.entries(data.req || {}).some(([key, level]) => Number(effective[key] || 0) < level)) break;
            const step = entry.level - Number(data.level_next);
            if (step < 0) continue;
            const cost = Object.fromEntries(RESOURCES.map((key) => [key,
                Math.ceil(Number(data[key]) * Math.pow(Number(data[`${key}_factor`]) || 1, step))
            ]));
            const pop = Math.ceil(Number(data.pop || 0) * Math.pow(Number(data.pop_factor) || 1, step));
            if (pop > free && entry.building !== 'farm') break;
            // Ohne bestätigte neue Bauernhofkapazität keine zusätzliche
            // Bevölkerung für den zweiten Bau voraussetzen.
            free -= pop;
            jobs.push({ ...entry, cost, buildSeconds: Math.ceil(Number(data.build_time || 0)
                * Math.pow(Number(data.build_time_factor) || 1, step)), name: `${data.name || entry.building} ${entry.level}` });
            effective[entry.building] = entry.level;
            if (jobs.length === 2) break;
        }
        return jobs;
    }
    function planOwnTransfers(input, configInput) {
        const config = normalizeConfig(configInput);
        const villages = input.map((v) => ({ ...v, id: String(v.id),
            resources: { ...v.resources }, sellable: { ...v.sellable },
            protected: { ...config.reserve }, allocated: zeroResources(),
            carry: v.carry || 1000, incomingEvents: v.incomingEvents || [], jobs: v.jobs || []
        }));
        const byId = Object.fromEntries(villages.map((v) => [v.id, v]));
        const clusters = clusterVillages(villages, config.clusterHours * 3600);
        const transfers = [], goals = [];
        const maxTime = config.clusterHours * 3600;
        const storageHorizon = (target, seconds) => Math.max(seconds,
            ...transfers.filter((route) => route.target === target.id).map((route) => route.seconds));
        const allowed = (a, b, cross) => a.id !== b.id && (cross ||
            (clusters[a.id] === clusters[b.id] && travelSeconds(a, b) <= maxTime));
        const forecastAt = (v, seconds) => Object.fromEntries(RESOURCES.map((key) => [key,
            Math.min(v.storage, v.sellable[key] + (v.production?.[key] || 0) * seconds
                + v.incomingEvents.filter((e) => e.seconds <= seconds).reduce((sum, e) => sum + e.amounts[key], 0)
                + transfers.filter((r) => r.target === v.id && r.seconds <= seconds).reduce((sum, r) => sum + r.amounts[key], 0))
        ]));
        function apply(routes) {
            for (const route of routes) {
                const from = byId[route.source], to = byId[route.target];
                from.merchants -= route.merchants;
                for (const key of RESOURCES) {
                    from.sellable[key] -= route.amounts[key]; from.resources[key] -= route.amounts[key];
                    to.resources[key] += route.amounts[key]; to.allocated[key] += route.amounts[key];
                }
                transfers.push(route);
            }
        }
        function fund(target, budget, reason, cross) {
            const donors = villages.filter((v) => allowed(v, target, cross) && v.merchants > 0)
                .sort((a, b) => travelSeconds(a, target) - travelSeconds(b, target));
            // Zuerst den kleinsten Radius testen, dann schrittweise erweitern.
            const horizons = [...new Set([0, ...donors.map((v) => travelSeconds(v, target)),
                ...target.incomingEvents.map((e) => e.seconds), ...transfers.filter((r) => r.target === target.id).map((r) => r.seconds)
            ])].sort((a, b) => a - b);
            for (const seconds of horizons) {
                const stock = forecastAt(target, seconds);
                const need = Object.fromEntries(RESOURCES.map((key) => [key, Math.max(0, Math.ceil(budget[key] - stock[key]))]));
                if (RESOURCES.some((key) => budget[key] > target.storage)) return null;
                if (RESOURCES.some((key) => target.resources[key] + need[key]
                    + Math.ceil((target.production?.[key] || 0) * storageHorizon(target, seconds)) > target.storage)) continue;
                const routes = [];
                for (const donor of donors.filter((v) => travelSeconds(v, target) <= seconds)) {
                    let capacity = donor.merchants * donor.carry;
                    const amounts = zeroResources();
                    const keys = [...RESOURCES].sort((a, b) =>
                        donors.filter((v) => v.sellable[a] > v.protected[a]).length
                        - donors.filter((v) => v.sellable[b] > v.protected[b]).length);
                    for (const key of keys) {
                        amounts[key] = Math.min(need[key], capacity, Math.max(0, donor.sellable[key] - donor.protected[key]));
                        need[key] -= amounts[key]; capacity -= amounts[key];
                    }
                    if (totalResources(amounts)) routes.push({ source: donor.id, target: target.id, amounts,
                        merchants: Math.ceil(totalResources(amounts) / donor.carry), seconds: travelSeconds(donor, target), reason });
                }
                if (!totalResources(need)) return { routes, seconds };
            }
            return null;
        }
        // Bereits bezahlbare Vorhaben schützen, damit deren Dörfer nicht durch
        // eine Spende erneut auf Rohstoffe warten müssen.
        if (config.ownMode === 'build') for (const v of villages) {
            const job = v.jobs[0];
            if (job && RESOURCES.every((key) => v.sellable[key] >= config.reserve[key] + job.cost[key])) {
                v.protected = Object.fromEntries(RESOURCES.map((key) => [key, config.reserve[key] + job.cost[key]]));
            }
        }
        if (config.ownMode === 'build') {
            const funded = new Set();
            // Erst ein Gebäude je Dorf, anschließend ein zweites im selben Dorf.
            for (let depth = 0; depth < 2; depth += 1) {
                let candidates = villages.filter((v) => v.jobs[depth] && (depth === 0 || funded.has(v.id)));
                while (candidates.length) {
                    const choices = candidates.map((v) => {
                        const budget = Object.fromEntries(RESOURCES.map((key) => [key,
                            config.reserve[key] + v.jobs.slice(0, depth + 1).reduce((sum, j) => sum + j.cost[key], 0)
                        ]));
                        const reason = v.jobs[depth].name;
                        let proposal = fund(v, budget, reason, false);
                        if (!proposal && config.allowCrossCluster) proposal = fund(v, budget, reason, true);
                        return { v, budget, proposal };
                    }).filter((c) => c.proposal).sort((a, b) =>
                        (a.v.queueSeconds || 0) - (b.v.queueSeconds || 0)
                        || totalResources(a.proposal.routes.reduce((s, r) => Object.fromEntries(RESOURCES.map((k) => [k, s[k] + r.amounts[k]])), zeroResources()))
                            - totalResources(b.proposal.routes.reduce((s, r) => Object.fromEntries(RESOURCES.map((k) => [k, s[k] + r.amounts[k]])), zeroResources()))
                        || a.proposal.seconds - b.proposal.seconds);
                    if (!choices.length) break;
                    const { v, budget, proposal } = choices[0];
                    apply(proposal.routes); v.protected = budget; funded.add(v.id);
                    const firstGoal = goals.find((goal) => goal.villageId === v.id);
                    goals.push({ villageId: v.id, label: v.jobs[depth].name, seconds: Math.max(proposal.seconds,
                        depth && firstGoal ? firstGoal.seconds + (v.jobs[0].buildSeconds || 0) : v.queueSeconds || 0) });
                    candidates = candidates.filter((other) => other.id !== v.id);
                }
            }
        }
        if (config.ownMode === 'troops') {
            const targets= villages.filter(v=>v.troop?.items.some(item=>item.deficit>0));
            const allocations=new Map();
            for(const target of targets) {
                const batch=troopBatch(target.troop.items,{...Object.fromEntries(RESOURCES.map(key=>[key,Math.max(0,target.sellable[key]-config.reserve[key])])),pop:target.populationFree});
                allocations.set(target.id,{counts:batch.counts,cost:batch.cost,number:batch.number,seconds:0});
                target.protected=Object.fromEntries(RESOURCES.map(key=>[key,config.reserve[key]+batch.cost[key]]));
            }
            while(true) {
                const choices=[];
                for(const target of targets) {
                    const allocated=allocations.get(target.id);
                    const items=target.troop.items.map(item=>({...item,deficit:Math.max(0,item.deficit-allocated.counts[item.unit])}));
                    const donors=villages.filter(v=>allowed(v,target,config.allowCrossCluster));
                    const stock=forecastAt(target,maxTime);
                    const budget={...Object.fromEntries(RESOURCES.map(key=>[key,Math.max(0,Math.min(target.storage-target.protected[key],
                        stock[key]-target.protected[key]+donors.reduce((s,v)=>s+Math.max(0,v.sellable[key]-v.protected[key]),0)))])),pop:Math.max(0,target.populationFree-allocated.cost.pop)};
                    for(let cap=1000;cap>=1;cap=Math.floor(cap/2)) {
                        const batch=troopBatch(items,budget,cap);
                        if(!batch.number) break;
                        const protectedBudget=Object.fromEntries(RESOURCES.map(key=>[key,target.protected[key]+batch.cost[key]]));
                        let proposal=fund(target,protectedBudget,`Truppen: ${target.troop.name}`,false);
                        if(!proposal && config.allowCrossCluster) proposal=fund(target,protectedBudget,`Truppen: ${target.troop.name}`,true);
                        if(proposal) { choices.push({target,allocated,batch,protectedBudget,proposal}); break; }
                    }
                }
                choices.sort((a,b)=>b.batch.number-a.batch.number || a.proposal.seconds-b.proposal.seconds
                    || totalResources(a.batch.cost)-totalResources(b.batch.cost));
                if(!choices.length) break;
                const {target,allocated,batch,protectedBudget,proposal}=choices[0];
                apply(proposal.routes); target.protected=protectedBudget;
                for(const item of target.troop.items) allocated.counts[item.unit]+=batch.counts[item.unit];
                for(const key of [...RESOURCES,'pop']) allocated.cost[key]+=batch.cost[key];
                allocated.number+=batch.number; allocated.seconds=Math.max(allocated.seconds,proposal.seconds);
            }
            for(const target of targets) {
                const allocated=allocations.get(target.id);
                target.troopPlannedPopulation=allocated.cost.pop;
                if(allocated.number) goals.push({villageId:target.id,label:`${target.troop.name}: ${Object.entries(allocated.counts).filter(([,n])=>n).map(([unit,n])=>`${n} ${TROOP_NAMES[unit]}`).join(', ')}`,seconds:allocated.seconds,counts:allocated.counts});
            }
        }
        if (config.ownMode === 'noble') {
            const targets = villages.filter((v) => v.noble);
            let slots = Math.min(...targets.map((v) => v.noble.slots));
            const remaining = new Set(targets.filter((v) => v.populationFree >= 100).map((v) => v.id));
            while (slots > 0 && remaining.size) {
                const choices = targets.filter((v) => remaining.has(v.id)).map((v) => {
                    const budget = Object.fromEntries(RESOURCES.map((k) => [k, config.reserve[k] + v.noble.cost[k]]));
                    let proposal = fund(v, budget, 'Nächstes Adelsgeschlecht', false);
                    if (!proposal && config.allowCrossCluster) proposal = fund(v, budget, 'Nächstes Adelsgeschlecht', true);
                    return { v, budget, proposal };
                }).filter((c) => c.proposal).sort((a, b) =>
                    a.proposal.routes.reduce((s, r) => s + totalResources(r.amounts), 0)
                    - b.proposal.routes.reduce((s, r) => s + totalResources(r.amounts), 0)
                    || a.proposal.seconds - b.proposal.seconds);
                if (!choices.length) break;
                const { v, budget, proposal } = choices[0];
                apply(proposal.routes); v.protected = budget; slots -= 1; remaining.delete(v.id);
                goals.push({ villageId: v.id, label: 'Nächstes Adelsgeschlecht', seconds: proposal.seconds });
            }
            // Weitere Überschüsse zu Adelshöfen: Münzenbedarf und kurze Wege
            // entscheiden über das Ziel; niemals über dessen Speicher hinaus.
            for (const cross of config.allowCrossCluster ? [false, true] : [false]) {
                for (const source of villages.filter((v) => !v.noble)) {
                    const receivers = targets.filter((v) => allowed(source, v, cross)).sort((a, b) =>
                        Math.min(...RESOURCES.map((k) => a.resources[k] / a.noble.coin[k]))
                        - Math.min(...RESOURCES.map((k) => b.resources[k] / b.noble.coin[k]))
                        || travelSeconds(source, a) - travelSeconds(source, b));
                    for (const target of receivers) {
                        let capacity = source.merchants * source.carry;
                        const amounts = zeroResources();
                        while (capacity > 0) {
                            const available = Object.fromEntries(RESOURCES.map((key) => [key, Math.max(0, Math.min(
                                source.sellable[key] - source.protected[key] - amounts[key],
                                target.storage - target.resources[key] - amounts[key]
                                    - Math.ceil((target.production?.[key] || 0) * storageHorizon(target, travelSeconds(source, target)))))]));
                            const key = [...RESOURCES].filter((resource) => available[resource] > 0).sort((a, b) =>
                                (target.resources[a] + amounts[a] - target.protected[a]) / target.noble.coin[a]
                                - (target.resources[b] + amounts[b] - target.protected[b]) / target.noble.coin[b])[0];
                            if (!key) break;
                            const amount = Math.min(capacity, available[key], source.carry);
                            amounts[key] += amount; capacity -= amount;
                        }
                        if (totalResources(amounts)) apply([{ source: source.id, target: target.id, amounts,
                            merchants: Math.ceil(totalResources(amounts) / source.carry), seconds: travelSeconds(source, target), reason: 'AG-Vorrat / Goldmünzen' }]);
                    }
                }
            }
        } else if (config.ownMode !== 'troops') {
            const passes = [...new Set(Object.values(clusters))].map((cluster) => villages.filter((v) => clusters[v.id] === cluster));
            if (config.allowCrossCluster) passes.push(villages);
            for (const group of passes) {
                const average = Object.fromEntries(RESOURCES.map((key) => [key, group.reduce((s, v) => s + v.resources[key], 0) / group.length]));
                const pairs = group.flatMap((source) => group.filter((target) => source.id !== target.id)
                    .map((target) => ({ source, target, seconds: travelSeconds(source, target) }))).sort((a, b) => a.seconds - b.seconds);
                for (const { source, target, seconds } of pairs) {
                    let capacity = source.merchants * source.carry;
                    const amounts = zeroResources();
                    for (const key of RESOURCES) {
                        const surplus = Math.min(source.resources[key] - average[key], source.sellable[key] - source.protected[key]);
                        const need = Math.min(average[key], target.storage - Math.ceil((target.production?.[key] || 0) * storageHorizon(target, seconds))) - target.resources[key];
                        const amount = Math.floor(Math.min(surplus, need, capacity));
                        if (amount >= config.minDifference && amount > 0) { amounts[key] = amount; capacity -= amount; }
                    }
                    if (totalResources(amounts)) apply([{ source: source.id, target: target.id, amounts,
                        merchants: Math.ceil(totalResources(amounts) / source.carry), seconds, reason: 'Gleichverteilung' }]);
                }
            }
        }
        const combined = new Map();
        for (const route of transfers) {
            const key = `${route.source}:${route.target}`;
            if (!combined.has(key)) combined.set(key, { ...route, amounts: zeroResources(), reasons: new Set() });
            const group = combined.get(key);
            for (const resource of RESOURCES) group.amounts[resource] += route.amounts[resource];
            group.reasons.add(route.reason);
            byId[route.source].merchants += route.merchants;
        }
        const merged = [...combined.values()].map((route) => {
            route.merchants = Math.ceil(totalResources(route.amounts) / byId[route.source].carry);
            byId[route.source].merchants -= route.merchants;
            route.reason = [...route.reasons].join(' / '); delete route.reasons;
            return route;
        });
        return { transfers: merged, goals, clusters, villages };
    }

    function transferReserveFor(plan, baseReserve, incoming, pendingReceipts) {
        return Object.fromEntries(RESOURCES.map(key => [key, Math.max(baseReserve[key],
            plan.transferProtected[key], plan.protected[key] - incoming[key]
                - pendingReceipts[key] - plan.futureProduction[key]) ]));
    }

    // Kleine Testoberfläche: die Berechnung benötigt weder Spielseite noch Netzwerk.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { parseIntLocalized, normalizeConfig, sharesFromWeights, redistributeShares, targetFor, planVillage, summarizeGroups, projectedStock,
            extractJsonObject, nextBuildJobs, clusterVillages, planOwnTransfers, travelSeconds, parseNoble, nativeTravelSeconds, recruitmentStore, troopBatch, parseTroopRecruitment, transferReserveFor, parseMarket, readTransportOutcome };
        return;
    }
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window.top !== window.self) return;
    const search = new URLSearchParams(window.location.search);
    const gameData = window.game_data || {};
    const screen = search.get('screen') || gameData.screen;
    if (screen !== 'market') return;
    if (document.getElementById(`${SCRIPT_ID}-panel`)) return;

    const storageKey = `${SCRIPT_ID}:1:${window.location.host}:${gameData.world || window.location.hostname}:${gameData.player?.id || 'unknown'}`;
    function loadStore() {
        try {
            const value = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
            return { config: normalizeConfig(value.config), excluded: value.excluded && typeof value.excluded === 'object' ? value.excluded : {} };
        } catch (_) {
            return { config: normalizeConfig(null), excluded: {} };
        }
    }
    const store = loadStore();
    const state = { villages: [], groups: [], transfers: [], ownGoals: [], villagePlans: {}, config: store.config, excluded: store.excluded, busy: false, panel: null };
    function readRecruitmentStore() {
        const key=`ds-troop-templates:v1:${window.location.host}:${gameData.world || window.location.hostname.split('.')[0] || 'world'}:${gameData.player?.id || 'player'}`;
        try { return recruitmentStore(JSON.parse(window.localStorage.getItem(key)||'null')); }
        catch (_) { return recruitmentStore(null); }
    }
    function renderTroopSettings() {
        const container=state.panel.querySelector('.dsmb-troop-settings');
        container.replaceChildren(); container.hidden=state.config.ownMode!=='troops';
        if(container.hidden) return;
        const data=readRecruitmentStore();
        container.append(createElement('h4',{},'Empfängervorlagen'),createElement('p',{className:'dsmb-note'},'Dörfer mit einer zugewiesenen ausgewählten Vorlage erhalten Ressourcen. Alle ausgewählten Dörfer können spenden. Zuordnungen im Rekrutierungsskript bearbeiten.'));
        if(!data.templates.length) container.append(createElement('p',{},'Keine gespeicherten Truppenvorlagen gefunden. Zuerst im Rekrutierungsskript eine Vorlage speichern und Dörfern zuweisen.'));
        for(const template of data.templates) {
            const label=createElement('label',{className:'dsmb-toggle'});
            const input=createElement('input',{type:'checkbox','data-troop-template':template.id});
            input.checked=state.config.troopTemplateIds===null||state.config.troopTemplateIds.includes(template.id);
            const count=state.villages.filter(v=>data.villageTemplateIds[v.id]===template.id).length;
            label.append(input,createElement('span',{},`${template.name} (${count} geladene Dörfer)`),help('Empfänger anhand der zugewiesenen Rekrutierungsvorlage wählen. Beispiel: Nur „Off“ aktivieren, „Deff“ abwählen.'));
            container.append(label);
        }
        container.append(createElement('button',{type:'button','data-action':'troop-refresh'},'Vorlagen neu lesen'));
    }
    const READ_GAP_MS = 1500;
    let nextReadAt = 0;
    function saveStore() {
        try { window.localStorage.setItem(storageKey, JSON.stringify({ config: state.config, excluded: state.excluded })); }
        catch (_) { showStatus('Einstellungen konnten nicht gespeichert werden.', true); }
    }

    function createElement(tag, attributes = {}, value = '') {
        const node = document.createElement(tag);
        for (const [key, attribute] of Object.entries(attributes)) {
            if (key === 'className') node.className = attribute;
            else if (key === 'type') node.type = attribute;
            else node.setAttribute(key, attribute);
        }
        if (value) node.textContent = value;
        return node;
    }
    function format(number) { return Math.floor(number).toLocaleString('de-DE'); }
    function showStatus(message, error = false) {
        const node = state.panel?.querySelector('.dsmb-status');
        if (!node) return;
        node.textContent = message;
        node.classList.toggle('dsmb-error', error);
    }
    function setBusy(value) {
        state.busy = value;
        state.panel.querySelectorAll('button[data-action="load"], button[data-action="plan"]').forEach((button) => { button.disabled = value; });
        state.panel.querySelectorAll('[data-setting], [data-share], [data-village-check], [data-mode], [data-troop-template]').forEach((input) => { input.disabled = value; });
    }

    function urlFor(screenName, mode = '', villageId = '') {
        const url = new URL('/game.php', window.location.origin);
        if (villageId || gameData.village?.id) url.searchParams.set('village', villageId || gameData.village.id);
        url.searchParams.set('screen', screenName);
        if (mode) url.searchParams.set('mode', mode);
        return url;
    }
    function wait(ms) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
    function retryAfterMs(value) {
        if (!value) return null;
        const seconds = Number(value);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
        const date = Date.parse(value);
        return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
    }
    async function fetchDocument(url) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            await wait(Math.max(0, nextReadAt - Date.now()));
            nextReadAt = Date.now() + READ_GAP_MS;
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 15000);
            let response;
            try {
                response = await window.fetch(url.toString(), { credentials: 'same-origin', signal: controller.signal, headers: { Accept: 'text/html' } });
                if (response.status !== 429) {
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return new DOMParser().parseFromString(await response.text(), 'text/html');
                }
            } finally { window.clearTimeout(timeout); }
            const serverWait = retryAfterMs(response.headers.get('Retry-After'));
            const cooldown = Math.max(10000, serverWait ?? 0);
            nextReadAt = Math.max(nextReadAt, Date.now() + cooldown);
            if (attempt > 0 || cooldown > 30000) {
                const error = new Error(`HTTP 429 (zu viele Anfragen${serverWait ? `; frühestens in ${Math.ceil(serverWait / 1000)} s erneut versuchen` : ''})`);
                error.rateLimited = true;
                throw error;
            }
        }
    }
    async function postDocument(url, data) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 15000);
        try {
            const response = await window.fetch(url.toString(), {
                method: 'POST', credentials: 'same-origin', signal: controller.signal,
                body: new URLSearchParams(data),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return new DOMParser().parseFromString(await response.text(), 'text/html');
        } finally { window.clearTimeout(timeout); }
    }
    function idFromLink(link) {
        try {
            const url = new URL(link.href, window.location.origin);
            return url.searchParams.get('village') || (url.searchParams.get('screen') === 'info_village' ? url.searchParams.get('id') : null);
        }
        catch (_) { return null; }
    }
    function resourcesFrom(doc, scope) {
        const result = {};
        for (const key of RESOURCES) {
            const node = scope.querySelector(`.res.${key}, [data-resource="${key}"], #${key}`);
            const raw = node?.getAttribute('data-amount') || node?.getAttribute('data-value') || node?.textContent;
            const amount = parseIntLocalized(raw);
            if (amount === null) return null;
            result[key] = amount;
        }
        return result;
    }
    function resourcesFromOverviewRow(row) {
        // Die Rohstoffzelle enthält je einen Wert mit wood/stone/iron.
        // Zusätzliche Klassen wie res, warn_90 oder warn sind nur Anzeige-Status.
        const cell = [...row.cells].find((candidate) =>
            RESOURCES.every((key) => candidate.querySelector(`span.${key}`)));
        if (!cell) return null;
        const values = Object.fromEntries(RESOURCES.map((key) => [key,
            parseIntLocalized(cell.querySelector(`span.${key}`).textContent)
        ]));
        return RESOURCES.every((key) => values[key] !== null) ? values : null;
    }
    function parseProduction(doc) {
        const table = doc.querySelector('#production_table');
        if (!table) throw new Error('Die Produktionsübersicht ist nicht verfügbar.');
        const villages = [];
        for (const row of table.querySelectorAll('tr')) {
            const link = row.querySelector('a[href*="village="], a[href*="info_village"]');
            const id = row.dataset.villageId || row.getAttribute('data-id') || (link && idFromLink(link));
            if (!id || !/^\d+$/.test(String(id))) continue;
            // Die Marktseite liefert beim Planen den maßgeblichen Bestand.
            // Ein fehlender Wert in dieser Übersicht darf kein Dorf entfernen.
            const resources = resourcesFromOverviewRow(row);
            villages.push({ id: String(id), name: link?.textContent.trim() || `Dorf ${id}`, resources, merchants: null });
        }
        const unique = [...new Map(villages.map((village) => [village.id, village])).values()];
        if (!unique.length) throw new Error('Keine Dörfer in der Produktionsübersicht gefunden.');
        const expected = parseIntLocalized(gameData.player?.villages);
        if (expected && unique.length < expected) {
            throw new Error(`Nur ${unique.length} von ${expected} Dörfern erkannt. Produktionsübersicht prüfen.`);
        }
        return unique;
    }
    function parseMarket(doc) {
        const form = doc.querySelector('#own_offer_form');
        const merchantNode = doc.querySelector('#market_merchant_available_count');
        const merchants = parseIntLocalized(merchantNode?.textContent);
        const resources = resourcesFrom(doc, doc);
        if (merchants === null || !resources) throw new Error(`${merchants === null ? 'Verfügbare Händler' : 'Dorfrohstoffe'} auf der Marktseite nicht lesbar.`);
        const committed = { wood: 0, stone: 0, iron: 0 };
        const wanted = { wood: 0, stone: 0, iron: 0 };
        for (const offer of doc.querySelectorAll('[class^="offer_container"]')) {
            const sellCell = offer.children[1];
            const buyCell = offer.children[2];
            const count = parseIntLocalized(offer.children[3]?.textContent);
            if (!sellCell || !buyCell || !count) continue;
            for (const [cell, totals] of [[sellCell, committed], [buyCell, wanted]]) {
                const resource = RESOURCES.find((key) => cell.querySelector(`.${key}, [data-resource="${key}"]`));
                const amount = parseIntLocalized(cell.textContent);
                if (resource && amount) totals[resource] += amount * count;
            }
        }
        const incoming = doc.querySelector('#market_status_bar') ? parseIncomingTransports(doc) : null;
        const data = pageGameData(doc);
        const maxCarry = parseIntLocalized(doc.querySelector('#market_merchant_max_transport')?.textContent);
        return { form, merchants, resources, committed, wanted, incoming, data,
            carry: merchants && maxCarry ? Math.floor(maxCarry / merchants) : 1000 };
    }
    async function marketFor(villageId) {
        const pageUrl = urlFor('market', 'own_offer', villageId);
        return { ...parseMarket(await fetchDocument(pageUrl)), pageUrl };
    }
    async function readTransportOutcome(result, source, route, readMarket) {
        const confirmed=Boolean(result.querySelector('.success_box, .success-message'));
        let updated;
        try {
            // Vollständige Werte aus der Versandantwort vermeiden eine zusätzliche
            // Abfrage. Eine andere Seite bzw. ein anderes Dorf ist kein Ersatz.
            try {
                const direct=parseMarket(result);
                if(String(direct.data?.player?.id)===String(source.data.player.id)
                    && String(direct.data?.village?.id)===route.source) updated=direct;
            } catch(_) { /* Versandantwort kann nur die Erfolgsmeldung enthalten. */ }
            if(!updated) updated=await readMarket();
            if(String(updated.data?.player?.id)!==String(source.data.player.id)
                || String(updated.data?.village?.id)!==route.source) throw new Error('Dorf oder Eigentümer der Versandnachprüfung stimmen nicht überein.');
        } catch(error) {
            if(!confirmed) throw error;
            // Die Spielbestätigung gilt auch dann, wenn die separate GET-Abfrage
            // scheitert. Für die Anzeige konservativ aus dem geprüften Vorrat ableiten.
            return {resources:Object.fromEntries(RESOURCES.map(key=>[key,source.resources[key]-route.amounts[key]])),
                merchants:Math.max(0,source.merchants-Math.ceil(totalResources(route.amounts)/source.carry)),
                refreshWarning:error.message};
        }
        if(!confirmed && (updated.merchants > source.merchants-Math.ceil(totalResources(route.amounts)/source.carry)
            || RESOURCES.some(key=>route.amounts[key]>0 && source.resources[key]-updated.resources[key]<route.amounts[key]-100))) {
            throw new Error('Versand konnte nicht eindeutig bestätigt werden.');
        }
        return updated;
    }
    function resourcesInCell(cell) {
        const amounts = { wood: 0, stone: 0, iron: 0 };
        for (const wrap of cell?.querySelectorAll('.nowrap') || []) {
            const key = RESOURCES.find((resource) => wrap.querySelector(`.icon.${resource}, .res.${resource}`));
            const amount = parseIntLocalized(wrap.textContent);
            if (key && amount) amounts[key] += amount;
        }
        return amounts;
    }
    function parseIncomingTransports(doc) {
        const incoming = { wood: 0, stone: 0, iron: 0 };
        const heading = [...doc.querySelectorAll('h3')].find((node) => /^Eingehende Transporte\b/i.test(node.textContent.trim()));
        const table = heading?.nextElementSibling?.matches('table') ? heading.nextElementSibling : null;
        if (table) {
            for (const row of table.querySelectorAll('tr')) {
                if (row.cells.length < 2 || row.querySelector('th')) continue;
                const amounts = resourcesInCell(row.cells[1]);
                for (const key of RESOURCES) incoming[key] += amounts[key];
            }
            return incoming;
        }
        const status = doc.querySelector('#market_status_bar');
        if (!status) throw new Error('Eingehende Transporte sind nicht lesbar.');
        const summary = [...status.querySelectorAll('th')].find((node) => /^Eintreffend:/i.test(node.textContent.trim()));
        if (summary) return resourcesInCell(summary);
        return incoming;
    }
    async function incomingFor(villageId) {
        return parseIncomingTransports(await fetchDocument(urlFor('market', 'transports', villageId)));
    }

    function pageGameData(doc) {
        for (const script of doc.querySelectorAll('script')) {
            const data = extractJsonObject(script.textContent, 'TribalWars.updateGameData(');
            if (data) return data;
        }
        return null;
    }
    function durationSeconds(value) {
        const match = String(value).match(/(?:(\d+)\s*(?:Tage?|d)\s*)?(\d+):(\d{2}):(\d{2})/i);
        return match ? Number(match[1] || 0) * 86400 + Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4]) : null;
    }
    function nativeTravelSeconds(doc) {
        const values = [...doc.querySelectorAll('tr')].filter((row) => row.cells.length === 2
            && /^\s*(?:Dauer|Laufzeit)(?:\s*\(\s*Hin-\s*und\s+Rückweg\s+jeweils\s*\))?\s*:?\s*$/i.test(row.cells[0]?.textContent || ''))
            .map((row) => durationSeconds(row.cells[1]?.textContent)).filter((value) => value !== null);
        // Widersprüchliche Laufzeitangaben dürfen keinen Versand freigeben.
        return values.length && values.every((value) => value === values[0]) ? values[0] : null;
    }
    function parseIncomingEvents(doc) {
        const heading = [...doc.querySelectorAll('h3')].find((node) => /^Eingehende Transporte\b/i.test(node.textContent.trim()));
        const table = heading?.nextElementSibling;
        const totals = parseIncomingTransports(doc);
        if (!totalResources(totals)) return [];
        if (!table?.matches('table')) throw new Error('Ankunftszeiten der Transporte sind nicht lesbar.');
        const events = [];
        for (const row of table.querySelectorAll('tr')) {
            if (row.querySelector('th') || row.cells.length < 4) continue;
            const amounts = resourcesInCell(row.cells[1]);
            if (!totalResources(amounts)) continue;
            const seconds = durationSeconds(row.cells[3].textContent);
            if (seconds === null) throw new Error('Ankunftszeit eines Transports ist nicht lesbar.');
            events.push({ arrivalAt: Date.now() + seconds * 1000, amounts });
        }
        if (RESOURCES.some((key) => events.reduce((s, e) => s + e.amounts[key], 0) !== totals[key])) {
            throw new Error('Transportmengen und Ankunftszeiten stimmen nicht überein.');
        }
        return events;
    }
    function parseAmAssignments(doc) {
        const table = doc.querySelector('#village_table');
        if (!table) throw new Error('Accountmanager-Dorfzuordnung nicht lesbar.');
        const templateIds = new Map([...doc.querySelectorAll('select[name="template"] option')]
            .map((node) => [node.textContent.trim().replace(/\s+/g, ' '), node.value]));
        const result = {};
        for (const row of table.querySelectorAll('tr')) {
            const id = row.querySelector('input[name="villages[]"]')?.value;
            if (!id) continue;
            const name = row.cells[1]?.textContent.trim().replace(/\s+/g, ' ');
            result[id] = { templateId: templateIds.get(name), active: /^Aktiv\b/.test(row.cells[3]?.textContent.trim() || '') };
            if (result[id].active && !result[id].templateId) throw new Error(`Bauvorlage „${name}“ nicht zuordenbar.`);
        }
        return result;
    }
    function parseBuildTemplate(doc) {
        const queue = doc.querySelector('#template_queue');
        if (!queue) throw new Error('Accountmanager-Bauvorlage nicht lesbar.');
        const entries = [...queue.querySelectorAll('[data-building]')].map((node) => ({
            building: node.dataset.building, level: parseIntLocalized(node.querySelector('.level_absolute')?.textContent)
        }));
        if (!entries.length || entries.some((entry) => !entry.level)) throw new Error('Stufen der Bauvorlage nicht lesbar.');
        return { entries, farmPercent: doc.querySelector('input[name="farm_upgrade_toggle"]')?.checked
            ? Number(doc.querySelector('select[name="population_upgrades"]')?.value || 0) : 0 };
    }
    function parseBuildState(doc) {
        let buildings = null;
        for (const script of doc.querySelectorAll('script')) {
            buildings = extractJsonObject(script.textContent, 'BuildingMain.buildings =');
            if (buildings) break;
        }
        if (!buildings) throw new Error('Aktuelle Baukosten sind nicht lesbar.');
        const data = pageGameData(doc)?.village;
        if (!data) throw new Error('Gebäudestufen sind nicht lesbar.');
        const levels = Object.fromEntries(Object.entries(data.buildings).map(([key, value]) => [key, Number(value)]));
        let queueUntil = Date.now();
        for (const row of doc.querySelectorAll('#build_queue tr')) {
            const kind = [...row.classList].find((c) => c.startsWith('buildorder_'))?.slice(11);
            if (!kind) continue;
            const level = row.cells[0]?.textContent.match(/Stufe\s*(\d+)/)?.[1];
            if (!level) throw new Error('Laufende Baustufe nicht lesbar.');
            levels[kind] = Math.max(levels[kind] || 0, Number(level));
            const end = Number(row.querySelector('[data-endtime]')?.dataset.endtime);
            const seconds = durationSeconds(row.cells[1]?.textContent);
            if (end) queueUntil = end * 1000;
            else if (seconds !== null) queueUntil += seconds * 1000;
            else throw new Error('Bauwarteschlangen-Zeit nicht lesbar.');
        }
        return { buildings, levels, queueUntil, populationFree: Math.max(0, data.pop_max - data.pop), popMax: Number(data.pop_max) };
    }
    function parseNoble(doc, coinDoc = doc) {
        const cost = Object.fromEntries(RESOURCES.map((key) => [key, parseIntLocalized(doc.querySelector(`#next_snob_cost_${key}`)?.textContent)]));
        const coin = Object.fromEntries(RESOURCES.map((key) => [key, parseIntLocalized(coinDoc.querySelector(`#coin_cost_${key}`)?.textContent)]));
        for (const page of [coinDoc, doc]) {
            for (const script of page.querySelectorAll('script')) {
                for (const marker of ['BuildingSnob.Modes.train.storage_item =', 'BuildingSnob.Modes.coin.storage_item =']) {
                    const prices = extractJsonObject(script.textContent, marker);
                    if (!prices || (prices.id && prices.id !== 'coin')) continue;
                    for (const key of RESOURCES) if (!coin[key] && Number(prices[key]) > 0) coin[key] = Number(prices[key]);
                }
            }
        }
        // Layoutzeilen enthalten den Text aller verschachtelten Tabellen.
        // Nur die tatsächliche Beschriftungszelle darf das Limit liefern.
        const limitRow = [...doc.querySelectorAll('tr')].find((row) => row.cells.length === 2
            && /^\s*Es\s+können\s+noch\s+erzeugt\s+werden\s*:\s*$/i.test(row.cells[0]?.textContent || '')
            && /^\s*\d[\d.\s\u00a0]*\s*$/.test(row.cells[1]?.textContent || ''));
        const slots = parseIntLocalized(limitRow?.cells[1]?.textContent);
        if (slots === null) throw new Error('Globales AG-Limit im Tab „Erzeugen“ ist nicht lesbar.');
        if (slots > 0 && RESOURCES.some((key) => !cost[key])) throw new Error('Kosten des nächsten AG im Tab „Erzeugen“ sind nicht lesbar.');
        if (RESOURCES.some((key) => !coin[key])) {
            const error = new Error('Münzkosten im Tab „Goldmünzen prägen“ sind nicht lesbar.');
            error.missingCoinCosts = true;
            throw error;
        }
        return { cost: RESOURCES.every((key) => cost[key] > 0) ? cost : null, coin, slots };
    }
    function parseTroopRecruitment(doc, template) {
        const form=doc.querySelector('#train_form');
        const data=pageGameData(doc);
        if(!form || !data?.village || !Number.isFinite(Number(data.village.pop_max)) || !Number.isFinite(Number(data.village.pop))) throw new Error('Rekrutierungsformular oder Bevölkerung nicht lesbar.');
        const queued=Object.fromEntries(Object.keys(TROOP_NAMES).map(unit=>[unit,0]));
        for(const row of doc.querySelectorAll('.trainqueue_wrap tr, [id^="trainqueue_wrap_"] tr, [data-trainqueue] tr')) {
            const assets=[...row.querySelectorAll('[class*="unit_sprite"], img')].map(node=>`${node.className||''} ${node.getAttribute('src')||''}`).join(' ');
            const unit=Object.keys(TROOP_NAMES).find(unit=>new RegExp(`(^|\\s)${unit}(\\s|$)`).test(assets)||assets.includes(`unit_${unit}`)||assets.includes(`/${unit}.`));
            if(!unit) continue;
            const amount=parseIntLocalized(row.querySelector('td')?.textContent.match(/([0-9][0-9.\s\u00a0]*)/)?.[1]);
            if(amount===null) throw new Error('Menge in Rekrutierungswarteschlange nicht lesbar.');
            queued[unit]+=amount;
        }
        const items=[];
        for(const [unit,target] of Object.entries(template.units)) {
            if(!target) continue;
            const row=form.querySelector(`.unit_link[data-unit="${unit}"]`)?.closest('tr');
            if(!row || !row.querySelector(`input[name="${unit}"], input[data-unit="${unit}"], input[id^="${unit}_"]`)) continue;
            const pair=[...row.querySelectorAll('td, th')].map(cell=>cell.textContent.match(/^\s*([0-9][0-9.\s\u00a0]*)\s*\/\s*([0-9][0-9.\s\u00a0]*)\s*$/)).find(Boolean);
            if(!pair) throw new Error(`Gesamtbestand von ${TROOP_NAMES[unit]} nicht lesbar.`);
            const cost={};
            for(const key of [...RESOURCES,'pop']) {
                const exact=row.querySelector(`[id="${unit}_0_cost_${key}"], [id$="_cost_${key}"], [data-cost-${key}]`);
                const icon=row.querySelector(`.icon.header.${key==='pop'?'population':key}`);
                const value=exact?.getAttribute(`data-cost-${key}`)??exact?.textContent??icon?.parentElement?.textContent;
                cost[key]=parseIntLocalized(value);
            }
            if(Object.values(cost).some(n=>n===null)||totalResources(cost)<=0||cost.pop<=0) throw new Error(`Einheitenkosten von ${TROOP_NAMES[unit]} nicht lesbar.`);
            items.push({unit,cost,deficit:Math.max(0,target-parseIntLocalized(pair[2])-queued[unit]),target,total:parseIntLocalized(pair[2]),queued:queued[unit]});
        }
        return { data, populationFree:Math.max(0,Number(data.village.pop_max)-Number(data.village.pop)), troop:{name:template.name,items} };
    }
    async function nobleFor(villageId) {
        const train = await fetchDocument(urlFor('snob', 'train', villageId));
        try { return parseNoble(train); }
        catch (error) {
            if (!error.missingCoinCosts) throw error;
            const coins = await fetchDocument(urlFor('snob', 'coin', villageId));
            return parseNoble(train, coins);
        }
    }
    async function worldMerchantSeconds() {
        const doc = await fetchDocument(new URL('/interface.php?func=get_config', window.location.origin));
        const speed = Number(doc.querySelector('config > speed')?.textContent);
        const unitSpeed = Number(doc.querySelector('config > unit_speed')?.textContent);
        if (!(speed > 0 && unitSpeed > 0)) throw new Error('Weltgeschwindigkeit nicht lesbar.');
        return 600 / speed / unitSpeed;
    }

    function help(text) {
        const icon = createElement('button', { type: 'button', className: 'dsmb-help', 'aria-label': `Hilfe: ${text}` }, '?');
        icon.append(createElement('span', { className: 'dsmb-tooltip', role: 'tooltip' }, text));
        return icon;
    }
    function field(label, key, value, min, max, hint) {
        const wrap = createElement('div', { className: 'dsmb-field' });
        const heading = createElement('span', { className: 'dsmb-field-label' });
        const inputId = `${SCRIPT_ID}-${key.replace(/[^a-zA-Z0-9]/g, '-')}`;
        heading.append(createElement('label', { for: inputId }, label), help(hint));
        const input = createElement('input', { id: inputId, type: 'number', min: String(min), max: String(max), step: '1', 'data-setting': key });
        input.value = String(value);
        wrap.append(heading, input);
        return wrap;
    }
    function toggle(label, key, value, hint) {
        const wrap = createElement('div', { className: 'dsmb-toggle' });
        const input = createElement('input', { type: 'checkbox', 'data-setting': key, id: `${SCRIPT_ID}-${key}` });
        input.checked = value;
        wrap.append(input, createElement('label', { for: input.id }, label), help(hint));
        return wrap;
    }
    function distributionControl(key, hint) {
        const row = createElement('div', { className: `dsmb-share-row dsmb-${key}` });
        const heading = createElement('div', { className: 'dsmb-share-heading' });
        const name = createElement('span', { className: 'dsmb-share-name' });
        name.append(createElement('span', { className: 'dsmb-dot' }), createElement('strong', {}, NAMES[key]), help(hint));
        heading.append(name, createElement('output', { 'data-share-output': key }, ''));
        const slider = createElement('input', {
            type: 'range', min: '1', max: '98', step: '1', 'data-share': key,
            'aria-label': `Zielanteil ${NAMES[key]}`
        });
        row.append(heading, slider);
        return row;
    }
    function renderDistribution(shares) {
        for (const key of RESOURCES) {
            const slider = state.panel.querySelector(`[data-share="${key}"]`);
            slider.value = String(shares[key]);
            slider.setAttribute('aria-valuetext', `${shares[key]} Prozent ${NAMES[key]}`);
            state.panel.querySelector(`[data-share-output="${key}"]`).textContent = `${shares[key]} %`;
            state.panel.querySelector(`[data-share-bar="${key}"]`).style.width = `${shares[key]}%`;
        }
    }
    function buildPanel() {
        const style = createElement('style');
        style.textContent = `
            #${SCRIPT_ID}-panel { --dsmb-ink:#3a2817; --dsmb-muted:#69543b; --dsmb-line:#b99c72; --dsmb-brown:#76512e;
                box-sizing:border-box; margin:12px 0; padding:0; border:1px solid #9f8257;
                background:var(--dsmb-surface,#f1e4c9); color:var(--dsmb-ink); box-shadow:0 1px 3px rgba(58,37,15,.16); font:12px/1.4 Verdana,Arial,sans-serif; overflow:visible; }
            #${SCRIPT_ID}-panel * { box-sizing:border-box; }
            #${SCRIPT_ID}-panel .dsmb-header { padding:9px 12px; border-bottom:1px solid #a98c62;
                background:var(--dsmb-heading,#d5bd91); color:#422d17; }
            #${SCRIPT_ID}-panel h3 { margin:0 0 2px; color:#422d17; font-size:15px; line-height:1.25; }
            #${SCRIPT_ID}-panel .dsmb-header p { margin:0; color:#634d32; font-size:11px; }
            #${SCRIPT_ID}-panel .dsmb-body { padding:13px 16px 16px; }
            #${SCRIPT_ID}-panel .dsmb-modes { display:flex; flex-wrap:wrap; gap:8px; border:1px solid var(--dsmb-line); padding:10px; margin:0 0 12px; }
            #${SCRIPT_ID}-panel .dsmb-modes legend { font-weight:700; padding:0 5px; }
            #${SCRIPT_ID}-panel .dsmb-mode { display:flex; align-items:center; gap:7px; flex:1; min-width:150px; padding:11px; cursor:pointer; border:1px solid var(--dsmb-line); background:#f8eed9; }
            #${SCRIPT_ID}-panel .dsmb-mode:has(input:checked) { background:var(--dsmb-heading,#d5bd91); box-shadow:inset 0 0 0 1px #795b30; }
            #${SCRIPT_ID}-panel h4 { margin:0; font-size:15px; color:var(--dsmb-ink); }
            #${SCRIPT_ID}-panel .dsmb-card { padding:12px; border:1px solid var(--dsmb-line); background:#f8eed9; }
            #${SCRIPT_ID}-panel .dsmb-card-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
            #${SCRIPT_ID}-panel .dsmb-note { margin:4px 0 10px; color:var(--dsmb-muted); font-size:12px; }
            #${SCRIPT_ID}-panel .dsmb-bar { display:flex; height:12px; border:1px solid #a98e68; border-radius:3px; overflow:hidden; background:#e4d3b4; margin:10px 0 12px; }
            #${SCRIPT_ID}-panel .dsmb-bar span { display:block; transition:width .15s ease; }
            #${SCRIPT_ID}-panel .dsmb-bar [data-share-bar=wood] { background:#b38639; }
            #${SCRIPT_ID}-panel .dsmb-bar [data-share-bar=stone] { background:#ad6746; }
            #${SCRIPT_ID}-panel .dsmb-bar [data-share-bar=iron] { background:#6d7b83; }
            #${SCRIPT_ID}-panel .dsmb-share-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }
            #${SCRIPT_ID}-panel .dsmb-share-heading, #${SCRIPT_ID}-panel .dsmb-share-name { display:flex; align-items:center; gap:6px; }
            #${SCRIPT_ID}-panel .dsmb-share-heading { justify-content:space-between; margin-bottom:4px; }
            #${SCRIPT_ID}-panel .dsmb-share-heading output { font-weight:700; font-variant-numeric:tabular-nums; }
            #${SCRIPT_ID}-panel .dsmb-dot { width:9px; height:9px; border-radius:50%; background:#b38639; }
            #${SCRIPT_ID}-panel .dsmb-stone .dsmb-dot { background:#ad6746; }
            #${SCRIPT_ID}-panel .dsmb-iron .dsmb-dot { background:#6d7b83; }
            #${SCRIPT_ID}-panel input[type=range] { width:100%; margin:3px 0 0; accent-color:var(--dsmb-brown); cursor:pointer; }
            #${SCRIPT_ID}-panel input[type=checkbox] { accent-color:var(--dsmb-brown); cursor:pointer; }
            #${SCRIPT_ID}-panel .dsmb-help { position:relative; display:inline-flex; justify-content:center; align-items:center;
                width:16px; height:16px; min-height:16px; padding:0; border:1px solid #b79a6d; border-radius:50%; color:#70512f;
                background:#f6e9ce; font:bold 11px Verdana,Arial,sans-serif; cursor:help; flex:none; }
            #${SCRIPT_ID}-panel .dsmb-help:focus { outline:2px solid #8f6b39; outline-offset:2px; }
            #${SCRIPT_ID}-panel .dsmb-tooltip { display:none; position:absolute; z-index:30; top:23px; left:0;
                width:210px; padding:8px 10px; border:1px solid #4f331c; border-radius:3px; background:#5e4129; color:#fff4dd;
                box-shadow:0 5px 16px rgba(0,0,0,.2); font:12px/1.4 Arial,sans-serif; text-align:left; white-space:normal; }
            #${SCRIPT_ID}-panel .dsmb-help:hover .dsmb-tooltip, #${SCRIPT_ID}-panel .dsmb-help:focus .dsmb-tooltip { display:block; }
            #${SCRIPT_ID}-panel .dsmb-advanced { border:1px solid var(--dsmb-line); background:#f8eed9; }
            #${SCRIPT_ID}-panel .dsmb-advanced summary { padding:10px 12px; background:var(--dsmb-heading,#d5bd91); cursor:pointer; font-weight:700; }
            #${SCRIPT_ID}-panel .dsmb-advanced summary small { margin-left:7px; color:var(--dsmb-muted); font-weight:400; }
            #${SCRIPT_ID}-panel .dsmb-advanced[open] summary { border-bottom:1px solid var(--dsmb-line); }
            #${SCRIPT_ID}-panel .dsmb-advanced-body { padding:12px; }
            #${SCRIPT_ID}-panel .dsmb-advanced-body .dsmb-card { margin-bottom:14px; }
            #${SCRIPT_ID}-panel .dsmb-section-label { margin:0 0 8px; font-size:12px; font-weight:700; color:var(--dsmb-muted); text-transform:uppercase; letter-spacing:.04em; }
            #${SCRIPT_ID}-panel .dsmb-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin-bottom:14px; }
            #${SCRIPT_ID}-panel .dsmb-fields:last-child { margin-bottom:0; }
            #${SCRIPT_ID}-panel .dsmb-field { min-width:0; position:relative; display:flex; flex-direction:column; gap:5px; }
            #${SCRIPT_ID}-panel .dsmb-field-label { display:flex; align-items:center; gap:5px; font-size:12px; font-weight:700; }
            #${SCRIPT_ID}-panel .dsmb-toggle { display:flex; align-items:center; gap:7px; min-height:28px; margin:4px 0; }
            #${SCRIPT_ID}-panel .dsmb-toggle label { cursor:pointer; }
            #${SCRIPT_ID}-panel input[type=number] { width:100%; min-height:31px; padding:5px 8px; border:1px solid #b79d73; border-radius:3px;
                background:#fffaf0; color:var(--dsmb-ink); font:inherit; }
            #${SCRIPT_ID}-panel input[type=number]:focus { outline:2px solid #b69056; outline-offset:1px; }
            #${SCRIPT_ID}-panel button { min-height:29px; padding:4px 9px; border:1px solid #9c7845;
                background:linear-gradient(#f8ebd0,#e4cda4); color:#463019; font:600 12px Verdana,Arial,sans-serif; cursor:pointer; }
            #${SCRIPT_ID}-panel button:hover:not(:disabled) { background:#fff1d5; }
            #${SCRIPT_ID}-panel button:disabled { opacity:.58; cursor:default; }
            #${SCRIPT_ID}-panel button.dsmb-primary { background:linear-gradient(#f5e2bd,#d7b47c); border-color:#876337; color:#3d2815; }
            #${SCRIPT_ID}-panel button.dsmb-primary:hover:not(:disabled) { background:#f5e3c2; }
            #${SCRIPT_ID}-panel button.dsmb-link { min-height:auto; padding:3px 5px; border:0; background:transparent; }
            #${SCRIPT_ID}-panel button.dsmb-link:hover:not(:disabled) { background:#f3e4c8; }
            #${SCRIPT_ID}-panel .dsmb-actions { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0 10px; }
            #${SCRIPT_ID}-panel .dsmb-status { min-height:19px; margin:0 0 12px; color:#614826; }
            #${SCRIPT_ID}-panel .dsmb-status.dsmb-error { color:#a22929; font-weight:700; }
            #${SCRIPT_ID}-panel .dsmb-scroll { max-height:340px; overflow:auto; margin-top:6px; border:1px solid var(--dsmb-line); background:#f9f0de; }
            #${SCRIPT_ID}-panel .dsmb-villages:empty, #${SCRIPT_ID}-panel .dsmb-groups:empty { display:none; }
            #${SCRIPT_ID}-panel table { width:100%; border-collapse:collapse; background:#f9f0de; }
            #${SCRIPT_ID}-panel th, #${SCRIPT_ID}-panel td { padding:7px 9px; border-right:1px solid #d6bf98; border-bottom:1px solid #d6bf98; text-align:left; white-space:nowrap; }
            #${SCRIPT_ID}-panel .dsmb-villages td[data-plan-cell], #${SCRIPT_ID}-panel .dsmb-villages td[data-stock] { white-space:normal; min-width:125px; }
            #${SCRIPT_ID}-panel th { position:sticky; top:0; z-index:1; background:var(--dsmb-heading,#d5bd91); font-size:11px; color:#4b321b; }
            #${SCRIPT_ID}-panel tr:last-child td { border-bottom:0; }
            #${SCRIPT_ID}-panel tr:nth-child(even) td { background:#f4e7d0; }
            #${SCRIPT_ID}-panel tr:hover td { background:#ead5ad; }
            #${SCRIPT_ID}-panel .dsmb-resource { display:inline-block; margin:1px 4px 1px 0; padding:2px 5px; border:1px solid #c7ad80; border-radius:2px; background:#f7e9ca; }
            #${SCRIPT_ID}-panel .dsmb-resource.wood { border-left:3px solid #b38639; }
            #${SCRIPT_ID}-panel .dsmb-resource.stone { border-left:3px solid #ad6746; }
            #${SCRIPT_ID}-panel .dsmb-resource.iron { border-left:3px solid #6d7b83; }
            #${SCRIPT_ID}-panel .dsmb-list-heading { display:flex; justify-content:space-between; align-items:center; gap:8px; margin:16px 0 5px; }
            #${SCRIPT_ID}-panel .dsmb-list-heading .dsmb-muted { color:var(--dsmb-muted); font-size:12px; }
            #${SCRIPT_ID}-panel .dsmb-groups h4 { padding:10px 10px 5px; }
            #${SCRIPT_ID}-panel .dsmb-groups .dsmb-note { padding:0 10px 8px; }
            @media (max-width:700px) { #${SCRIPT_ID}-panel .dsmb-body { padding:14px; }
                #${SCRIPT_ID}-panel .dsmb-share-grid { grid-template-columns:1fr; gap:10px; }
                #${SCRIPT_ID}-panel .dsmb-header { padding:15px; }
                #${SCRIPT_ID}-panel .dsmb-advanced summary small { display:block; margin-left:0; } }
        `;
        document.head.append(style);
        const panel = createElement('section', { id: `${SCRIPT_ID}-panel` });
        const header = createElement('div', { className: 'dsmb-header' });
        header.append(createElement('h3', {}, 'Marktplatz-Ausgleich'));
        header.append(createElement('p', {}, 'Dörfer auswählen · Modus festlegen · Eigene Lieferungen und Marktangebote prüfen'));
        panel.append(header);
        const body = createElement('div', { className: 'dsmb-body' });
        const modes = createElement('fieldset', { className: 'dsmb-modes' });
        modes.append(createElement('legend', {}, 'Eigene Dörfer zuerst ausgleichen'));
        for (const [value, label, text] of [
            ['balance', 'Gleichverteilung', 'Gleicht jeden Rohstoff zwischen nahen Dörfern aus. Beispiel: Ein Dorf mit 60.000 Holz versorgt ein Dorf mit 10.000 Holz.'],
            ['build', 'Ausbau', 'Finanziert vollständige nächste AM-Bauten, zuerst in verschiedenen Dörfern. Beispiel: Erst zwei Kasernen parallel, dann einen zweiten Bau. Restliche Überschüsse werden gleich verteilt.'],
            ['noble', 'AG-Push', 'Versorgt Adelshof-Dörfer nach AG-Bedarf und anschließend für Münzen. Beispiel: Bei erreichtem AG-Limit gehen Überschüsse zum Münzenprägen. Reserven bleiben erhalten.'],
            ['troops', 'Truppen-Push', 'Finanziert fehlende Einheiten nach zugewiesenen Rekrutierungsvorlagen. Beispiel: Off-Vorlagen auswählen; Gesamtbestand und laufende Rekrutierung werden vom Soll abgezogen.']
        ]) {
            const choice = createElement('label', { className: 'dsmb-mode' });
            const input = createElement('input', { type: 'radio', name: `${SCRIPT_ID}-mode`, value, 'data-setting': 'ownMode' });
            input.checked = state.config.ownMode === value;
            choice.append(input, createElement('strong', {}, label), help(text)); modes.append(choice);
        }
        body.append(modes);
        body.append(createElement('section',{className:'dsmb-troop-settings dsmb-card'}));
        const distribution = createElement('section', { className: 'dsmb-card', 'aria-label': 'Zielverteilung' });
        const cardHeading = createElement('div', { className: 'dsmb-card-heading' });
        cardHeading.append(createElement('h4', {}, 'Zielverteilung'));
        cardHeading.append(createElement('button', { type: 'button', className: 'dsmb-link', 'data-action': 'equal' }, 'Gleich verteilen'));
        distribution.append(cardHeading);
        distribution.append(createElement('p', { className: 'dsmb-note' }, 'Anteile gelten pro Dorf. Zusammen bleiben sie immer bei 100 %.'));
        const bar = createElement('div', { className: 'dsmb-bar', 'aria-hidden': 'true' });
        for (const key of RESOURCES) bar.append(createElement('span', { 'data-share-bar': key }));
        distribution.append(bar);
        const shareGrid = createElement('div', { className: 'dsmb-share-grid' });
        for (const key of RESOURCES) shareGrid.append(distributionControl(key,
            `Zielanteil für ${NAMES[key]} im einzelnen Dorf. Beispiel: 50 % Holz und je 25 % Lehm und Eisen.`));
        distribution.append(shareGrid);
        const details = createElement('details', { className: 'dsmb-advanced' });
        const summary = createElement('summary');
        summary.append(createElement('span', {}, 'Einstellungen'), createElement('small', {}, 'Zielverteilung, Reserven und Handel'));
        details.append(summary);
        const advancedBody = createElement('div', { className: 'dsmb-advanced-body' });
        advancedBody.append(distribution);
        advancedBody.append(createElement('p', { className: 'dsmb-section-label' }, 'Mindestreserven'));
        const reserves = createElement('div', { className: 'dsmb-fields' });
        for (const key of RESOURCES) reserves.append(field(`${NAMES[key]} behalten`, `reserve.${key}`, state.config.reserve[key], 0, 10000000,
            `Dieser Bestand wird nicht angeboten. Beispiel: 5.000 ${NAMES[key]} bleiben im Dorf.`));
        advancedBody.append(reserves);
        advancedBody.append(createElement('p', { className: 'dsmb-section-label' }, 'Eigene Transporte'));
        advancedBody.append(field('Cluster-Laufzeit (Stunden)', 'clusterHours', state.config.clusterHours, 1, 100,
            'Maximale einfache Laufzeit zwischen allen Dörfern eines Clusters. Beispiel: 2 hält entfernte Dorfgruppen getrennt.'));
        advancedBody.append(toggle('Lieferungen außerhalb der Cluster erlauben', 'allowCrossCluster', state.config.allowCrossCluster,
            'Sucht nach lokalen Lieferungen zusätzlich in anderen Clustern. Beispiel: Ein Bau kann aus einer entfernteren Dorfgruppe vollständig finanziert werden.'));
        advancedBody.append(createElement('p', { className: 'dsmb-section-label' }, 'Tausch und Grenzen'));
        const fields = createElement('div', { className: 'dsmb-fields' });
        fields.append(field('Anbieten je Angebot', 'sellPerOffer', state.config.sellPerOffer, 10, 100000,
            'Menge, die du pro Einzelangebot gibst. Beispiel: 1.000 Holz.'));
        fields.append(field('Fordern je Angebot', 'buyPerOffer', state.config.buyPerOffer, 10, 100000,
            'Gegenleistung pro Einzelangebot. Beispiel: 1.000 Eisen für 1.000 Holz.'));
        fields.append(field('Mindestabweichung', 'minDifference', state.config.minDifference, 0, 1000000,
            'Kleinere Überschüsse und Bedarfe werden ignoriert. Beispiel: Bei 2.000 bleibt eine Lücke von 1.500 unbeachtet.'));
        fields.append(field('Angebote je Gruppe', 'maxOffersPerGroup', state.config.maxOffersPerGroup, 1, 100,
            'Höchstens so viele gleiche Angebote pro Klick. Beispiel: 5 erstellt maximal fünf gleiche Angebote.'));
        fields.append(field('Gruppen je Dorf', 'maxGroupsPerVillage', state.config.maxGroupsPerVillage, 1, 30,
            'Höchstens so viele Tauschkombinationen pro Dorf. Beispiel: 2 erlaubt zwei Gruppen in der Vorschau.'));
        fields.append(field('Max. Handelsdauer', 'maxTravelHours', state.config.maxTravelHours, 1, 1000,
            'Begrenzt passende fremde Angebote und das Feld max_time, falls vorhanden. Beispiel: 10 Stunden.'));
        advancedBody.append(fields);
        advancedBody.append(createElement('p', { className: 'dsmb-section-label' }, 'Berechnung und Handel'));
        advancedBody.append(toggle('Offene eigene Angebote einplanen', 'includeOpenOffers', state.config.includeOpenOffers,
            'Die geforderten Rohstoffe zählen als erwarteter Eingang, solange das Angebot offen ist. Beispiel: 1.000 Eisen aus einem offenen Angebot vermindern weiteren Eisenbedarf.'));
        advancedBody.append(toggle('Exakt passende Fremdangebote bevorzugen', 'preferForeignOffers', state.config.preferForeignOffers,
            'Beim Klick wird ein Angebot mit genau derselben Abgabe und Gegenleistung gesucht und gegebenenfalls angenommen. Beispiel: 1.000 Holz für 1.000 Eisen.'));
        details.append(advancedBody);
        body.append(details);
        const actions = createElement('div', { className: 'dsmb-actions' });
        for (const [action, label] of [['load', 'Dörfer laden'], ['plan', 'Ausgleich vorbereiten']]) {
            actions.append(createElement('button', { type: 'button', className: action === 'plan' ? 'dsmb-primary' : '', 'data-action': action }, label));
        }
        body.append(actions);
        body.append(createElement('div', { className: 'dsmb-status', role: 'status', 'aria-live': 'polite' }));
        const villageHeading = createElement('div', { className: 'dsmb-list-heading', 'data-village-heading': '' });
        villageHeading.style.display = 'none';
        villageHeading.append(createElement('h4', {}, 'Dörfer'));
        const villageTools = createElement('div');
        villageTools.append(createElement('span', { className: 'dsmb-muted', 'data-selected-count': '' }),
            createElement('button', { type: 'button', className: 'dsmb-link', 'data-action': 'all' }, 'Alle'),
            createElement('button', { type: 'button', className: 'dsmb-link', 'data-action': 'none' }, 'Keine'));
        villageHeading.append(villageTools);
        body.append(villageHeading);
        body.append(createElement('div', { className: 'dsmb-villages dsmb-scroll' }));
        body.append(createElement('div', { className: 'dsmb-transfers dsmb-scroll' }));
        body.append(createElement('div', { className: 'dsmb-groups dsmb-scroll' }));
        panel.append(body);
        const anchor = document.querySelector('#content_value, #contentContainer') || document.body;
        const nativeHeading = anchor.querySelector('.vis th');
        const nativeSurface = window.getComputedStyle(anchor).backgroundColor;
        if (nativeHeading) panel.style.setProperty('--dsmb-heading', window.getComputedStyle(nativeHeading).backgroundColor);
        if (nativeSurface && nativeSurface !== 'rgba(0, 0, 0, 0)') panel.style.setProperty('--dsmb-surface', nativeSurface);
        anchor.prepend(panel);
        state.panel = panel;
        renderDistribution(sharesFromWeights(state.config.weights));
        panel.addEventListener('click', handleClick);
        panel.addEventListener('change', handleChange);
        panel.addEventListener('input', handleInput);
        renderTroopSettings();
        showStatus('Dörfer laden, Auswahl und Einstellungen prüfen, dann Ausgleich vorbereiten.');
    }

    function readConfig() {
        const raw = { troopTemplateIds: state.config.troopTemplateIds, weights: { ...state.config.weights }, reserve: {} };
        for (const input of state.panel.querySelectorAll('[data-setting]')) {
            if (input.type === 'radio' && !input.checked) continue;
            const path = input.dataset.setting.split('.');
            const value = input.type === 'checkbox' ? input.checked : input.value;
            if (path.length === 2) raw[path[0]][path[1]] = value;
            else raw[path[0]] = value;
        }
        state.config = normalizeConfig(raw);
        saveStore();
    }
    function invalidatePlan() {
        state.groups = [];
        state.transfers = [];
        state.ownGoals = [];
        state.villagePlans = {};
        state.panel.querySelector('.dsmb-groups').replaceChildren();
        state.panel.querySelector('.dsmb-transfers').replaceChildren();
        updateVillagePlanCells();
    }
    function handleInput(event) {
        const slider = event.target.closest('[data-share]');
        if (!slider) return;
        const current = Object.fromEntries(RESOURCES.map((key) => [key,
            Number(state.panel.querySelector(`[data-share="${key}"]`).value)
        ]));
        const shares = redistributeShares(current, slider.dataset.share, slider.value);
        state.config.weights = shares;
        renderDistribution(shares);
        invalidatePlan();
    }
    function handleChange(event) {
        if (event.target.matches('[data-share]')) {
            saveStore(); showStatus('Zielverteilung gespeichert. Vorschau neu berechnen.');
        } else if (event.target.matches('[data-setting]')) {
            readConfig(); invalidatePlan(); renderTroopSettings();
            if(event.target.dataset.setting==='ownMode') renderVillages();
            showStatus('Einstellungen gespeichert. Vorschau neu berechnen.');
        } else if(event.target.matches('[data-troop-template]')) {
            state.config.troopTemplateIds=[...state.panel.querySelectorAll('[data-troop-template]:checked')].map(input=>input.dataset.troopTemplate);
            saveStore(); invalidatePlan(); showStatus('Empfängervorlagen gespeichert. Vorschau neu berechnen.');
        } else if (event.target.matches('[data-village-check]')) {
            state.excluded[event.target.dataset.villageCheck] = !event.target.checked;
            saveStore(); invalidatePlan(); updateSelectedCount(); showStatus('Dorfauswahl geändert. Vorschau neu berechnen.');
        }
    }
    async function handleClick(event) {
        const button = event.target.closest('button[data-action]');
        if (!button || state.busy) return;
        const action = button.dataset.action;
        if (action === 'load') await loadVillages();
        else if(action==='troop-refresh') { invalidatePlan(); renderTroopSettings(); renderVillages(); showStatus('Truppenvorlagen neu gelesen. Vorschau neu berechnen.'); }
        else if (action === 'plan') await prepare();
        else if (action === 'equal') {
            state.config.weights = { wood: 1, stone: 1, iron: 1 };
            renderDistribution(sharesFromWeights(state.config.weights));
            saveStore(); invalidatePlan(); showStatus('Gleiche Zielverteilung eingestellt. Vorschau neu berechnen.');
        }
        else if (action === 'all' || action === 'none') {
            for (const village of state.villages) state.excluded[village.id] = action === 'none';
            saveStore(); invalidatePlan(); renderVillages(); showStatus('Dorfauswahl geändert. Vorschau neu berechnen.');
        } else if (action === 'submit') await submitGroup(Number(button.dataset.groupIndex), button);
        else if (action === 'transfer') await submitTransfer(Number(button.dataset.transferIndex));
    }
    async function loadVillages() {
        setBusy(true); invalidatePlan(); showStatus('Produktionsübersicht wird geladen …');
        state.villages = [];
        renderVillages();
        try {
            const url = urlFor('overview_villages', 'prod');
            url.searchParams.set('group', '0');
            url.searchParams.set('page', '-1');
            state.villages = parseProduction(await fetchDocument(url));
            renderVillages();
            renderTroopSettings();
            const selected = state.villages.filter((village) => !state.excluded[village.id]).length;
            showStatus(`${state.villages.length} Dörfer geladen, ${selected} ausgewählt. Auswahl prüfen und Ausgleich vorbereiten.`);
        } catch (error) { showStatus(`Dörfer konnten nicht geladen werden: ${error.message}`, true); }
        finally { setBusy(false); }
    }
    function updateSelectedCount() {
        const heading = state.panel.querySelector('[data-village-heading]');
        heading.style.display = state.villages.length ? '' : 'none';
        state.panel.querySelector('[data-selected-count]').textContent =
            `${state.villages.filter((village) => !state.excluded[village.id]).length} von ${state.villages.length} ausgewählt · `;
    }
    function renderResourceAmounts(cell, amounts) {
        cell.replaceChildren();
        if (!amounts || !RESOURCES.some((key) => amounts[key] > 0)) {
            cell.textContent = '—';
            return;
        }
        for (const key of RESOURCES) {
            if (amounts[key] > 0) cell.append(createElement('span', { className: `dsmb-resource ${key}` }, `${format(amounts[key])} ${NAMES[key]}`));
        }
    }
    function describeAmounts(amounts) {
        return RESOURCES.filter((key) => amounts?.[key] > 0)
            .map((key) => `${format(amounts[key])} ${NAMES[key]}`).join(', ') || 'keine';
    }
    function updateVillagePlanCells() {
        for (const row of state.panel.querySelectorAll('.dsmb-villages tr[data-village-id]')) {
            const plan = state.villagePlans[row.dataset.villageId];
            const remaining = plan && !plan.error ? summarizeGroups(state.groups.filter((group) =>
                group.villageId === row.dataset.villageId && (group.status === 'bereit' || group.status === 'prüft')
            )) : null;
            if (remaining) for (const route of state.transfers.filter((r) => ['bereit', 'prüft'].includes(r.status))) {
                if (route.source === row.dataset.villageId) {
                    remaining.merchants += route.merchants;
                    for (const key of RESOURCES) remaining.offered[key] += route.amounts[key];
                }
                if (route.target === row.dataset.villageId) for (const key of RESOURCES) remaining.wanted[key] += route.amounts[key];
            }
            const name = row.querySelector('[data-village-name]');
            if (name && plan) {
                name.title = [plan.troopSummary,...state.ownGoals.filter((goal) => goal.villageId === row.dataset.villageId).map((goal) => goal.label)].filter(Boolean).join('; ');
                name.textContent = `${state.villages.find((v) => v.id === row.dataset.villageId).name}${name.dataset.troopLabel||''} · Cluster ${plan.cluster}`;
            }
            const merchantCell = row.querySelector('[data-plan-cell="merchants"]');
            merchantCell.textContent = plan?.error ? 'nicht lesbar' : plan
                ? `${format(Math.max(0, plan.merchantsNow))} frei · ${format(remaining.merchants)} verplant` : '—';
            const existingCell = row.querySelector('[data-plan-cell="existing"]');
            renderResourceAmounts(existingCell, plan?.existingExpected);
            existingCell.title = plan && !plan.error
                ? `Unterwegs: ${describeAmounts(plan.incoming)}. Offene eigene Angebote: ${describeAmounts(plan.openOffered)} angeboten, ${state.config.includeOpenOffers ? describeAmounts(plan.openWanted) + ' gefordert' : 'Gegenleistung nicht einbezogen'}.`
                : '';
            renderResourceAmounts(row.querySelector('[data-plan-cell="offered"]'), remaining?.offered);
            renderResourceAmounts(row.querySelector('[data-plan-cell="wanted"]'), remaining?.wanted);
        }
    }
    function renderVillages() {
        const container = state.panel.querySelector('.dsmb-villages');
        container.replaceChildren();
        updateSelectedCount();
        if (!state.villages.length) return;
        const table = createElement('table');
        const header = createElement('tr');
        for (const label of ['Auswahl', 'Dorf', 'Lagerbestand', 'Händler (frei / verplant)', 'Bereits erwartet', 'Geplante Abgabe', 'Geplanter Empfang']) {
            header.append(createElement('th', {}, label));
        }
        table.append(header);
        for (const village of state.villages) {
            const row = createElement('tr', { 'data-village-id': village.id });
            const checkCell = createElement('td');
            const check = createElement('input', { type: 'checkbox', 'data-village-check': village.id });
            check.checked = !state.excluded[village.id];
            checkCell.append(check);
            const troopStore=state.config.ownMode==='troops'?readRecruitmentStore():null;
            const assigned=troopStore?.templates.find(t=>t.id===troopStore.villageTemplateIds[village.id]);
            const troopLabel=troopStore?` · ${assigned?.name || 'keine Truppenvorlage'}`:'';
            row.append(checkCell, createElement('td', { 'data-village-name': '', 'data-troop-label':troopLabel }, `${village.name}${troopLabel}`));
            const stock = createElement('td', { 'data-stock': '' });
            renderResourceAmounts(stock, village.resources);
            row.append(stock);
            for (const key of ['merchants', 'existing', 'offered', 'wanted']) row.append(createElement('td', { 'data-plan-cell': key }, '—'));
            table.append(row);
        }
        container.append(table);
        updateVillagePlanCells();
    }
    async function prepare() {
        if (!state.villages.length) { showStatus('Zuerst Dörfer laden.', true); return; }
        const chosen = state.villages.filter((village) => !state.excluded[village.id]);
        if (!chosen.length) { showStatus('Mindestens ein Dorf auswählen.', true); return; }
        readConfig(); invalidatePlan(); setBusy(true);
        showStatus(`Marktdaten für ${chosen.length} Dörfer werden gelesen …`);
        const failures = [];
        const planned = [];
        try {
            const troopStore=state.config.ownMode==='troops'?readRecruitmentStore():null;
            const targetTemplates=troopStore?new Map(troopStore.templates.filter(t=>state.config.troopTemplateIds===null||state.config.troopTemplateIds.includes(t.id)).map(t=>[t.id,t])):null;
            if(troopStore && !chosen.some(v=>targetTemplates.has(troopStore.villageTemplateIds[v.id]))) throw new Error('Kein ausgewähltes Dorf mit einer ausgewählten zugewiesenen Truppenvorlage. Vorlagen im Rekrutierungsskript zuweisen und Empfängervorlagen auswählen.');
            const secondsPerField = await worldMerchantSeconds();
            const assignments = state.config.ownMode === 'build'
                ? parseAmAssignments(await fetchDocument(new URL(`${urlFor('am_village')}&group=0&page=-1`))) : {};
            const templates = new Map();
            for (const village of chosen) {
                try {
                    showStatus(`${planned.length + 1}/${chosen.length}: ${village.name} wird gelesen …`);
                    const market = await marketFor(village.id);
                    const incoming = market.incoming ?? await incomingFor(village.id);
                    const data = market.data?.village;
                    if (!data || String(data.id) !== village.id || String(market.data.player?.id) !== String(gameData.player?.id)
                        || !Number.isFinite(Number(data.x)) || !Number.isFinite(Number(data.y)) || !Number(data.storage_max)) {
                        throw new Error('Dorfkennung, Eigentümer, Koordinaten oder Speicher nicht lesbar.');
                    }
                    let events = [], jobs = [], queueUntil = Date.now(), noble = null, troop=null;
                    let populationFree=Math.max(0,Number(data.pop_max)-Number(data.pop));
                    if (state.config.ownMode !== 'balance' && totalResources(incoming)) {
                        events = parseIncomingEvents(await fetchDocument(urlFor('market', 'transports', village.id)));
                    }
                    if (state.config.ownMode === 'build') {
                        const assignment = assignments[village.id];
                        if (!assignment) throw new Error('Dorf fehlt in der Accountmanager-Zuordnung.');
                        if (assignment.active) {
                            if (!templates.has(assignment.templateId)) {
                                const templateUrl = urlFor('am_village', 'queue', village.id);
                                templateUrl.searchParams.set('template', assignment.templateId);
                                templates.set(assignment.templateId, parseBuildTemplate(await fetchDocument(templateUrl)));
                            }
                            const template = templates.get(assignment.templateId);
                            const build = parseBuildState(await fetchDocument(urlFor('main', 'build', village.id)));
                            const priority = build.populationFree / build.popMax * 100 < template.farmPercent ? template.farmPercent : 0;
                            jobs = nextBuildJobs(template.entries, build.buildings, build.levels, build.populationFree, priority);
                            queueUntil = build.queueUntil;
                        }
                    } else if (state.config.ownMode === 'noble' && Number(data.buildings?.snob) > 0) {
                        noble = await nobleFor(village.id);
                    } else if(state.config.ownMode==='troops') {
                        const template=targetTemplates.get(troopStore.villageTemplateIds[village.id]);
                        if(template) {
                            const recruit=parseTroopRecruitment(await fetchDocument(urlFor('train','',village.id)),template);
                            if(String(recruit.data.village.id)!==village.id || String(recruit.data.player?.id)!==String(gameData.player?.id)) throw new Error('Dorf oder Eigentümer der Rekrutierungsseite stimmt nicht überein.');
                            troop=recruit.troop; populationFree=recruit.populationFree;
                        }
                    }
                    const available = { ...market.resources };
                    const forecast = projectedStock(available, incoming, market.wanted, state.config.includeOpenOffers);
                    const existingExpected = projectedStock({ wood: 0, stone: 0, iron: 0 }, incoming,
                        market.wanted, state.config.includeOpenOffers);
                    planned.push({ village, resources: market.resources, merchantsAvailable: market.merchants,
                        incoming, openWanted: market.wanted, openOffered: market.committed, existingExpected,
                        core: { id: village.id, resources: forecast, sellable: available, merchants: market.merchants,
                            x: Number(data.x), y: Number(data.y), storage: Number(data.storage_max), carry: market.carry,
                            production: Object.fromEntries(RESOURCES.map((key) => [key, Number(data[`${key}_prod`]) || 0])),
                            events, queueUntil, jobs, noble, troop, populationFree, secondsPerField } });
                } catch (error) {
                    failures.push({ village, message: error.message, rateLimited: error.rateLimited });
                    if (error.rateLimited) break;
                }
            }
            if (failures.length) {
                const limited = failures.some((failure) => failure.rateLimited);
                const details = failures.slice(0, 3).map((item) => `${item.village.name}: ${item.message}`).join('; ');
                showStatus(`${limited ? 'Der Spielserver begrenzt die Anfragen. Bitte später erneut planen.' : 'Marktdaten konnten nicht vollständig gelesen werden.'} Keine Angebote vorbereitet. ${details}${failures.length > 3 ? '; …' : ''}`, true);
                return;
            }
            if (state.config.ownMode === 'noble' && !planned.some((entry) => entry.core.noble)) {
                throw new Error('Kein ausgewähltes Dorf mit Adelshof gefunden.');
            }
            const now = Date.now();
            const own = planOwnTransfers(planned.map((entry) => ({ ...entry.core,
                incomingEvents: entry.core.events.map((event) => ({ ...event, seconds: Math.max(0, (event.arrivalAt - now) / 1000) })),
                queueSeconds: Math.max(0, (entry.core.queueUntil - now) / 1000)
            })), state.config);
            const names = Object.fromEntries(chosen.map((v) => [v.id, v.name]));
            state.transfers = own.transfers.map((route) => ({ ...route, sourceName: names[route.source], targetName: names[route.target], status: 'bereit' }));
            state.ownGoals = own.goals;
            for (const entry of planned) entry.village.resources = entry.resources;
            state.villagePlans = Object.fromEntries(planned.map(({ village, merchantsAvailable, incoming, openWanted, openOffered, existingExpected }) => [village.id,
                { merchantsNow: merchantsAvailable, incoming, openWanted, openOffered, existingExpected }
            ]));
            state.groups = own.villages.flatMap((v) => {
                const plan = state.villagePlans[v.id];
                Object.assign(plan, { protected: v.protected, cluster: own.clusters[v.id], carry: v.carry, storage: v.storage });
                // Nur der tatsächlich vorhandene Teil des späteren Zielvorrats
                // muss schon vor eingehenden Lieferungen im Lager bleiben.
                plan.transferProtected=Object.fromEntries(RESOURCES.map(key=>[key,Math.min(v.protected[key],v.sellable[key])]));
                const fundingHorizon=Math.max(0,...own.goals.filter(goal=>goal.villageId===v.id).map(goal=>goal.seconds));
                plan.futureProduction=Object.fromEntries(RESOURCES.map(key=>[key,Math.floor((v.production?.[key]||0)*fundingHorizon)]));
                plan.troopPopulation=v.troopPlannedPopulation||0;
                plan.troopSummary=v.troop?.items.map(item=>`${TROOP_NAMES[item.unit]}: Soll ${item.target}, Gesamtbestand ${item.total}, Warteschlange ${item.queued}, fehlen ${item.deficit}`).join('; ');
                const config = { ...state.config, reserve: v.protected };
                // Münz- und AG-Vorräte werden nach ihrem tatsächlichen Bedarf getauscht.
                if (v.noble) config.weights = sharesFromWeights(v.noble.slots > 0 ? v.noble.cost : v.noble.coin);
                if(v.troop && v.troop.items.some(item=>item.deficit>0)) config.weights=sharesFromWeights(Object.fromEntries(RESOURCES.map(key=>[key,v.troop.items.reduce((s,item)=>s+item.deficit*item.cost[key],0)])));
                return planVillage(v, config).map((group) => ({ ...group, villageName: names[v.id], status: 'bereit' }));
            });
            renderVillages();
            renderTransfers();
            renderGroups();
            const count = state.groups.reduce((sum, group) => sum + group.count, 0);
            showStatus(`${state.transfers.length} eigene Lieferungen und ${state.groups.length} Marktgruppen mit ${count} Angeboten vorbereitet. ${state.transfers.length ? 'Zuerst eigene Lieferungen abschließen.' : 'Marktgruppen können jetzt angeklickt werden.'}`);
        } catch (error) { invalidatePlan(); showStatus(`Ausgleich nicht vorbereitet: ${error.message}`, true); }
        finally { setBusy(false); }
    }
    function renderGroups() {
        const container = state.panel.querySelector('.dsmb-groups');
        container.replaceChildren();
        if (!state.groups.length) return;
        const visible = state.groups.map((group, index) => ({ group, index }))
            .filter(({ group }) => group.status !== 'abgeschlossen');
        if (!visible.length) {
            container.append(createElement('p', { className: 'dsmb-note' }, 'Alle vorbereiteten Gruppen sind erledigt.'));
            return;
        }
        container.append(createElement('h4', {}, 'Vorschau der Angebotsgruppen'));
        const table = createElement('table');
        const header = createElement('tr');
        for (const label of ['Dorf', 'Anbieten', 'Fordern', 'Anzahl', 'Händler', 'Aktion']) header.append(createElement('th', {}, label));
        table.append(header);
        visible.forEach(({ group, index }) => {
            const row = createElement('tr');
            row.append(createElement('td', {}, group.villageName));
            row.append(createElement('td', {}, `${format(group.sellEach)} ${NAMES[group.sell]}`));
            row.append(createElement('td', {}, `${format(group.buyEach)} ${NAMES[group.buy]}`));
            row.append(createElement('td', {}, String(group.count)));
            row.append(createElement('td', {}, String(group.merchants)));
            const cell = createElement('td');
            const label = group.status === 'unklar' || group.status === 'gesperrt' ? 'Neu planen'
                    : state.config.preferForeignOffers ? 'Gruppe handeln' : 'Gruppe einstellen';
            const button = createElement('button', { type: 'button', className: 'dsmb-primary', 'data-action': 'submit', 'data-group-index': String(index) }, label);
            button.disabled = group.status !== 'bereit' || state.transfers.some((route) => route.status !== 'abgeschlossen');
            cell.append(button); row.append(cell); table.append(row);
        });
        container.append(table);
        container.append(createElement('p', { className: 'dsmb-note' }, state.config.preferForeignOffers
            ? 'Jeder Klick nimmt höchstens ein exakt passendes fremdes Angebot mit der gewählten Anzahl an. Gibt es keines, wird die Gruppe als eigenes Angebot eingestellt. Ein Rest bleibt für einen weiteren Klick sichtbar.'
            : 'Jeder Klick stellt nur diese eine Gruppe ein. Der aktuelle Bestand und freie Händler werden unmittelbar vorher erneut geprüft.'));
        if (state.transfers.some((route) => route.status !== 'abgeschlossen')) container.append(createElement('p', { className: 'dsmb-note' },
            'Die Marktgruppen werden freigegeben, sobald alle eigenen Lieferungen abgeschlossen sind.'));
    }

    function formatDuration(seconds) {
        const minutes = Math.ceil(seconds / 60);
        return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} h`;
    }
    function renderTransfers() {
        const container = state.panel.querySelector('.dsmb-transfers');
        container.replaceChildren();
        container.append(createElement('h4', {}, '1. Eigene Lieferungen'));
        if (state.ownGoals.length) {
            const goals = createElement('p', { className: 'dsmb-note' });
            goals.textContent = state.ownGoals.map((g) => `${state.villages.find((v) => v.id === g.villageId)?.name}: ${g.label} (frühestens ${formatDuration(g.seconds)})`).join(' · ');
            container.append(goals);
        }
        const visible = state.transfers.map((route, index) => ({ route, index })).filter(({ route }) => route.status !== 'abgeschlossen');
        if (!visible.length) { container.append(createElement('p', { className: 'dsmb-note' }, state.transfers.length ? 'Alle eigenen Lieferungen sind abgeschlossen.' : 'Keine eigenen Lieferungen erforderlich oder mit den verfügbaren Händlern möglich.')); return; }
        const table = createElement('table');
        const header = createElement('tr');
        for (const label of ['Von', 'Nach', 'Rohstoffe', 'Händler', 'Laufzeit ca.', 'Zweck', 'Aktion']) header.append(createElement('th', {}, label));
        table.append(header);
        for (const { route, index } of visible) {
            const row = createElement('tr');
            const amounts = createElement('td'); renderResourceAmounts(amounts, route.amounts);
            row.append(createElement('td', {}, route.sourceName), createElement('td', {}, route.targetName), amounts,
                createElement('td', {}, String(route.merchants)), createElement('td', {}, formatDuration(route.seconds)),
                createElement('td', {}, route.reason));
            const cell = createElement('td');
            const button = createElement('button', { type: 'button', className: 'dsmb-primary', 'data-action': 'transfer', 'data-transfer-index': String(index) },
                ({bereit:'Lieferung senden',prüft:'Bestand wird geprüft …',gesendet:'Versand läuft …',unklar:'Versand unklar',gesperrt:'Gesperrt – neu planen'})[route.status] || 'Prüfen / neu planen');
            button.disabled = route.status !== 'bereit'; cell.append(button); row.append(cell); table.append(row);
        }
        container.append(table);
        container.append(createElement('p', { className: 'dsmb-note' }, 'Ein Klick sendet genau eine Lieferung. Angezeigte Laufzeiten sind Schätzungen aus Weltgeschwindigkeit und Entfernung; die native Bestätigung wird vor dem Versand geprüft.'));
    }
    function checkMarketFormAction(form, pageUrl, sourceId, final = false) {
        if (form.method.toUpperCase() !== 'POST') throw new Error('Unbekannte Transportformular-Methode.');
        const action = new URL(form.getAttribute('action') || pageUrl, pageUrl);
        const operation = action.searchParams.get('try') || action.searchParams.get('action');
        if (action.origin !== window.location.origin || !action.pathname.endsWith('/game.php')
            || action.searchParams.get('screen') !== 'market' || action.searchParams.get('village') !== sourceId
            || (final ? operation !== 'send' : operation !== 'confirm_send')) throw new Error('Unbekannte Transportformular-Adresse.');
        return action;
    }
    function nativeError(doc) {
        const message = doc.querySelector('.error_box, .error-message, #error')?.textContent.trim();
        if (message) throw new Error(message.slice(0, 220));
    }
    async function submitTransfer(index) {
        const route = state.transfers[index];
        if (!route || route.status !== 'bereit') return;
        setBusy(true); route.status = 'prüft'; renderTransfers();
        showStatus(`${route.sourceName} → ${route.targetName}: Bestand, Ziel und Händler werden geprüft …`);
        try {
            const source = await marketFor(route.source);
            const target = await marketFor(route.target);
            if (String(source.data?.player?.id) !== String(gameData.player?.id)
                || String(target.data?.player?.id) !== String(gameData.player?.id)
                || String(target.data?.village?.id) !== route.target || String(source.data?.village?.id) !== route.source) throw new Error('Eigentümer oder Dorfkennung verändert. Neu planen.');
            const plan = state.villagePlans[route.source];
            const pending = state.transfers.filter((r) => r.source === route.source && ['bereit', 'prüft'].includes(r.status));
            const marketPending = summarizeGroups(state.groups.filter((g) => g.villageId === route.source && g.status === 'bereit'));
            const inFlight = target.incoming ?? await incomingFor(route.target);
            const sourceIncoming=source.incoming ?? await incomingFor(route.source);
            const pendingReceipts=zeroResources();
            for(const receipt of state.transfers.filter(r=>r.target===route.source && ['bereit','prüft'].includes(r.status))) {
                for(const key of RESOURCES) pendingReceipts[key]+=receipt.amounts[key];
            }
            const sendReserve=transferReserveFor(plan,state.config.reserve,sourceIncoming,pendingReceipts);
            if(state.villagePlans[route.target].troopPopulation > Number(target.data.village.pop_max)-Number(target.data.village.pop)) throw new Error('Freie Bauernhofplätze reichen nicht mehr für die geplanten Einheiten. Neu planen.');
            const targetPending = state.transfers.filter((r) => r.target === route.target && ['bereit', 'prüft'].includes(r.status));
            const arrivalHorizon = Math.max(...targetPending.map((r) => r.seconds));
            for (const key of RESOURCES) {
                const spend = pending.reduce((sum, r) => sum + r.amounts[key], 0) + marketPending.offered[key];
                if (spend > 0 && source.resources[key] - spend < sendReserve[key]) throw new Error(`${NAMES[key]} reichen nicht mehr für alle geplanten Abgaben und die Reserve. Neu planen.`);
                const later = targetPending.reduce((s, r) => s + r.amounts[key], 0);
                const produced = Math.ceil((Number(target.data.village[`${key}_prod`]) || 0) * arrivalHorizon);
                if (target.resources[key] + inFlight[key] + later + produced > Number(target.data.village.storage_max)) throw new Error(`Zielspeicher für ${NAMES[key]} wäre überschritten. Neu planen.`);
            }
            const neededMerchants = pending.reduce((s, r) => s + Math.ceil(totalResources(r.amounts) / source.carry), 0) + marketPending.merchants;
            if (source.merchants < neededMerchants) throw new Error('Händler reichen nicht mehr für alle geplanten Abgaben. Neu planen.');
            const pageUrl = urlFor('market', 'send', route.source);
            const page = await fetchDocument(pageUrl);
            const form = page.querySelector('#market-send-form');
            if (!form) throw new Error('Transportformular nicht lesbar.');
            const action = checkMarketFormAction(form, pageUrl, route.source);
            for (const key of RESOURCES) setNativeValue(form, `input[name="${key}"]`, route.amounts[key]);
            setNativeValue(form, 'input[name="x"]', target.data.village.x);
            setNativeValue(form, 'input[name="y"]', target.data.village.y);
            setNativeValue(form, 'input[name="input"]', `${target.data.village.x}|${target.data.village.y}`);
            for (const option of form.querySelectorAll('input[name="target_type"]')) option.checked = option.value === 'coord';
            const confirmation = await postDocument(action, new FormData(form));
            nativeError(confirmation);
            const finalForm = [...confirmation.querySelectorAll('form')].find((candidate) => {
                try { checkMarketFormAction(candidate, action, route.source, true); return true; } catch (_) { return false; }
            });
            if (!finalForm) throw new Error('Native Transportbestätigung nicht lesbar. Es wurde kein Versand bestätigt.');
            const data = new FormData(finalForm);
            const targetId = data.get('target_id') || data.get('target');
            const correctCoord = String(data.get('x')) === String(target.data.village.x) && String(data.get('y')) === String(target.data.village.y);
            if (String(targetId) !== route.target && !correctCoord) throw new Error('Zieldorf in der Transportbestätigung nicht eindeutig.');
            if (RESOURCES.some((key) => Number(data.get(key)) !== route.amounts[key])) throw new Error('Transportmengen in der Bestätigung stimmen nicht überein.');
            const actualSeconds = nativeTravelSeconds(finalForm);
            if (actualSeconds === null) throw new Error('Laufzeit in der nativen Transportbestätigung nicht eindeutig lesbar. Es wurde nichts versendet.');
            if (!state.config.allowCrossCluster && actualSeconds > state.config.clusterHours * 3600) {
                throw new Error(`Native Laufzeit ${Math.floor(actualSeconds / 3600)}:${String(Math.floor(actualSeconds / 60) % 60).padStart(2, '0')}:${String(actualSeconds % 60).padStart(2, '0')} überschreitet die Cluster-Grenze von ${state.config.clusterHours} Stunden. Cluster-Laufzeit anpassen und neu planen.`);
            }
            for (const key of RESOURCES) {
                const later = targetPending.reduce((s, r) => s + r.amounts[key], 0);
                const production = Math.ceil((Number(target.data.village[`${key}_prod`]) || 0) * Math.max(arrivalHorizon, actualSeconds));
                if (target.resources[key] + inFlight[key] + later + production > Number(target.data.village.storage_max)) throw new Error('Zielspeicher reicht bei der nativen Laufzeit nicht aus. Neu planen.');
            }
            const submit = finalForm.querySelector('input[type="submit"], button[type="submit"]');
            if (submit?.name) data.set(submit.name, submit.value || '1');
            route.status = 'gesendet';
            const result = await postDocument(checkMarketFormAction(finalForm, action, route.source, true), data);
            nativeError(result);
            const updated = await readTransportOutcome(result,source,route,()=>marketFor(route.source));
            route.status = 'abgeschlossen'; plan.merchantsNow = updated.merchants;
            state.villages.find((v) => v.id === route.source).resources = updated.resources;
            for (const key of RESOURCES) {
                state.villagePlans[route.target].incoming[key] += route.amounts[key];
                state.villagePlans[route.target].existingExpected[key] += route.amounts[key];
            }
            renderVillages(); renderTransfers(); renderGroups();
            showStatus(`Lieferung nach ${route.targetName} bestätigt. ${state.transfers.every((r) => r.status === 'abgeschlossen') ? 'Marktgruppen sind jetzt freigegeben.' : 'Weitere Lieferungen einzeln anklicken.'}${updated.refreshWarning ? ' Bestandsnachprüfung fehlgeschlagen; Anzeige aus der bestätigten Lieferung berechnet. Vor dem nächsten Versand werden die aktuellen Werte erneut gelesen.' : ''}`);
        } catch (error) {
            if (route.status === 'gesendet') {
                route.status = 'unklar';
                for (const other of state.transfers) if (other.status === 'bereit') other.status = 'gesperrt';
                for (const group of state.groups) if (group.status === 'bereit') group.status = 'gesperrt';
            } else route.status = 'bereit';
            renderTransfers(); renderGroups();
            showStatus(`${error.message}${route.status === 'unklar' ? ' Transporte prüfen und anschließend neu planen; nicht erneut senden.' : ''}`, true);
        } finally { setBusy(false); }
    }

    function offerSide(cell) {
        const key = RESOURCES.find((resource) => cell?.querySelector(`.icon.${resource}, .res.${resource}`));
        const amount = parseIntLocalized(cell?.textContent);
        return key && amount ? { key, amount } : null;
    }
    function durationHours(textValue) {
        const parts = String(textValue).trim().split(':').map(Number);
        return parts.length === 3 && parts.every(Number.isFinite)
            ? parts[0] + parts[1] / 60 + parts[2] / 3600 : Infinity;
    }
    function matchingForeignOffer(doc, group, maxTravelHours) {
        const matches = [];
        for (const form of doc.querySelectorAll('form.market_accept_offer')) {
            const row = form.closest('tr');
            if (!row || row.cells.length < 7) continue;
            const receive = offerSide(row.cells[0]);
            const pay = offerSide(row.cells[1]);
            const available = parseIntLocalized(row.cells[5].textContent);
            const nativeLimit = parseIntLocalized(form.querySelector('a[onclick*="input[name=count]"]')?.textContent);
            const hours = durationHours(row.cells[3].textContent);
            if (!receive || !pay || !available || hours > maxTravelHours) continue;
            if (receive.key !== group.buy || receive.amount !== group.buyEach
                || pay.key !== group.sell || pay.amount !== group.sellEach) continue;
            matches.push({ form, available: nativeLimit ? Math.min(available, nativeLimit) : available, hours });
        }
        matches.sort((a, b) => b.available - a.available || a.hours - b.hours);
        return matches[0] || null;
    }
    async function findForeignOffer(group, config) {
        const pageUrl = urlFor('market', 'other_offer', group.villageId);
        const initial = await fetchDocument(pageUrl);
        const filter = initial.querySelector('#offer_filter');
        if (!filter || filter.method.toUpperCase() !== 'POST') throw new Error('Suche nach fremden Angeboten ist nicht lesbar.');
        const action = new URL(filter.getAttribute('action') || pageUrl, pageUrl);
        if (action.origin !== window.location.origin || action.searchParams.get('screen') !== 'market'
            || action.searchParams.get('mode') !== 'other_offer' || action.searchParams.get('action') !== 'search') {
            throw new Error('Unbekannte Suchadresse für fremde Angebote.');
        }
        const values = new FormData(filter);
        values.set('res_sell', group.buy);
        values.set('res_buy', group.sell);
        values.set('filter', 'all');
        values.set('ratio_max', '2');
        const timeSelect = filter.querySelector('[name="trader_time_max_hours"]');
        if (timeSelect) {
            const options = [...timeSelect.options].map((option) => Number(option.value)).filter(Number.isFinite).sort((a, b) => a - b);
            values.set('trader_time_max_hours', String(options.find((hours) => hours >= config.maxTravelHours) || options.at(-1) || config.maxTravelHours));
        }
        const result = await postDocument(action, values);
        let best = matchingForeignOffer(result, group, config.maxTravelHours);
        if (best?.available >= group.count) return best;
        const pageLinks = [...result.querySelectorAll('select option[value*="mode=other_offer"][value*="start="]')]
            .map((option) => new URL(option.value, pageUrl))
            .filter((url) => url.origin === window.location.origin && url.searchParams.get('screen') === 'market'
                && url.searchParams.get('mode') === 'other_offer' && Number(url.searchParams.get('start')) > 0);
        for (const nextUrl of pageLinks) {
            const next = matchingForeignOffer(await fetchDocument(nextUrl), group, config.maxTravelHours);
            if (next && (!best || next.available > best.available ||
                (next.available === best.available && next.hours < best.hours))) best = next;
            if (best?.available >= group.count) break;
        }
        return best;
    }

    function setNativeValue(form, selector, value) {
        const input = form.querySelector(selector);
        if (!input) throw new Error(`Formularfeld ${selector} fehlt.`);
        input.value = String(value);
        return input;
    }
    function selectNativeResource(form, side, key) {
        const input = form.querySelector(`#res_${side}_${key}`);
        if (!input || input.type !== 'radio') throw new Error(`Rohstoffauswahl für ${side}/${key} fehlt.`);
        input.checked = true;
    }
    function createSubmission(form, pageUrl, group, config) {
        selectNativeResource(form, 'sell', group.sell);
        selectNativeResource(form, 'buy', group.buy);
        setNativeValue(form, '#res_sell_amount', group.sellEach);
        setNativeValue(form, '#res_buy_amount', group.buyEach);
        const multi = setNativeValue(form, 'input[name="multi"]', group.count);
        if (multi.max && Number(multi.max) < group.count) throw new Error(`Das native Formular erlaubt höchstens ${multi.max} Angebote je Gruppe.`);
        if (form.querySelector('input[name="max_time"]')) setNativeValue(form, 'input[name="max_time"]', config.maxTravelHours);
        if (form.method.toUpperCase() !== 'POST') throw new Error('Unbekannte Formularmethode.');
        const action = new URL(form.getAttribute('action') || pageUrl, pageUrl);
        if (action.origin !== window.location.origin || !action.pathname.endsWith('/game.php') || action.searchParams.get('screen') !== 'market') {
            throw new Error('Unbekannte Formularadresse.');
        }
        const data = new FormData(form);
        const submit = form.querySelector('button[type="submit"], input[type="submit"]');
        if (submit?.name) data.set(submit.name, submit.value || '1');
        return { action, data };
    }
    function createForeignSubmission(candidate, count, villageId) {
        const { form } = candidate;
        if (form.method.toUpperCase() !== 'POST') throw new Error('Unbekannte Annahmemethode.');
        const action = new URL(form.getAttribute('action'), window.location.origin);
        if (action.origin !== window.location.origin || !action.pathname.endsWith('/game.php')
            || action.searchParams.get('screen') !== 'market' || action.searchParams.get('mode') !== 'other_offer'
            || action.searchParams.get('action') !== 'accept_multi' || action.searchParams.get('village') !== villageId) {
            throw new Error('Unbekannte Annahmeadresse.');
        }
        const offerId = form.querySelector('input[name="id"]')?.value;
        if (!offerId || offerId !== action.searchParams.get('id')) throw new Error('Angebotskennung ist nicht lesbar.');
        const data = new FormData(form);
        data.set('count', String(count));
        return { action, data };
    }
    function recordSubmittedGroup(group, market, count, foreign = false) {
        const plan = state.villagePlans[group.villageId];
        const usedMerchants = count * Math.ceil(group.sellEach / 1000);
        plan.merchantsNow = Math.max(0, market.merchants - usedMerchants);
        const village = state.villages.find((entry) => entry.id === group.villageId);
        village.resources = { ...market.resources, [group.sell]: market.resources[group.sell] - group.sellEach * count };
        if (foreign) plan.incoming[group.buy] += group.buyEach * count;
        else { plan.openOffered[group.sell] += group.sellEach * count; plan.openWanted[group.buy] += group.buyEach * count; }
        if (foreign || state.config.includeOpenOffers) plan.existingExpected[group.buy] += group.buyEach * count;
        group.count -= count;
        group.merchants -= usedMerchants;
        group.status = group.count ? 'bereit' : 'abgeschlossen';
        renderGroups();
        renderVillages();
    }
    async function submitGroup(index, button) {
        if (state.transfers.some((route) => route.status !== 'abgeschlossen')) { showStatus('Zuerst alle eigenen Lieferungen abschließen.', true); return; }
        const group = state.groups[index];
        if (!group || group.status !== 'bereit') return;
        setBusy(true);
        const config = state.config;
        button.disabled = true;
        group.status = 'prüft';
        showStatus(`${group.villageName}: Bestand, Händler und passende Angebote werden geprüft …`);
        try {
            const foreign = config.preferForeignOffers ? await findForeignOffer(group, config) : null;
            const market = await marketFor(group.villageId);
            const plan = state.villagePlans[group.villageId];
            if (!plan || plan.error) throw new Error('Dorfplanung fehlt. Vorschau neu berechnen.');
            plan.merchantsNow = market.merchants;
            const count = foreign ? Math.min(group.count, foreign.available) : group.count;
            const merchantsNeeded = count * Math.ceil(group.sellEach / 1000);
            if (market.merchants < merchantsNeeded) throw new Error(`Nur ${market.merchants} Händler frei, benötigt ${merchantsNeeded}. Vorschau neu berechnen.`);
            const available = market.resources[group.sell];
            const spend = group.sellEach * count;
            if (available - spend < group.reserve) {
                throw new Error(`${NAMES[group.sell]}: ${format(available)} verfügbar, ${format(spend)} für diese Gruppe und ${format(group.reserve)} Reserve. Vorschau neu berechnen.`);
            }
            const submission = foreign
                ? createForeignSubmission(foreign, count, group.villageId)
                : createSubmission(market.form, market.pageUrl, group, config);
            group.status = 'gesendet';
            showStatus(`${group.villageName}: ${foreign ? 'Fremdes Angebot wird angenommen' : 'Eigene Angebotsgruppe wird eingestellt'} …`);
            const result = await postDocument(submission.action, submission.data);
            const error = result.querySelector('.error_box, .error-message, #error');
            if (error?.textContent.trim()) throw new Error(error.textContent.trim().slice(0, 220));
            recordSubmittedGroup(group, market, count, Boolean(foreign));
            const actionText = foreign
                ? `${count} ${count === 1 ? 'fremdes Angebot' : 'fremde Angebote'} angenommen`
                : `${count} ${count === 1 ? 'eigenes Angebot' : 'eigene Angebote'} eingestellt`;
            showStatus(`${group.villageName}: ${actionText}. ${group.count
                ? `${group.count} ${group.count === 1 ? 'Angebot bleibt' : 'Angebote bleiben'} in dieser Gruppe für einen weiteren Klick.`
                : 'Bitte den Marktstatus prüfen.'}`);
        } catch (error) {
            // Bei unklarer POST-Antwort nie automatisch wiederholen: das Angebot könnte erstellt worden sein.
            if (group.status === 'gesendet') {
                group.status = 'unklar';
                for (const other of state.groups) {
                    if (other.villageId === group.villageId && other.status === 'bereit') other.status = 'gesperrt';
                }
                renderGroups();
                updateVillagePlanCells();
                showStatus(`${group.villageName}: ${error.message} Bitte Angebotsliste prüfen, bevor du neu planst.`, true);
            } else {
                group.status = 'bereit';
                button.disabled = false;
                showStatus(`${group.villageName}: ${error.message}`, true);
            }
        } finally { setBusy(false); }
    }

    buildPanel();
})();
