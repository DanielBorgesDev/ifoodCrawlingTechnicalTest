async function extractProductData(page) {
    return await page.evaluate(() => {
        const container = document.querySelector('[role="dialog"], .marmita-modal, .ReactModalPortal') || document.querySelector('main') || document;

        let titleEl = container.querySelector('h1') || container.querySelector('h2') || container.querySelector('h3');
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
}

module.exports = { extractProductData };
