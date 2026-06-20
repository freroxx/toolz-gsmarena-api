// api/specs.js
// Minimal, robust CommonJS handler for Vercel that returns JSON and surfaces errors.

const cheerio = require('cheerio');

async function fetchHtml(targetUrl) {
  try {
    const apiKey = process.env.SCRAPER_API_KEY;
    let fetchUrl = targetUrl;
    if (apiKey) {
      const proxyUrl = new URL('https://api.scraperapi.com/');
      proxyUrl.searchParams.set('api_key', apiKey);
      proxyUrl.searchParams.set('url', targetUrl);
      fetchUrl = proxyUrl.toString();
    }

    if (typeof fetch !== 'function') {
      // Node <18 fallback is not included — Vercel uses Node 18+, but this is safer
      throw new Error('global fetch is not available in this runtime. Use Node 18+ or add a fetch polyfill.');
    }

    const r = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/'
      },
      method: 'GET'
    });

    const text = await r.text();
    return { text, status: r.status };
  } catch (err) {
    return { text: null, status: null, error: String(err) };
  }
}

function generateStrategies(input) {
  let clean = (input || '').toLowerCase().trim().replace(/\b(sm-|gt-|sch-|sgh-|sph-)/gi, '');
  clean = clean.replace(/[\/:,#]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const strategies = [clean, parts.join('')];
  if (parts.length > 1) {
    strategies.push(parts[parts.length - 1]);
    strategies.push(parts.slice(0, -1).join(' '));
  }
  const last = parts[parts.length - 1] || '';
  const base = last.match(/[a-z]{1,2}\d{2}/i);
  if (base) strategies.push(base[0]);
  if (clean.includes('pixel') && !clean.includes('google')) strategies.unshift(`google ${clean}`);
  if (clean.includes('galaxy') && !clean.includes('samsung')) strategies.unshift(`samsung ${clean}`);
  return Array.from(new Set(strategies)).filter(s => s && s.length >= 2);
}

async function scrapeSearchForUrl(q) {
  const searchUrl = 'https://www.gsmarena.com/results.php3?sQuickSearch=yes&sName=' + encodeURIComponent(q);
  const { text, status, error } = await fetchHtml(searchUrl);
  if (!text) return { url: null, status, error };

  const lowered = text.toLowerCase();
  if (lowered.includes('cf-turnstile') || lowered.includes('turnstile') || lowered.includes('turnstile-verify')) {
    return { url: null, status, blocked: true, body_length: text.length };
  }

  const $ = cheerio.load(text);
  if ($('#specs-list').length > 0) {
    const canonical = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content');
    if (canonical) {
      return { url: canonical.startsWith('http') ? canonical : `https://www.gsmarena.com/${String(canonical).replace(/^\\//, '')}`, status, body_length: text.length };
    }
    return { url: searchUrl, status, body_length: text.length };
  }

  let first = $('.makers ul li a').first().attr('href') || $('.makers a').first().attr('href');
  if (first) return { url: `https://www.gsmarena.com/${String(first).replace(/^\\//, '')}`, status, body_length: text.length };

  return { url: null, status, body_length: text.length };
}

async function scrapeSpecs(url) {
  const { text, status } = await fetchHtml(url);
  if (!text) return { specs: null, status, error: 'no body' };
  if (text.toLowerCase().includes('cf-turnstile')) return { specs: null, blocked: true };

  const $ = cheerio.load(text);
  const specs = {};
  $('#specs-list table').each((i, table) => {
    const section = $(table).find('th').text().trim();
    if (!section) return;
    specs[section] = {};
    $(table).find('tr').each((_, tr) => {
      const key = $(tr).find('.ttl').text().trim();
      const value = $(tr).find('.nfo').text().trim();
      if (key && value) specs[section][key] = value;
    });
  });

  return { specs: Object.keys(specs).length ? specs : null, status };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    const raw = String(req.query.model || '').trim();
    if (!raw) return res.status(400).json({ error: "Missing 'model' query param" });

    const strategies = generateStrategies(raw);
    const tried = [];

    for (const s of strategies) {
      const search = await scrapeSearchForUrl(s);
      tried.push(Object.assign({ strategy: s }, search));
      if (search.blocked) {
        // If Turnstile detected, inform caller
        return res.status(502).json({ error: 'Blocked by Cloudflare Turnstile', strategy: s, details: search });
      }
      if (search.url) {
        const { specs, status, blocked } = await scrapeSpecs(search.url);
        if (blocked) {
          return res.status(502).json({ error: 'Product page blocked by Turnstile', source_url: search.url });
        }
        if (specs) return res.status(200).json({ source_url: search.url, specifications: specs });
        return res.status(502).json({ error: 'Failed to extract specs from product page', source_url: search.url });
      }
    }

    return res.status(404).json({ error: `No match for '${raw}'`, tried });
  } catch (err) {
    console.error('Unhandled error in /api/specs:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'handler_exception', message: String(err), stack: err && err.stack ? String(err.stack).split('\n').slice(0,10) : undefined });
  }
};
