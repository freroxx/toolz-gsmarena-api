import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';

// Detect Cloudflare Turnstile / anti-bot pages quickly
function isTurnstile(html: string): boolean {
  if (!html) return false;
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

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRemainingTime(startTime: number, totalBudget: number, minBuffer: number = 500): number {
  const elapsed = Date.now() - startTime;
  const remaining = totalBudget - elapsed;
  return Math.max(remaining, minBuffer);
}

async function fetchHtml(
  targetUrl: string,
  signal?: AbortSignal,
  extraHeaders: Record<string, string> = {},
  options: { render?: boolean; timeoutMs?: number; useProxy?: boolean } = {}
): Promise<{ text: string | null; status: number | null; errorBody?: string; turnstile?: boolean }> {
  const apiKey = process.env.SCRAPER_API_KEY;
  const { render = false, useProxy = true } = options;
  const timeoutMs = options.timeoutMs || (render ? 7000 : 4000);

  let fetchUrl: string;
  const isProxyActive = apiKey && useProxy;

  if (isProxyActive) {
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
    fetchUrl = targetUrl;
  }

  const internalController = new AbortController();
  const internalTimeout = setTimeout(() => internalController.abort(), timeoutMs);

  let combinedSignal: AbortSignal = internalController.signal;
  if (signal) {
    // @ts-ignore
    if (typeof AbortSignal.any === 'function') {
      combinedSignal = AbortSignal.any([internalController.signal, signal]);
    } else {
      signal.addEventListener('abort', () => internalController.abort());
    }
  }

  try {
    const headers: Record<string, string> = { ...extraHeaders };
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
      return { text, status: response.status, turnstile: true };
    }

    return { text, status: response.status };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { text: null, status: 408, errorBody: signal?.aborted ? 'Global timeout' : 'Request timeout' };
    }
    return { text: null, status: null };
  } finally {
    clearTimeout(internalTimeout);
  }
}

async function scrapeGsmArenaSearch(query: string, signal?: AbortSignal, startTime?: number, totalBudget: number = 9600) {
  const searchUrl = `https://www.gsmarena.com/results.php3?sQuickSearch=yes&sName=${encodeURIComponent(query)}`;

  let result = await fetchHtml(searchUrl, signal, {}, { render: false, timeoutMs: 5000, useProxy: true });

  if (result.turnstile && startTime) {
    const remaining = getRemainingTime(startTime, totalBudget);
    if (remaining > 6000) {
      result = await fetchHtml(searchUrl, signal, {}, { render: true, timeoutMs: remaining - 500, useProxy: true });
    }
  }

  if (result.turnstile || !result.text) return null;

  const $ = cheerio.load(result.text);
  if ($('#specs-list').length > 0) {
    const canonical = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content');
    if (canonical) {
      return canonical.startsWith('http') ? canonical : `https://www.gsmarena.com/${String(canonical).replace(/^\//, '')}`;
    }
    return searchUrl;
  }

  let firstDeviceLink = $('.makers ul li a').first().attr('href') || $('.makers a').first().attr('href');
  if (firstDeviceLink) {
    return `https://www.gsmarena.com/${String(firstDeviceLink).replace(/^\//, '')}`;
  }

  return null;
}

async function scrapeDeviceSpecs(url: string, signal?: AbortSignal, options: { render?: boolean; timeoutMs?: number } = { render: false }) {
  const { render = false } = options;
  const { text: html, turnstile } = await fetchHtml(url, signal, {}, {
    render,
    timeoutMs: options.timeoutMs || (render ? 7000 : 4000)
  });

  if (turnstile || !html) return null;

  const $ = cheerio.load(html);
  const specs: Record<string, Record<string, string>> = {};

  $('#specs-list table').each((_, table) => {
    const sectionName = $(table).find('th').text().trim();
    if (!sectionName) return;

    specs[sectionName] = {};
    $(table).find('tr').each((_, tr) => {
      const key = $(tr).find('.ttl').text().trim();
      const value = $(tr).find('.nfo').text().trim();
      if (key && value) {
        specs[sectionName][key] = value;
      }
    });
  });

  return Object.keys(specs).length > 0 ? specs : null;
}

function generateSmartStrategies(input: string): string[] {
  const lower = input.toLowerCase().trim();
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();
  const totalBudget = 9600;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), totalBudget);

  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    const raw = String(req.query.model || '').trim();
    if (!raw) return res.status(400).json({ error: "Missing 'model' query parameter" });

    const strategies = generateSmartStrategies(raw).slice(0, 3);
    const tried: any[] = [];
    let targetDeviceUrl: string | null = null;

    // Phase 1: Direct Search
    for (const q of strategies) {
      console.info(`[Phase 1] Searching for ${q}...`);
      const url = await scrapeGsmArenaSearch(q, controller.signal, startTime, totalBudget);
      tried.push({ query: q, matchedUrl: url });
      if (url) {
        targetDeviceUrl = url;
        break;
      }
      if (getRemainingTime(startTime, totalBudget) < 3000) break;
    }

    // Phase 2: Fallback External Search
    if (!targetDeviceUrl && getRemainingTime(startTime, totalBudget) > 4000) {
      console.info(`[Phase 2] External discovery for ${raw}...`);
      const ddgUrl = new URL('https://html.duckduckgo.com/html/');
      ddgUrl.searchParams.set('q', `site:gsmarena.com ${raw}`);
      const { text: ddgHtml } = await fetchHtml(ddgUrl.toString(), controller.signal, {}, { useProxy: false });

      if (ddgHtml) {
        const $ddg = cheerio.load(ddgHtml);
        const discoveredLinks: string[] = [];
        $ddg('a').each((_, el) => {
          let href = $ddg(el).attr('href');
          if (href && href.includes('gsmarena.com/')) {
            if (href.includes('uddg=')) {
              try { href = new URLSearchParams(href.split('?')[1]).get('uddg') || href; } catch (e) {}
            }
            if (href.includes('.php') && !/results|search|compare|glossary|blog/i.test(href)) {
              discoveredLinks.push(href.startsWith('http') ? href : `https://www.gsmarena.com/${href.replace(/^\//, '')}`);
            }
          }
        });
        if (discoveredLinks.length > 0) {
          targetDeviceUrl = discoveredLinks[0];
          tried.push({ query: raw, engine: 'duckduckgo', matchedUrl: targetDeviceUrl });
        }
      }
    }

    if (targetDeviceUrl) {
      const specs = await scrapeDeviceSpecs(targetDeviceUrl, controller.signal);
      if (specs) {
        return res.status(200).json({ source_url: targetDeviceUrl, specifications: specs, timing_ms: Date.now() - startTime });
      }
    }

    return res.status(404).json({ error: `No match for '${raw}'`, tried, timing_ms: Date.now() - startTime });
  } catch (error) {
    console.error("Critical error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  } finally {
    clearTimeout(timeoutId);
  }
}
