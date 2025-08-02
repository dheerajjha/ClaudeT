const { chromium } = require('playwright');

async function quickWebSocketTest() {
  console.log('🧪 Quick WebSocket Terminal Test\n');
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 200
  });

  try {
    console.log('📍 Testing TUNNEL WebSocket Terminal (10 seconds)...\n');
    
    const context = await browser.newContext({
      viewport: { width: 1200, height: 800 }
    });
    
    const page = await context.newPage();
    
    // Monitor WebSocket connections
    page.on('websocket', ws => {
      console.log(`🔌 WebSocket: ${ws.url()}`);
      ws.on('framereceived', data => {
        console.log(`📥 BROWSER WS Received: ${data.payload.slice(0, 100)}...`);
      });
      ws.on('framesent', data => {
        console.log(`📤 BROWSER WS Sent: ${data.payload.slice(0, 100)}...`);
      });
    });
    
    // Enable console logging
    page.on('console', msg => {
      console.log(`🌐 Console: ${msg.text()}`);
    });
    
    await page.goto('https://claude.grabr.cc');
    
    // Wait for page to load
    await page.waitForTimeout(3000);
    
    // Click terminal if it exists
    try {
      await page.click('text=Terminal', { timeout: 2000 });
      console.log('🖱️ Clicked Terminal');
    } catch (e) {
      console.log('⚠️ Terminal button not found, continuing...');
    }
    
    // Wait for terminal to load
    await page.waitForTimeout(2000);
    
    // Type a command
    await page.keyboard.type('echo "hello world"');
    await page.keyboard.press('Enter');
    
    console.log('⌨️ Typed: echo "hello world"');
    
    // Wait to see output
    await page.waitForTimeout(5000);
    
    await context.close();
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
    console.log('\n✅ Quick test completed!');
  }
}

if (require.main === module) {
  quickWebSocketTest().catch(console.error);
}

module.exports = { quickWebSocketTest }; 