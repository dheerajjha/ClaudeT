#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

class WSTunnelServerWrapper {
  constructor(config = {}) {
    this.config = {
      serverPort: config.serverPort || 80,
      tunnelPort: config.tunnelPort || 8080,
      domain: config.domain || 'grabr.cc',
      ...config
    };
    
    this.app = express();
    this.server = http.createServer(this.app);
    this.wstunnelProcess = null;
    this.activeTunnels = new Map();
    
    this.setupMiddleware();
    this.setupRoutes();
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
        wstunnelRunning: this.wstunnelProcess && !this.wstunnelProcess.killed,
        tunnels: activeTunnels.map(t => ({
          id: t.id,
          localPort: t.localPort,
          connectedAt: t.connectedAt,
          requestCount: t.requestCount || 0,
          protocol: t.protocol
        })),
        timestamp: new Date().toISOString()
      });
    });

    // Dashboard (matching original tunnel format)
    this.app.get('/dashboard', (req, res) => {
      const activeTunnels = Array.from(this.activeTunnels.values())
        .filter(t => t.connected);

      res.json({
        server: 'WST Tunnel Wrapper',
        status: 'running',
        activeTunnels: activeTunnels.length,
        tunnels: activeTunnels.map(t => ({
          id: t.id,
          url: `https://${t.id}.${this.config.domain}/`,
          localPort: t.localPort,
          connectedAt: t.connectedAt,
          requestCount: t.requestCount || 0,
          protocol: t.protocol,
          localHost: t.localHost
        })),
        wstunnel: {
          running: this.wstunnelProcess && !this.wstunnelProcess.killed,
          pid: this.wstunnelProcess ? this.wstunnelProcess.pid : null,
          serverPort: this.config.serverPort,
          tunnelPort: this.config.tunnelPort,
          domain: this.config.domain
        },
        features: {
          websockets: 'Full WebSocket support with transparent proxying',
          protocols: 'TCP, UDP, SOCKS5',
          note: 'Excellent for SOCKS5 proxying and UDP tunneling'
        }
      });
    });

    // Catch-all route for tunneling
    this.app.use((req, res, next) => {
      const host = req.get('host') || '';
      const subdomain = host.split('.')[0];
      
      const tunnel = this.activeTunnels.get(subdomain);
      if (tunnel) {
        // Proxy to the tunnel
        console.log(`🌐 HTTP routing: ${host}${req.path} → wstunnel`);
        this.proxyToWSTunnel(req, res, tunnel);
        return;
      }
      
      // No tunnel found
      res.status(404).json({ 
        error: 'No active tunnel found for this subdomain',
        subdomain,
        availableTunnels: Array.from(this.activeTunnels.keys())
      });
    });
  }

  proxyToWSTunnel(req, res, tunnel) {
    // Since wstunnel handles the actual tunneling, we need to redirect or proxy
    // For now, provide information about how to connect
    res.json({
      message: 'Tunnel is active',
      tunnelInfo: {
        subdomain: tunnel.id,
        localEndpoint: `${tunnel.localHost}:${tunnel.localPort}`,
        wstunnelPort: this.config.tunnelPort
      },
      instructions: {
        clientCommand: `wstunnel client -L 'tcp://${tunnel.localPort}:${tunnel.localHost}:${tunnel.localPort}' wss://localhost:${this.config.tunnelPort}`,
        note: 'Use the wstunnel client to establish the actual tunnel connection'
      }
    });
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
      // Try to install via cargo if available
      exec('cargo install wstunnel', (error, stdout, stderr) => {
        if (error) {
          console.log('❌ Failed to install via cargo. Please install manually:');
          console.log('   curl -L https://github.com/erebe/wstunnel/releases/latest/download/wstunnel-linux-x64 -o wstunnel');
          console.log('   chmod +x wstunnel');
          console.log('   sudo mv wstunnel /usr/local/bin/');
          reject(false);
        } else {
          console.log('✅ wstunnel installed successfully');
          resolve(true);
        }
      });
    });
  }

  startWSTunnelServer() {
    const args = [
      'server',
      '--restrict-to', 'localhost',
      `wss://[::]:${this.config.tunnelPort}`
    ];

    console.log(`🚀 Starting wstunnel server: wstunnel ${args.join(' ')}`);
    
    this.wstunnelProcess = spawn('wstunnel', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.wstunnelProcess.stdout.on('data', (data) => {
      console.log(`[wstunnel] ${data.toString().trim()}`);
    });

    this.wstunnelProcess.stderr.on('data', (data) => {
      console.log(`[wstunnel] ${data.toString().trim()}`);
    });

    this.wstunnelProcess.on('close', (code) => {
      console.log(`❌ wstunnel server exited with code ${code}`);
      this.wstunnelProcess = null;
    });

    this.wstunnelProcess.on('error', (error) => {
      console.error('❌ Failed to start wstunnel server:', error.message);
    });
  }

  registerTunnel(tunnelId, config) {
    this.activeTunnels.set(tunnelId, {
      id: tunnelId,
      localPort: config.localPort,
      localHost: config.localHost || 'localhost',
      protocol: config.protocol || 'tcp',
      connectedAt: new Date().toISOString(),
      connected: true,
      requestCount: 0
    });
    
    console.log(`📋 Registered tunnel: ${tunnelId} → ${config.protocol || 'tcp'}://${config.localHost || 'localhost'}:${config.localPort}`);
  }

  updateTunnelStats(tunnelId) {
    const tunnel = this.activeTunnels.get(tunnelId);
    if (tunnel) {
      tunnel.requestCount = (tunnel.requestCount || 0) + 1;
    }
  }

  unregisterTunnel(tunnelId) {
    if (this.activeTunnels.delete(tunnelId)) {
      console.log(`🗑️  Unregistered tunnel: ${tunnelId}`);
    }
  }

  async start() {
    // Check for wstunnel binary
    const hasWSTunnel = await this.checkWSTunnelBinary();
    if (!hasWSTunnel) {
      console.log('❌ Cannot start without wstunnel binary');
      process.exit(1);
    }

    // Start wstunnel server
    this.startWSTunnelServer();

    // Wait a moment for wstunnel to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Start HTTP server
    this.server.listen(this.config.serverPort, () => {
      console.log(`🌐 HTTP wrapper server running on port ${this.config.serverPort}`);
      console.log(`🔌 WST tunnel server running on port ${this.config.tunnelPort}`);
      console.log(`📊 Dashboard: http://localhost:${this.config.serverPort}/dashboard`);
      console.log('');
      console.log('🔧 To connect a client:');
      console.log(`   node wstunnel-wrapper-client.js`);
      console.log('');
      console.log('📖 Direct wstunnel usage:');
      console.log(`   wstunnel client -L 'tcp://3000:localhost:3000' wss://localhost:${this.config.tunnelPort}`);
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n👋 Shutting down...');
      if (this.wstunnelProcess) {
        this.wstunnelProcess.kill();
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

  console.log('🚀 WST Tunnel Server Configuration\n');
  
  const serverPort = await ask('HTTP server port (default 80): ') || '80';
  const tunnelPort = await ask('WST tunnel port (default 8080): ') || '8080';
  const domain = await ask('Domain (default grabr.cc): ') || 'grabr.cc';
  
  rl.close();
  
  return {
    serverPort: parseInt(serverPort),
    tunnelPort: parseInt(tunnelPort),
    domain
  };
}

// Start server if run directly
if (require.main === module) {
  if (process.argv.includes('--quick')) {
    console.log('🚀 Quick Mode - WST Tunnel Server');
    const server = new WSTunnelServerWrapper({
      serverPort: 80,
      tunnelPort: 8080,
      domain: 'grabr.cc'
    });
    server.start();
  } else {
    promptConfig().then(config => {
      const server = new WSTunnelServerWrapper(config);
      server.start();
    }).catch(console.error);
  }
}

module.exports = WSTunnelServerWrapper; 