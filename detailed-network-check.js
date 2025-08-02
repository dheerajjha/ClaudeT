const { chromium } = require('playwright');
const fs = require('fs');

class DetailedNetworkCheck {
  constructor() {
    this.results = {
      direct: { requests: [], responses: [], failed: [], console: [] },
      tunneled: { requests: [], responses: [], failed: [], console: [] }
    };
  }

  async run() {
    console.log('🔍 Starting Detailed Network Check...\n');
    
    const browser = await chromium.launch({ 
      headless: false,
      devtools: true
    });

    try {
      // Test both endpoints with detailed monitoring
      const [directResult, tunneledResult] = await Promise.all([
        this.testEndpointDetailed(browser, 'http://localhost:3008', 'direct'),
        this.testEndpointDetailed(browser, 'http://localhost:8999', 'tunneled')
      ]);
      
      // Analyze differences
      this.compareResults();
      
      console.log('\n⏸️  Browser tabs will stay open for manual inspection...');
      console.log('Press Ctrl+C when done examining.');
      
    } catch (error) {
      console.error('❌ Check failed:', error);
    }
  }

  async testEndpointDetailed(browser, url, type) {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log(`🔍 Testing ${type.toUpperCase()}: ${url}`);
    
    const data = this.results[type];
    
    // Monitor ALL network activity
    page.on('request', request => {
      const req = {
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        headers: request.headers(),
        timestamp: Date.now()
      };
      data.requests.push(req);
      console.log(`  📤 ${type}: ${request.method()} ${request.resourceType()} ${request.url()}`);
    });
    
    page.on('response', response => {
      const resp = {
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(),
        resourceType: response.request().resourceType(),
        timestamp: Date.now()
      };
      data.responses.push(resp);
      console.log(`  📥 ${type}: ${response.status()} ${response.request().resourceType()} ${response.url()}`);
    });

    page.on('requestfailed', request => {
      const failed = {
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        failure: request.failure(),
        timestamp: Date.now()
      };
      data.failed.push(failed);
      console.log(`  ❌ ${type}: FAILED ${request.resourceType()} ${request.url()} - ${request.failure()?.errorText}`);
    });

    page.on('console', msg => {
      const consoleMsg = {
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now()
      };
      data.console.push(consoleMsg);
      console.log(`  📝 ${type}: ${msg.type().toUpperCase()}: ${msg.text()}`);
    });

    page.on('pageerror', error => {
      console.log(`  🚨 ${type}: PAGE ERROR: ${error.message}`);
      data.console.push({
        type: 'error',
        text: error.message,
        stack: error.stack,
        timestamp: Date.now()
      });
    });

    try {
      console.log(`  ⏳ Loading ${url}...`);
      
      const response = await page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      
      console.log(`  ✅ ${type}: Main page ${response.status()} ${response.statusText()}`);
      
      // Wait for all resources to load
      await page.waitForTimeout(5000);
      
      // Check if page is actually rendered
      const hasTitle = await page.title();
      const bodyContent = await page.locator('body').textContent();
      const hasScripts = await page.locator('script').count();
      const hasStyles = await page.locator('link[rel="stylesheet"], style').count();
      
      console.log(`  📄 ${type}: Title="${hasTitle}"`);
      console.log(`  📄 ${type}: Body content length: ${bodyContent.length} chars`);
      console.log(`  📄 ${type}: Scripts: ${hasScripts}, Styles: ${hasStyles}`);
      
      // Take screenshot
      await page.screenshot({ 
        path: `logs/${type}-detailed.png`,
        fullPage: true 
      });
      
      return {
        title: hasTitle,
        bodyLength: bodyContent.length,
        scripts: hasScripts,
        styles: hasStyles
      };
      
    } catch (error) {
      console.log(`  ❌ ${type}: Navigation error: ${error.message}`);
      return { error: error.message };
    }
  }

  compareResults() {
    console.log('\n📊 DETAILED COMPARISON:');
    console.log('═'.repeat(80));
    
    const direct = this.results.direct;
    const tunneled = this.results.tunneled;
    
    console.log(`\n🔗 DIRECT (3008):`);
    console.log(`  📤 Requests: ${direct.requests.length}`);
    console.log(`  📥 Responses: ${direct.responses.length}`);
    console.log(`  ❌ Failed: ${direct.failed.length}`);
    console.log(`  📝 Console: ${direct.console.length}`);
    
    console.log(`\n⚡ TUNNELED (8999):`);
    console.log(`  📤 Requests: ${tunneled.requests.length}`);
    console.log(`  📥 Responses: ${tunneled.responses.length}`);
    console.log(`  ❌ Failed: ${tunneled.failed.length}`);
    console.log(`  📝 Console: ${tunneled.console.length}`);
    
    // Compare by resource type
    const directByType = this.groupByResourceType(direct.responses);
    const tunneledByType = this.groupByResourceType(tunneled.responses);
    
    console.log(`\n📋 RESOURCE COMPARISON:`);
    const allTypes = new Set([...Object.keys(directByType), ...Object.keys(tunneledByType)]);
    
    for (const type of allTypes) {
      const directCount = directByType[type]?.length || 0;
      const tunneledCount = tunneledByType[type]?.length || 0;
      const match = directCount === tunneledCount ? '✅' : '❌';
      console.log(`  ${match} ${type}: Direct(${directCount}) vs Tunneled(${tunneledCount})`);
    }
    
    // Show failed requests
    if (tunneled.failed.length > 0) {
      console.log(`\n❌ TUNNELED FAILURES:`);
      tunneled.failed.forEach(fail => {
        console.log(`  🚨 ${fail.resourceType}: ${fail.url} - ${fail.failure?.errorText}`);
      });
    }
    
    if (direct.failed.length > 0) {
      console.log(`\n❌ DIRECT FAILURES:`);
      direct.failed.forEach(fail => {
        console.log(`  🚨 ${fail.resourceType}: ${fail.url} - ${fail.failure?.errorText}`);
      });
    }
    
    // Save detailed logs
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `logs/detailed-network-${timestamp}.json`;
    
    try {
      fs.writeFileSync(filename, JSON.stringify(this.results, null, 2));
      console.log(`\n💾 Detailed logs saved: ${filename}`);
    } catch (error) {
      console.error('❌ Failed to save logs:', error);
    }
  }

  groupByResourceType(responses) {
    return responses.reduce((acc, resp) => {
      const type = resp.resourceType || 'unknown';
      if (!acc[type]) acc[type] = [];
      acc[type].push(resp);
      return acc;
    }, {});
  }
}

// Run the detailed check
async function main() {
  const checker = new DetailedNetworkCheck();
  await checker.run();
  
  // Keep alive until user stops
  process.on('SIGINT', () => {
    console.log('\n🔚 Exiting...');
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = DetailedNetworkCheck; 