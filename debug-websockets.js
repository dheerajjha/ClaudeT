const { chromium } = require('playwright');

async function debugWebSockets() {
    const browser = await chromium.launch({ 
        headless: false,
        slowMo: 500
    });
    
    console.log('🔍 WebSocket Debug Session Starting...\n');
    
    const environments = [
        { name: 'Localhost', url: 'http://localhost:3008' },
        { name: 'Production', url: 'https://claude.grabr.cc' }
    ];
    
    const results = {};
    
    for (const env of environments) {
        console.log(`\n🔬 Debugging ${env.name}: ${env.url}`);
        console.log('=' .repeat(60));
        
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Comprehensive monitoring
        const wsData = {
            connections: [],
            messages: [],
            errors: [],
            networkRequests: [],
            consoleMessages: []
        };
        
        // Console monitoring
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('websocket') || text.includes('socket.io') || text.includes('WS') || text.includes('ws')) {
                console.log(`🗣️  [${env.name}] Console:`, text);
                wsData.consoleMessages.push({
                    type: msg.type(),
                    text: text,
                    timestamp: new Date().toISOString()
                });
            }
        });
        
        // Network monitoring
        page.on('request', request => {
            const url = request.url();
            if (url.includes('ws://') || url.includes('wss://') || url.includes('socket.io') || url.includes('/ws')) {
                console.log(`🌐 [${env.name}] Request: ${request.method()} ${url}`);
                wsData.networkRequests.push({
                    method: request.method(),
                    url: url,
                    headers: request.headers(),
                    timestamp: new Date().toISOString()
                });
            }
        });
        
        page.on('response', response => {
            const url = response.url();
            if (url.includes('ws://') || url.includes('wss://') || url.includes('socket.io') || url.includes('/ws')) {
                console.log(`📡 [${env.name}] Response: ${response.status()} ${url}`);
            }
        });
        
        // WebSocket monitoring with detailed logging
        page.on('websocket', ws => {
            console.log(`🔌 [${env.name}] WebSocket Connected: ${ws.url()}`);
            
            const wsConnection = {
                url: ws.url(),
                timestamp: new Date().toISOString(),
                messagesSent: 0,
                messagesReceived: 0,
                closed: false
            };
            wsData.connections.push(wsConnection);
            
            ws.on('framesent', event => {
                wsConnection.messagesSent++;
                const payload = event.payload.toString();
                console.log(`📤 [${env.name}] WS Sent (${payload.length} bytes):`, payload.substring(0, 200));
                
                wsData.messages.push({
                    direction: 'sent',
                    payload: payload,
                    payloadType: typeof event.payload,
                    size: payload.length,
                    timestamp: new Date().toISOString(),
                    environment: env.name
                });
            });
            
            ws.on('framereceived', event => {
                wsConnection.messagesReceived++;
                const payload = event.payload.toString();
                console.log(`📥 [${env.name}] WS Received (${payload.length} bytes):`, payload.substring(0, 200));
                
                wsData.messages.push({
                    direction: 'received',
                    payload: payload,
                    payloadType: typeof event.payload,
                    size: payload.length,
                    timestamp: new Date().toISOString(),
                    environment: env.name
                });
            });
            
            ws.on('close', () => {
                wsConnection.closed = true;
                console.log(`❌ [${env.name}] WebSocket Closed: ${ws.url()}`);
            });
            
            ws.on('socketerror', error => {
                console.log(`🚨 [${env.name}] WebSocket Error:`, error);
                wsData.errors.push({
                    error: error.toString(),
                    timestamp: new Date().toISOString(),
                    url: ws.url()
                });
            });
        });
        
        try {
            console.log(`🌐 Navigating to ${env.url}...`);
            await page.goto(env.url, { 
                waitUntil: 'networkidle',
                timeout: 30000 
            });
            
            // Wait for initial load
            await page.waitForTimeout(3000);
            
            // Take screenshot for debugging
            await page.screenshot({ path: `debug-${env.name.toLowerCase()}-initial.png` });
            
            // Try to find and click on any project
            console.log('🔍 Searching for projects...');
            
            // More comprehensive project selectors
            const projectSelectors = [
                'a[href*="project"]',
                'a[href*="workspace"]', 
                '[data-testid*="project"]',
                '.project',
                '.workspace',
                'li:has-text("project")',
                'div:has-text("project")',
                'button:has-text("Open")',
                'a:has-text("Open")',
                'a[href*="/p/"]',  // Common project URL pattern
                'a[href*="/w/"]'   // Common workspace URL pattern
            ];
            
            let clicked = false;
            for (const selector of projectSelectors) {
                try {
                    const elements = await page.locator(selector).all();
                    for (const element of elements) {
                        if (await element.isVisible({ timeout: 1000 })) {
                            console.log(`✅ Clicking project element: ${selector}`);
                            await element.click();
                            clicked = true;
                            break;
                        }
                    }
                    if (clicked) break;
                } catch (e) {
                    // Continue trying
                }
            }
            
            if (clicked) {
                console.log('⏳ Waiting for project to load...');
                await page.waitForTimeout(5000);
                await page.screenshot({ path: `debug-${env.name.toLowerCase()}-project.png` });
            }
            
            // Look for terminal
            console.log('🖥️  Searching for terminal...');
            
            const terminalSelectors = [
                'button:has-text("Terminal")',
                'a:has-text("Terminal")',
                '[data-testid*="terminal"]',
                '.terminal-button',
                '[title*="terminal" i]',
                '[aria-label*="terminal" i]',
                'button[class*="terminal"]',
                '.menu button:has-text("Terminal")',
                'div[role="button"]:has-text("Terminal")'
            ];
            
            let terminalOpened = false;
            for (const selector of terminalSelectors) {
                try {
                    const terminalBtn = await page.locator(selector).first();
                    if (await terminalBtn.isVisible({ timeout: 2000 })) {
                        console.log(`✅ Found terminal button: ${selector}`);
                        await terminalBtn.click();
                        terminalOpened = true;
                        break;
                    }
                } catch (e) {
                    // Continue
                }
            }
            
            if (!terminalOpened) {
                console.log('⌨️  Trying keyboard shortcuts for terminal...');
                await page.keyboard.press('Control+`');
                await page.waitForTimeout(1000);
                await page.keyboard.press('Control+Shift+`');
                await page.waitForTimeout(1000);
                // VS Code style
                await page.keyboard.press('Control+Shift+P');
                await page.waitForTimeout(500);
                await page.keyboard.type('terminal');
                await page.keyboard.press('Enter');
                await page.waitForTimeout(2000);
            }
            
            await page.screenshot({ path: `debug-${env.name.toLowerCase()}-terminal.png` });
            
            // Try to execute command
            console.log('💻 Attempting to execute terminal command...');
            
            // Various ways to interact with terminal
            const terminalInputs = [
                '.xterm-helper-textarea',
                'textarea[class*="terminal"]',
                'input[class*="terminal"]',
                '.terminal-input',
                '[data-testid*="terminal-input"]'
            ];
            
            let commandExecuted = false;
            for (const selector of terminalInputs) {
                try {
                    const input = await page.locator(selector).first();
                    if (await input.isVisible({ timeout: 2000 })) {
                        console.log(`✅ Found terminal input: ${selector}`);
                        await input.click();
                        await page.waitForTimeout(500);
                        await input.type('echo "Testing WebSocket: $(date)"');
                        await page.keyboard.press('Enter');
                        commandExecuted = true;
                        break;
                    }
                } catch (e) {
                    // Continue
                }
            }
            
            if (!commandExecuted) {
                console.log('🎯 Trying direct keyboard input on page...');
                await page.keyboard.type('echo "Testing WebSocket terminal"');
                await page.keyboard.press('Enter');
            }
            
            // Monitor for extended period to catch all WebSocket activity
            console.log('⏳ Monitoring WebSocket activity for 10 seconds...');
            await page.waitForTimeout(10000);
            
            await page.screenshot({ path: `debug-${env.name.toLowerCase()}-final.png` });
            
        } catch (error) {
            console.error(`❌ Error in ${env.name}:`, error.message);
            wsData.errors.push({
                error: error.message,
                timestamp: new Date().toISOString(),
                phase: 'navigation'
            });
        }
        
        results[env.name] = wsData;
        
        // Environment summary
        console.log(`\n📊 ${env.name} Summary:`);
        console.log(`   WebSocket Connections: ${wsData.connections.length}`);
        console.log(`   Messages Sent: ${wsData.messages.filter(m => m.direction === 'sent').length}`);
        console.log(`   Messages Received: ${wsData.messages.filter(m => m.direction === 'received').length}`);
        console.log(`   Network Requests: ${wsData.networkRequests.length}`);
        console.log(`   Console Messages: ${wsData.consoleMessages.length}`);
        console.log(`   Errors: ${wsData.errors.length}`);
        
        await context.close();
    }
    
    await browser.close();
    
    // Detailed comparison
    console.log('\n🔍 DETAILED COMPARISON');
    console.log('=' .repeat(60));
    
    const localhost = results.Localhost;
    const production = results.Production;
    
    console.log('\nWebSocket Connections:');
    console.log(`  Localhost: ${localhost.connections.length}`);
    console.log(`  Production: ${production.connections.length}`);
    
    if (localhost.connections.length > 0) {
        console.log('  Localhost URLs:', localhost.connections.map(c => c.url));
    }
    if (production.connections.length > 0) {
        console.log('  Production URLs:', production.connections.map(c => c.url));
    }
    
    console.log('\nMessage Traffic:');
    console.log(`  Localhost: ${localhost.messages.length} total messages`);
    console.log(`  Production: ${production.messages.length} total messages`);
    
    console.log('\nNetwork Requests:');
    console.log(`  Localhost: ${localhost.networkRequests.length} WS-related requests`);
    console.log(`  Production: ${production.networkRequests.length} WS-related requests`);
    
    console.log('\nErrors:');
    console.log(`  Localhost: ${localhost.errors.length} errors`);
    console.log(`  Production: ${production.errors.length} errors`);
    
    if (production.errors.length > 0) {
        console.log('  Production Errors:', production.errors);
    }
    
    // Diagnosis
    console.log('\n🩺 DIAGNOSIS:');
    if (localhost.connections.length > 0 && production.connections.length === 0) {
        console.log('🔴 PROBLEM: Production WebSocket connections are failing to establish');
        console.log('   Possible causes:');
        console.log('   - WSS/SSL certificate issues');
        console.log('   - Firewall blocking WebSocket upgrades');
        console.log('   - Proxy/CDN not properly handling WebSocket connections');
        console.log('   - Different WebSocket endpoint URLs');
    } else if (localhost.messages.length > production.messages.length) {
        console.log('🟡 ISSUE: Production has fewer WebSocket messages than localhost');
        console.log('   This could indicate message delivery problems');
    } else if (localhost.connections.length === 0 && production.connections.length === 0) {
        console.log('🟡 INFO: No WebSocket connections found on either environment');
        console.log('   The application might not be using WebSockets for terminal functionality');
    } else {
        console.log('🟢 Both environments appear to have similar WebSocket behavior');
    }
    
    // Save detailed report
    const report = {
        timestamp: new Date().toISOString(),
        comparison: {
            localhost: {
                connections: localhost.connections.length,
                messages: localhost.messages.length,
                errors: localhost.errors.length,
                networkRequests: localhost.networkRequests.length
            },
            production: {
                connections: production.connections.length,
                messages: production.messages.length,
                errors: production.errors.length,
                networkRequests: production.networkRequests.length
            }
        },
        detailed: results
    };
    
    require('fs').writeFileSync(
        'websocket-debug-report.json', 
        JSON.stringify(report, null, 2)
    );
    
    console.log('\n📄 Screenshots saved: debug-localhost-*.png, debug-production-*.png');
    console.log('📄 Detailed debug report saved: websocket-debug-report.json');
}

debugWebSockets().catch(console.error); 