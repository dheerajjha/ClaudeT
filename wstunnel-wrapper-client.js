#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const readline = require('readline');
const net = require('net');

class WSTunnelClientWrapper {
  constructor(config = {}) {
    this.config = {
      serverHost: config.serverHost || '20.193.143.179',
      serverPort: config.serverPort || 8080,
      localPort: config.localPort || 3000,
      localHost: config.localHost || 'localhost',
      subdomain: config.subdomain || null,
      protocol: config.protocol || 'tcp',
      ...config
    };
    
    this.wstunnelProcess = null;
    this.isConnected = false;
  }

  async checkWSTunnelBinary() {
    return new Promise((resolve) => {
      exec('wstunnel --version', (error, stdout, stderr) => {
        if (error) {
          console.log('❌ wstunnel binary not found. Installing...');
          this.installWSTunnel().then(resolve).catch(() => resolve(false));
        } else {
          console.log(`✅ wstunnel found: ${stdout.trim()}`);
          resolve(true);
        }
      });
    });
  }

  async installWSTunnel() {
    console.log('📦 Installing wstunnel binary...');
    
    return new Promise((resolve, reject) => {
      const platform = process.platform;
      let downloadUrl;
      
      switch (platform) {
        case 'darwin':
          downloadUrl = 'https://github.com/erebe/wstunnel/releases/latest/download/wstunnel-macos';
          break;
        case 'linux':
          downloadUrl = 'https://github.com/erebe/wstunnel/releases/latest/download/wstunnel-linux-x64';
          break;
        case 'win32':
          downloadUrl = 'https://github.com/erebe/wstunnel/releases/latest/download/wstunnel-windows-x64.exe';
          break;
        default:
          console.log('❌ Unsupported platform. Please install wstunnel manually.');
          reject(false);
          return;
      }

      console.log(`📥 Downloading wstunnel for ${platform}...`);
      const filename = platform === 'win32' ? 'wstunnel.exe' : 'wstunnel';
      
      exec(`curl -L "${downloadUrl}" -o ${filename} && chmod +x ${filename}`, (error, stdout, stderr) => {
        if (error) {
          console.log('❌ Failed to download wstunnel. Please install manually:');
          console.log(`   curl -L ${downloadUrl} -o ${filename}`);
          console.log(`   chmod +x ${filename}`);
          console.log(`   sudo mv ${filename} /usr/local/bin/`);
          reject(false);
        } else {
          console.log('✅ wstunnel downloaded successfully');
          console.log('💡 Consider moving it to /usr/local/bin/ for global access');
          resolve(true);
        }
      });
    });
  }

  startTunnel() {
    const wsUrl = `wss://${this.config.serverHost}:${this.config.serverPort}`;
    
    // Build tunnel specification based on protocol
    let tunnelSpec;
    switch (this.config.protocol) {
      case 'tcp':
        tunnelSpec = `tcp://${this.config.localPort}:${this.config.localHost}:${this.config.localPort}`;
        break;
      case 'udp':
        tunnelSpec = `udp://${this.config.localPort}:${this.config.localHost}:${this.config.localPort}?timeout_sec=0`;
        break;
      case 'socks5':
        tunnelSpec = `socks5://${this.config.localHost}:${this.config.localPort}`;
        break;
      default:
        tunnelSpec = `tcp://${this.config.localPort}:${this.config.localHost}:${this.config.localPort}`;
    }

    const args = [
      'client',
      '-L', tunnelSpec,
      wsUrl
    ];

    // Add additional options
    if (this.config.subdomain) {
      args.push('--http-upgrade-path-prefix', this.config.subdomain);
    }

    console.log(`🚀 Starting wstunnel client: wstunnel ${args.join(' ')}`);
    console.log(`🔌 Connecting to: ${wsUrl}`);
    console.log(`⬅️  Local: ${this.config.protocol}://${this.config.localHost}:${this.config.localPort}`);
    
    this.wstunnelProcess = spawn('wstunnel', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.wstunnelProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      console.log(`[wstunnel] ${output}`);
      
      // Check for connection success
      if (output.includes('connected') || output.includes('listening')) {
        this.isConnected = true;
        console.log('✅ Tunnel established successfully!');
      }
    });

    this.wstunnelProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      console.log(`[wstunnel] ${output}`);
      
      // Check for connection success in stderr too
      if (output.includes('connected') || output.includes('listening')) {
        this.isConnected = true;
        console.log('✅ Tunnel established successfully!');
      }
    });

    this.wstunnelProcess.on('close', (code) => {
      console.log(`❌ wstunnel client exited with code ${code}`);
      this.isConnected = false;
      this.wstunnelProcess = null;
    });

    this.wstunnelProcess.on('error', (error) => {
      console.error('❌ Failed to start wstunnel client:', error.message);
      this.isConnected = false;
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n👋 Shutting down tunnel...');
      this.disconnect();
      process.exit(0);
    });
  }

  disconnect() {
    if (this.wstunnelProcess) {
      this.wstunnelProcess.kill();
      this.wstunnelProcess = null;
    }
    this.isConnected = false;
  }

  async testLocalServer() {
    if (this.config.protocol === 'socks5') {
      console.log('ℹ️  SOCKS5 mode - skipping local server test');
      return true;
    }

    return new Promise((resolve) => {
      const testSocket = new net.Socket();
      testSocket.setTimeout(3000);
      
      testSocket.connect(this.config.localPort, this.config.localHost, () => {
        console.log(`✅ Local server is running on ${this.config.localHost}:${this.config.localPort}`);
        testSocket.destroy();
        resolve(true);
      });
      
      testSocket.on('error', () => {
        console.log(`❌ No server running on ${this.config.localHost}:${this.config.localPort}`);
        console.log('💡 Make sure your local service is running before starting the tunnel');
        resolve(false);
      });
      
      testSocket.on('timeout', () => {
        console.log(`⏰ Timeout connecting to ${this.config.localHost}:${this.config.localPort}`);
        testSocket.destroy();
        resolve(false);
      });
    });
  }

  async connect() {
    // Check for wstunnel binary
    const hasWSTunnel = await this.checkWSTunnelBinary();
    if (!hasWSTunnel) {
      console.log('❌ Cannot start without wstunnel binary');
      return false;
    }

    // Test local server (unless SOCKS5 mode)
    if (this.config.protocol !== 'socks5') {
      const serverRunning = await this.testLocalServer();
      if (!serverRunning) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const answer = await new Promise(resolve => {
          rl.question('Continue anyway? (y/n): ', resolve);
        });
        rl.close();
        
        if (answer.toLowerCase() !== 'y') {
          return false;
        }
      }
    }

    // Start tunnel
    this.startTunnel();
    return true;
  }
}

