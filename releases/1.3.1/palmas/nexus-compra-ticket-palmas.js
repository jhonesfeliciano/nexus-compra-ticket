(() => {
    'use strict';

    const CONFIG = {
        ecosystemKey: 'palmas',
        ecosystemLabel: 'PALMAS',
        firebaseDb: 'https://acompanhamentos-reta-final-default-rtdb.firebaseio.com',
        integrationBase: 'Ciclo-semanas-integracao',
        dataRoot: 'Ciclo-semanas-setores',
        panelId: 'nexusCompraTicketPanel',
        openerId: 'nexusCompraTicketOpen',
        panelHiddenKey: 'nexusCompraTicketPanelHidden_palmas',
        releaseVersion: '1.3.1'
    };

    const state = { lastRequest: null, data: [], profiles: [] };


    function normalizeHeader(value) {
        return String(value || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ').trim().toUpperCase();
    }

    function headerTokens(cell) {
        return String(cell?.getAttribute('headers') || '')
            .split(/\s+/).map(normalizeHeader).filter(Boolean);
    }

    function cellByHeader(row, aliases) {
        const wanted = aliases.map(normalizeHeader);
        return [...row.querySelectorAll('td')].find(td => {
            const tokens = headerTokens(td);
            return tokens.some(token => wanted.includes(token));
        }) || null;
    }

    function findReportTable() {
        const aliases = {
            week: ['SEMANA'],
            region: ['REGIAO', 'REGIÃO'],
            total: ['TOTALGERAL'],
            ticket: ['C5407196655334160411']
        };
        const tables = [...document.querySelectorAll('table')];
        const exact = tables.find(table => {
            const rows = [...table.querySelectorAll('tbody tr')];
            return rows.some(tr =>
                cellByHeader(tr, aliases.week) &&
                cellByHeader(tr, aliases.region) &&
                cellByHeader(tr, aliases.total) &&
                cellByHeader(tr, aliases.ticket)
            );
        });
        if (exact) return exact;
        return tables.find(table => {
            const headers = [...table.querySelectorAll('thead th')]
                .map(th => normalizeHeader(th.innerText || th.textContent));
            return headers.some(h => h === 'SEMANA') &&
                headers.some(h => h === 'REGIAO') &&
                headers.some(h => h === 'TOTAL') &&
                headers.some(h => h.includes('TICKET MEDIO'));
        }) || null;
    }

    function isTargetReportPage() {
        return Boolean(findReportTable());
    }


    if (!isTargetReportPage()) {
        console.info(`[NEXUS Compra & Ticket/${CONFIG.ecosystemLabel}] Página sem a grade de Cobranças; módulo não iniciado.`);
        return;
    }

    start().catch(error => console.error(`[NEXUS Compra & Ticket/${CONFIG.ecosystemLabel}]`, error));

    async function start() {
        installStyles();
        panel();
        await loadProfiles();
        await preselectPendingRequest();
        setInterval(monitorCancellation, 3500);
    }

    function normalize(value) {
        return String(value || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function canonical(value) {
        return normalize(value)
            .replace(/^(regiao|setor)\s+/, '')
            .replace(/\s+(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)$/, '')
            .trim();
    }

    function profileKey(profile) {
        const normalized = String(profile || 'perfil').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'perfil';
        let hash = 2166136261;
        for (const ch of String(profile || '')) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
        return `${normalized}_${(hash >>> 0).toString(36)}`;
    }

    function weekNumber(value) {
        const m = String(value || '').match(/(\d+)/);
        return m ? Number(m[1]) : 0;
    }

    function money(value) {
        const clean = String(value || '').replace(/\s/g, '').replace(/R\$/gi, '');
        if (!clean) return NaN;
        if (clean.includes(',') && clean.includes('.')) return Number(clean.replace(/\./g, '').replace(',', '.'));
        if (clean.includes(',')) return Number(clean.replace(/\./g, '').replace(',', '.'));
        return Number(clean.replace(/[^\d.-]/g, ''));
    }

    async function fb(method, path, body) {
        const res = await fetch(`${CONFIG.firebaseDb}/${String(path).replace(/^\/+/, '')}.json`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`Firebase HTTP ${res.status}`);
        return res.json();
    }

    function convertToArray(value) {
        if (Array.isArray(value)) return value.filter(v => v !== null && v !== undefined);
        if (!value || typeof value !== 'object') return [];
        return Object.values(value).filter(v => v !== null && v !== undefined);
    }

    function extractProfileNames(raw) {
        return [...new Set(convertToArray(raw).map(item => {
            if (typeof item === 'string' || typeof item === 'number') return String(item).trim();
            if (item && typeof item === 'object') return String(item.name || item.nome || item.profile || item.distributor || item.value || '').trim();
            return '';
        }).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    }

    function flattenRequests(raw) {
        if (!raw || typeof raw !== 'object') return [];
        const out = [];
        const walk = (node, key = '') => {
            if (!node || typeof node !== 'object') return;
            const looksLikeRequest = Object.prototype.hasOwnProperty.call(node, 'requestId') ||
                Object.prototype.hasOwnProperty.call(node, 'profile') ||
                Object.prototype.hasOwnProperty.call(node, 'status');
            if (looksLikeRequest) { out.push({ key, ...node }); return; }
            Object.entries(node).forEach(([k, v]) => walk(v, key ? `${key}/${k}` : k));
        };
        walk(raw);
        return out;
    }

    async function loadProfiles() {
        const select = document.getElementById('nexusProfile');
        if (!select) return;
        try {
            const raw = await fb('GET', `${CONFIG.dataRoot}/${CONFIG.ecosystemKey}/profiles`);
            state.profiles = extractProfileNames(raw);
            select.innerHTML = '<option value="">Selecione o distribuidor...</option>' +
                state.profiles.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
            renderStatus(state.profiles.length
                ? `${state.profiles.length} perfis de ${CONFIG.ecosystemLabel} carregados. Capture a tabela ou atenda uma solicitação.`
                : `Nenhum perfil foi encontrado em ${CONFIG.ecosystemLabel}.`, !state.profiles.length);
        } catch (error) {
            console.error(error);
            renderStatus(`Não foi possível carregar os perfis de ${CONFIG.ecosystemLabel}: ${error.message || error}`, true);
        }
    }

    async function preselectPendingRequest() {
        try {
            const raw = await fb('GET', `${CONFIG.integrationBase}/requests`);
            const profileSet = new Set(state.profiles.map(normalize));
            const pending = flattenRequests(raw)
                .filter(req => req?.status === 'pending' && req?.type === 'purchaseMetrics' && req?.profile)
                .filter(req => {
                    const explicit = normalize(req.ecosystemKey || req.workspaceKey || req.dataKey || '');
                    if (explicit) return explicit === normalize(CONFIG.ecosystemKey);
                    return profileSet.has(normalize(req.profile));
                })
                .sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0));
            if (!pending.length) return;
            const request = pending[0];
            const select = document.getElementById('nexusProfile');
            if (select && [...select.options].some(opt => normalize(opt.value) === normalize(request.profile))) {
                const option = [...select.options].find(opt => normalize(opt.value) === normalize(request.profile));
                if (option) select.value = option.value;
            }
            state.lastRequest = request;
            renderStatus(`Solicitação Compra/Ticket encontrada para ${request.profile}. Semanas de origem: ${(request.targetWeeks || []).join(', ') || 'todas'}.`);
        } catch (error) {
            console.warn(`[NEXUS Compra & Ticket/${CONFIG.ecosystemLabel}] Pré-seleção de solicitação falhou.`, error);
        }
    }


    // Atualização 1.3.1: cancelamento de pedidos via Firebase, sem alterar a captura APEX.
    const cancellationNotifiedIds = new Set();
    const cancellationMonitorStartedAt = Date.now();
    let cancellationMonitorBusy = false;
    let purchaseSendBusy = false;

    function isCancelledStatus(status) {
        return ['cancelled', 'canceled'].includes(String(status || '').toLowerCase());
    }

    function showCancellationModal(profile) {
        document.getElementById('nexusCompraTicketCancelOverlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'nexusCompraTicketCancelOverlay';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'nexusCompraTicketCancelTitle');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.68);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';
        const card = document.createElement('div');
        card.style.cssText = 'max-width:410px;width:100%;padding:26px 22px;background:#fff;color:#172033;border-radius:16px;box-shadow:0 22px 60px rgba(0,0,0,.33);font:14px/1.45 Arial,sans-serif;text-align:center';
        const icon = document.createElement('div');
        icon.textContent = '✕';
        icon.style.cssText = 'display:grid;place-items:center;margin:0 auto 12px;width:42px;height:42px;border-radius:50%;color:#b91c1c;background:#fee2e2;font-size:24px;font-weight:bold';
        const title = document.createElement('h3');
        title.id = 'nexusCompraTicketCancelTitle';
        title.textContent = 'Solicitação cancelada';
        title.style.cssText = 'margin:0 0 10px;font-size:20px;color:#b91c1c';
        const message = document.createElement('p');
        message.textContent = `O pedido de Compra e Ticket de ${profile || 'distribuidor'} foi cancelado no NEXUS. O script está livre e aguardando outra solicitação.`;
        message.style.cssText = 'margin:0 0 22px;color:#334155';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'OK, entendi';
        button.style.cssText = 'width:100%;padding:12px;border:0;border-radius:9px;background:#dc2626;color:white;font-size:14px;font-weight:700;cursor:pointer';
        button.addEventListener('click', () => overlay.remove());
        card.append(icon,title,message,button);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        button.focus();
    }

    function notifyCancelledRequest(request) {
        if (!request || request.type !== 'purchaseMetrics' || !isCancelledStatus(request.status)) return;
        const id = String(request.requestId || '');
        if (!id || cancellationNotifiedIds.has(id)) return;
        cancellationNotifiedIds.add(id);
        if (String(state.lastRequest?.requestId || '') === id) state.lastRequest = null;
        renderStatus('Solicitação cancelada pelo NEXUS. Aguardando outra solicitação.');
        showCancellationModal(request.profile);
    }

    async function requirePendingPurchaseRequest(request) {
        if (!request?.requestId) throw new Error('Nenhuma solicitação de Compra/Ticket está selecionada.');
        const key = String(request.profileKey || profileKey(request.profile || ''));
        const current = await fb('GET', `${CONFIG.integrationBase}/requests/${key}`);
        if (!current || String(current.requestId || '') !== String(request.requestId)) {
            state.lastRequest = null;
            throw new Error('A solicitação foi substituída. Verifique o novo pedido.');
        }
        if (isCancelledStatus(current.status)) {
            notifyCancelledRequest(current);
            throw new Error('Solicitação cancelada. Aguardando outra solicitação.');
        }
        if (current.type !== 'purchaseMetrics' || current.status !== 'pending') {
            state.lastRequest = null;
            throw new Error('Esta solicitação já foi concluída ou pertence a outra integração.');
        }
        return current;
    }

    async function monitorCancellation() {
        if (cancellationMonitorBusy) return;
        const remembered = state.lastRequest;
        const selected = selectedProfile();
        if (!remembered && !selected) return;
        cancellationMonitorBusy = true;
        try {
            const key = remembered?.profileKey || (remembered?.profile ? profileKey(remembered.profile) : '') || profileKey(selected);
            const current = await fb('GET', `${CONFIG.integrationBase}/requests/${key}`);
            if (current?.type === 'purchaseMetrics' && isCancelledStatus(current.status) &&
                ((remembered && String(remembered.requestId || '') === String(current.requestId || '')) ||
                 Number(current.cancelledAt || 0) >= cancellationMonitorStartedAt)) {
                notifyCancelledRequest(current);
            } else if (remembered && (!current || String(current.requestId || '') !== String(remembered.requestId || '') || current.status !== 'pending')) {
                state.lastRequest = null;
            }
        } catch (error) {
            console.debug(`[NEXUS Compra & Ticket/${CONFIG.ecosystemLabel}] Monitor de cancelamento:`, error);
        } finally {
            cancellationMonitorBusy = false;
        }
    }

    // ETag REST: apenas finaliza o mesmo pedido que ainda está pendente.
    function conditionalFirebaseRequest(method, url, body, etag) {
        return new Promise((resolve, reject) => GM_xmlhttpRequest({
            method, url, timeout: 30000,
            headers: method === 'GET' ? {'X-Firebase-ETag': 'true'} :
                {'Content-Type': 'application/json', 'If-Match': etag},
            data: body === undefined ? undefined : JSON.stringify(body),
            onload: response => resolve({status: response.status, text: response.responseText || '', headers: response.responseHeaders || ''}),
            onerror: () => reject(new Error('Falha de comunicação com o Firebase.')),
            ontimeout: () => reject(new Error('Tempo esgotado no Firebase.'))
        }));
    }

    async function completeRequestWithoutOverwritingCancellation(request) {
        const key = String(request.profileKey || profileKey(request.profile || ''));
        const url = `${CONFIG.firebaseDb}/${CONFIG.integrationBase}/requests/${key}.json`;
        for (let attempt = 0; attempt < 3; attempt++) {
            const snapshot = await conditionalFirebaseRequest('GET', url);
            if (snapshot.status !== 200) throw new Error(`Firebase HTTP ${snapshot.status} ao verificar a solicitação.`);
            const etag = /^etag:\s*(.+)$/im.exec(snapshot.headers)?.[1]?.trim();
            if (!etag) throw new Error('O Firebase não forneceu ETag. Não concluí a solicitação para evitar uma sobrescrita.');
            const current = JSON.parse(snapshot.text || 'null');
            if (!current || String(current.requestId || '') !== String(request.requestId || '') || current.status !== 'pending') {
                if (isCancelledStatus(current?.status) && String(current?.requestId || '') === String(request.requestId || '')) {
                    notifyCancelledRequest(current);
                } else state.lastRequest = null;
                throw new Error('Solicitação cancelada, concluída ou substituída durante o envio.');
            }
            const completed = {...current, status: 'completed', completedAt: Date.now()};
            const result = await conditionalFirebaseRequest('PUT', url, completed, etag);
            if (result.status >= 200 && result.status < 300) return;
            if (result.status !== 412) throw new Error(`Firebase HTTP ${result.status} ao concluir solicitação.`);
        }
        throw new Error('O pedido mudou durante a finalização. Nenhum cancelamento foi sobrescrito.');
    }

    function extractData() {
        const table = findReportTable();
        if (!table) throw new Error('Esta não é a página/grade de Cobranças usada pelo Nexus Compra & Ticket.');

        const headerTexts = [...table.querySelectorAll('thead th')].map(th => normalizeHeader(th.innerText || th.textContent));
        const idxWeek = headerTexts.findIndex(h => h === 'SEMANA');
        const idxRegion = headerTexts.findIndex(h => h === 'REGIAO');
        const idxTotal = headerTexts.findIndex(h => h === 'TOTAL');
        const idxTicket = headerTexts.findIndex(h => h.includes('TICKET MEDIO'));
        const aliases = { week: ['SEMANA'], region: ['REGIAO', 'REGIÃO'], total: ['TOTALGERAL'], ticket: ['C5407196655334160411'] };

        const rows = [...table.querySelectorAll('tbody tr')];
        const data = rows.map(tr => {
            const cells = [...tr.querySelectorAll('td')];
            const w = cellByHeader(tr, aliases.week) || cells[idxWeek];
            const r = cellByHeader(tr, aliases.region) || cells[idxRegion];
            const t = cellByHeader(tr, aliases.total) || cells[idxTotal];
            const tk = cellByHeader(tr, aliases.ticket) || cells[idxTicket];
            const week = weekNumber(w?.innerText || w?.textContent);
            const region = String(r?.innerText || r?.textContent || '').replace(/\s+/g, ' ').trim();
            const total = money(t?.innerText || t?.textContent);
            const ticketMedio = money(tk?.innerText || tk?.textContent);
            if (!week || !region || !Number.isFinite(total) || !Number.isFinite(ticketMedio)) return null;
            return { week, region, regionKey: canonical(region), total, ticketMedio, key: `${week}|${canonical(region)}` };
        }).filter(Boolean);

        if (!data.length) throw new Error('A grade foi encontrada, mas nenhuma linha válida foi extraída. Aguarde a tabela terminar de carregar e tente novamente.');
        state.data = data;
        renderStatus(`${data.length} linhas capturadas. Semanas: ${[...new Set(data.map(x => x.week))].sort((a,b) => a-b).join(', ')}`);
        return data;
    }

    function makePayload(request) {
        const wantedWeeks = Array.isArray(request?.targetWeeks) ? request.targetWeeks.map(Number) : null;
        const mappings = Array.isArray(request?.mappings) ? request.mappings : [];
        const metrics = {};
        const source = state.data.length ? state.data : extractData();
        for (const row of source) {
            if (wantedWeeks && wantedWeeks.length && !wantedWeeks.includes(row.week)) continue;
            metrics[row.key] = { total: row.total, ticketMedio: row.ticketMedio, region: row.region, sourceWeek: row.week };
        }
        for (const map of mappings) {
            const wk = Number(map.sourceWeek);
            const sectorKey = canonical(map.sector);
            const found = source.find(r => r.week === wk && r.regionKey === sectorKey);
            if (found) metrics[`${wk}|${sectorKey}`] = { total: found.total, ticketMedio: found.ticketMedio, region: found.region, sourceWeek: wk };
        }
        return metrics;
    }

    function selectedProfile() {
        return String(document.getElementById('nexusProfile')?.value || '').trim();
    }

    async function checkRequest() {
        const profile = selectedProfile();
        if (!profile) throw new Error('Selecione o mesmo distribuidor/perfil selecionado no Nexus.');
        const key = profileKey(profile);
        const req = await fb('GET', `${CONFIG.integrationBase}/requests/${key}`);
        if (req?.type === 'purchaseMetrics' && isCancelledStatus(req.status)) notifyCancelledRequest(req);
        if (!req || !req.requestId || req.status !== 'pending') throw new Error('Nenhuma solicitação pendente para este perfil.');
        if (req.type !== 'purchaseMetrics') throw new Error('A solicitação pendente deste perfil pertence a outra integração. No Nexus, use “Solicitar Compra e Ticket”.');
        const explicit = normalize(req.ecosystemKey || req.workspaceKey || req.dataKey || '');
        if (explicit && explicit !== normalize(CONFIG.ecosystemKey)) throw new Error(`Esta solicitação pertence ao perfil ${String(req.ecosystemName || req.ecosystemKey || '').toUpperCase() || 'de outro ecossistema'}.`);
        state.lastRequest = req;
        renderStatus(`Solicitação encontrada para ${req.profile}. Semanas de origem: ${(req.targetWeeks || []).join(', ') || 'todas'}.`);
        return req;
    }

    async function sendRequest() {
        if (purchaseSendBusy) return;
        purchaseSendBusy = true;
        try {
            const currentProfile = selectedProfile();
            if (!currentProfile) throw new Error('Selecione o distribuidor/perfil antes de enviar.');
            let req = state.lastRequest;
            if (!req || normalize(req.profile) !== normalize(currentProfile) || req.status !== 'pending' || req.type !== 'purchaseMetrics') {
                req = await checkRequest();
            }
            req = await requirePendingPurchaseRequest(req);
            if (!state.data.length) extractData();
            const metrics = makePayload(req);
            if (!Object.keys(metrics).length) throw new Error('Nenhuma linha encontrada para as semanas solicitadas.');
            req = await requirePendingPurchaseRequest(req);
            const key = String(req.profileKey || profileKey(req.profile || currentProfile));
            const payload = {
                version: 3, type: 'purchaseMetrics', requestId: req.requestId,
                profile: req.profile || currentProfile, profileKey: key,
                ecosystemKey: CONFIG.ecosystemKey, ecosystemName: CONFIG.ecosystemLabel,
                requestedAt: req.requestedAt, createdAt: Date.now(), status: 'ready',
                source: 'tampermonkey-relatorio-cobrancas-github', sourceRelease: CONFIG.releaseVersion,
                metrics, rowsCaptured: state.data.length
            };
            await fb('PUT', `${CONFIG.integrationBase}/results/${key}`, payload);
            await requirePendingPurchaseRequest(req);
            await completeRequestWithoutOverwritingCancellation(req);
            state.lastRequest = null;
            renderStatus(`Enviado com sucesso: ${Object.keys(metrics).length} combinações de Semana + Região.`);
        } finally {
            purchaseSendBusy = false;
        }
    }

    function setPanelHidden(hidden) {
        const box = document.getElementById(CONFIG.panelId);
        const opener = document.getElementById(CONFIG.openerId);
        if (!box || !opener) return;
        box.classList.toggle('is-hidden', hidden);
        opener.classList.toggle('is-visible', hidden);
        try { localStorage.setItem(CONFIG.panelHiddenKey, hidden ? '1' : '0'); } catch (_) {}
    }

    function panel() {
        if (document.getElementById(CONFIG.panelId) || !isTargetReportPage()) return;
        const box = document.createElement('div');
        box.id = CONFIG.panelId;
        box.innerHTML = `
            <div class="nexus-head">
                <div><strong>Nexus • Compra & Ticket</strong><small>${CONFIG.ecosystemLabel} • GitHub v${CONFIG.releaseVersion}</small></div>
                <button id="nexusHide" class="nexus-hide" type="button" title="Ocultar painel">− Ocultar</button>
            </div>
            <label>Distribuidor / Perfil do Nexus</label>
            <div class="nexus-profile-row">
                <select id="nexusProfile"><option value="">Carregando perfis...</option></select>
                <button id="nexusRefreshProfiles" type="button" title="Atualizar perfis">↻</button>
            </div>
            <div class="nexus-actions">
                <button id="nexusCapture">1. Capturar tabela</button>
                <button id="nexusCheck">2. Ver solicitação</button>
                <button id="nexusSend" class="primary">3. Atender solicitação e enviar</button>
            </div>
            <div id="nexusTmStatus">Carregando perfis de ${CONFIG.ecosystemLabel}...</div>`;

        const opener = document.createElement('button');
        opener.id = CONFIG.openerId;
        opener.type = 'button';
        opener.title = `Mostrar painel Nexus Compra & Ticket • ${CONFIG.ecosystemLabel}`;
        opener.innerHTML = '<span class="nexus-open-icon">↗</span><span>Compra & Ticket</span>';
        document.body.appendChild(box);
        document.body.appendChild(opener);

        document.getElementById('nexusHide').onclick = () => setPanelHidden(true);
        opener.onclick = () => setPanelHidden(false);
        document.getElementById('nexusCapture').onclick = () => { try { extractData(); } catch(e) { renderStatus(e.message, true); } };
        document.getElementById('nexusCheck').onclick = async () => { try { await checkRequest(); } catch(e) { renderStatus(e.message, true); } };
        document.getElementById('nexusSend').onclick = async () => { try { renderStatus('Enviando...'); await sendRequest(); } catch(e) { console.error(e); renderStatus(e.message, true); } };
        document.getElementById('nexusRefreshProfiles').onclick = async () => { state.lastRequest = null; await loadProfiles(); await preselectPendingRequest(); };
        document.getElementById('nexusProfile').onchange = () => { state.lastRequest = null; };

        let hidden = false;
        try { hidden = localStorage.getItem(CONFIG.panelHiddenKey) === '1'; } catch (_) {}
        setPanelHidden(hidden);
    }

    function renderStatus(text, error = false) {
        const el = document.getElementById('nexusTmStatus');
        if (el) { el.textContent = text; el.className = error ? 'error' : ''; }
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
    }

    function installStyles() {
        if (document.getElementById('nexusCompraTicketGithubStyles')) return;
        GM_addStyle(`
            #${CONFIG.panelId}{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:350px;padding:14px;border-radius:14px;background:#fff;color:#172033;box-shadow:0 12px 35px rgba(0,0,0,.25);font:13px Arial,sans-serif;transition:opacity .18s ease,transform .18s ease}
            #${CONFIG.panelId}.is-hidden{display:none!important}
            #${CONFIG.panelId} .nexus-head{font-size:15px;margin-bottom:10px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
            #${CONFIG.panelId} .nexus-head strong{display:block}
            #${CONFIG.panelId} .nexus-head small{display:block;margin-top:2px;font-size:10px;color:#64748b;font-weight:700}
            #${CONFIG.panelId} .nexus-hide{padding:5px 8px!important;border-radius:7px!important;background:#f1f5f9!important;color:#526174!important;font-size:11px!important;font-weight:700!important;white-space:nowrap}
            #${CONFIG.panelId} .nexus-hide:hover{background:#e2e8f0!important;color:#172033!important}
            #${CONFIG.openerId}{display:none;position:fixed;right:18px;bottom:18px;z-index:2147483647;border:0;border-radius:999px;padding:10px 13px;background:#7c3aed;color:#fff;box-shadow:0 10px 28px rgba(0,0,0,.25);font:700 12px Arial,sans-serif;cursor:pointer;align-items:center;gap:7px}
            #${CONFIG.openerId}.is-visible{display:flex}
            #${CONFIG.openerId}:hover{filter:brightness(.96);transform:translateY(-1px)}
            #${CONFIG.panelId} label{display:block;font-weight:700;margin-bottom:4px}
            #${CONFIG.panelId} .nexus-profile-row{display:grid;grid-template-columns:1fr 38px;gap:6px;margin-bottom:9px}
            #${CONFIG.panelId} select{box-sizing:border-box;width:100%;padding:9px;border:1px solid #ccd3df;border-radius:8px;background:#fff;color:#172033}
            #${CONFIG.panelId} .nexus-profile-row button{padding:0!important;font-size:19px!important}
            #${CONFIG.panelId} .nexus-actions{display:grid;gap:7px}
            #${CONFIG.panelId} button{border:0;border-radius:8px;padding:9px;cursor:pointer;background:#e8edf5;color:#172033;font-weight:600}
            #${CONFIG.panelId} button.primary{background:#7c3aed;color:#fff}
            #nexusTmStatus{margin-top:10px;padding-top:9px;border-top:1px solid #e5e7eb;color:#526174;line-height:1.35}
            #nexusTmStatus.error{color:#b91c1c}
        `);
        const marker = document.createElement('meta');
        marker.id = 'nexusCompraTicketGithubStyles';
        document.head.appendChild(marker);
    }
})();
