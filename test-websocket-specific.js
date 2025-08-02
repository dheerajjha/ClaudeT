const { chromium } = require('playwright');

async function testWebSocketPaths() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('🚀 Testing WebSocket paths on claude.grabr.cc...\n');

  // Common WebSocket paths to test
  const wsPathsToTest = [
    '/',           // Root
    '/ws',         // Common WebSocket path
    '/socket.io',  // Socket.IO
    '/websocket',  // Generic WebSocket
    '/api/ws',     // API WebSocket
    '/terminal',   // Terminal WebSocket (likely for your use case)
    '/console',    // Console WebSocket
    '/shell',      // Shell WebSocket
  ];

  for (const path of wsPathsToTest) {
    console.log(`🔌 Testing WebSocket path: ${path}`);
    
    const wsResult = await page.evaluate((wsPath) => {
      return new Promise((resolve) => {
        try {
          const ws = new WebSocket(`wss://claude.grabr.cc${wsPath}`);
          
          ws.onopen = () => {
            ws.close();
            resolve({ success: true, message: 'Connected successfully' });
          };
          
          ws.onerror = (error) => {
            resolve({ success: false, message: 'Connection error' });
          };
          
          ws.onclose = (event) => {
            if (event.wasClean) {
              resolve({ success: true, message: 'Connected and closed cleanly' });
            } else {
              resolve({ success: false, message: `Closed with code: ${event.code}` });
            }
          };
          
          // Timeout after 3 seconds
          setTimeout(() => {
            ws.close();
            resolve({ success: false, message: 'Connection timeout' });
          }, 3000);
          
        } catch (error) {
          resolve({ success: false, message: `Exception: ${error.message}` });
        }
      });
    }, path);
    
    if (wsResult.success) {
      console.log(`✅ ${path}: ${wsResult.message}`);
    } else {
      console.log(`🔴 ${path}: ${wsResult.message}`);
    }
  }

  // Test HTTP endpoints to see what paths exist
  console.log('\n📋 Testing HTTP endpoints for hints about WebSocket paths...');
  
  const httpPathsToTest = [
    '/terminal',
    '/console', 
    '/shell',
    '/api',
    '/ws',
    '/socket.io'
  ];

  for (const path of httpPathsToTest) {
    try {
      console.log(`📡 Testing HTTP: ${path}`);
      const response = await page.goto(`https://claude.grabr.cc${path}`, {
        waitUntil: 'networkidle',
        timeout: 5000
      });
      
      if (response) {
        console.log(`📊 ${path}: ${response.status()} ${response.statusText()}`);
        
        // Check for upgrade headers that might indicate WebSocket support
        const headers = response.headers();
        if (headers['upgrade'] || headers['connection']?.includes('upgrade')) {
          console.log(`🔌 ${path}: Supports WebSocket upgrade!`);
        }
      }
    } catch (error) {
      console.log(`🔴 ${path}: ${error.message}`);
    }
  }

  await browser.close();
  
  console.log('\n🏁 WebSocket path testing complete!');
}

// Run the test
if (require.main === module) {
  testWebSocketPaths()
    .catch((error) => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
}

module.exports = testWebSocketPaths; 