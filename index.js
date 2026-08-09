
const catalog = require('./src/services/catalog');
const deals = require('./src/services/deals');
const glossary = require('./src/services/glossary');
const search = require('./src/services/search');
const top = require('./src/services/top');
const utils = require('./src/services/utils');

module.exports = {
    catalog,
    deals,
    glossary,
    search: search.search,
    discoverDevice: search.discoverDevice,
    top,
    utils,
    // Direct exports for common utilities
    fetchHtml: utils.fetchHtml,
    generateSmartStrategies: utils.generateSmartStrategies,
    isTurnstile: utils.isTurnstile,
    getRemainingTime: utils.getRemainingTime,
};
