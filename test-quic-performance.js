const { chromium } = require('playwright');
const fs = require('fs');

class QuicPerformanceTest {
  constructor() {
    this.results = {
      direct: {},
      tunneled: {},
      comparison: {}
    };
  }

  async runTest() {
    console.log('🧪 Starting QUIC Performance Test Suite...\n');
    
    const browser = await chromium.launch({ 
      headless: true,
      devtools: false 
    });

    try {
      // Test Direct Connection (localhost:3008)
      console.log('📊 Testing Direct Connection (localhost:3008)...');
      this.results.direct = await this.testConnection(browser, 'http://localhost:3008', 'Direct');
      
      // Wait between tests
      await this.sleep(2000);
      
      // Test Tunneled Connection (localhost:8999)
      console.log('📊 Testing Tunneled Connection (localhost:8999)...');
      this.results.tunneled = await this.testConnection(browser, 'http://localhost:8999', 'Tunneled');
      
      // Analyze results
      this.analyzeResults();
      
      // Save results
      this.saveResults();
      
    } catch (error) {
      console.error('❌ Test failed:', error);
    } finally {
      await browser.close();
    }
  }

  async testConnection(browser, url, name) {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    const metrics = {
      name,
      url,
      loadTimes: [],
      networkTimings: [],
      resourceCounts: {},
      errors: []
    };

    // Enable request/response monitoring
    const requests = [];
    const responses = [];
    
    page.on('request', request => {
      requests.push({
        url: request.url(),
        method: request.method(),
        timestamp: Date.now()
      });
    });
    
    page.on('response', response => {
      responses.push({
        url: response.url(),
        status: response.status(),
        timestamp: Date.now(),
        headers: response.headers()
      });
    });

    try {
      // Test 1: Initial Page Load
      console.log(`  🔍 Testing initial page load for ${name}...`);
      const loadStart = Date.now();
      
      const response = await page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      
      const loadEnd = Date.now();
      const loadTime = loadEnd - loadStart;
      
      metrics.loadTimes.push({
        test: 'initial_load',
        duration: loadTime,
        status: response?.status() || 'unknown'
      });
      
      console.log(`    ⏱️  Initial load: ${loadTime}ms`);

      // Test 2: Multiple Resource Requests
      console.log(`  🔍 Testing multiple resource requests for ${name}...`);
      const resourceTests = [
        '/',
        '/health',
        '/dashboard'
      ];

      for (const path of resourceTests) {
        try {
          const reqStart = Date.now();
          const resp = await page.goto(`${url}${path}`, { 
            waitUntil: 'domcontentloaded',
            timeout: 15000 
          });
          const reqEnd = Date.now();
          
          metrics.loadTimes.push({
            test: `resource_${path.replace('/', 'root')}`,
            duration: reqEnd - reqStart,
            status: resp?.status() || 'unknown'
          });
          
          console.log(`    ⏱️  ${path}: ${reqEnd - reqStart}ms`);
        } catch (error) {
          metrics.errors.push(`Resource ${path}: ${error.message}`);
          console.log(`    ❌ ${path}: ${error.message}`);
        }
      }

      // Test 3: Concurrent Requests
      console.log(`  🔍 Testing concurrent requests for ${name}...`);
      const concurrentStart = Date.now();
      
      const concurrentPromises = Array.from({ length: 5 }, (_, i) => 
        page.evaluate(async (baseUrl, index) => {
          const start = performance.now();
          try {
            const response = await fetch(`${baseUrl}/?test=${index}`);
            const end = performance.now();
            return {
              index,
              duration: end - start,
              status: response.status,
              ok: response.ok
            };
          } catch (error) {
            return {
              index,
              duration: -1,
              status: 'error',
              error: error.message
            };
          }
        }, url, i)
      );

      const concurrentResults = await Promise.all(concurrentPromises);
      const concurrentEnd = Date.now();
      
      metrics.loadTimes.push({
        test: 'concurrent_requests',
        duration: concurrentEnd - concurrentStart,
        details: concurrentResults
      });
      
      console.log(`    ⏱️  5 concurrent requests: ${concurrentEnd - concurrentStart}ms`);

      // Test 4: Network Timing Analysis
      const navigationEntry = await page.evaluate(() => {
        const entry = performance.getEntriesByType('navigation')[0];
        return entry ? {
          dns: entry.domainLookupEnd - entry.domainLookupStart,
          connect: entry.connectEnd - entry.connectStart,
          request: entry.responseStart - entry.requestStart,
          response: entry.responseEnd - entry.responseStart,
          dom: entry.domContentLoadedEventEnd - entry.domContentLoadedEventStart,
          load: entry.loadEventEnd - entry.loadEventStart
        } : null;
      });

      if (navigationEntry) {
        metrics.networkTimings = navigationEntry;
        console.log(`    🌐 DNS: ${navigationEntry.dns}ms, Connect: ${navigationEntry.connect}ms, Request: ${navigationEntry.request}ms`);
      }

      // Resource count analysis
      metrics.resourceCounts = {
        totalRequests: requests.length,
        totalResponses: responses.length,
        successfulResponses: responses.filter(r => r.status >= 200 && r.status < 300).length,
        errorResponses: responses.filter(r => r.status >= 400).length
      };

      console.log(`    📈 Requests: ${requests.length}, Responses: ${responses.length}`);

    } catch (error) {
      metrics.errors.push(`Main test error: ${error.message}`);
      console.log(`    ❌ Error: ${error.message}`);
    }

    await context.close();
    return metrics;
  }

