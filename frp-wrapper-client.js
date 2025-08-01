#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const readline = require('readline');
const net = require('net');
const fs = require('fs');

class FRPClientWrapper {
  constructor(config = {}) {
    this.config = {
      serverAddr: config.serverAddr || '20.193.143.179',
      serverPort: config.serverPort || 7000,
      token: config.token || null,
      localPort: config.localPort || 3000,
      localHost: config.localHost || 'localhost',
      remotePort: config.remotePort || null,
      subdomain: config.subdomain || null,
      customDomain: config.customDomain || null,
      proxyName: config.proxyName || 'tunnel',
      proxyType: config.proxyType || 'tcp',
      ...config
    };
    
    this.frpcProcess = null;
    this.isConnected = false;
    this.activeProxies = [];
  }

  async checkFRPBinary() {
    return new Promise((resolve) => {
      exec('frpc --version', (error, stdout, stderr) => {
        if (error) {
          console.log('❌ frpc binary not found. Installing...');
          this.installFRP().then(resolve).catch(() => resolve(false));
        } else {
          console.log(`✅ frpc found: ${stdout.trim() || stderr.trim()}`);
          resolve(true);
        }
      });
    });
  }

  async installFRP() {
    console.log('📦 Installing FRP binaries...');
    
    return new Promise((resolve, reject) => {
      const platform = process.platform;
      const arch = process.arch;
      
      let downloadUrl;
      let filename;
      
      // Determine download URL based on platform
      const version = 'v0.63.0'; // Latest stable version
      
      switch (platform) {
        case 'darwin':
          if (arch === 'arm64') {
            downloadUrl = `https://github.com/fatedier/frp/releases/download/${version}/frp_${version.substring(1)}_darwin_arm64.tar.gz`;
          } else {
            downloadUrl = `https://github.com/fatedier/frp/releases/download/${version}/frp_${version.substring(1)}_darwin_amd64.tar.gz`;
          }
          filename = `frp_${version.substring(1)}_darwin_${arch === 'arm64' ? 'arm64' : 'amd64'}.tar.gz`;
          break;
        case 'linux':
          if (arch === 'arm64') {
            downloadUrl = `https://github.com/fatedier/frp/releases/download/${version}/frp_${version.substring(1)}_linux_arm64.tar.gz`;
          } else {
            downloadUrl = `https://github.com/fatedier/frp/releases/download/${version}/frp_${version.substring(1)}_linux_amd64.tar.gz`;
          }
          filename = `frp_${version.substring(1)}_linux_${arch === 'arm64' ? 'arm64' : 'amd64'}.tar.gz`;
          break;
        case 'win32':
          downloadUrl = `https://github.com/fatedier/frp/releases/download/${version}/frp_${version.substring(1)}_windows_amd64.zip`;
          filename = `frp_${version.substring(1)}_windows_amd64.zip`;
          break;
        default:
          console.log('❌ Unsupported platform. Please install FRP manually.');
          reject(false);
          return;
      }

      console.log(`📥 Downloading FRP ${version} for ${platform}-${arch}...`);
      
      const extractCmd = platform === 'win32' ? 
        `curl -L "${downloadUrl}" -o ${filename} && unzip ${filename} && mv frp_*/frps* . && mv frp_*/frpc* .` :
        `curl -L "${downloadUrl}" -o ${filename} && tar -xzf ${filename} && mv frp_*/frps . && mv frp_*/frpc . && chmod +x frps frpc`;
      
      exec(extractCmd, (error, stdout, stderr) => {
        if (error) {
          console.log('❌ Failed to download FRP. Please install manually:');
          console.log(`   ${downloadUrl}`);
          console.log('   Extract and place frps and frpc in PATH');
          reject(false);
        } else {
          console.log('✅ FRP downloaded and extracted successfully');
          console.log('💡 Consider moving frps and frpc to /usr/local/bin/ for global access');
          resolve(true);
        }
      });
    });
  }

  createFRPCConfig() {
    const configPath = 'frpc.toml';
    
    let config = `# FRP Client Configuration
serverAddr = "${this.config.serverAddr}"
serverPort = ${this.config.serverPort}

# Authentication
auth.method = "token"
auth.token = "${this.config.token}"

# Log configuration
log.to = "console"
log.level = "info"

# Transport settings
transport.poolCount = 1

`;

    // Add proxy configurations
    for (const proxy of this.activeProxies) {
      config += this.generateProxyConfig(proxy);
    }

    fs.writeFileSync(configPath, config);
    console.log(`📝 Created FRP client config: ${configPath}`);
    return configPath;
  }

