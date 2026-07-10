// Legacy experimental Puppeteer/chafa path.
// Official low-power flow: ./server.sh then ./client.sh
const puppeteer = require('puppeteer');
const { execSync } = require('child_process');

const OUTPUT_PATH = `${process.env.HOME}/live.png`;
let currentUrl = 'https://news.ycombinator.com';
let widthColumns = 100; // Terminal grid width constraint
const renderMode = 'symbols';

// Web View Dimensions matching our Chafa aspect bounds 
const WEB_WIDTH = 1280;
const WEB_HEIGHT = 800;

async function main() {
    // Enable system mouse reporting protocols in your Terminal app (xterm / SGR 1006)
    process.stdout.write('\x1b[?1000;1006h');

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-gpu']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: WEB_WIDTH, height: WEB_HEIGHT });
    await page.goto(currentUrl, { waitUntil: 'networkidle2' });

    async function render() {
        console.clear();
        console.log(`=== MOUSE INTERACTIVE BROWSER: ${currentUrl} ===`);
        console.log(`Resolution Columns: ${widthColumns} | Click anywhere to navigate layout`);
        console.log("----------------------------------------------------------------------------------");

        await page.screenshot({ path: OUTPUT_PATH });

        try {
            const chafaFlags = renderMode === 'pixels' 
                ? `--size ${widthColumns}x -c full` 
                : `--size ${widthColumns}x --symbols block+border+space`;
            
            const output = execSync(`chafa ${chafaFlags} ${OUTPUT_PATH}`, { encoding: 'utf8' });
            console.log(output);
        } catch (err) {
            console.log("Waiting for graphic buffer layer...");
        }
        console.log("----------------------------------------------------------------------------------");
        console.log("Controls: Click elements directly | Press Ctrl+C to safely exit app.");
    }

    // Capture binary raw input streams from terminal frame buffer
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let buffer = '';

    process.stdin.on('data', async (key) => {
        // Handle standard escape termination sequences (Ctrl + C) safely
        if (key === '\u0003') {
            process.stdout.write('\x1b[?1000;1006l\n'); // Turn mouse tracking off before exit
            await browser.close();
            process.exit();
        }

        buffer += key;

        // Parse SGR Mouse Tracking Pattern standard format: ESC [ < button ; x ; y M (or m)
        const match = buffer.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
        
        if (match) {
            const [fullMatch, button, termX, termY, actionType] = match;
            buffer = buffer.replace(fullMatch, ''); // Clear processed input

            // Run action strictly on Mouse Down clicks
            if (actionType === 'M' && (button == 0 || button == 2)) {
                const xCoord = parseInt(termX, 10);
                const yCoord = parseInt(termY, 10);

                // Offset calculation adjustments to skip top menu title bars
                const correctedTermY = yCoord - 4; 

                if (correctedTermY >= 0 && xCoord <= widthColumns) {
                    // Convert terminal character grids coordinates directly into website viewport pixels
                    const pixelX = Math.round((xCoord / widthColumns) * WEB_WIDTH);
                    
                    // Standard rows to pixels calculation based on standard terminal character height scale
                    const pixelY = Math.round((correctedTermY / (widthColumns * 0.45)) * WEB_HEIGHT);

                    if (pixelX >= 0 && pixelX <= WEB_WIDTH && pixelY >= 0 && pixelY <= WEB_HEIGHT) {
                        // Click exactly where your physical mouse hovered on screen inside Puppeteer!
                        await page.mouse.click(pixelX, pixelY);
                        
                        // Small pause buffer to let the web engine shift page history
                        await new Promise(r => setTimeout(r, 1000));
                        currentUrl = page.url();
                        await render();
                    }
                }
            }
        }

        // Keep buffer limits narrow to prevent string bloating anomalies
        if (buffer.length > 50) buffer = '';
    });

    await render();
}

main().catch(console.error);