  analyzeResults() {
    console.log('\n📊 Performance Analysis:');
    console.log('─'.repeat(60));

    // Calculate averages
    const directAvg = this.calculateAverage(this.results.direct.loadTimes);
    const tunneledAvg = this.calculateAverage(this.results.tunneled.loadTimes);
    
    console.log(`🔗 Direct Average Load Time: ${directAvg.toFixed(2)}ms`);
    console.log(`⚡ Tunneled Average Load Time: ${tunneledAvg.toFixed(2)}ms`);
    
    const overhead = tunneledAvg - directAvg;
    const overheadPercent = ((overhead / directAvg) * 100).toFixed(2);
    
    console.log(`📈 Tunnel Overhead: ${overhead.toFixed(2)}ms (${overheadPercent}%)`);

    // Detailed comparison
    console.log('\n📋 Detailed Comparison:');
    console.log('─'.repeat(60));
    
    this.results.direct.loadTimes.forEach((direct, index) => {
      const tunneled = this.results.tunneled.loadTimes[index];
      if (tunneled && direct.test === tunneled.test) {
        const diff = tunneled.duration - direct.duration;
        const diffPercent = ((diff / direct.duration) * 100).toFixed(1);
        console.log(`${direct.test}: Direct ${direct.duration}ms → Tunneled ${tunneled.duration}ms (${diff > 0 ? '+' : ''}${diff}ms, ${diffPercent}%)`);
      }
    });

    // Network timing comparison
    if (this.results.direct.networkTimings && this.results.tunneled.networkTimings) {
      console.log('\n🌐 Network Timing Comparison:');
      console.log('─'.repeat(60));
      
      const directNet = this.results.direct.networkTimings;
      const tunneledNet = this.results.tunneled.networkTimings;
      
      Object.keys(directNet).forEach(key => {
        const direct = directNet[key];
        const tunneled = tunneledNet[key];
        const diff = tunneled - direct;
        console.log(`${key}: Direct ${direct}ms → Tunneled ${tunneled}ms (${diff > 0 ? '+' : ''}${diff}ms)`);
      });
    }

    // Error analysis
    console.log('\n🚨 Error Analysis:');
    console.log('─'.repeat(60));
    console.log(`Direct Connection Errors: ${this.results.direct.errors.length}`);
    console.log(`Tunneled Connection Errors: ${this.results.tunneled.errors.length}`);
    
    if (this.results.direct.errors.length > 0) {
      console.log('Direct Errors:', this.results.direct.errors);
    }
    if (this.results.tunneled.errors.length > 0) {
      console.log('Tunneled Errors:', this.results.tunneled.errors);
    }

    // Store comparison results
    this.results.comparison = {
      directAverage: directAvg,
      tunneledAverage: tunneledAvg,
      overhead: overhead,
      overheadPercent: parseFloat(overheadPercent),
      recommendation: this.getRecommendation(overhead, overheadPercent)
    };
  }

  calculateAverage(loadTimes) {
    if (!loadTimes || loadTimes.length === 0) return 0;
    const validTimes = loadTimes.filter(t => t.duration > 0);
    const sum = validTimes.reduce((acc, t) => acc + t.duration, 0);
    return sum / validTimes.length;
  }

  getRecommendation(overhead, overheadPercent) {
    if (overhead < 50) {
      return 'Excellent: QUIC tunnel adds minimal overhead';
    } else if (overhead < 200) {
      return 'Good: QUIC tunnel performance is acceptable';
    } else if (overhead < 500) {
      return 'Fair: QUIC tunnel has noticeable overhead';
    } else {
      return 'Poor: QUIC tunnel adds significant overhead - investigate issues';
    }
  }

  saveResults() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `logs/performance-test-${timestamp}.json`;
    
    const fullResults = {
      timestamp: new Date().toISOString(),
      ...this.results
    };

    try {
      fs.writeFileSync(filename, JSON.stringify(fullResults, null, 2));
      console.log(`\n💾 Results saved to: ${filename}`);
    } catch (error) {
      console.error('❌ Failed to save results:', error);
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the test
async function main() {
  const test = new QuicPerformanceTest();
  await test.runTest();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = QuicPerformanceTest; 