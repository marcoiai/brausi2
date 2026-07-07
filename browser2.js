import { mkdtempSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer';
import express from 'express';
import { WebSocketServer } from 'ws';

const app = express();

const config = {
    port: intEnv('BROWSER_PORT', 3001),
    width: intEnv('BROWSER_WIDTH', 1280),
    height: intEnv('BROWSER_HEIGHT', 900),
    deviceScaleFactor: numberEnv('BROWSER_DSF', 1.25),
    captureIntervalMs: intEnv('BROWSER_FRAME_MS', 140),
    frameType: enumEnv('BROWSER_FRAME_TYPE', ['png', 'jpeg', 'webp'], 'jpeg'),
    frameQuality: intEnv('BROWSER_FRAME_QUALITY', 78),
    maxBufferedBytes: intEnv('BROWSER_MAX_BUFFERED_BYTES', 2_000_000),
    navigationTimeoutMs: intEnv('BROWSER_NAV_TIMEOUT_MS', 15_000),
    initialUrl: normalizeUrl(process.env.BROWSER_INITIAL_URL ?? 'about:blank'),
};

const userDataDir = mkdtempSync('/private/tmp/brausi2-puppeteer-');
const browser = await puppeteer.launch({
    headless: 'new',
    userDataDir,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({
    width: config.width,
    height: config.height,
    deviceScaleFactor: config.deviceScaleFactor,
});

const clients = new Set();
let captureTimer = null;
let captureInFlight = false;
let lastFrame = null;
let lastFrameAt = 0;
let currentUrl = 'about:blank';

app.get('/health', (_req, res) => {
    res.json({
        ok: true,
        clients: clients.size,
        currentUrl,
        lastFrameAt,
        frameType: config.frameType,
        viewport: {
            width: config.width,
            height: config.height,
            deviceScaleFactor: config.deviceScaleFactor,
        },
    });
});

const server = app.listen(config.port, () => {
    console.log(`[Engine] Running on port ${config.port}`);
    console.log(`[Engine] Frame stream: ${config.frameType} @ ${config.captureIntervalMs}ms`);
});
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[Engine] Terminal client attached. clients=${clients.size}`);

    if (lastFrame) {
        sendFrame(ws, lastFrame);
    }

    startCaptureLoop();

    ws.on('message', async (message) => {
        try {
            await handleClientEvent(JSON.parse(message));
        } catch (err) {
            console.error('[Engine] Interaction failed:', err.message);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`[Engine] Terminal client detached. clients=${clients.size}`);
        if (clients.size === 0) {
            stopCaptureLoop();
        }
    });
});

void navigateTo(config.initialUrl, { label: 'initial' });

async function handleClientEvent(event) {
    if (!event || typeof event.type !== 'string') {
        return;
    }

    if (event.type === 'click') {
        await page.mouse.click(clampInt(event.x, 0, config.width), clampInt(event.y, 0, config.height));
        return;
    }

    if (event.type === 'move') {
        await page.mouse.move(clampInt(event.x, 0, config.width), clampInt(event.y, 0, config.height));
        return;
    }

    if (event.type === 'text') {
        if (typeof event.text === 'string' && event.text.length > 0) {
            await page.keyboard.type(event.text);
        }
        return;
    }

    if (event.type === 'key') {
        if (typeof event.key === 'string' && event.key.length > 0) {
            await page.keyboard.press(event.key);
        }
        return;
    }

    if (event.type === 'keypress') {
        await handleLegacyKeypress(event.key);
        return;
    }

    if (event.type === 'navigate') {
        await navigateTo(event.url, { label: 'navigate' });
        return;
    }

    if (event.type === 'history') {
        if (event.direction === 'back') {
            await page.goBack({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs })
                .catch(() => console.log('[Engine] No backward history.'));
        } else if (event.direction === 'forward') {
            await page.goForward({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs })
                .catch(() => console.log('[Engine] No forward history.'));
        }
        currentUrl = page.url();
    }
}

async function handleLegacyKeypress(key) {
    if (typeof key !== 'string' || key.length === 0) {
        return;
    }

    if (key.length === 1) {
        await page.keyboard.type(key);
    } else {
        await page.keyboard.press(key);
    }
}

async function navigateTo(rawUrl, { label }) {
    const url = normalizeUrl(rawUrl);
    console.log(`[Engine] ${label}: ${url}`);

    try {
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: config.navigationTimeoutMs,
        });
    } catch (err) {
        console.error(`[Engine] Navigation warning: ${err.message}`);
    } finally {
        currentUrl = page.url();
    }
}

function startCaptureLoop() {
    if (captureTimer) {
        return;
    }

    captureTimer = setInterval(captureAndBroadcast, config.captureIntervalMs);
    void captureAndBroadcast();
}

function stopCaptureLoop() {
    if (!captureTimer) {
        return;
    }

    clearInterval(captureTimer);
    captureTimer = null;
}

async function captureAndBroadcast() {
    if (captureInFlight || clients.size === 0) {
        return;
    }

    captureInFlight = true;
    try {
        const frame = await page.screenshot(buildScreenshotOptions());
        lastFrame = Buffer.from(frame);
        lastFrameAt = Date.now();

        for (const ws of clients) {
            sendFrame(ws, lastFrame);
        }
    } catch (err) {
        console.log('[Engine] Dropped frame skipped:', err.message);
    } finally {
        captureInFlight = false;
    }
}

function sendFrame(ws, frame) {
    if (ws.readyState !== ws.OPEN) {
        return;
    }

    if (ws.bufferedAmount > config.maxBufferedBytes) {
        return;
    }

    ws.send(frame, { binary: true });
}

function buildScreenshotOptions() {
    const options = {
        type: config.frameType,
        optimizeForSpeed: true,
        captureBeyondViewport: false,
    };

    if (config.frameType === 'png') {
        options.omitBackground = true;
    } else {
        options.quality = clampInt(config.frameQuality, 1, 100);
    }

    return options;
}

function normalizeUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
        return 'about:blank';
    }

    const trimmed = rawUrl.trim();
    if (trimmed === 'about:blank' || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
    }

    return `https://${trimmed}`;
}

function intEnv(name, fallback) {
    const value = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(value) ? value : fallback;
}

function numberEnv(name, fallback) {
    const value = Number.parseFloat(process.env[name] ?? '');
    return Number.isFinite(value) ? value : fallback;
}

function enumEnv(name, allowed, fallback) {
    const value = process.env[name];
    return allowed.includes(value) ? value : fallback;
}

function clampInt(value, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return min;
    }

    return Math.min(max, Math.max(min, parsed));
}

async function shutdown() {
    console.log('[Engine] Shutting down.');
    stopCaptureLoop();
    for (const ws of clients) {
        ws.close();
    }
    await browser.close().catch(() => {});
    rmSync(userDataDir, { recursive: true, force: true });
    server.close(() => process.exit(0));
}

process.on('SIGINT', () => {
    void shutdown();
});

process.on('SIGTERM', () => {
    void shutdown();
});
