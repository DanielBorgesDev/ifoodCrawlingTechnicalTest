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
        console.error(`Arquivo não encontrado: ${INPUT_FILE}`);
        return;
    }

    const urls = fs.readFileSync(INPUT_FILE, 'utf-8')
        .split('\n')
        .map(url => url.trim())
        .filter(url => url.startsWith('http'));

    console.log(`Iniciando processamento de ${urls.length} URLs...`);

    const extractedData = [];
    let processedCount = 0;
    let successCount = 0;
    const totalUrls = urls.length;

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

    cluster.on('taskerror', (err, url) => {
        processedCount++;
        const percent = ((processedCount / totalUrls) * 100).toFixed(1);
        console.error(`[${processedCount}/${totalUrls}] (${percent}%) Erro: ${err.message}`);
        extractedData.push({
            title: null,
            normal_price: null,
            discount_price: null,
            product_url: url,
            image_url: null,
            status: 'error',
            error_message: err.message
        });
        saveProgress(); 
    });

    await cluster.task(async ({ page, data: url }) => {
        await page.setViewport({ width: 1366, height: 768 });
        
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            
            await page.waitForFunction(() => {
                const modal = document.querySelector('[role="dialog"]');
                const title = document.querySelector('[data-test-id="product-detail-name"]');
                const text = document.body.innerText.toLowerCase();
                const isUnavailable = text.includes('indisponível') || 
                                      text.includes('não encontramos') || 
                                      text.includes('esgotado') ||
                                      text.includes('restaurante fechado');
                return modal || title || isUnavailable;
            }, { timeout: 20000 });
            
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
        }

        const produto = await page.evaluate(() => {
            const container = document.querySelector('[role="dialog"]') || document;

            const titleEl = container.querySelector('[data-test-id="product-detail-name"]') 
                         || container.querySelector('[data-test-id="item-name"]')
                         || container.querySelector('.item-title')
                         || container.querySelector('h2')
                         || container.querySelector('h3')
                         || container.querySelector('h1');
            const title = titleEl ? titleEl.innerText.trim() : null;

            const precosEl = Array.from(container.querySelectorAll('span, p, div, h2, h3'));
            const validPrices = precosEl.filter(el => {
                if (!el.innerText) return false;
                return /^R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}$/.test(el.innerText.trim());
            });
            
            let normal_price = null;
            let discount_price = null;

            if (validPrices.length > 0) {
                const strikethrough = validPrices.find(el => {
                    const style = window.getComputedStyle(el);
                    return style.textDecorationLine.includes('line-through') || style.textDecoration.includes('line-through');
                });
                
                const normal = validPrices.find(el => {
                    const style = window.getComputedStyle(el);
                    return !style.textDecorationLine.includes('line-through') && !style.textDecoration.includes('line-through');
                });

                if (strikethrough && normal) {
                    normal_price = strikethrough.innerText.trim();
                    discount_price = normal.innerText.trim();
                } else if (normal) {
                    normal_price = normal.innerText.trim();
                } else if (strikethrough) {
                    normal_price = strikethrough.innerText.trim();
                }
            } else {
                const precoMatch = precosEl.find(el => el.innerText && el.innerText.includes('R$'));
                if (precoMatch) normal_price = precoMatch.innerText.trim();
            }

            const imgElements = Array.from(container.querySelectorAll('img'));
            const imgEl = imgElements.find(img => img.alt.toLowerCase().includes('produto')) 
                       || imgElements.find(img => img.width > 50 && img.height > 50) 
                       || imgElements[0];
            const image_url = imgEl ? imgEl.src : null;

            const textContent = document.body.innerText.toLowerCase();
            const isUnavailable = textContent.includes('produto indisponível') 
                               || textContent.includes('não encontramos') 
                               || textContent.includes('esgotado') 
                               || textContent.includes('item indisponível')
                               || textContent.includes('restaurante fechado');

            return { title, normal_price, discount_price, image_url, isUnavailable };
        });

        processedCount++;
        const percent = ((processedCount / totalUrls) * 100).toFixed(1);

        if (produto.isUnavailable || (!produto.title && !produto.normal_price)) {
            console.log(`[${processedCount}/${totalUrls}] (${percent}%) ⚠️ Indisponível/Removido: ${url}`);
            extractedData.push({
                title: null,
                normal_price: null,
                discount_price: null,
                product_url: url,
                image_url: null,
                status: 'error',
                error_message: 'Produto indisponível ou página não carregada'
            });
        } else {
            successCount++;
            console.log(`[${processedCount}/${totalUrls}] (${percent}%) ✅ Extraído: ${produto.title || 'Sem título'}`);
            extractedData.push({
                title: produto.title,
                normal_price: produto.normal_price,
                discount_price: produto.discount_price,
                product_url: url,
                image_url: produto.image_url,
                status: 'success',
                error_message: null
            });
        }
        saveProgress(); 
    });

    urls.forEach(url => cluster.queue(url));

    await cluster.idle();
    await cluster.close();

    const finalSuccessRate = processedCount > 0 ? ((successCount / processedCount) * 100).toFixed(1) : '0.0';
    console.log(`\nExtração concluída! Dados salvos em: ${OUTPUT_FILE}`);
    console.log(`Resumo: ${successCount} sucessos de ${processedCount} URLs processadas. Taxa de sucesso: ${finalSuccessRate}%`);
}

runScraper();
