const { addExtra } = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { Cluster } = require('puppeteer-cluster');
const path = require('path');

const config = require('./src/config');
const FileManager = require('./src/fileManager');
const { setupNetworkInterceptor, verifyCloudflareBlock } = require('./src/interceptor');
const { extractProductData } = require('./src/extractor');

async function run() {
    const fileManager = new FileManager(config);
    fileManager.loadPreviousProgress();

    let urls;
    try {
        urls = fileManager.getUrlsToProcess();
    } catch (e) {
        console.error(e.message);
        return;
    }

    const totalUrls = urls.length;
    if (totalUrls === 0) {
        console.log('Todas as URLs já foram processadas.');
        return;
    }

    console.log(`Iniciando processamento de ${totalUrls} URLs (restantes na fila)...`);

    let processedCount = 0;
    let successCount = 0;
    let evidencesSaved = 0;

    const puppeteerVanilla = (await import('puppeteer')).default;
    const puppeteer = addExtra(puppeteerVanilla);
    puppeteer.use(StealthPlugin());

    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_PAGE,
        maxConcurrency: config.CONCURRENCY,
        puppeteer: puppeteer,
        retryLimit: config.RETRY_LIMIT,
        retryDelay: config.RETRY_DELAY,
        puppeteerOptions: {
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
        },
        timeout: config.TIMEOUT,
    });

    cluster.on('taskerror', (err, url) => {
        processedCount++;
        const percent = ((processedCount / totalUrls) * 100).toFixed(1);
        console.error(`[${processedCount}/${totalUrls}] (${percent}%) Erro fatal: ${err.message}`);
        fileManager.saveProgress({
            title: null,
            normal_price: null,
            discount_price: null,
            product_url: url,
            image_url: null,
            status: 'error',
            error_message: err.message
        });
    });

    await cluster.task(async ({ page, data: url }) => {
        await page.setViewport({ width: 1366, height: 768 });
        
        const ua = await page.browser().userAgent();
        await page.setUserAgent(ua.replace('HeadlessChrome', 'Chrome'));

        await setupNetworkInterceptor(page);

        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.PAGE_TIMEOUT });

        await verifyCloudflareBlock(page, response);

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

        const produto = await extractProductData(page);

        if (produto.isUnavailable || (!produto.title && !produto.normal_price)) {
            const timestamp = new Date().getTime();
            const screenshotPath = path.join(config.EVIDENCES_DIR, `error_${timestamp}.png`);
            try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch (e) { }

            fileManager.saveProgress({
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
                const screenshotPath = path.join(config.EVIDENCES_DIR, `success_${timestamp}.png`);
                try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch (e) { }
                evidencesSaved++;
            }

            successCount++;
            fileManager.saveProgress({
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
    });

    urls.forEach(url => cluster.queue(url));

    await cluster.idle();
    await cluster.close();

    const finalSuccessRate = processedCount > 0 ? ((successCount / processedCount) * 100).toFixed(1) : '0.0';
    console.log(`\nProcessamento finalizado. Resultados salvos em: ${config.OUTPUT_FILE}`);
    console.log(`Sucessos: ${successCount} / Total processado (nesta sessão): ${processedCount} (${finalSuccessRate}%)`);
}

run();
