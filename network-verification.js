const { chromium } = require('playwright');
const fs = require('fs');

class NetworkVerification {
  constructor() {
    this.results = {
      direct: { requests: [], responses: [] },
      tunneled: { requests: [], responses: [] }
    };
  }

  async run() {
    console.log('🌐 URL Proxying Verification Test (20s each endpoint)...\n');
    
    const browser = await chromium.launch({ 
      headless: false,
      devtools: true
    });

    try {
      console.log('🔍 Testing DIRECT endpoint first...');
      await this.testEndpoint(browser, 'http://localhost:3008', 'DIRECT');
      
      console.log('\n🔍 Testing TUNNELED endpoint...');
      await this.testEndpoint(browser, 'http://localhost:8999', 'TUNNELED');
      
      this.compareProxying();
      
    } catch (error) {
      console.error('❌ Verification failed:', error);
    } finally {
      console.log('\n🔚 Closing browser...');
      await browser.close();
      console.log('✅ URL Proxying verification complete!');
      process.exit(0);
    }
  }

  async testEndpoint(browser, url, type) {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log(`\n📋 ${type}: ${url}`);
    console.log('─'.repeat(50));
    
    const data = this.results[type.toLowerCase()];
    
    // Monitor all requests and responses with URLs
    page.on('request', request => {
      const requestData = {
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        timestamp: new Date().toISOString()
      };
      data.requests.push(requestData);
      console.log(`📤 REQ  ${request.method()} ${request.resourceType().padEnd(10)} ${request.url()}`);
    });
    
    page.on('response', response => {
      const responseData = {
        url: response.url(),
        status: response.status(),
        resourceType: response.request().resourceType(),
        timestamp: new Date().toISOString()
      };
      data.responses.push(responseData);
      console.log(`📥 RESP ${response.status()} ${response.request().resourceType().padEnd(10)} ${response.url()}`);
    });

    page.on('websocket', ws => {
      console.log(`🔌 WebSocket: ${ws.url()}`);
    });

    try {
      // Navigate to the page
      const response = await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });
      
      const title = await page.title();
      console.log(`✅ Loaded: ${response.status()} "${title}"`);
      
      // Keep open for 20 seconds for manual testing
      console.log(`⏱️  Keeping ${type} open for 20 seconds - test manually now!`);
      for (let i = 20; i > 0; i--) {
        process.stdout.write(`\r⏰ ${i}s remaining... `);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      console.log('\n✅ Time up!');
      
    } catch (error) {
      console.log(`❌ ${type}: ${error.message}`);
    } finally {
      await context.close();
    }
  }

  compareProxying() {
    console.log('\n📊 URL PROXYING VERIFICATION:');
    console.log('═'.repeat(80));
    
    const direct = this.results.direct;
    const tunneled = this.results.tunneled;
    
    console.log(`\n🔗 DIRECT (3008):`);
    console.log(`  📤 Requests: ${direct.requests.length}`);
    console.log(`  📥 Responses: ${direct.responses.length}`);
    
    console.log(`\n⚡ TUNNELED (8999):`);
    console.log(`  📤 Requests: ${tunneled.requests.length}`);
    console.log(`  📥 Responses: ${tunneled.responses.length}`);
    
    // Check if URLs are being properly proxied
    console.log(`\n🎯 URL PROXYING CHECK:`);
    
    // Group by resource type
    const directTypes = this.groupByType(direct.requests);
    const tunneledTypes = this.groupByType(tunneled.requests);
    
    const allTypes = new Set([...Object.keys(directTypes), ...Object.keys(tunneledTypes)]);
    
    let allProxied = true;
    for (const type of allTypes) {
      const directCount = directTypes[type]?.length || 0;
      const tunneledCount = tunneledTypes[type]?.length || 0;
      const match = directCount > 0 && tunneledCount > 0;
      
      if (!match && directCount > 0) allProxied = false;
      
      const status = match ? '✅' : (directCount > 0 ? '❌' : '⚪');
      console.log(`  ${status} ${type.padEnd(12)}: Direct(${directCount}) → Tunneled(${tunneledCount})`);
    }
    
    // Check specific URL patterns
    console.log(`\n🔍 SPECIFIC URL CHECKS:`);
    const patterns = [
      { name: 'HTML pages', pattern: /\.(html?)$|^\/$/ },
      { name: 'JavaScript', pattern: /\.js$/ },
      { name: 'CSS files', pattern: /\.css$/ },
      { name: 'API calls', pattern: /\/api\// },
      { name: 'WebSocket', pattern: /\/ws$|\/terminal$/ },
      { name: 'Images', pattern: /\.(png|svg|ico|jpg|jpeg)$/ },
      { name: 'JSON files', pattern: /\.json$/ }
    ];
    
    patterns.forEach(({ name, pattern }) => {
      const directMatches = direct.requests.filter(r => pattern.test(r.url)).length;
      const tunneledMatches = tunneled.requests.filter(r => pattern.test(r.url)).length;
      const proxied = directMatches > 0 && tunneledMatches > 0;
      const status = proxied ? '✅' : (directMatches > 0 ? '❌' : '⚪');
      console.log(`  ${status} ${name.padEnd(12)}: Direct(${directMatches}) → Tunneled(${tunneledMatches})`);
    });
    
    console.log(`\n🎉 FINAL RESULT:`);
    if (allProxied) {
      console.log('✅ ALL REQUESTS ARE BEING PROXIED CORRECTLY!');
      console.log('🚀 QUIC tunnel is successfully forwarding all traffic types');
    } else {
      console.log('⚠️  Some request types may not be proxied properly');
      console.log('🔧 Check the specific failures above');
    }
    
    // Save detailed comparison
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `logs/url-proxying-${timestamp}.json`;
    
    try {
      const comparison = {
        timestamp: new Date().toISOString(),
        summary: {
          direct: { requests: direct.requests.length, responses: direct.responses.length },
          tunneled: { requests: tunneled.requests.length, responses: tunneled.responses.length },
          allProxied
        },
        details: { direct, tunneled }
      };
      
      fs.writeFileSync(filename, JSON.stringify(comparison, null, 2));
      console.log(`\n💾 Detailed comparison saved: ${filename}`);
    } catch (error) {
      console.error('❌ Failed to save comparison:', error);
    }
  }

  groupByType(requests) {
    return requests.reduce((acc, req) => {
      const type = req.resourceType || 'unknown';
      if (!acc[type]) acc[type] = [];
      acc[type].push(req);
      return acc;
    }, {});
  }
}

// Run the verification
async function main() {
  const verification = new NetworkVerification();
  
  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log('\n\n🛑 User interrupted - closing browser...');
    process.exit(0);
  });
  
  await verification.run();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = NetworkVerification; 