const cheerio = require('cheerio');
const { fetchHtml } = require('./utils');

const getBrands = async () => {
    const res = await fetchHtml('https://www.gsmarena.com/makers.php3');
    if (!res.text) return [];

    const $ = cheerio.load(res.text);
    const json = [];
    const brands = $('table').find('td');

    brands.each((i, el) => {
        const aBlock = $(el).find('a');
        json.push({
            id: aBlock.attr('href').replace('.php', ''),
            name: aBlock.text().replace(' devices', '').replace(/[0-9]/g, ''),
            devices: parseInt($(el).find('span').text().replace(' devices', ''), 10),
        });
    });

    return json;
};

const getNextPage = ($) => {
    const nextPage = $('a.prevnextbutton[title="Next page"]').attr('href');
    if (nextPage) {
        return nextPage.replace('.php', '');
    }
    return false;
};

const getDevices = ($, devicesList) => {
    const devices = [];
    devicesList.each((i, el) => {
        const imgBlock = $(el).find('img');
        devices.push({
            id: $(el).find('a').attr('href').replace('.php', ''),
            name: $(el).find('span').text(),
            img: imgBlock.attr('src'),
            description: imgBlock.attr('title'),
        });
    });

    return devices;
};

const getBrand = async (brand) => {
    let res = await fetchHtml(`https://www.gsmarena.com/${brand}.php`);
    if (!res.text) return [];

    let $ = cheerio.load(res.text);
    let json = [];

    let devices = getDevices($, $('.makers').find('li'));
    json = [...json, ...devices];

    while (getNextPage($)) {
        res = await fetchHtml(`https://www.gsmarena.com/${getNextPage($)}.php`);
        if (!res.text) break;
        $ = cheerio.load(res.text);
        devices = getDevices($, $('.makers').find('li'));
        json = [...json, ...devices];
    }

    return json;
};

/**
 * Extracts comprehensive device specifications
 */
const getDevice = async (device, options = {}) => {
    const url = device.startsWith('http') ? device : `https://www.gsmarena.com/${device}.php`;

    let res = await fetchHtml(url, options.signal, {}, { render: false, useProxy: true });

    if ((!res.text || res.turnstile) && options.allowRender) {
        res = await fetchHtml(url, options.signal, {}, { render: true, useProxy: true });
    }

    if (!res.text) return null;

    const $ = cheerio.load(res.text);
    const specs = {};

    // Extract main image URL robustly
    let img = '';
    const imgElement = $('.specs-photo-main img, #specs-cp-pic img, #specs-cp-main img, img[src*="/bigpic/"]').first();
    if (imgElement.length > 0) {
        img = imgElement.attr('src') || '';
        if (img && !img.startsWith('http')) {
            img = `https://www.gsmarena.com/${img.replace(/^\//, '')}`;
        }
    }

    const name = $('.specs-phone-name-title').text();

    // Extract all spec tables
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

    // Quick specs for backward compatibility
    const quickSpec = [
        { name: 'Display size', value: $('span[data-spec=displaysize-hl]').text() },
        { name: 'Display resolution', value: $('div[data-spec=displayres-hl]').text() },
        { name: 'Camera pixels', value: $('.accent-camera').text() },
        { name: 'Video pixels', value: $('div[data-spec=videopixels-hl]').text() },
        { name: 'RAM size', value: $('.accent-expansion').text() },
        { name: 'Chipset', value: $('div[data-spec=chipset-hl]').text() },
        { name: 'Battery size', value: $('.accent-battery').text() },
        { name: 'Battery type', value: $('div[data-spec=battype-hl]').text() }
    ];

    return {
        name,
        img,
        specifications: specs,
        quickSpec,
        // Keep old detailSpec format for legacy support
        detailSpec: Object.entries(specs).map(([category, specifications]) => ({
            category,
            specifications: Object.entries(specifications).map(([name, value]) => ({ name, value }))
        }))
    };
};

module.exports = {
    getBrands,
    getBrand,
    getDevice,
};