async function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptConfig() {
  console.log('🚀 WST Tunnel Client Configuration\n');
  
  const protocol = await ask('Protocol (tcp/udp/socks5, default tcp): ') || 'tcp';
  const localPort = await ask('Local port (default 3000): ') || '3000';
  const localHost = await ask('Local host (default localhost): ') || 'localhost';
  const serverHost = await ask('Server host (default 20.193.143.179): ') || '20.193.143.179';
  const serverPort = await ask('Server port (default 8080): ') || '8080';
  const subdomain = await ask('Subdomain prefix (optional): ') || null;
  
  return {
    protocol,
    localPort: parseInt(localPort),
    localHost,
    serverHost,
    serverPort: parseInt(serverPort),
    subdomain
  };
}

async function startMultiPortClient() {
  const clients = [];
  
  console.log('\n🌟 Multi-Port WST Tunnel Setup');
  console.log('Add multiple services (press Enter with empty port to finish):\n');
  
  while (true) {
    const port = await ask('Enter port (or press Enter to finish): ');
    if (!port) break;
    
    const protocol = await ask(`Protocol for port ${port} (tcp/udp/socks5, default tcp): `) || 'tcp';
    const subdomain = await ask(`Subdomain prefix for port ${port} (optional): `) || null;
    
    // Validate port
    const portNum = parseInt(port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      console.log('❌ Invalid port number, skipping...');
      continue;
    }
    
    clients.push({
      port: portNum,
      protocol,
      subdomain,
      client: new WSTunnelClientWrapper({
        localPort: portNum,
        protocol,
        subdomain
      })
    });
    
    console.log(`✅ Added: ${protocol}://localhost:${port} ${subdomain ? `→ ${subdomain}` : ''}`);
  }
  
  if (clients.length === 0) {
    console.log('❌ No ports specified. Exiting...');
    process.exit(0);
  }
  
  console.log(`\n📋 Starting ${clients.length} WST tunnel(s):`);
  
  // Setup shutdown handler for all clients
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down all tunnels...');
    clients.forEach(({ client }) => client.disconnect());
    process.exit(0);
  });
  
  // Connect all clients
  for (const { port, protocol, subdomain, client } of clients) {
    console.log(`\n🔌 Setting up ${protocol} tunnel for port ${port}...`);
    await client.connect();
    
    // Small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`\n🎉 All ${clients.length} WST tunnels are starting up!`);
  console.log('Monitor the logs above for connection status 🌐');
}

async function startClient() {
  console.log('🚀 WST Tunnel Client\n');
  
  const multiPort = await ask('Tunnel multiple ports? (y/n, default n): ');
  
  if (multiPort.toLowerCase() === 'y') {
    await startMultiPortClient();
  } else {
    const config = await promptConfig();
    
    console.log('\n📋 Configuration:');
    console.log(`   Protocol: ${config.protocol}`);
    console.log(`   Local: ${config.localHost}:${config.localPort}`);
    console.log(`   Server: wss://${config.serverHost}:${config.serverPort}`);
    if (config.subdomain) {
      console.log(`   Subdomain: ${config.subdomain}`);
    }
    console.log('');

    const client = new WSTunnelClientWrapper(config);
    await client.connect();
  }
}

// Quick start configurations
function quickStart(mode) {
  switch (mode) {
    case 'web':
      return new WSTunnelClientWrapper({
        localPort: 3000,
        protocol: 'tcp',
        subdomain: 'web'
      });
    case 'api':
      return new WSTunnelClientWrapper({
        localPort: 8000,
        protocol: 'tcp',
        subdomain: 'api'
      });
    case 'socks':
      return new WSTunnelClientWrapper({
        localPort: 1080,
        protocol: 'socks5'
      });
    default:
      return new WSTunnelClientWrapper({
        localPort: 3000,
        protocol: 'tcp'
      });
  }
}

// Start client if run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--quick') || args.includes('--web')) {
    console.log('🚀 Quick Mode - WST Tunnel Client (Web)');
    console.log('📋 Using: tcp://localhost:3000 → web subdomain\n');
    const client = quickStart('web');
    client.connect();
  } else if (args.includes('--api')) {
    console.log('🚀 Quick Mode - WST Tunnel Client (API)');
    console.log('📋 Using: tcp://localhost:8000 → api subdomain\n');
    const client = quickStart('api');
    client.connect();
  } else if (args.includes('--socks')) {
    console.log('🚀 Quick Mode - WST Tunnel Client (SOCKS5)');
    console.log('📋 Using: socks5://localhost:1080\n');
    const client = quickStart('socks');
    client.connect();
  } else {
    startClient().catch(console.error);
  }
}

module.exports = WSTunnelClientWrapper; 