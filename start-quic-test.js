const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class QuicTestOrchestrator {
  constructor() {
    this.processes = new Map();
    this.logDir = 'logs';
    this.claudeUIPath = '../claudecodeuiTT';
  }

  async init() {
    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    
    console.log('🚀 QUIC Tunnel Test Orchestrator Starting...\n');
  }

  async startClaudeUI() {
    console.log('📦 Starting ClaudeCodeUI in background...');
    
    return new Promise((resolve, reject) => {
      const claudeUI = spawn('npm', ['run', 'dev'], {
        cwd: this.claudeUIPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      });

      let output = '';
      let hasStarted = false;

      claudeUI.stdout.on('data', (data) => {
        output += data.toString();
        console.log(`[ClaudeUI] ${data.toString().trim()}`);
        
        // Check if server has started
        if (data.toString().includes('3008') || data.toString().includes('ready')) {
          if (!hasStarted) {
            hasStarted = true;
            console.log('✅ ClaudeCodeUI started successfully on port 3008\n');
            resolve(claudeUI);
          }
        }
      });

      claudeUI.stderr.on('data', (data) => {
        console.log(`[ClaudeUI Error] ${data.toString().trim()}`);
      });

      claudeUI.on('error', (error) => {
        console.error('❌ Failed to start ClaudeCodeUI:', error);
        reject(error);
      });

      // Store process
      this.processes.set('claudeui', claudeUI);
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (!hasStarted) {
          console.log('⚠️  ClaudeUI taking longer than expected, continuing anyway...');
          resolve(claudeUI);
        }
      }, 30000);
    });
  }

  async startQuicServer() {
    console.log('⚡ Starting QUIC Server...');
    
    return new Promise((resolve, reject) => {
      const server = spawn('node', ['quic-tunnel-server.js'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let hasStarted = false;

      server.stdout.on('data', (data) => {
        console.log(`[QUIC-Server] ${data.toString().trim()}`);
        
        if (data.toString().includes('Ready') || data.toString().includes('listening')) {
          if (!hasStarted) {
            hasStarted = true;
            console.log('✅ QUIC Server started successfully\n');
            resolve(server);
          }
        }
      });

      server.stderr.on('data', (data) => {
        console.log(`[QUIC-Server Error] ${data.toString().trim()}`);
      });

      server.on('error', (error) => {
        console.error('❌ Failed to start QUIC Server:', error);
        reject(error);
      });

      this.processes.set('quicserver', server);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (!hasStarted) {
          console.log('⚠️  QUIC Server taking longer than expected, continuing anyway...');
          resolve(server);
        }
      }, 10000);
    });
  }

  async startQuicClient() {
    console.log('🔌 Starting QUIC Client...');
    
    return new Promise((resolve, reject) => {
      const client = spawn('node', ['quic-tunnel-client.js', '3008', 'claude'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let hasStarted = false;

      client.stdout.on('data', (data) => {
        console.log(`[QUIC-Client] ${data.toString().trim()}`);
        
        if (data.toString().includes('Connected') || data.toString().includes('tunnel available')) {
          if (!hasStarted) {
            hasStarted = true;
            console.log('✅ QUIC Client connected successfully\n');
            resolve(client);
          }
        }
      });

      client.stderr.on('data', (data) => {
        console.log(`[QUIC-Client Error] ${data.toString().trim()}`);
      });

      client.on('error', (error) => {
        console.error('❌ Failed to start QUIC Client:', error);
        reject(error);
      });

      this.processes.set('quicclient', client);
      
      // Timeout after 15 seconds
      setTimeout(() => {
        if (!hasStarted) {
          console.log('⚠️  QUIC Client taking longer than expected, continuing anyway...');
          resolve(client);
        }
      }, 15000);
    });
  }

  async runPerformanceTest() {
    console.log('🧪 Running Performance Tests...');
    
    return new Promise((resolve, reject) => {
      const test = spawn('node', ['test-quic-performance.js'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      test.stdout.on('data', (data) => {
        console.log(`[Test] ${data.toString().trim()}`);
      });

      test.stderr.on('data', (data) => {
        console.log(`[Test Error] ${data.toString().trim()}`);
      });

      test.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Performance tests completed successfully\n');
          resolve(true);
        } else {
          console.log(`⚠️  Performance tests exited with code ${code}\n`);
          resolve(false);
        }
      });

      test.on('error', (error) => {
        console.error('❌ Failed to run performance tests:', error);
        reject(error);
      });
    });
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async showLogSummary() {
    console.log('\n📋 Log Summary:');
    console.log('─'.repeat(50));
    
    const logFiles = ['QUIC-SERVER.log', 'QUIC-CLIENT.log'];
    
    for (const logFile of logFiles) {
      const logPath = path.join(this.logDir, logFile);
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        const lastLines = lines.slice(-10);
        
        console.log(`\n📄 ${logFile} (last 10 lines):`);
        lastLines.forEach(line => console.log(`  ${line}`));
      }
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up processes...');
    
    for (const [name, process] of this.processes) {
      try {
        console.log(`  Stopping ${name}...`);
        process.kill('SIGTERM');
        
        // Wait a bit for graceful shutdown
        await this.sleep(1000);
        
        // Force kill if still running
        if (!process.killed) {
          process.kill('SIGKILL');
        }
      } catch (error) {
        console.log(`  Warning: Could not stop ${name}:`, error.message);
      }
    }
    
    console.log('✅ Cleanup completed');
  }

  async run() {
    try {
      await this.init();
      
      // Step 1: Start ClaudeCodeUI
      await this.startClaudeUI();
      await this.sleep(3000); // Wait for UI to fully start
      
      // Step 2: Start QUIC Server
      await this.startQuicServer();
      await this.sleep(2000); // Wait for server to be ready
      
      // Step 3: Start QUIC Client
      await this.startQuicClient();
      await this.sleep(3000); // Wait for client to connect
      
      // Step 4: Run Performance Tests
      await this.runPerformanceTest();
      
      // Step 5: Show logs
      await this.showLogSummary();
      
      console.log('\n🎉 All tests completed! Check log files for detailed output.');
      console.log('📁 Log files: logs/QUIC-SERVER.log, logs/QUIC-CLIENT.log');
      console.log('🌐 Direct access: http://localhost:3008');
      console.log('⚡ Tunneled access: http://localhost:8999');
      
    } catch (error) {
      console.error('❌ Test execution failed:', error);
    } finally {
      // Keep processes running for manual testing
      console.log('\n⏸️  Processes are still running for manual testing...');
      console.log('Press Ctrl+C to stop all processes.');
      
      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\n🛑 Received shutdown signal...');
        await this.cleanup();
        process.exit(0);
      });
    }
  }
}

// Run the orchestrator
if (require.main === module) {
  const orchestrator = new QuicTestOrchestrator();
  orchestrator.run().catch(console.error);
}

module.exports = QuicTestOrchestrator; 