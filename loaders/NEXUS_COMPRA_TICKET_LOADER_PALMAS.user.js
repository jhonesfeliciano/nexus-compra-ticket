// ==UserScript==
// @name         NEXUS Compra & Ticket Loader - PALMAS
// @namespace    nexus-compra-ticket-github
// @version      1.0.0
// @description  Carrega do GitHub a versão aprovada do Nexus Compra & Ticket para PALMAS; só ativa na página da grade de Cobranças.
// @author       LM Confecções
// @match        https://sistema.romancemoda.com.br/apex/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      raw.githubusercontent.com
// @connect      acompanhamentos-reta-final-default-rtdb.firebaseio.com
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const CONFIG = {
        channel: 'palmas',
        label: 'PALMAS',
        branch: 'main',
        repo: 'jhonesfeliciano/nexus-compra-ticket',
        cacheStorageKey: 'nexusCompraTicketLoaderCache_palmas',
        timeoutMs: 30000,
        waitTargetMs: 120000,
        minCodeBytes: 4000
    };
    let loaded = false;


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


    registerMenus();
    waitForTargetPage(CONFIG.waitTargetMs).then(found => {
        if (!found) {
            console.info(`[NEXUS Compra & Ticket Loader/${CONFIG.label}] Grade de Cobranças não detectada; loader permaneceu inativo nesta página.`);
            return;
        }
        return bootstrap();
    }).catch(error => console.error(`[NEXUS Compra & Ticket Loader/${CONFIG.label}]`, error));

    function waitForTargetPage(timeoutMs) {
        if (isTargetReportPage()) return Promise.resolve(true);
        return new Promise(resolve => {
            const started = Date.now();
            const timer = setInterval(() => {
                if (isTargetReportPage()) { clearInterval(timer); resolve(true); }
                else if (Date.now() - started >= timeoutMs) { clearInterval(timer); resolve(false); }
            }, 700);
        });
    }

    async function bootstrap() {
        if (loaded) return;
        loaded = true;
        const previousCache = GM_getValue(CONFIG.cacheStorageKey, null);
        try {
            const base = `https://raw.githubusercontent.com/${CONFIG.repo}/${CONFIG.branch}`;
            const manifest = await requestJson(`${base}/manifest.json?ts=${Date.now()}`);
            const release = manifest?.channels?.[CONFIG.channel];
            validateRelease(release);
            const code = await requestText(`${base}/${String(release.path).replace(/^\/+/, '')}?ts=${Date.now()}`);
            validateCode(code);
            const expected = String(release.sha256 || '').toLowerCase();
            if (expected) {
                const actual = await sha256(code);
                if (actual && actual !== expected) throw new Error('SHA-256 diferente do manifest.json.');
            }
            executeCode(code, `nexus-compra-ticket-${CONFIG.channel}-${release.version}.js`);
            GM_setValue(CONFIG.cacheStorageKey, { version: release.version, path: release.path, sha256: release.sha256 || '', code, savedAt: Date.now() });
            console.info(`[NEXUS Compra & Ticket Loader/${CONFIG.label}] Versão ${release.version} carregada do GitHub e salva no cache.`);
        } catch (remoteError) {
            console.warn(`[NEXUS Compra & Ticket Loader/${CONFIG.label}] Falha no GitHub; tentando cache local.`, remoteError);
            if (previousCache?.code) {
                try { validateCode(previousCache.code); executeCode(previousCache.code, `nexus-compra-ticket-${CONFIG.channel}-cache.js`); return; }
                catch (cacheError) { console.error(cacheError); }
            }
            loaded = false;
            window.alert(`NEXUS Compra & Ticket ${CONFIG.label}: não foi possível carregar o GitHub e não existe cache funcional.\n\n${remoteError.message || remoteError}`);
        }
    }

    function validateRelease(release) {
        if (!release || !release.version || !release.path) throw new Error(`Canal ${CONFIG.channel} não encontrado ou incompleto no manifest.json.`);
    }
    function validateCode(code) {
        if (typeof code !== 'string' || code.length < CONFIG.minCodeBytes) throw new Error('Código remoto vazio ou muito pequeno.');
        new Function('GM_getValue','GM_setValue','GM_deleteValue','GM_xmlhttpRequest','GM_registerMenuCommand','GM_addStyle', code);
    }
    function executeCode(code, sourceName) {
        const runner = new Function('GM_getValue','GM_setValue','GM_deleteValue','GM_xmlhttpRequest','GM_registerMenuCommand','GM_addStyle', `${code}\n//# sourceURL=${sourceName}`);
        runner(GM_getValue, GM_setValue, GM_deleteValue, GM_xmlhttpRequest, GM_registerMenuCommand, GM_addStyle);
    }
    function requestText(url) {
        return new Promise((resolve, reject) => GM_xmlhttpRequest({
            method:'GET', url, timeout:CONFIG.timeoutMs, headers:{'Cache-Control':'no-cache'},
            onload:r => r.status >= 200 && r.status < 300 ? resolve(String(r.responseText || '')) : reject(new Error(`GitHub HTTP ${r.status}`)),
            onerror:() => reject(new Error('Falha de rede ao acessar o GitHub.')),
            ontimeout:() => reject(new Error('Tempo esgotado ao acessar o GitHub.'))
        }));
    }
    async function requestJson(url) { const text = await requestText(url); try { return JSON.parse(text); } catch { throw new Error('manifest.json inválido.'); } }
    async function sha256(text) {
        try {
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
            return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
        } catch { return ''; }
    }
    function registerMenus() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        GM_registerMenuCommand(`Ver versão/cache - Compra & Ticket ${CONFIG.label}`, () => {
            const c = GM_getValue(CONFIG.cacheStorageKey, null);
            window.alert(`Repositório: ${CONFIG.repo}\nCanal: ${CONFIG.label}\nCache: ${c?.version || 'nenhum'}\nSalvo: ${c?.savedAt ? new Date(c.savedAt).toLocaleString('pt-BR') : '—'}`);
        });
        GM_registerMenuCommand(`Limpar cache - Compra & Ticket ${CONFIG.label}`, () => {
            if (window.confirm('Limpar o cache local deste loader?')) GM_deleteValue(CONFIG.cacheStorageKey);
        });
    }
})();
