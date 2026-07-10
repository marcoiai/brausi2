#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- SELF-INSTALLATION LOGIC ---
// Checks if puppeteer is installed. If not, initializes npm and installs it automatically.
try {
    require.resolve('puppeteer');
} catch (e) {
    console.log("📦 Dependencies missing. Running automatic internal installation...");
    
    // Create package.json if it doesn't exist in the current folder
    if (!fs.existsSync(path.join(process.cwd(), 'package.json'))) {
        execSync('npm init -y', { stdio: 'ignore' });
    }
    
    // Clean install puppeteer quietly
    console.log("Installing Puppeteer (this may take a moment)...");
    execSync('npm install puppeteer', { stdio: 'inherit' });
    console.log("✅ Installation complete! Launching browser...");
}

// Now that we guarantee dependencies exist, safely require the modules
const puppeteer = require('puppeteer');
const os = require('os');

// --- CONFIGURATION ---
const OUTPUT_PATH = path.join(os.homedir(), 'live.png');
let currentUrl = 'https://ycombinator.com';

let widthColumns = 45;      // Compact column width for small terminal windows
const WEB_WIDTH = 375;      // Mobile smartphone layout proportions
const WEB_HEIGHT = 812;     
const renderMode = 'symbols';

function findBrowserPath() {
    const platform = os.platform();
    if (platform === 'darwin') {
        return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    } else if (platform === 'linux') {
        const binaries = ['chromium-browser', 'chromium', 'google-chrome-stable', 'google-chrome'];
        for (const bin of binaries) {
            try { return execSync(`command -v ${bin}`, { encoding: 'utf8' }).trim(); } catch (e) {}
        }
    }
    return null;
}

async function main() {
    const executablePath = findBrowserPath();
    if (!executablePath) {
        console.error("❌ Error: Could not locate Chrome or Chromium on this machine.");
        process.exit(1);
    }

    // Turn on xterm advanced mouse reporting protocols
    process.stdout.write('\x1b[?1000;1006h');

    const browser = await puppeteer.launch({
        headless: "new",
        executablePath: executablePath,
        args: [
            '--no-sandbox',
            '--autoplay-policy=no-user-gesture-required',
            `--window-size=${WEB_WIDTH},${WEB_HEIGHT}`
        ]
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: WEB_WIDTH, height: WEB_HEIGHT });
    await page.setAudioMuted(false); // Force unmute for web audio

    await page.goto(currentUrl, { waitUntil: 'networkidle2' });

    async function render() {
        console.clear();
        console.log(`📱 MINI MODE [${widthColumns}px] | Audio: ACTIVE`);
        console.log(`URL: ${currentUrl.substring(0, 35)}...`);
        console.log("------------------------------------------------");

        await page.screenshot({ path: OUTPUT_PATH });

        try {
            const chafaFlags = renderMode === 'pixels' 
                ? `--size ${widthColumns}x -c full` 
                : `--size ${widthColumns}x --symbols block+border+space`;
            
            const output = execSync(`chafa ${chafaFlags} ${OUTPUT_PATH}`, { encoding: 'utf8' });
            console.log(output);
        } catch (err) {
            console.log("Generating micro rendering matrix buffer...");
        }
        console.log("------------------------------------------------");
        console.log("Controls: Click any coordinate | Press Ctrl+C to close");
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let buffer = '';

    process.stdin.on('data', async (key) => {
        // Safe exit trap (Ctrl + C)
        if (key === '\u0003') {
            process.stdout.write('\x1b[?1000;1006l\n'); // Turn mouse reporting off before exiting
            await browser.close();
            process.exit();
        }

        buffer += key;
        const match = buffer.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
        
        if (match) {
            const [fullMatch, button, termX, termY, actionType] = match;
            buffer = buffer.replace(fullMatch, ''); 

            if (actionType === 'M' && (button == 0 || button == 2)) {
                const xCoord = parseInt(termX, 10);
                const yCoord = parseInt(termY, 10);
                const correctedTermY = yCoord - 4; // Header offset spacer

                if (correctedTermY >= 0 && xCoord <= widthColumns) {
                    const pixelX = Math.round((xCoord / widthColumns) * WEB_WIDTH);
                    const pixelY = Math.round((correctedTermY / (widthColumns * 0.85)) * WEB_HEIGHT);

                    if (pixelX >= 0 && pixelX <= WEB_WIDTH && pixelY >= 0 && pixelY <= WEB_HEIGHT) {
                        await page.mouse.click(pixelX, pixelY);
                        await new Promise(r => setTimeout(r, 1200)); // Navigation buffer time
                        currentUrl = page.url();
                        await render();
                    }
                }
            }
        }

        if (buffer.length > 50) buffer = '';
    });

    await render();
}

main().catch(console.error);

