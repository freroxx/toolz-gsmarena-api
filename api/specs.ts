// api/specs.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';

// Centralized fetch tool with optional proxy (api.scraperapi.com)
async function fetchHtml(targetUrl: string): Promise<{ text: string | null; status: number | null; errorBody?: string }> {
  const apiKey = process.env.SCRAPER_API_KEY;
  let fetchUrl = targetUrl;
  if (apiKey) {
    const proxyUrl = new URL('https://api.scraperapi.com/');
    proxyUrl.searchParams.set('api_key', apiKey);
    proxyUrl.searchParams.set('url', targetUrl);
    // render/premium/ultra_premium are paid-tier features — ScraperAPI 403s the
    // whole request if your plan doesn't include them. Opt in via env vars so a
    // free-plan key doesn't get rejected outright.
    if (process.env.SCRAPER_RENDER === 'true') proxyUrl.searchParams.set('render', 'true');
    if (process.env.SCRAPER_ULTRA_PREMIUM === 'true') proxyUrl.searchParams.set('ultra_premium', 'true');
    else if (process.env.SCRAPER_PREMIUM === 'true') proxyUrl.searchParams.set('premium', 'true');
    fetchUrl = proxyUrl.toString();
  }

  try {
    const response = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/'
      }
    });
    const text = await response.text();
    if (!response.ok) {
      console.error(`Fetch failed with status ${response.status} for ${targetUrl}. Body: ${text.slice(0, 500)}`);
      return { text: null, status: response.status, errorBody: text.slice(0, 500) };
    }
    return { text, status: response.status };
  } catch (e) {
    console.error('Network error fetching', targetUrl, e);
    return { text: null, status: null };
  }
}

async function scrapeGsmArenaSearch(query: string): Promise<string | null> {
  const searchUrl = new URL('https://www.gsmarena.com/results.php3');
  searchUrl.searchParams.set('sQuickSearch', 'yes');
  searchUrl.searchParams.set('sName', query);

  const { text: html } = await fetchHtml(searchUrl.toString());
  if (!html) return null;

  const lowered = html.toLowerCase();
  // If we hit Turnstile or anti-bot, return null so the caller can handle it
  if (lowered.includes('cf-turnstile') || lowered.includes('turnstile') || lowered.includes('turnstile-verify')) {
    return null;
  }

  const $ = cheerio.load(html);
  // If GSMArena redirected to product page (spec table present), prefer canonical
  if ($('#specs-list').length > 0) {
    const canonical = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content');
    if (canonical) return canonical.startsWith('http') ? canonical : `https://www.gsmarena.com/${String(canonical).replace(/^\\//, '')}`;
    return searchUrl.toString();
  }

  // Normal listing page: pick the first device link
  let firstDeviceLink = $('.makers ul li a').first().attr('href') || $('.makers a').first().attr('href');
  if (firstDeviceLink) return `https://www.gsmarena.com/${String(firstDeviceLink).replace(/^\\//, '')}`;

  return null;
}

async function scrapeDeviceSpecs(url: string) {
  const { text: html } = await fetchHtml(url);
  if (!html) return null;

  // If Turnstile appears on the product page, bail (caller must handle)
  if (html.toLowerCase().includes('cf-turnstile') || html.toLowerCase().includes('turnstile')) return null;

  const $ = cheerio.load(html);
  const specs: Record<string, Record<string, string>> = {};

  $('#specs-list table').each((_, table) => {
    const section = $(table).find('th').text().trim();
    if (!section) return;
    specs[section] = {};
    $(table)
      .find('tr')
      .each((_, tr) => {
        const key = $(tr).find('.ttl').text().trim();
        const value = $(tr).find('.nfo').text().trim();
        if (key && value) specs[section][key] = value;
      });
  });

  return Object.keys(specs).length > 0 ? specs : null;
}

function generateStrategies(input: string): string[] {
  let clean = input.toLowerCase().trim().replace(/\b(sm-|gt-|sch-|sgh-|sph-)/gi, '');
  clean = clean.replace(/[\/:,#]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = clean.split(/\s+/);
  const strategies = [clean, parts.join('')];
  if (parts.length > 1) {
    strategies.push(parts[parts.length - 1]);
    strategies.push(parts.slice(0, -1).join(' '));
  }
  const last = parts[parts.length - 1];
  const base = last.match(/[a-z]{1,2}\d{2}/i);
  if (base) strategies.push(base[0]);
  // brand hints
  if (clean.includes('pixel') && !clean.includes('google')) strategies.unshift(`google ${clean}`);
  if (clean.includes('galaxy') && !clean.includes('samsung')) strategies.unshift(`samsung ${clean}`);
  return [...new Set(strategies)].filter(s => s && s.length >= 2);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const raw = String(req.query.model || '').trim();
  if (!raw) return res.status(400).json({ error: "Missing 'model' query parameter" });

  const strategies = generateStrategies(raw);
  const tried: any[] = [];

  for (const q of strategies) {
    const url = await scrapeGsmArenaSearch(q);
    tried.push({ query: q, matchedUrl: url });
    if (url) {
      const specs = await scrapeDeviceSpecs(url);
      if (specs) {
        return res.status(200).json({ source_url: url, specifications: specs });
      }
      // If product page returned but no specs (or Turnstile), return what we have or continue
      return res.status(502).json({ error: 'Failed to extract specs from matched product page', source_url: url });
    }
  }

  // Nothing matched
  return res.status(404).json({ error: `No match for '${raw}'`, tried });
}
