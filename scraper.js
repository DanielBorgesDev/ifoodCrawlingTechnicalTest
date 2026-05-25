const fs = require('fs');
const path = require('path');
const { addExtra } = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { Cluster } = require('puppeteer-cluster');

const INPUT_FILE = path.join(__dirname, 'ifood_urls_padrao_item_1000.csv');
const OUTPUT_FILE = path.join(__dirname, 'produtos_extraidos.json');
const EVIDENCES_DIR = path.join(__dirname, 'evidences');
const CONCURRENCY = 5;

if (!fs.existsSync(EVIDENCES_DIR)) {
    fs.mkdirSync(EVIDENCES_DIR);
}

async function runScraper() {
    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`Arquivo não encontrado: ${INPUT_FILE}`);
        return;
    }

    let extractedData = [];
    let processedUrls = new Set();

    if (fs.existsSync(OUTPUT_FILE)) {
        try {
            const existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
            if (Array.isArray(existingData)) {
                extractedData = existingData;
                existingData.forEach(item => {
                    if (item.product_url) processedUrls.add(item.product_url);
                });
                console.log(`Retomando execução: ${processedUrls.size} URLs já processadas encontradas.`);
            }
        } catch (e) {
            console.warn('Falha ao ler o arquivo de progresso anterior. Iniciando do zero.');
        }
    }

    const urls = fs.readFileSync(INPUT_FILE, 'utf-8')
        .split('\n')
        .map(url => url.trim())
        .filter(url => url.startsWith('http') && !processedUrls.has(url));

    console.log(`Iniciando processamento de ${urls.length} URLs (restantes na fila)...`);

    let processedCount = 0;
    let successCount = 0;
    let evidencesSaved = 0;
    const totalUrls = urls.length;

    if (totalUrls === 0) {
        console.log('Todas as URLs já foram processadas.');
        return;
    }

    const saveProgress = () => {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(extractedData, null, 2), 'utf-8');
    };

    const puppeteerVanilla = (await import('puppeteer')).default;
    const puppeteer = addExtra(puppeteerVanilla);
    puppeteer.use(StealthPlugin());

    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_PAGE,
        maxConcurrency: CONCURRENCY,
        puppeteer: puppeteer,
        retryLimit: 2,
        retryDelay: 2000,
        puppeteerOptions: {
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
        },
        timeout: 45000,
    });

    cluster.on('taskerror', (err, url) => {
        processedCount++;
        const percent = ((processedCount / totalUrls) * 100).toFixed(1);
        console.error(`[${processedCount}/${totalUrls}] (${percent}%) Erro fatal: ${err.message}`);
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

        const ua = await page.browser().userAgent();
        await page.setUserAgent(ua.replace('HeadlessChrome', 'Chrome'));

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        if (response && (response.status() === 403 || response.status() === 429)) {
            throw new Error(`Bloqueio de rede detectado (HTTP ${response.status()})`);
        }

        const isCloudflare = await page.evaluate(() => {
            return document.body.innerText.includes('cloudflare') || document.body.innerText.includes('Just a moment');
        });

        if (isCloudflare) {
            throw new Error("Bloqueio Cloudflare detectado");
        }

        try {
            await page.waitForFunction(() => {
                const text = document.body.innerText.toLowerCase();
                const isError = text.includes('não encontramos') || text.includes('ops!');
                const hasTitle = document.querySelector('h1, h2, h3');
                return hasTitle || isError;
            }, { timeout: 15000 });
        } catch (e) {
            throw new Error("Timeout aguardando conteúdo da página");
        }

        const produto = await page.evaluate(() => {
            const container = document.querySelector('[role="dialog"], .marmita-modal, .ReactModalPortal') || document.querySelector('main') || document;

            let titleEl = container.querySelector('h1');
            if (!titleEl) titleEl = container.querySelector('h2');
            if (!titleEl) titleEl = container.querySelector('h3');
            const title = titleEl ? titleEl.innerText.trim() : null;

            const precosEl = Array.from(container.querySelectorAll('span, p, div'));
            const validPrices = precosEl.filter(el => {
                if (el.children.length > 0) return false;
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
            }

            let image_url = null;
            try {
                const __NEXT_DATA__ = document.querySelector('script#__NEXT_DATA__');
                if (__NEXT_DATA__) {
                    const data = JSON.parse(__NEXT_DATA__.innerText);
                    if (data.props?.initialProps?.pageProps?.productData?.logoUrl) {
                        image_url = 'https://static.ifood-static.com.br/image/upload/t_high/' + data.props.initialProps.pageProps.productData.logoUrl;
                    }
                }
            } catch (e) { }

            if (!image_url) {
                const imgElements = Array.from(container.querySelectorAll('img'));
                const imgEl = imgElements.find(img => img.src && img.src.includes('http'));
                if (imgEl) image_url = imgEl.src;
            }

            const isUnavailable = !title && !normal_price;
            return { title, normal_price, discount_price, image_url, isUnavailable };
        });

        if (produto.isUnavailable || (!produto.title && !produto.normal_price)) {
            const timestamp = new Date().getTime();
            const screenshotPath = path.join(EVIDENCES_DIR, `error_${timestamp}.png`);
            try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch(e) {}

            extractedData.push({
                title: null,
                normal_price: null,
                discount_price: null,
                product_url: url,
                image_url: null,
                status: 'error',
                error_message: 'Produto indisponível ou estrutura da página não reconhecida'
            });
            console.log(`[ERRO] ${url}`);
        } else {
            if (evidencesSaved < 5) {
                const timestamp = new Date().getTime();
                const screenshotPath = path.join(EVIDENCES_DIR, `success_${timestamp}.png`);
                try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch(e) {}
                evidencesSaved++;
            }

            successCount++;
            extractedData.push({
                title: produto.title,
                normal_price: produto.normal_price,
                discount_price: produto.discount_price,
                product_url: url,
                image_url: produto.image_url,
                status: 'success',
                error_message: null
            });
            console.log(`[SUCESSO] ${produto.title}`);
        }

        processedCount++;
        saveProgress();
    });

    urls.forEach(url => cluster.queue(url));

    await cluster.idle();
    await cluster.close();

    const finalSuccessRate = processedCount > 0 ? ((successCount / processedCount) * 100).toFixed(1) : '0.0';
    console.log(`\nProcessamento finalizado. Resultados salvos em: ${OUTPUT_FILE}`);
    console.log(`Sucessos: ${successCount} / Total processado: ${processedCount} (${finalSuccessRate}%)`);
}

runScraper();
