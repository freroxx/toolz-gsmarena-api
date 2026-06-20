const cheerio = require('cheerio');
const { getDataFromUrl } = require('./utils');

const search = async (searchValue) => {
    // Use URLSearchParams to properly encode the search query
    const params = new URLSearchParams();
    params.append('sQuickSearch', 'yes');
    params.append('sName', searchValue);
    
    const html = await getDataFromUrl(`/results.php3?${params.toString()}`);

    const $ = cheerio.load(html);
    const json = [];

    const devices = $('.makers').find('li');
    devices.each((i, el) => {
        const imgBlock = $(el).find('img');
        json.push({
            id: $(el).find('a').attr('href').replace('.php', ''),
            name: $(el).find('span').html().split('<br>')
                .join(' '),
            img: imgBlock.attr('src'),
            description: imgBlock.attr('title'),
        });
    });

    return json;
};

module.exports = {
    search,
};
