const { chromium } = require('playwright');

async function runManualComparison() {
  console.log('🚀 Starting Manual Test Comparison...\n');
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 100,
    args: ['--disable-web-security', '--disable-features=VizDisplayCompositor']
  });

  try {
    // Test Localhost first
    console.log('📍 Testing LOCALHOST (http://localhost:3008)');
    console.log('⏱️  You have 20 seconds to test...\n');
    
    const localhostContext = await browser.newContext({
      viewport: { width: 1200, height: 800 }
    });
    
    const localhostPage = await localhostContext.newPage();
    
    // Enable console logging
    localhostPage.on('console', msg => {
      console.log(`🏠 LOCALHOST Console: ${msg.text()}`);
    });
    
    // Enable error logging
    localhostPage.on('pageerror', err => {
      console.log(`❌ LOCALHOST Error: ${err.message}`);
    });
    
    // Monitor WebSocket connections
    localhostPage.on('websocket', ws => {
      console.log(`🔌 LOCALHOST WebSocket: ${ws.url()}`);
      ws.on('framereceived', data => {
        console.log(`📥 LOCALHOST WS Received: ${data.payload.slice(0, 100)}...`);
      });
      ws.on('framesent', data => {
        console.log(`📤 LOCALHOST WS Sent: ${data.payload.slice(0, 100)}...`);
      });
    });
    
    await localhostPage.goto('http://localhost:3008');
    await localhostPage.waitForTimeout(20000); // 20 seconds
    
    await localhostContext.close();
    
    console.log('\n' + '='.repeat(60));
    console.log('📍 Testing TUNNEL (https://claude.grabr.cc)');
    console.log('⏱️  You have 20 seconds to test...\n');
    
    // Test Tunneled site
    const tunnelContext = await browser.newContext({
      viewport: { width: 1200, height: 800 }
    });
    
    const tunnelPage = await tunnelContext.newPage();
    
    // Enable console logging
    tunnelPage.on('console', msg => {
      console.log(`🌐 TUNNEL Console: ${msg.text()}`);
    });
    
    // Enable error logging
    tunnelPage.on('pageerror', err => {
      console.log(`❌ TUNNEL Error: ${err.message}`);
    });
    
    // Monitor WebSocket connections
    tunnelPage.on('websocket', ws => {
      console.log(`🔌 TUNNEL WebSocket: ${ws.url()}`);
      ws.on('framereceived', data => {
        console.log(`📥 TUNNEL WS Received: ${data.payload.slice(0, 100)}...`);
      });
      ws.on('framesent', data => {
        console.log(`📤 TUNNEL WS Sent: ${data.payload.slice(0, 100)}...`);
      });
    });
    
    // Monitor network requests
    tunnelPage.on('request', request => {
      if (request.url().includes('api/') || request.url().includes('ws')) {
        console.log(`🌐 TUNNEL Request: ${request.method()} ${request.url()}`);
      }
    });
    
    tunnelPage.on('response', response => {
      if (response.url().includes('api/') || response.url().includes('ws')) {
        console.log(`🌐 TUNNEL Response: ${response.status()} ${response.url()}`);
      }
    });
    
    await tunnelPage.goto('https://claude.grabr.cc');
    await tunnelPage.waitForTimeout(20000); // 20 seconds
    
    await tunnelContext.close();
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
    console.log('\n✅ Manual comparison test completed!');
  }
}

if (require.main === module) {
  runManualComparison().catch(console.error);
}

module.exports = { runManualComparison }; 