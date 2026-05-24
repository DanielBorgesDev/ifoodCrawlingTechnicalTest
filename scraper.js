const fs = require('fs');
const path = require('path');
const { addExtra } = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { Cluster } = require('puppeteer-cluster');

const INPUT_FILE = path.join(__dirname, 'ifood_urls_padrao_item_1000.csv');
const OUTPUT_FILE = path.join(__dirname, 'produtos_extraidos.json');
const CONCURRENCY = 5; 

async function runScraper() {
    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`❌ Arquivo não encontrado: ${INPUT_FILE}`);
        return;
    }

    const urls = fs.readFileSync(INPUT_FILE, 'utf-8')
        .split('\n')
        .map(url => url.trim())
        .filter(url => url.startsWith('http'));

    console.log(`Iniciando processamento de ${urls.length} URLs...`);

    const extractedData = [];

    const saveProgress = () => {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(extractedData, null, 2), 'utf-8');
    };

    const puppeteerVanilla = (await import('puppeteer')).default;
    const puppeteer = addExtra(puppeteerVanilla);
    puppeteer.use(StealthPlugin());

    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_CONTEXT, 
        maxConcurrency: CONCURRENCY,
        puppeteer: puppeteer,
        puppeteerOptions: {
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        },
        timeout: 60000, 
    });

    // Tratamento de erros por aba
    cluster.on('taskerror', (err, url) => {
        console.error(`Falha na URL ${url}: ${err.message}`);
        extractedData.push({ url, status: 'error', error: err.message });
        saveProgress(); 
    });

    await cluster.task(async ({ page, data: url }) => {
        await page.setViewport({ width: 1366, height: 768 });
        
        await page.goto(url, { waitUntil: 'networkidle2' });

        const produto = await page.evaluate(() => {
            const tituloEl = document.querySelector('h1');
            const titulo = tituloEl ? tituloEl.innerText.trim() : null;

            const precosEl = Array.from(document.querySelectorAll('span, p'));
            const precoMatch = precosEl.find(el => el.innerText.includes('R$'));
            const preco = precoMatch ? precoMatch.innerText.trim() : null;

            const descEl = document.querySelector('[data-test-id="product-description"], h2 + p');
            const descricao = descEl ? descEl.innerText.trim() : null;

            const imgEl = document.querySelector('img[alt*="Imagem do produto"], div[data-test-id="product-image"] img');
            const imagem = imgEl ? imgEl.src : null;

            return { titulo, descricao, preco, imagem };
        });

        console.log(` Extraído: ${produto.titulo || 'Sem título'} | ${preco}`);
        extractedData.push({ url, status: 'success', ...produto });
        saveProgress(); 
    });

    urls.forEach(url => cluster.queue(url));

    await cluster.idle();
    await cluster.close();

    console.log(`\n Extração concluída! Dados salvos em: ${OUTPUT_FILE}`);
}

runScraper();
