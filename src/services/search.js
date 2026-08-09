const cheerio = require('cheerio');
const { fetchHtml, generateSmartStrategies, getRemainingTime } = require('./utils');

/**
 * Robust device discovery using multiple phases
 */
const discoverDevice = async (query, signal = null, options = {}) => {
    const startTime = options.startTime || Date.now();
    const totalBudget = options.totalBudget || 9500;

    const strategies = generateSmartStrategies(query);
    let matchedUrl = null;
    let suggestImage = '';
    let sawTurnstile = false;

    // Phase 1: Suggest API — try direct first (fast, low-cost), then proxy as fallback
    const suggestResults = await Promise.all(
        strategies.slice(0, 3).map(async (q) => {
            const suggestUrl = `https://www.gsmarena.com/suggest.php3?sSearch=${encodeURIComponent(q)}`;

            // Attempt direct (no proxy) — fast & cheap, works when not rate-limited
            let res = await fetchHtml(suggestUrl, signal, {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://www.gsmarena.com/'
            }, { render: false, timeoutMs: 2500, useProxy: false });

            // If direct is blocked by Turnstile, fall back to proxy
            if (res.turnstile || (!res.text && res.status && res.status >= 400)) {
                console.info(`[discoverDevice] Suggest direct blocked (${res.status}), retrying via proxy for: ${q}`);
                res = await fetchHtml(suggestUrl, signal, {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': 'https://www.gsmarena.com/'
                }, { render: false, timeoutMs: 3000, useProxy: true });
            }

            if (res.turnstile) return { turnstile: true };
            if (!res.text) return null;

            try {
                const data = JSON.parse(res.text);
                if (Array.isArray(data) && data.length > 0) {
                    const first = data[0];
                    const id = first.id || first.u;
                    const image = first.image || first.i;
                    const name = first.text || first.n;
                    if (id) {
                        return {
                            matchedUrl: id.startsWith('http') ? id : `https://www.gsmarena.com/${String(id).replace(/^\//, '').replace(/\.php$/, '')}.php`,
                            image: image ? `https://fdn2.gsmarena.com/vv/bigpic/${image}` : '',
                            name: name || ''
                        };
                    }
                }
            } catch (e) {}
            return null;
        })
    );

    for (const res of suggestResults) {
        if (res?.turnstile) sawTurnstile = true;
        if (res?.matchedUrl) {
            matchedUrl = res.matchedUrl;
            if (res.image) suggestImage = res.image;
            break;
        }
    }

    // Phase 2: Direct Search (via proxy to avoid Cloudflare)
    if (!matchedUrl && !signal?.aborted) {
        if (getRemainingTime(startTime, totalBudget) > 4000) {
            for (const q of strategies.slice(0, 2)) {
                const searchUrl = `https://www.gsmarena.com/results.php3?sQuickSearch=yes&sName=${encodeURIComponent(q)}`;
                let res = await fetchHtml(searchUrl, signal, {}, { render: false, timeoutMs: 4000, useProxy: true });

                if (res.turnstile) {
                    sawTurnstile = true;
                    // Always escalate to render on Turnstile if budget allows (lowered threshold: 4500 ms)
                    if (getRemainingTime(startTime, totalBudget) > 4500) {
                        console.info(`[discoverDevice] Turnstile on search, escalating to render for: ${q}`);
                        res = await fetchHtml(searchUrl, signal, {}, { render: true, timeoutMs: getRemainingTime(startTime, totalBudget) - 500, useProxy: true });
                    }
                }

                if (res.text && !res.turnstile) {
                    const $ = cheerio.load(res.text);
                    if ($('#specs-list').length > 0) {
                        matchedUrl = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content') || searchUrl;
                        break;
                    }
                    const firstLink = $('.makers ul li a').first().attr('href') || $('.makers a').first().attr('href');
                    if (firstLink) {
                        matchedUrl = `https://www.gsmarena.com/${String(firstLink).replace(/^\//, '')}`;
                        break;
                    }
                }
                if (getRemainingTime(startTime, totalBudget) < 3000) break;
                // Small back-off between strategy attempts to avoid thundering-herd
                await new Promise(r => setTimeout(r, 300));
            }
        }
    }

    // Phase 3: External discovery
    if (!matchedUrl && !signal?.aborted) {
        if (getRemainingTime(startTime, totalBudget) > 5500) {
            const engines = [
                { name: 'Google', url: `https://www.google.com/search?q=site:gsmarena.com+${encodeURIComponent(query)}` },
                { name: 'DuckDuckGo', url: `https://html.duckduckgo.com/html/?q=site:gsmarena.com+${encodeURIComponent(query)}` }
            ];

            const discoveryResults = await Promise.all(engines.map(async (engine) => {
                const res = await fetchHtml(engine.url, signal, {}, { render: false, timeoutMs: 3000 });
                if (res.turnstile) return { turnstile: true };
                if (!res.text) return null;
                const $ = cheerio.load(res.text);
                let link = null;
                $('a').each((_, el) => {
                    let href = $(el).attr('href');
                    if (!href || link) return;
                    try {
                        if (href.includes('uddg=')) {
                            const urlObj = new URL(href.startsWith('http') ? href : `https://duckduckgo.com${href}`);
                            href = urlObj.searchParams.get('uddg') || href;
                        } else if (href.startsWith('/url?q=')) {
                            const urlObj = new URL(href, 'https://www.google.com');
                            href = urlObj.searchParams.get('q') || href;
                        }
                    } catch (e) {}
                    if (href.includes('gsmarena.com/') && href.includes('.php') && !/results|search|compare|glossary|blog/i.test(href)) {
                        link = href.startsWith('http') ? href : `https://www.gsmarena.com/${href.replace(/^\//, '')}`;
                    }
                });
                return link ? { matchedUrl: link } : null;
            }));

            for (const res of discoveryResults) {
                if (res?.turnstile) sawTurnstile = true;
                if (res?.matchedUrl) {
                    matchedUrl = res.matchedUrl;
                    break;
                }
            }
        }
    }

    return { matchedUrl, suggestImage, turnstile: sawTurnstile };
};

const search = async (searchValue) => {
    const { matchedUrl } = await discoverDevice(searchValue);
    if (!matchedUrl) return [];
    const res = await fetchHtml(matchedUrl, null, {}, { useProxy: true });
    if (!res.text) return [];
    const $ = cheerio.load(res.text);
    if ($('#specs-list').length > 0) {
        const name = $('.specs-phone-name-title').text();
        const img = $('.specs-photo-main img').attr('src');
        return [{ id: matchedUrl.split('/').pop().replace('.php', ''), name, img, description: name }];
    }
    const json = [];
    $('.makers').find('li').each((i, el) => {
        const imgBlock = $(el).find('img');
        json.push({
            id: $(el).find('a').attr('href').replace('.php', ''),
            name: $(el).find('span').html().split('<br>').join(' '),
            img: imgBlock.attr('src'),
            description: imgBlock.attr('title'),
        });
    });
    return json;
};

module.exports = { search, discoverDevice };