  generateProxyConfig(proxy) {
    let config = `[[proxies]]
name = "${proxy.name}"
type = "${proxy.type}"
localIP = "${proxy.localHost}"
localPort = ${proxy.localPort}
`;

    switch (proxy.type) {
      case 'tcp':
        if (proxy.remotePort) {
          config += `remotePort = ${proxy.remotePort}\n`;
        }
        break;
      case 'udp':
        if (proxy.remotePort) {
          config += `remotePort = ${proxy.remotePort}\n`;
        }
        break;
      case 'http':
        if (proxy.subdomain) {
          config += `subdomain = "${proxy.subdomain}"\n`;
        }
        if (proxy.customDomain) {
          config += `customDomains = ["${proxy.customDomain}"]\n`;
        }
        if (proxy.locations) {
          config += `locations = [${proxy.locations.map(l => `"${l}"`).join(', ')}]\n`;
        }
        break;
      case 'https':
        if (proxy.subdomain) {
          config += `subdomain = "${proxy.subdomain}"\n`;
        }
        if (proxy.customDomain) {
          config += `customDomains = ["${proxy.customDomain}"]\n`;
        }
        break;
    }

    config += '\n';
    return config;
  }

  addProxy(proxyConfig) {
    this.activeProxies.push({
      name: proxyConfig.name || `proxy-${this.activeProxies.length + 1}`,
      type: proxyConfig.type || 'tcp',
      localHost: proxyConfig.localHost || 'localhost',
      localPort: proxyConfig.localPort,
      remotePort: proxyConfig.remotePort,
      subdomain: proxyConfig.subdomain,
      customDomain: proxyConfig.customDomain,
      locations: proxyConfig.locations
    });
  }

