async function setupNetworkInterceptor(page) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const type = req.resourceType();
        if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
            req.abort();
        } else {
            req.continue();
        }
    });
}

async function verifyCloudflareBlock(page, response) {
    if (response && (response.status() === 403 || response.status() === 429)) {
        throw new Error(`Bloqueio de rede detectado (HTTP ${response.status()})`);
    }

    const isCloudflare = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('cloudflare') || text.includes('just a moment');
    });

    if (isCloudflare) {
        throw new Error("Bloqueio Cloudflare detectado na pagina");
    }
}

module.exports = { setupNetworkInterceptor, verifyCloudflareBlock };
