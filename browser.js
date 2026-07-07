import puppeteer from 'puppeteer';
import express from 'express';
import { WebSocketServer } from 'ws';

const app = express();
const port = 3001;

// Initialize headless browser
const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
});
const page = await browser.newPage();

// Enforce strict 640x480 viewport
await page.setViewport({ width: 640, height: 480, deviceScaleFactor: 1 });
await page.goto('https://google.com');

// Set up server for frame pushing and event processing
const server = app.listen(port, () => console.log(`Browser Core running on port ${port}`));
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Terminal client linked.');

    // Frame broadcast loop
    const frameInterval = setInterval(async () => {
        if (ws.readyState === ws.OPEN) {
            // Capture raw, uncompressed 24-bit RGB/PNG snapshot
            const screenshot = await page.screenshot({ type: 'png', omitBackground: true });
            ws.send(screenshot);
        }
    }, 100); // 10 FPS target

    // Handle incoming terminal keyboard and mouse actions
    ws.on('message', async (message) => {
        try {
            const event = JSON.parse(message);

            if (event.type === 'click') {
                await page.mouse.click(event.x, event.y);
            } else if (event.type === 'move') {
                await page.mouse.move(event.x, event.y);
            } else if (event.type === 'keypress') {
                await page.keyboard.press(event.key);
            } else if (event.type === 'navigate') {
                await page.goto(event.url);
            }
        } catch (err) {
            console.error('Action error:', err.message);
        }
    });

    ws.on('close', () => clearInterval(frameInterval));
});