  startTunnel() {
    if (this.activeProxies.length === 0) {
      // Add default proxy
      this.addProxy({
        name: this.config.proxyName,
        type: this.config.proxyType,
        localHost: this.config.localHost,
        localPort: this.config.localPort,
        remotePort: this.config.remotePort,
        subdomain: this.config.subdomain,
        customDomain: this.config.customDomain
      });
    }

    const configPath = this.createFRPCConfig();
    
    console.log(`🚀 Starting FRP client with config: ${configPath}`);
    console.log(`🔌 Connecting to: ${this.config.serverAddr}:${this.config.serverPort}`);
    
    for (const proxy of this.activeProxies) {
      console.log(`⬅️  ${proxy.type.toUpperCase()}: ${proxy.localHost}:${proxy.localPort} → ${this.getProxyUrl(proxy)}`);
    }
    
    this.frpcProcess = spawn('./frpc', ['-c', configPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.frpcProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      console.log(`[frpc] ${output}`);
      
      // Check for connection success
      if (output.includes('login to server success') || output.includes('start proxy success')) {
        this.isConnected = true;
        console.log('✅ Tunnel established successfully!');
      }
      
      // Parse proxy URLs
      if (output.includes('proxy added') || output.includes('remote address')) {
        this.parseProxyInfo(output);
      }
    });

    this.frpcProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      console.log(`[frpc] ${output}`);
      
      if (output.includes('login to server success')) {
        this.isConnected = true;
        console.log('✅ Connected to FRP server!');
      }
    });

    this.frpcProcess.on('close', (code) => {
      console.log(`❌ FRP client exited with code ${code}`);
      this.isConnected = false;
      this.frpcProcess = null;
    });

    this.frpcProcess.on('error', (error) => {
      console.error('❌ Failed to start FRP client:', error.message);
      this.isConnected = false;
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n👋 Shutting down tunnel...');
      this.disconnect();
      process.exit(0);
    });
  }

  parseProxyInfo(logLine) {
    // Parse FRP log lines to extract proxy information
    console.log(`📋 Proxy info: ${logLine}`);
  }

  getProxyUrl(proxy) {
    switch (proxy.type) {
      case 'tcp':
      case 'udp':
        return `${proxy.type}://server:${proxy.remotePort || 'auto'}`;
      case 'http':
        if (proxy.customDomain) {
          return `http://${proxy.customDomain}`;
        } else if (proxy.subdomain) {
          return `http://${proxy.subdomain}.domain.com`;
        }
        return 'http://auto-assigned';
      case 'https':
        if (proxy.customDomain) {
          return `https://${proxy.customDomain}`;
        } else if (proxy.subdomain) {
          return `https://${proxy.subdomain}.domain.com`;
        }
        return 'https://auto-assigned';
      default:
        return 'auto-assigned';
    }
  }

  disconnect() {
    if (this.frpcProcess) {
      this.frpcProcess.kill();
      this.frpcProcess = null;
    }
    this.isConnected = false;
  }

  async testLocalServer(port, host = 'localhost') {
    return new Promise((resolve) => {
      const testSocket = new net.Socket();
      testSocket.setTimeout(3000);
      
      testSocket.connect(port, host, () => {
        console.log(`✅ Local server is running on ${host}:${port}`);
        testSocket.destroy();
        resolve(true);
      });
      
      testSocket.on('error', () => {
        console.log(`❌ No server running on ${host}:${port}`);
        console.log('💡 Make sure your local service is running before starting the tunnel');
        resolve(false);
      });
      
      testSocket.on('timeout', () => {
        console.log(`⏰ Timeout connecting to ${host}:${port}`);
        testSocket.destroy();
        resolve(false);
      });
    });
  }

  async connect() {
    // Check for FRP binary
    const hasFRP = await this.checkFRPBinary();
    if (!hasFRP) {
      console.log('❌ Cannot start without FRP binary');
      return false;
    }

    // Test local servers for active proxies
    for (const proxy of this.activeProxies) {
      const serverRunning = await this.testLocalServer(proxy.localPort, proxy.localHost);
      if (!serverRunning) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const answer = await new Promise(resolve => {
          rl.question(`Continue with ${proxy.name} anyway? (y/n): `, resolve);
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
  console.log('🚀 FRP Client Configuration\n');
  
  const proxyType = await ask('Proxy type (tcp/udp/http/https, default tcp): ') || 'tcp';
  const localPort = await ask('Local port (default 3000): ') || '3000';
  const localHost = await ask('Local host (default localhost): ') || 'localhost';
  const serverAddr = await ask('Server address (default 20.193.143.179): ') || '20.193.143.179';
  const serverPort = await ask('Server port (default 7000): ') || '7000';
  const token = await ask('Auth token (required): ');
  
  if (!token) {
    console.log('❌ Auth token is required for FRP');
    process.exit(1);
  }
  
  let remotePort, subdomain, customDomain;
  
  if (proxyType === 'tcp' || proxyType === 'udp') {
    remotePort = await ask(`Remote ${proxyType.toUpperCase()} port (optional): `) || null;
  } else if (proxyType === 'http' || proxyType === 'https') {
    subdomain = await ask('Subdomain (optional): ') || null;
    customDomain = await ask('Custom domain (optional): ') || null;
  }
  
  return {
    proxyType,
    localPort: parseInt(localPort),
    localHost,
    serverAddr,
    serverPort: parseInt(serverPort),
    token,
    remotePort: remotePort ? parseInt(remotePort) : null,
    subdomain,
    customDomain
  };
}

async function startMultiProxyClient() {
  const client = new FRPClientWrapper();
  
  console.log('\n🌟 Multi-Proxy FRP Setup');
  console.log('Add multiple services (press Enter with empty port to finish):\n');
  
  // Get server config first
  const serverAddr = await ask('Server address (default 20.193.143.179): ') || '20.193.143.179';
  const serverPort = await ask('Server port (default 7000): ') || '7000';
  const token = await ask('Auth token (required): ');
  
  if (!token) {
    console.log('❌ Auth token is required for FRP');
    process.exit(1);
  }
  
  client.config.serverAddr = serverAddr;
  client.config.serverPort = parseInt(serverPort);
  client.config.token = token;
  
  while (true) {
    const port = await ask('Enter local port (or press Enter to finish): ');
    if (!port) break;
    
    const proxyType = await ask(`Proxy type for port ${port} (tcp/udp/http/https, default tcp): `) || 'tcp';
    const name = await ask(`Proxy name for port ${port} (optional): `) || `proxy-${port}`;
    
    // Validate port
    const portNum = parseInt(port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      console.log('❌ Invalid port number, skipping...');
      continue;
    }
    
    const proxyConfig = {
      name,
      type: proxyType,
      localPort: portNum
    };
    
    if (proxyType === 'tcp' || proxyType === 'udp') {
      const remotePort = await ask(`Remote ${proxyType.toUpperCase()} port for ${name} (optional): `) || null;
      if (remotePort) proxyConfig.remotePort = parseInt(remotePort);
    } else if (proxyType === 'http' || proxyType === 'https') {
      const subdomain = await ask(`Subdomain for ${name} (optional): `) || null;
      const customDomain = await ask(`Custom domain for ${name} (optional): `) || null;
      if (subdomain) proxyConfig.subdomain = subdomain;
      if (customDomain) proxyConfig.customDomain = customDomain;
    }
    
    client.addProxy(proxyConfig);
    console.log(`✅ Added: ${name} (${proxyType}://localhost:${port})`);
  }
  
  if (client.activeProxies.length === 0) {
    console.log('❌ No proxies configured. Exiting...');
    process.exit(0);
  }
  
  console.log(`\n📋 Starting ${client.activeProxies.length} FRP proxy(ies):`);
  await client.connect();
}

async function startClient() {
  console.log('🚀 FRP Client\n');
  
  const multiProxy = await ask('Configure multiple proxies? (y/n, default n): ');
  
  if (multiProxy.toLowerCase() === 'y') {
    await startMultiProxyClient();
  } else {
    const config = await promptConfig();
    
    console.log('\n📋 Configuration:');
    console.log(`   Type: ${config.proxyType}`);
    console.log(`   Local: ${config.localHost}:${config.localPort}`);
    console.log(`   Server: ${config.serverAddr}:${config.serverPort}`);
    if (config.remotePort) {
      console.log(`   Remote Port: ${config.remotePort}`);
    }
    if (config.subdomain) {
      console.log(`   Subdomain: ${config.subdomain}`);
    }
    if (config.customDomain) {
      console.log(`   Custom Domain: ${config.customDomain}`);
    }
    console.log('');

    const client = new FRPClientWrapper(config);
    await client.connect();
  }
}

// Quick start configurations
function quickStart(mode, token) {
  switch (mode) {
    case 'web':
      return new FRPClientWrapper({
        localPort: 3000,
        proxyType: 'http',
        subdomain: 'web',
        token
      });
    case 'api':
      return new FRPClientWrapper({
        localPort: 8000,
        proxyType: 'http',
        subdomain: 'api',
        token
      });
    case 'tcp':
      return new FRPClientWrapper({
        localPort: 3000,
        proxyType: 'tcp',
        remotePort: 8000,
        token
      });
    default:
      return new FRPClientWrapper({
        localPort: 3000,
        proxyType: 'tcp',
        token
      });
  }
}

// Start client if run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--quick') || args.includes('--web')) {
    console.log('🚀 Quick Mode - FRP Client (Web HTTP)');
    console.log('📋 Using: http://localhost:3000 → web subdomain\n');
    
    ask('Auth token (required): ').then(token => {
      if (!token) {
        console.log('❌ Auth token is required');
        process.exit(1);
      }
      const client = quickStart('web', token);
      client.connect();
    });
  } else if (args.includes('--api')) {
    console.log('🚀 Quick Mode - FRP Client (API HTTP)');
    console.log('📋 Using: http://localhost:8000 → api subdomain\n');
    
    ask('Auth token (required): ').then(token => {
      if (!token) {
        console.log('❌ Auth token is required');
        process.exit(1);
      }
      const client = quickStart('api', token);
      client.connect();
    });
  } else if (args.includes('--tcp')) {
    console.log('🚀 Quick Mode - FRP Client (TCP)');
    console.log('📋 Using: tcp://localhost:3000 → remote port 8000\n');
    
    ask('Auth token (required): ').then(token => {
      if (!token) {
        console.log('❌ Auth token is required');
        process.exit(1);
      }
      const client = quickStart('tcp', token);
      client.connect();
    });
  } else {
    startClient().catch(console.error);
  }
}

module.exports = FRPClientWrapper; 