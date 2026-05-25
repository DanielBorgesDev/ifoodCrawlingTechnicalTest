const fs = require('fs');

class FileManager {
    constructor(config) {
        this.config = config;
        this.processedUrls = new Set();
        this.extractedData = [];

        if (!fs.existsSync(this.config.EVIDENCES_DIR)) {
            fs.mkdirSync(this.config.EVIDENCES_DIR);
        }
    }

    loadPreviousProgress() {
        if (fs.existsSync(this.config.OUTPUT_FILE)) {
            try {
                const existingData = JSON.parse(fs.readFileSync(this.config.OUTPUT_FILE, 'utf-8'));
                if (Array.isArray(existingData)) {
                    this.extractedData = existingData;
                    existingData.forEach(item => {
                        if (item.product_url) this.processedUrls.add(item.product_url);
                    });
                    console.log(`Retomando execução: ${this.processedUrls.size} URLs já processadas encontradas.`);
                }
            } catch (e) {
                console.warn('Falha ao ler o arquivo de progresso anterior. Iniciando do zero.');
            }
        }
    }

    getUrlsToProcess() {
        if (!fs.existsSync(this.config.INPUT_FILE)) {
            throw new Error(`Arquivo não encontrado: ${this.config.INPUT_FILE}`);
        }

        return fs.readFileSync(this.config.INPUT_FILE, 'utf-8')
            .split('\n')
            .map(url => url.trim())
            .filter(url => url.startsWith('http') && !this.processedUrls.has(url));
    }

    saveProgress(dataItem) {
        this.extractedData.push(dataItem);
        fs.writeFileSync(this.config.OUTPUT_FILE, JSON.stringify(this.extractedData, null, 2), 'utf-8');
    }
}

module.exports = FileManager;
