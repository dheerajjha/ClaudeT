const { chromium } = require('playwright');

async function simpleNetworkTest() {
    const browser = await chromium.launch({ 
        headless: false,
        slowMo: 200
    });
    
    console.log('🔍 Simple Network Test Starting...\n');
    
    const environments = [
        { name: 'Localhost', url: 'http://localhost:3008' },
        { name: 'Production', url: 'https://claude.grabr.cc' }
    ];
    
    const results = {};
    
    for (const env of environments) {
        console.log(`\n🧪 Testing ${env.name}: ${env.url}`);
        console.log('=' .repeat(50));
        console.log('⏳ You have 10 seconds to perform your actions...');
        
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Store network logs
        const networkLogs = [];
        
        // Monitor all network activity
        page.on('request', request => {
            const url = request.url();
            const timestamp = new Date().toISOString();
            
            networkLogs.push({
                type: 'request',
                method: request.method(),
                url: url,
                timestamp: timestamp,
                isWebSocket: url.includes('ws://') || url.includes('wss://') || request.headers()['upgrade'] === 'websocket'
            });
        });
        
        page.on('response', response => {
            const url = response.url();
            const timestamp = new Date().toISOString();
            
            networkLogs.push({
                type: 'response',
                status: response.status(),
                url: url,
                timestamp: timestamp,
                isWebSocket: url.includes('ws://') || url.includes('wss://') || response.headers()['upgrade'] === 'websocket'
            });
        });
        
        // Monitor WebSocket connections
        page.on('websocket', ws => {
            const timestamp = new Date().toISOString();
            console.log(`🔌 [${env.name}] WebSocket Connected: ${ws.url()}`);
            
            networkLogs.push({
                type: 'websocket_connect',
                url: ws.url(),
                timestamp: timestamp,
                isWebSocket: true
            });
            
            ws.on('framesent', event => {
                const timestamp = new Date().toISOString();
                networkLogs.push({
                    type: 'websocket_sent',
                    url: ws.url(),
                    size: event.payload.length,
                    timestamp: timestamp,
                    isWebSocket: true,
                    payload: event.payload.toString().substring(0, 100)
                });
            });
            
            ws.on('framereceived', event => {
                const timestamp = new Date().toISOString();
                networkLogs.push({
                    type: 'websocket_received',
                    url: ws.url(),
                    size: event.payload.length,
                    timestamp: timestamp,
                    isWebSocket: true,
                    payload: event.payload.toString().substring(0, 100)
                });
            });
            
            ws.on('close', () => {
                const timestamp = new Date().toISOString();
                console.log(`❌ [${env.name}] WebSocket Closed: ${ws.url()}`);
                networkLogs.push({
                    type: 'websocket_close',
                    url: ws.url(),
                    timestamp: timestamp,
                    isWebSocket: true
                });
            });
            
            ws.on('socketerror', error => {
                const timestamp = new Date().toISOString();
                console.log(`🚨 [${env.name}] WebSocket Error: ${error}`);
                networkLogs.push({
                    type: 'websocket_error',
                    url: ws.url(),
                    error: error.toString(),
                    timestamp: timestamp,
                    isWebSocket: true
                });
            });
        });
        
        try {
            console.log(`🌐 Opening ${env.url}...`);
            await page.goto(env.url, { waitUntil: 'networkidle' });
            
            console.log(`⏰ 10-second window started for ${env.name}...`);
            console.log(`   Please perform your actions now!`);
            
            // Wait for 10 seconds for user actions
            await page.waitForTimeout(10000);
            
            console.log(`⏰ Time's up for ${env.name}!`);
            
        } catch (error) {
            console.error(`❌ Error testing ${env.name}:`, error.message);
        }
        
        // Get the last 5 network logs
        const last5Logs = networkLogs.slice(-5);
        results[env.name] = {
            totalLogs: networkLogs.length,
            last5Logs: last5Logs,
            wsLogs: networkLogs.filter(log => log.isWebSocket)
        };
        
        console.log(`\n📊 ${env.name} - Last 5 Network Activities:`);
        last5Logs.forEach((log, index) => {
            const wsIcon = log.isWebSocket ? '🔌' : '🌐';
            const time = new Date(log.timestamp).toLocaleTimeString();
            
            if (log.type === 'request') {
                console.log(`${index + 1}. ${wsIcon} [${time}] REQ: ${log.method} ${log.url}`);
            } else if (log.type === 'response') {
                console.log(`${index + 1}. ${wsIcon} [${time}] RES: ${log.status} ${log.url}`);
            } else if (log.type === 'websocket_connect') {
                console.log(`${index + 1}. ${wsIcon} [${time}] WS CONNECT: ${log.url}`);
            } else if (log.type === 'websocket_sent') {
                console.log(`${index + 1}. ${wsIcon} [${time}] WS SENT: ${log.size} bytes to ${log.url}`);
                console.log(`      Preview: ${log.payload}...`);
            } else if (log.type === 'websocket_received') {
                console.log(`${index + 1}. ${wsIcon} [${time}] WS RECV: ${log.size} bytes from ${log.url}`);
                console.log(`      Preview: ${log.payload}...`);
            } else if (log.type === 'websocket_close') {
                console.log(`${index + 1}. ${wsIcon} [${time}] WS CLOSE: ${log.url}`);
            } else if (log.type === 'websocket_error') {
                console.log(`${index + 1}. ${wsIcon} [${time}] WS ERROR: ${log.error} on ${log.url}`);
            }
        });
        
        await context.close();
    }
    
    await browser.close();
    
    // Compare the results
    console.log('\n🔍 COMPARISON ANALYSIS');
    console.log('=' .repeat(50));
    
    const localhost = results.Localhost;
    const production = results.Production;
    
    console.log(`\nTotal Network Activity:`);
    console.log(`  Localhost: ${localhost.totalLogs} activities`);
    console.log(`  Production: ${production.totalLogs} activities`);
    
    console.log(`\nWebSocket Activity:`);
    console.log(`  Localhost: ${localhost.wsLogs.length} WebSocket activities`);
    console.log(`  Production: ${production.wsLogs.length} WebSocket activities`);
    
    // Show WebSocket comparison
    if (localhost.wsLogs.length > 0 || production.wsLogs.length > 0) {
        console.log(`\n🔌 WebSocket Activity Details:`);
        
        console.log(`\nLocalhost WebSocket:`);
        localhost.wsLogs.forEach((log, index) => {
            const time = new Date(log.timestamp).toLocaleTimeString();
            console.log(`  ${index + 1}. [${time}] ${log.type.toUpperCase()}: ${log.url}`);
            if (log.error) console.log(`     ERROR: ${log.error}`);
        });
        
        console.log(`\nProduction WebSocket:`);
        production.wsLogs.forEach((log, index) => {
            const time = new Date(log.timestamp).toLocaleTimeString();
            console.log(`  ${index + 1}. [${time}] ${log.type.toUpperCase()}: ${log.url}`);
            if (log.error) console.log(`     ERROR: ${log.error}`);
        });
    }
    
    // Key differences
    console.log(`\n🎯 Key Differences:`);
    const localhostErrors = localhost.wsLogs.filter(log => log.type === 'websocket_error').length;
    const productionErrors = production.wsLogs.filter(log => log.type === 'websocket_error').length;
    
    if (productionErrors > localhostErrors) {
        console.log(`🔴 Production has ${productionErrors} WebSocket errors vs ${localhostErrors} on localhost`);
    } else if (localhost.wsLogs.length > production.wsLogs.length) {
        console.log(`🟡 Localhost has more WebSocket activity (${localhost.wsLogs.length} vs ${production.wsLogs.length})`);
    } else {
        console.log(`🟢 Similar WebSocket behavior between environments`);
    }
    
    // Save simplified report
    const report = {
        timestamp: new Date().toISOString(),
        comparison: {
            localhost: {
                totalLogs: localhost.totalLogs,
                wsLogs: localhost.wsLogs.length,
                last5: localhost.last5Logs
            },
            production: {
                totalLogs: production.totalLogs,
                wsLogs: production.wsLogs.length,
                last5: production.last5Logs
            }
        },
        detailed: results
    };
    
    require('fs').writeFileSync(
        'simple-network-report.json', 
        JSON.stringify(report, null, 2)
    );
    
    console.log('\n📄 Detailed report saved: simple-network-report.json');
}

simpleNetworkTest().catch(console.error); 