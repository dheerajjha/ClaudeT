const { chromium } = require('playwright');

async function testWebSockets() {
    const browser = await chromium.launch({ 
        headless: false,
        slowMo: 1000 // Slow down for better observation
    });
    
    console.log('🚀 Starting WebSocket Tests...\n');
    
    // Test both environments
    const environments = [
        { name: 'Localhost', url: 'http://localhost:3008' },
        { name: 'Production', url: 'https://claude.grabr.cc' }
    ];
    
    for (const env of environments) {
        console.log(`\n🧪 Testing ${env.name}: ${env.url}`);
        console.log('=' .repeat(50));
        
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Capture WebSocket traffic
        const wsMessages = [];
        const wsConnections = [];
        
        // Monitor WebSocket connections
        page.on('websocket', ws => {
            console.log(`🔌 WebSocket connection: ${ws.url()}`);
            wsConnections.push({
                url: ws.url(),
                timestamp: new Date().toISOString()
            });
            
            ws.on('framesent', event => {
                const message = {
                    type: 'sent',
                    payload: event.payload,
                    timestamp: new Date().toISOString(),
                    environment: env.name
                };
                wsMessages.push(message);
                console.log(`📤 [${env.name}] WS Sent:`, event.payload.toString().substring(0, 100));
            });
            
            ws.on('framereceived', event => {
                const message = {
                    type: 'received', 
                    payload: event.payload,
                    timestamp: new Date().toISOString(),
                    environment: env.name
                };
                wsMessages.push(message);
                console.log(`📥 [${env.name}] WS Received:`, event.payload.toString().substring(0, 100));
            });
            
            ws.on('close', () => {
                console.log(`❌ [${env.name}] WebSocket closed`);
            });
        });
        
        // Monitor network requests
        page.on('request', request => {
            if (request.url().includes('socket.io') || request.url().includes('ws')) {
                console.log(`🌐 [${env.name}] Request: ${request.method()} ${request.url()}`);
            }
        });
        
        page.on('response', response => {
            if (response.url().includes('socket.io') || response.url().includes('ws')) {
                console.log(`📡 [${env.name}] Response: ${response.status()} ${response.url()}`);
            }
        });
        
        try {
            // Navigate to the environment
            console.log(`🌐 Navigating to ${env.url}...`);
            await page.goto(env.url, { waitUntil: 'networkidle' });
            
            // Wait for the page to load
            await page.waitForTimeout(3000);
            
            // Look for project links or navigation
            console.log('🔍 Looking for projects...');
            
            // Try common selectors for project navigation
            const projectSelectors = [
                'a[href*="project"]',
                '[data-testid*="project"]',
                '.project-link',
                '.project-item',
                'a:has-text("project")',
                'button:has-text("project")',
                'a[href*="workspace"]',
                '.workspace-item'
            ];
            
            let projectFound = false;
            for (const selector of projectSelectors) {
                try {
                    const projectElement = await page.locator(selector).first();
                    if (await projectElement.isVisible({ timeout: 2000 })) {
                        console.log(`✅ Found project with selector: ${selector}`);
                        await projectElement.click();
                        projectFound = true;
                        break;
                    }
                } catch (e) {
                    // Continue trying other selectors
                }
            }
            
            if (!projectFound) {
                console.log('⚠️  No specific project found, continuing with current page...');
            }
            
            // Wait for project to load
            await page.waitForTimeout(3000);
            
            // Look for terminal option
            console.log('🖥️  Looking for terminal option...');
            
            const terminalSelectors = [
                'button:has-text("Terminal")',
                'a:has-text("Terminal")',
                '[data-testid*="terminal"]',
                '.terminal-button',
                'button:has-text("terminal")',
                '[title*="terminal"]',
                '[aria-label*="terminal"]',
                'button[class*="terminal"]',
                '.menu-item:has-text("Terminal")'
            ];
            
            let terminalFound = false;
            for (const selector of terminalSelectors) {
                try {
                    const terminalElement = await page.locator(selector).first();
                    if (await terminalElement.isVisible({ timeout: 2000 })) {
                        console.log(`✅ Found terminal with selector: ${selector}`);
                        await terminalElement.click();
                        terminalFound = true;
                        break;
                    }
                } catch (e) {
                    // Continue trying other selectors
                }
            }
            
            if (!terminalFound) {
                console.log('⚠️  Terminal not found, trying keyboard shortcut...');
                // Try common terminal shortcuts
                await page.keyboard.press('Control+`');
                await page.waitForTimeout(1000);
                await page.keyboard.press('Control+Shift+`');
                await page.waitForTimeout(1000);
            }
            
            // Wait for terminal to open
            await page.waitForTimeout(3000);
            
            // Look for terminal input
            console.log('⌨️  Looking for terminal input...');
            
            const terminalInputSelectors = [
                'input[class*="terminal"]',
                'textarea[class*="terminal"]',
                '.terminal-input',
                '.xterm-helper-textarea',
                '[data-testid*="terminal-input"]',
                '.terminal textarea',
                '.terminal input'
            ];
            
            let terminalInput = null;
            for (const selector of terminalInputSelectors) {
                try {
                    terminalInput = await page.locator(selector).first();
                    if (await terminalInput.isVisible({ timeout: 2000 })) {
                        console.log(`✅ Found terminal input with selector: ${selector}`);
                        break;
                    }
                } catch (e) {
                    // Continue trying
                }
            }
            
            if (terminalInput) {
                console.log('💻 Executing terminal command...');
                
                // Click on terminal input to focus
                await terminalInput.click();
                await page.waitForTimeout(1000);
                
                // Type a simple command
                const command = 'ls -la';
                console.log(`📝 Typing command: ${command}`);
                await terminalInput.type(command);
                
                // Press Enter
                await page.keyboard.press('Enter');
                console.log('⏎ Command executed');
                
                // Wait for command execution and potential WebSocket traffic
                await page.waitForTimeout(5000);
                
            } else {
                console.log('❌ Could not find terminal input field');
                
                // Try typing directly on the page (some terminals capture all keyboard input)
                console.log('🎯 Trying direct keyboard input...');
                await page.keyboard.type('ls -la');
                await page.keyboard.press('Enter');
                await page.waitForTimeout(3000);
            }
            
            // Monitor for a bit longer to catch any delayed WebSocket traffic
            console.log('⏳ Monitoring for additional WebSocket traffic...');
            await page.waitForTimeout(5000);
            
        } catch (error) {
            console.error(`❌ Error testing ${env.name}:`, error.message);
        }
        
        // Report WebSocket statistics for this environment
        const envWsMessages = wsMessages.filter(msg => msg.environment === env.name);
        console.log(`\n📊 ${env.name} WebSocket Summary:`);
        console.log(`   Connections: ${wsConnections.length}`);
        console.log(`   Messages Sent: ${envWsMessages.filter(m => m.type === 'sent').length}`);
        console.log(`   Messages Received: ${envWsMessages.filter(m => m.type === 'received').length}`);
        
        if (wsConnections.length === 0) {
            console.log(`⚠️  No WebSocket connections detected for ${env.name}`);
        }
        
        await context.close();
    }
    
    await browser.close();
    
    // Final comparison
    console.log('\n🔍 COMPARISON ANALYSIS');
    console.log('=' .repeat(50));
    
    const localhostMessages = wsMessages.filter(m => m.environment === 'Localhost');
    const productionMessages = wsMessages.filter(m => m.environment === 'Production');
    
    console.log(`Localhost WebSocket Messages: ${localhostMessages.length}`);
    console.log(`Production WebSocket Messages: ${productionMessages.length}`);
    
    if (localhostMessages.length > 0 && productionMessages.length === 0) {
        console.log('🔴 ISSUE: Production has no WebSocket traffic while localhost does');
    } else if (localhostMessages.length === 0 && productionMessages.length === 0) {
        console.log('🟡 WARNING: No WebSocket traffic detected on either environment');
    } else {
        console.log('🟢 Both environments show WebSocket activity');
    }
    
    // Save detailed logs
    const report = {
        timestamp: new Date().toISOString(),
        environments: {
            localhost: {
                messages: localhostMessages,
                messageCount: localhostMessages.length
            },
            production: {
                messages: productionMessages,
                messageCount: productionMessages.length
            }
        }
    };
    
    require('fs').writeFileSync(
        'websocket-test-report.json', 
        JSON.stringify(report, null, 2)
    );
    
    console.log('\n📄 Detailed report saved to: websocket-test-report.json');
}

// Run the test
testWebSockets().catch(console.error); 