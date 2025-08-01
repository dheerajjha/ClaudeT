#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

class FRPServerWrapper {
  constructor(config = {}) {
    this.config = {
      serverPort: config.serverPort || 80,
      bindPort: config.bindPort || 7000,
      dashboardPort: config.dashboardPort || 7500,
      vhostHTTPPort: config.vhostHTTPPort || 8080,
      vhostHTTPSPort: config.vhostHTTPSPort || 8443,
      token: config.token || this.generateToken(),
      domain: config.domain || 'grabr.cc',
      ...config
    };
    
    this.app = express();
    this.server = http.createServer(this.app);
    this.frpsProcess = null;
    this.activeTunnels = new Map();
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  generateToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  setupMiddleware() {
    this.app.use(express.json());
    
    // CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });
  }

  setupRoutes() {
    // Health check (matching original tunnel format)
    this.app.get('/health', (req, res) => {
      const activeTunnels = Array.from(this.activeTunnels.values())
        .filter(t => t.connected);

      res.json({
        status: 'healthy',
        activeTunnels: activeTunnels.length,
        frpsRunning: this.frpsProcess && !this.frpsProcess.killed,
        tunnels: activeTunnels.map(t => ({
          id: t.id,
          localPort: t.localPort,
          connectedAt: t.connectedAt,
          requestCount: t.requestCount || 0,
          type: t.type
        })),
        timestamp: new Date().toISOString()
      });
    });

    // Dashboard (matching original tunnel format)
    this.app.get('/dashboard', (req, res) => {
      const activeTunnels = Array.from(this.activeTunnels.values())
        .filter(t => t.connected);

      res.json({
        server: 'FRP Server Wrapper',
        status: 'running',
        activeTunnels: activeTunnels.length,
        tunnels: activeTunnels.map(t => ({
          id: t.id,
          url: this.getTunnelUrl(t),
          localPort: t.localPort,
          connectedAt: t.connectedAt,
          requestCount: t.requestCount || 0,
          type: t.type,
          subdomain: t.subdomain,
          customDomain: t.customDomain
        })),
        frp: {
          running: this.frpsProcess && !this.frpsProcess.killed,
          pid: this.frpsProcess ? this.frpsProcess.pid : null,
          dashboardUrl: `http://localhost:${this.config.dashboardPort}`,
          token: this.config.token,
          bindPort: this.config.bindPort,
          vhostHTTPPort: this.config.vhostHTTPPort,
          vhostHTTPSPort: this.config.vhostHTTPSPort
        },
        limitations: {
          websockets: 'FRP has limited WebSocket support compared to original tunnel',
          note: 'For full WebSocket proxying, use the original tunnel or WST tunnel wrapper'
        }
      });
    });

    // Proxy FRP dashboard
    this.app.get('/frp-dashboard/*', (req, res) => {
      const frpUrl = `http://localhost:${this.config.dashboardPort}${req.path.replace('/frp-dashboard', '')}`;
      this.proxyRequest(req, res, frpUrl);
    });

    // Catch-all route for HTTP tunneling
    this.app.use((req, res) => {
      const host = req.get('host') || '';
      const subdomain = host.split('.')[0];
      
      const tunnel = this.findTunnelByHost(host);
      if (tunnel) {
        console.log(`🌐 HTTP routing: ${host}${req.path} → FRP tunnel ${tunnel.id}`);
        res.json({
          message: 'Tunnel is active via FRP',
          tunnelInfo: tunnel,
          note: 'FRP handles the actual HTTP proxying internally'
        });
        return;
      }
      
      res.status(404).json({ 
        error: 'No active tunnel found for this host',
        host,
        availableTunnels: Array.from(this.activeTunnels.keys())
      });
    });
  }

  findTunnelByHost(host) {
    for (const [id, tunnel] of this.activeTunnels) {
      if (tunnel.customDomain === host || 
          (tunnel.subdomain && host.startsWith(tunnel.subdomain + '.'))) {
        return { id, ...tunnel };
      }
    }
    return null;
  }

  getTunnelUrl(tunnel) {
    if (tunnel.type === 'http') {
      if (tunnel.customDomain) {
        return `http://${tunnel.customDomain}`;
      } else if (tunnel.subdomain) {
        return `http://${tunnel.subdomain}.${this.config.domain}:${this.config.vhostHTTPPort}`;
      }
    } else if (tunnel.type === 'https') {
      if (tunnel.customDomain) {
        return `https://${tunnel.customDomain}`;
      } else if (tunnel.subdomain) {
        return `https://${tunnel.subdomain}.${this.config.domain}:${this.config.vhostHTTPSPort}`;
      }
    } else if (tunnel.type === 'tcp') {
      return `tcp://localhost:${tunnel.remotePort}`;
    }
    return `${tunnel.type}://localhost:${tunnel.remotePort || tunnel.localPort}`;
  }

  async checkFRPBinary() {
    return new Promise((resolve) => {
      exec('frps --version', (error, stdout, stderr) => {
        if (error) {
          console.log('❌ frps binary not found. Installing...');
          this.installFRP().then(resolve).catch(() => resolve(false));
        } else {
          console.log(`✅ frps found: ${stdout.trim() || stderr.trim()}`);
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

  createFRPSConfig() {
    const configPath = 'frps.toml';
    const config = `# FRP Server Configuration
bindPort = ${this.config.bindPort}
vhostHTTPPort = ${this.config.vhostHTTPPort}
vhostHTTPSPort = ${this.config.vhostHTTPSPort}

# Dashboard
webServer.addr = "0.0.0.0"
webServer.port = ${this.config.dashboardPort}
webServer.user = "admin"
webServer.password = "admin"

# Authentication
auth.method = "token"
auth.token = "${this.config.token}"

# Subdomain configuration
subDomainHost = "${this.config.domain}"

# Log configuration
log.to = "console"
log.level = "info"

# Transport settings
transport.maxPoolCount = 5
transport.maxStreamsPerPool = 10`;

    fs.writeFileSync(configPath, config);
    console.log(`📝 Created FRP server config: ${configPath}`);
    return configPath;
  }

  startFRPServer() {
    const configPath = this.createFRPSConfig();
    
    console.log(`🚀 Starting FRP server with config: ${configPath}`);
    
    this.frpsProcess = spawn('./frps', ['-c', configPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.frpsProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      console.log(`[frps] ${output}`);
      
      // Parse client connections
      if (output.includes('new proxy')) {
        this.parseProxyConnection(output);
      }
    });

    this.frpsProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      console.log(`[frps] ${output}`);
    });

    this.frpsProcess.on('close', (code) => {
      console.log(`❌ FRP server exited with code ${code}`);
      this.frpsProcess = null;
    });

    this.frpsProcess.on('error', (error) => {
      console.error('❌ Failed to start FRP server:', error.message);
    });
  }

  parseProxyConnection(logLine) {
    // Parse FRP log lines to track active proxies
    // Example: "[I] [service.go:104] new proxy [web] success"
    const match = logLine.match(/new proxy \[([^\]]+)\]/);
    if (match) {
      const proxyName = match[1];
      console.log(`📋 New proxy registered: ${proxyName}`);
    }
  }

  registerTunnel(tunnelId, config) {
    this.activeTunnels.set(tunnelId, {
      id: tunnelId,
      type: config.type || 'tcp',
      localPort: config.localPort,
      localHost: config.localHost || 'localhost',
      remotePort: config.remotePort,
      subdomain: config.subdomain,
      customDomain: config.customDomain,
      connectedAt: new Date().toISOString(),
      connected: true,
      requestCount: 0
    });
    
    console.log(`📋 Registered tunnel: ${tunnelId} → ${config.type}://${config.localHost || 'localhost'}:${config.localPort}`);
  }

  updateTunnelStats(tunnelId) {
    const tunnel = this.activeTunnels.get(tunnelId);
    if (tunnel) {
      tunnel.requestCount = (tunnel.requestCount || 0) + 1;
    }
  }

  async start() {
    // Check for FRP binary
    const hasFRP = await this.checkFRPBinary();
    if (!hasFRP) {
      console.log('❌ Cannot start without FRP binary');
      process.exit(1);
    }

    // Start FRP server
    this.startFRPServer();

    // Wait a moment for FRP to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Start HTTP management server
    this.server.listen(this.config.serverPort, () => {
      console.log(`🌐 HTTP management server running on port ${this.config.serverPort}`);
      console.log(`🔌 FRP server running on port ${this.config.bindPort}`);
      console.log(`📊 Management Dashboard: http://localhost:${this.config.serverPort}/dashboard`);
      console.log(`🎛️  FRP Dashboard: http://localhost:${this.config.dashboardPort} (admin/admin)`);
      console.log(`🌐 HTTP Proxy: port ${this.config.vhostHTTPPort}`);
      console.log(`🔒 HTTPS Proxy: port ${this.config.vhostHTTPSPort}`);
      console.log(`🔑 Auth Token: ${this.config.token}`);
      console.log('');
      console.log('🔧 To connect a client:');
      console.log(`   node frp-wrapper-client.js`);
      console.log('');
      console.log('📖 Direct FRP usage:');
      console.log(`   frpc tcp --server_addr localhost --server_port ${this.config.bindPort} --token ${this.config.token} --proxy_name test --local_port 3000 --remote_port 8000`);
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n👋 Shutting down...');
      if (this.frpsProcess) {
        this.frpsProcess.kill();
      }
      this.server.close(() => {
        process.exit(0);
      });
    });
  }
}

async function promptConfig() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (question) => new Promise((resolve) => {
    rl.question(question, resolve);
  });

  console.log('🚀 FRP Server Configuration\n');
  
  const serverPort = await ask('HTTP management port (default 80): ') || '80';
  const bindPort = await ask('FRP bind port (default 7000): ') || '7000';
  const dashboardPort = await ask('FRP dashboard port (default 7500): ') || '7500';
  const vhostHTTPPort = await ask('HTTP vhost port (default 8080): ') || '8080';
  const vhostHTTPSPort = await ask('HTTPS vhost port (default 8443): ') || '8443';
  const domain = await ask('Domain for subdomains (default grabr.cc): ') || 'grabr.cc';
  
  rl.close();
  
  return {
    serverPort: parseInt(serverPort),
    bindPort: parseInt(bindPort),
    dashboardPort: parseInt(dashboardPort),
    vhostHTTPPort: parseInt(vhostHTTPPort),
    vhostHTTPSPort: parseInt(vhostHTTPSPort),
    domain
  };
}

// Start server if run directly
if (require.main === module) {
  if (process.argv.includes('--quick')) {
    console.log('🚀 Quick Mode - FRP Server');
    const server = new FRPServerWrapper({
      serverPort: 80,
      bindPort: 7000,
      dashboardPort: 7500,
      vhostHTTPPort: 8080,
      vhostHTTPSPort: 8443,
      domain: 'grabr.cc'
    });
    server.start();
  } else {
    promptConfig().then(config => {
      const server = new FRPServerWrapper(config);
      server.start();
    }).catch(console.error);
  }
}

module.exports = FRPServerWrapper; 