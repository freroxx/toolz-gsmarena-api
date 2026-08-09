const cheerio = require('cheerio');

/**
 * Detect Cloudflare Turnstile / anti-bot pages quickly
 */
function isTurnstile(html) {
    if (!html) return false;
    if (typeof html !== 'string') return false;
    if (html.trim().startsWith('{') || html.trim().startsWith('[')) return false;

    const lowered = html.toLowerCase();
    return (
        lowered.includes('cf-turnstile') ||
        lowered.includes('turnstile') ||
        lowered.includes('turnstile-verify') ||
        lowered.includes('one quick check before you continue') ||
        lowered.includes('meta name="turnstile"') ||
        lowered.includes('challenge-form') ||
        lowered.includes('verify you are human') ||
        lowered.includes('cloudflare.com/static/cos/')
    );
}

// User agent rotation for direct fetches
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Calculates remaining time in the global execution budget.
 */
function getRemainingTime(startTime, totalBudget, minBuffer = 500) {
    const elapsed = Date.now() - startTime;
    const remaining = totalBudget - elapsed;
    return Math.max(remaining, minBuffer);
}

/**
 * Centralized fetch tool with integrated proxy support (ScraperAPI)
 */
async function fetchHtml(targetUrl, signal = null, extraHeaders = {}, options = {}) {
    const primaryApiKey = process.env.SCRAPER_API_KEY;
    const backupApiKey = process.env.SCRAPER_API_KEY_1;
    const { render = false, useProxy = true } = options;

    const performFetch = async (apiKey, keyName) => {
        const timeoutMs = options.timeoutMs || (render ? 7000 : 4000);
        let fetchUrl;
        const isProxyActive = apiKey && useProxy;

        if (isProxyActive) {
            console.info(`[Proxy] Fetching ${targetUrl} using ${keyName} (${apiKey.slice(0, 4)}...)`);
            const proxyUrl = new URL('https://api.scraperapi.com/');
            proxyUrl.searchParams.set('api_key', apiKey);
            proxyUrl.searchParams.set('url', targetUrl);

            if (render) {
                proxyUrl.searchParams.set('render', 'true');
                if (process.env.SCRAPER_ULTRA_PREMIUM === 'true') {
                    proxyUrl.searchParams.set('ultra_premium', 'true');
                } else {
                    proxyUrl.searchParams.set('premium', 'true');
                }
            }
            fetchUrl = proxyUrl.toString();
        } else {
            if (useProxy) console.warn(`[Proxy] No API key available for ${keyName}, falling back to direct fetch`);
            fetchUrl = targetUrl;
        }

        const internalController = new AbortController();
        const internalTimeout = setTimeout(() => internalController.abort(), timeoutMs);

        let combinedSignal = internalController.signal;
        if (signal) {
            try {
                if (typeof AbortSignal.any === 'function') {
                    combinedSignal = AbortSignal.any([internalController.signal, signal]);
                } else {
                    signal.addEventListener('abort', () => internalController.abort());
                }
            } catch (e) {
                combinedSignal = signal;
            }
        }

        try {
            const headers = { ...extraHeaders };
            if (!isProxyActive) {
                headers['User-Agent'] = getRandomUserAgent();
                headers['Accept-Language'] = 'en-US,en;q=0.9';
                headers['Referer'] = targetUrl.includes('gsmarena.com') ? 'https://www.gsmarena.com/' : 'https://www.google.com/';
            }

            const response = await fetch(fetchUrl, { headers, signal: combinedSignal });
            const text = await response.text();

            if (!response.ok) {
                return { text, status: response.status, errorBody: text.slice(0, 200) };
            }

            if (isTurnstile(text)) {
                console.warn(`Turnstile detected for ${targetUrl} (Render: ${render}, Proxy: ${isProxyActive})`);
                return { text, status: response.status, turnstile: true };
            }

            return { text, status: response.status };
        } catch (error) {
            if (error.name === 'AbortError') {
                const isGlobal = signal && signal.aborted;
                console.warn(`Fetch aborted (${isGlobal ? 'Global Budget' : 'Local Timeout'}): ${targetUrl}`);
                return { text: null, status: 408, errorBody: isGlobal ? 'Global timeout' : 'Request timeout' };
            }
            console.error(`Network error fetching ${targetUrl}:`, error);
            return { text: null, status: null };
        } finally {
            clearTimeout(internalTimeout);
        }
    };

    const initialKey = primaryApiKey || backupApiKey;
    const initialName = primaryApiKey ? "Primary" : "Backup";
    let result = await performFetch(initialKey, initialName);

    if (result.status === 403 && useProxy) {
        const isPrimaryExhausted = initialName === "Primary";
        if (isPrimaryExhausted && backupApiKey && backupApiKey !== primaryApiKey) {
            console.warn(`[Proxy] Primary key exhausted (403), retrying with Backup key...`);
            result = await performFetch(backupApiKey, "Backup");
        }
    }

    if (result.status && result.status >= 400 && result.status !== 408) {
        console.error(`Fetch failed (${result.status}) for ${targetUrl}. Body: ${result.errorBody || ''}`);
    }

    return result;
}

function generateSmartStrategies(input) {
    const raw = (input || '').trim();
    if (!raw) return [];
    const lower = raw.toLowerCase();
    const strategies = [lower];

    let clean = lower.replace(/[\/:,#]/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean !== lower) strategies.push(clean);

    const splitSquashed = clean.replace(/([a-z])([0-9])/g, '$1 $2').replace(/([0-9])([a-z])/g, '$1 $2');
    if (splitSquashed !== clean) strategies.push(splitSquashed);

    const stripped = lower.replace(/\b(sm-|gt-|sch-|sgh-|sph-)/gi, '');
    if (stripped !== lower) {
        strategies.push(stripped.trim());
        const cleanStripped = stripped.replace(/[\/:,#]/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleanStripped !== stripped) strategies.push(cleanStripped);
    }

    const parts = splitSquashed.split(/\s+/);
    if (parts.length > 1) {
        strategies.push(parts[parts.length - 1]);
        strategies.push(parts.slice(0, -1).join(' '));
    }

    strategies.push(parts.join(''));
    return [...new Set(strategies)].filter(q => q && q.length >= 2);
}

async function getDataFromUrl(url) {
    const fullUrl = url.startsWith('http') ? url : `https://www.gsmarena.com${url.startsWith('/') ? '' : '/'}${url}`;
    const res = await fetchHtml(fullUrl, null, {}, { useProxy: true });
    return res.text || '';
}

exports.fetchHtml = fetchHtml;
exports.generateSmartStrategies = generateSmartStrategies;
exports.isTurnstile = isTurnstile;
exports.getRemainingTime = getRemainingTime;
exports.getDataFromUrl = getDataFromUrl;
exports.getPrice = (text) => {
    const value = text.replace(',', '').split(' ');
    return { currency: value[0], price: parseFloat(value[1]) };
};
