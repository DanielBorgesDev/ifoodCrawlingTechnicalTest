const path = require('path');

module.exports = {
    INPUT_FILE: path.join(__dirname, '..', 'ifood_urls_padrao_item_1000.csv'),
    OUTPUT_FILE: path.join(__dirname, '..', 'produtos_extraidos.json'),
    EVIDENCES_DIR: path.join(__dirname, '..', 'evidences'),
    CONCURRENCY: 5,
    RETRY_LIMIT: 2,
    RETRY_DELAY: 2000,
    TIMEOUT: 45000,
    PAGE_TIMEOUT: 30000,
};
