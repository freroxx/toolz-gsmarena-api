# GSMArena API (gsmarena.com) — fork for Toolz Device Info

Parse GSMArena and return phone data as JSON. This repository is a maintained fork intended for integration with the Toolz Device Info tool — it preserves the original functionality while applying small fixes and improvements (see Changes / Changelog).

Works on Node.js and scrapes GSM Arena pages using axios + cheerio.

## Highlights / Implemented features

- [x] Get all brands
- [x] Get devices by brand (handles pagination)
- [x] Get device specification (quick specs + full detail table)
- [x] Find devices by keyword (search)
- [x] Top devices / rankings
- [x] Hot deals
- [x] Glossary list
- [x] Glossary detail (term content)
- [ ] Advanced filtering (planned)
- [ ] News / Reviews (planned)

Notable fix in this fork:
- Search queries are URL-encoded properly (uses URLSearchParams) to avoid broken or truncated searches for special characters.

## Installation

From npm:
```bash
npm install gsmarena-api
```

Or install directly from this GitHub fork:
```bash
npm install freroxx/toolz-gsmarena-api
```

Dependencies: axios, cheerio

## Quick start (usage)

Require the package and call the exported service modules. All methods are async and return plain JSON objects/arrays.

Import:
```js
const gsmarena = require('gsmarena-api');
```

Catalog — brands:
```js
const brands = await gsmarena.catalog.getBrands();
console.log(brands);
// [
//   { id: 'apple-phones-48', name: 'Apple', devices: 98 },
//   ...
// ]
```

Catalog — devices for a brand:
```js
const devices = await gsmarena.catalog.getBrand('apple-phones-48');
console.log(devices);
// [
//   { id: 'apple_iphone_13_pro_max-11089', name: 'iPhone 13 Pro Max', img: '...', description: '...' },
//   ...
// ]
```

Catalog — device detail:
```js
const device = await gsmarena.catalog.getDevice('apple_iphone_13_pro_max-11089');
console.log(device);
// {
//   name: 'Apple iPhone 13 Pro Max',
//   img: 'https://...',
//   quickSpec: [{ name: 'Display size', value: '6.7"' }, ...],
//   detailSpec: [{ category: 'Network', specifications: [{ name: 'Technology', value: 'GSM / ...' }, ...] }, ...]
// }
```

Search:
```js
const results = await gsmarena.search.search('casio');
console.log(results);
// [
//   { id: 'casio_g_zone_ca_201l-5384', name: "Casio G'zOne CA-201L", img: '...', description: '...' },
//   ...
// ]
```

Top / Rankings:
```js
const top = await gsmarena.top.get();
console.log(top);
// [
//   { category: 'Top 10 by daily interest', list: [{ position: 1, id: 'xiaomi_12-11285', name: 'Xiaomi 12', dailyHits: 50330 }, ...] },
//   ...
// ]
```

Deals:
```js
const deals = await gsmarena.deals.getDeals();
console.log(deals);
// [
//   { id: 'oneplus_9-10747', img: '...', url: '...', name: 'OnePlus 9', deal: { memory: '128GB', price: 449.00, currency: '£', discount: 24.6 }, history: [...] },
//   ...
// ]
```

Glossary:
```js
const glossary = await gsmarena.glossary.get();
console.log(glossary);
// [{ letter: 'X', list: [{ id: 'xenon-flash', name: 'Xenon flash' }, ...] }, ...]
```

Glossary term:
```js
const term = await gsmarena.glossary.getTerm('xenon-flash');
console.log(term);
// { title: 'Xenon flash - definition', html: '<p>...</p>' }
```

## API surface

Exported modules (top-level export from index.js):
- gsmarena.catalog
  - getBrands()
  - getBrand(brandId)
  - getDevice(deviceId)
- gsmarena.search
  - search(query)
- gsmarena.top
  - get()
- gsmarena.deals
  - getDeals()
- gsmarena.glossary
  - get()
  - getTerm(termId)

All functions are async and return parsed JSON-friendly structures.

## Contributing

This fork focuses on reliability for Toolz integration. Contributions are welcome — please open issues or PRs for:
- Robustness improvements (selectors, error handling, retries)
- TypeScript typings or a TypeScript rewrite
- Tests and CI
- Support for additional GSM Arena pages (news, reviews, filters)

When contributing, keep scraping behaviour polite: implement caching, rate limiting, and respect the target site's robots and usage policies.

## License & credits

MIT License.

This project is originally authored by Kirill Potapenko (kirill.potap97@gmail.com). This repository is a fork maintained by freroxx for the Toolz Device Info tool and may include fixes and improvements over the original upstream project.

Contact / Maintainer: freroxx (GitHub)
