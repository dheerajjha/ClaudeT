const { chromium } = require('playwright');

async function testSiteHealth() {
  const browser = await chromium.launch({ headless: false }); // Set to true for headless
  const context = await browser.newContext();
  const page = await context.newPage();

  // Arrays to collect issues
  const consoleErrors = [];
  const networkErrors = [];
  const pageErrors = [];
  const performanceMetrics = [];

  // Intercept console messages
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({
        type: 'console_error',
        text: msg.text(),
        location: msg.location(),
        timestamp: new Date().toISOString()
      });
      console.log(`🔴 Console Error: ${msg.text()}`);
    } else if (msg.type() === 'warning') {
      console.log(`🟡 Console Warning: ${msg.text()}`);
    }
  });

  // Intercept network requests
  page.on('response', async (response) => {
    const url = response.url();
    const status = response.status();
    
    if (status >= 400) {
      networkErrors.push({
        type: 'network_error',
        url: url,
        status: status,
        statusText: response.statusText(),
        timestamp: new Date().toISOString()
      });
      console.log(`🔴 Network Error: ${status} ${response.statusText()} - ${url}`);
    } else if (status >= 200 && status < 300) {
      console.log(`✅ Success: ${status} - ${url}`);
    }
  });

  // Intercept failed requests
  page.on('requestfailed', (request) => {
    networkErrors.push({
      type: 'request_failed',
      url: request.url(),
      failure: request.failure(),
      timestamp: new Date().toISOString()
    });
    console.log(`🔴 Request Failed: ${request.failure()?.errorText} - ${request.url()}`);
  });

  // Intercept page errors
  page.on('pageerror', (error) => {
    pageErrors.push({
      type: 'page_error',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    console.log(`🔴 Page Error: ${error.message}`);
  });

  try {
    console.log('🚀 Testing claude.grabr.cc...\n');
    
    // Record start time
    const startTime = Date.now();
    
    // Navigate to the site
    console.log('📍 Navigating to https://claude.grabr.cc...');
    const response = await page.goto('https://claude.grabr.cc', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    const loadTime = Date.now() - startTime;
    console.log(`⏱️  Page loaded in ${loadTime}ms`);
    
    performanceMetrics.push({
      metric: 'page_load_time',
      value: loadTime,
      unit: 'ms'
    });

    // Check main response
    if (response) {
      console.log(`📊 Main response: ${response.status()} ${response.statusText()}`);
      
      // Check for tunnel headers
      const headers = response.headers();
      if (headers['x-tunnel-protocol']) {
        console.log(`🚇 Tunnel Protocol: ${headers['x-tunnel-protocol']}`);
      }
      if (headers['x-tunnel-latency']) {
        console.log(`⚡ Tunnel Latency: ${headers['x-tunnel-latency']}`);
      }
    }

    // Wait a bit for any async operations
    await page.waitForTimeout(2000);

    // Test some common endpoints
    const endpoints = ['/health', '/dashboard'];
    
    for (const endpoint of endpoints) {
      try {
        console.log(`\n🧪 Testing endpoint: ${endpoint}`);
        const endpointResponse = await page.goto(`https://claude.grabr.cc${endpoint}`, {
          waitUntil: 'networkidle',
          timeout: 10000
        });
        
        if (endpointResponse) {
          console.log(`📊 ${endpoint}: ${endpointResponse.status()} ${endpointResponse.statusText()}`);
          
          // Try to get JSON content for API endpoints
          if (endpoint.includes('health') || endpoint.includes('dashboard')) {
            try {
              const content = await page.textContent('body');
              if (content) {
                const json = JSON.parse(content);
                console.log(`📋 ${endpoint} response:`, JSON.stringify(json, null, 2));
              }
            } catch (e) {
              console.log(`📋 ${endpoint} content: ${(await page.textContent('body'))?.substring(0, 100)}...`);
            }
          }
        }
      } catch (error) {
        console.log(`🔴 Error testing ${endpoint}: ${error.message}`);
        pageErrors.push({
          type: 'endpoint_error',
          endpoint: endpoint,
          message: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Test WebSocket connection if available
    try {
      console.log('\n🔌 Testing WebSocket connection...');
      const wsResult = await page.evaluate(() => {
        return new Promise((resolve) => {
          try {
            const ws = new WebSocket('wss://claude.grabr.cc');
            ws.onopen = () => resolve({ success: true, message: 'WebSocket connected' });
            ws.onerror = (error) => resolve({ success: false, message: 'WebSocket error', error: error.message });
            ws.onclose = () => resolve({ success: false, message: 'WebSocket closed immediately' });
            
            // Timeout after 5 seconds
            setTimeout(() => {
              ws.close();
              resolve({ success: false, message: 'WebSocket timeout' });
            }, 5000);
          } catch (error) {
            resolve({ success: false, message: 'WebSocket exception', error: error.message });
          }
        });
      });
      
      if (wsResult.success) {
        console.log('✅ WebSocket: Connected successfully');
      } else {
        console.log(`🔴 WebSocket: ${wsResult.message}`);
      }
    } catch (error) {
      console.log(`🔴 WebSocket test failed: ${error.message}`);
    }

    // Take a screenshot
    await page.screenshot({ path: 'claude-grabr-cc-screenshot.png', fullPage: true });
    console.log('\n📸 Screenshot saved: claude-grabr-cc-screenshot.png');

  } catch (error) {
    console.error(`🔴 Critical Error: ${error.message}`);
    pageErrors.push({
      type: 'critical_error',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }

  // Summary report
  console.log('\n📊 === HEALTH CHECK SUMMARY ===');
  console.log(`✅ Console Errors: ${consoleErrors.length}`);
  console.log(`✅ Network Errors: ${networkErrors.length}`);
  console.log(`✅ Page Errors: ${pageErrors.length}`);
  
  if (consoleErrors.length > 0) {
    console.log('\n🔴 Console Errors:');
    consoleErrors.forEach((error, i) => {
      console.log(`  ${i + 1}. ${error.text} (${error.timestamp})`);
    });
  }
  
  if (networkErrors.length > 0) {
    console.log('\n🔴 Network Errors:');
    networkErrors.forEach((error, i) => {
      console.log(`  ${i + 1}. ${error.status || 'Failed'} - ${error.url} (${error.timestamp})`);
    });
  }
  
  if (pageErrors.length > 0) {
    console.log('\n🔴 Page Errors:');
    pageErrors.forEach((error, i) => {
      console.log(`  ${i + 1}. ${error.message} (${error.timestamp})`);
    });
  }

  if (consoleErrors.length === 0 && networkErrors.length === 0 && pageErrors.length === 0) {
    console.log('\n🎉 All tests passed! Site is healthy.');
  } else {
    console.log('\n⚠️  Issues detected. Check logs above for details.');
  }

  await browser.close();
  
  return {
    healthy: consoleErrors.length === 0 && networkErrors.length === 0 && pageErrors.length === 0,
    consoleErrors,
    networkErrors,
    pageErrors,
    performanceMetrics
  };
}

// Run the test
if (require.main === module) {
  testSiteHealth()
    .then((result) => {
      process.exit(result.healthy ? 0 : 1);
    })
    .catch((error) => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
}

module.exports = testSiteHealth; 