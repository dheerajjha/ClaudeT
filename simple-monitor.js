const { chromium } = require('playwright');

async function simpleMonitor() {
    const browser = await chromium.launch({ 
        headless: false,
        slowMo: 500
    });
    
    console.log('🔍 Simple Network Monitor Starting...\n');
    
    const environments = [
        { name: 'Localhost', url: 'http://localhost:3008' },
        { name: 'Production', url: 'https://claude.grabr.cc' }
    ];
    
    for (const env of environments) {
        console.log(`\n📱 Opening ${env.name}: ${env.url}`);
        console.log('=' .repeat(50));
        
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Store last 5 network events
        const networkEvents = [];
        const wsEvents = [];
        
        // Monitor all network requests
        page.on('request', request => {
            const event = {
                type: 'REQUEST',
                method: request.method(),
                url: request.url(),
                timestamp: new Date().toISOString()
            };
            
            networkEvents.push(event);
            if (networkEvents.length > 5) networkEvents.shift();
            
            // Show if WebSocket related
            if (request.url().includes('ws://') || request.url().includes('wss://') || 
                request.url().includes('/ws') || request.url().includes('/terminal')) {
                console.log(`🌐 [${env.name}] REQUEST: ${request.method()} ${request.url()}`);
            }
        });
        
        page.on('response', response => {
            const event = {
                type: 'RESPONSE',
                status: response.status(),
                url: response.url(),
                timestamp: new Date().toISOString()
            };
            
            networkEvents.push(event);
            if (networkEvents.length > 5) networkEvents.shift();
            
            // Show if WebSocket related
            if (response.url().includes('ws://') || response.url().includes('wss://') || 
                response.url().includes('/ws') || response.url().includes('/terminal')) {
                console.log(`📡 [${env.name}] RESPONSE: ${response.status()} ${response.url()}`);
            }
        });
        
        // Monitor WebSocket connections
        page.on('websocket', ws => {
            const wsEvent = {
                type: 'WS_CONNECT',
                url: ws.url(),
                timestamp: new Date().toISOString()
            };
            
            wsEvents.push(wsEvent);
            console.log(`🔌 [${env.name}] WebSocket Connected: ${ws.url()}`);
            
            ws.on('framesent', event => {
                const frameEvent = {
                    type: 'WS_SENT',
                    size: event.payload.length,
                    data: event.payload.toString().substring(0, 100),
                    timestamp: new Date().toISOString()
                };
                wsEvents.push(frameEvent);
                if (wsEvents.length > 5) wsEvents.shift();
                console.log(`📤 [${env.name}] WS SENT (${event.payload.length} bytes): ${event.payload.toString().substring(0, 50)}...`);
            });
            
            ws.on('framereceived', event => {
                const frameEvent = {
                    type: 'WS_RECEIVED',
                    size: event.payload.length,
                    data: event.payload.toString().substring(0, 100),
                    timestamp: new Date().toISOString()
                };
                wsEvents.push(frameEvent);
                if (wsEvents.length > 5) wsEvents.shift();
                console.log(`📥 [${env.name}] WS RECEIVED (${event.payload.length} bytes): ${event.payload.toString().substring(0, 50)}...`);
            });
            
            ws.on('close', () => {
                console.log(`❌ [${env.name}] WebSocket Closed: ${ws.url()}`);
            });
            
            ws.on('socketerror', error => {
                console.log(`🚨 [${env.name}] WebSocket Error: ${error}`);
            });
        });
        
        // Monitor console errors
        page.on('console', msg => {
            if (msg.type() === 'error' && (msg.text().includes('websocket') || msg.text().includes('WebSocket'))) {
                console.log(`🗣️ [${env.name}] Console Error: ${msg.text()}`);
            }
        });
        
        try {
            console.log(`🌐 Navigating to ${env.url}...`);
            await page.goto(env.url, { waitUntil: 'networkidle' });
            
            console.log(`\n✅ ${env.name} loaded. Please perform your actions now.`);
            console.log(`📊 Monitoring last 5 network events and all WebSocket activity...`);
            console.log(`⏳ Waiting for your actions (60 seconds)...\n`);
            
            // Wait for user actions
            await page.waitForTimeout(60000);
            
            // Show final summary
            console.log(`\n📊 Final Summary for ${env.name}:`);
            console.log('🌐 Last 5 Network Events:');
            networkEvents.forEach((event, index) => {
                console.log(`   ${index + 1}. ${event.type}: ${event.method || event.status} ${event.url.split('/').pop()}`);
            });
            
            console.log('🔌 WebSocket Events:');
            wsEvents.forEach((event, index) => {
                if (event.type === 'WS_CONNECT') {
                    console.log(`   ${index + 1}. CONNECT: ${event.url}`);
                } else {
                    console.log(`   ${index + 1}. ${event.type}: ${event.size} bytes`);
                }
            });
            
        } catch (error) {
            console.error(`❌ Error with ${env.name}:`, error.message);
        }
        
        await context.close();
        
        if (env.name === 'Localhost') {
            console.log('\n⏳ Waiting 3 seconds before opening production...');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    
    await browser.close();
    console.log('\n🏁 Monitoring complete. Compare the network events above.');
}

simpleMonitor().catch(console.error); 