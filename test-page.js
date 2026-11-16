const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
app.use(express.static(__dirname));

const server = app.listen(3000, async () => {
    console.log("Server running on port 3000");
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();

    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log('BROWSER_ERROR:', msg.text());
        } else {
            console.log('BROWSER_LOG:', msg.text());
        }
    });

    page.on('pageerror', error => {
        console.log('PAGE_ERROR:', error.message);
    });

    page.on('requestfailed', request => {
        console.log('REQUEST_FAILED:', request.url(), request.failure().errorText);
    });

    try {
        await page.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle0', timeout: 30000 });
        console.log("Page loaded successfully.");
    } catch (e) {
        console.log("Navigation error:", e.message);
    }

    await browser.close();
    server.close();
});
