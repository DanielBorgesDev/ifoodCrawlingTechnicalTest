const fs = require('fs');
const path = require('path');
const { addExtra } = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { Cluster } = require('puppeteer-cluster');

const INPUT_FILE = path.join(__dirname, 'ifood_urls_padrao_item_1000.csv');
const OUTPUT_FILE = path.join(__dirname, 'produtos_extraidos.json');
const CONCURRENCY = 2; // Reduzido para evitar bloqueio por Rate Limit do Cloudflare

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
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
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
        
        // Obtém a versão real do Chrome do Puppeteer e remove a tag 'Headless' para burlar o WAF
        const ua = await page.browser().userAgent();
        await page.setUserAgent(ua.replace('HeadlessChrome', 'Chrome'));

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['image', 'media', 'font'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
            
            await page.waitForFunction(() => {
                const text = document.body.innerText.toLowerCase();
                const hasPrice = /R\$\s*\d+/.test(text);
                const hasTitle = document.querySelector('h1, h2, h3');
                const isError = text.includes('não encontramos') || text.includes('ops!');
                
                return (hasPrice && hasTitle) || isError;
            }, { timeout: 15000 });
            
            await new Promise(r => setTimeout(r, 500));
        } catch (e) {
            console.log(`[Aviso] Bloqueio ou Timeout na página: ${e.message}`);
        }

        const produto = await page.evaluate(() => {
            const modal = document.querySelector('[role="dialog"], .marmita-modal, .ReactModalPortal');
            const container = modal || document.querySelector('main') || document;

            // Estrutura genérica para capturar nomes de produtos de mercado
            let titleEl = container.querySelector('h1');
            if (!titleEl) titleEl = container.querySelector('h2');
            if (!titleEl) titleEl = container.querySelector('h3');
            
            const title = titleEl ? titleEl.innerText.trim() : null;

            const precosEl = Array.from(container.querySelectorAll('span, p, div, h2, h3'));
            const validPrices = precosEl.filter(el => {
                if (!el.innerText || el.children.length > 0) return false;
                return /R\$\s*\d+/.test(el.innerText.trim());
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

            const isUnavailable = !title && !normal_price;

            return { title, normal_price, discount_price, image_url, isUnavailable };
        });

        processedCount++;
        const percent = ((processedCount / totalUrls) * 100).toFixed(1);

        if (produto.isUnavailable || (!produto.title && !produto.normal_price)) {
            console.log(`[${processedCount}/${totalUrls}] (${percent}%) Indisponivel/Removido: ${url}`);
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
            console.log(`[${processedCount}/${totalUrls}] (${percent}%) Extraido: ${produto.title || 'Sem titulo'}`);
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
