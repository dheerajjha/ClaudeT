#!/usr/bin/env node

const WebSocket = require('ws');
const net = require('net');
const readline = require('readline');

class WSTunnelClient {
  constructor(localPort, serverUrl, customSubdomain = null) {
    this.localPort = localPort;
    this.serverUrl = serverUrl;
    this.customSubdomain = customSubdomain;
    this.ws = null;
    this.localConnections = new Map();
    this.isConnected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      console.log(`🔗 Connecting to tunnel server: ${this.serverUrl}`);
      
      this.ws = new WebSocket(this.serverUrl);
      
      this.ws.on('open', () => {
        console.log(`✅ Connected to tunnel server`);
        this.isConnected = true;
        
        // Send configuration
        this.ws.send(JSON.stringify({
          type: 'config',
          localPort: this.localPort,
          host: this.customSubdomain
        }));
        
        resolve();
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleServerMessage(message);
        } catch (error) {
          console.error('Invalid message from server:', error);
        }
      });
      
      this.ws.on('close', () => {
        console.log(`🔌 Disconnected from tunnel server`);
        this.isConnected = false;
        
        // Close all local connections
        for (const [connId, localSocket] of this.localConnections) {
          localSocket.destroy();
        }
        this.localConnections.clear();
      });
      
      this.ws.on('error', (error) => {
        console.error(`❌ Tunnel connection error:`, error);
        reject(error);
      });
    });
  }

  handleServerMessage(message) {
    switch (message.type) {
      case 'connected':
        console.log(`🎯 Tunnel ID: ${message.tunnelId}`);
        if (this.customSubdomain) {
          console.log(`🌐 Your tunnel URL: https://${this.customSubdomain}.grabr.cc/`);
        } else {
          console.log(`🌐 Your tunnel URL: https://${message.tunnelId}.grabr.cc/`);
        }
        break;
        
      case 'tcp_connect':
        this.handleTcpConnect(message);
        break;
        
      case 'tcp_data':
        this.handleTcpData(message);
        break;
        
      case 'tcp_close':
        this.handleTcpClose(message);
        break;
        
      case 'websocket_upgrade':
        this.handleWebSocketUpgrade(message);
        break;
    }
  }

  handleTcpConnect(message) {
    const connId = message.connId;
    console.log(`🔗 New connection: ${connId}`);
    
    // Create connection to local service
    const localSocket = new net.Socket();
    this.localConnections.set(connId, localSocket);
    
    localSocket.connect(this.localPort, 'localhost', () => {
      console.log(`✅ Connected to local service: localhost:${this.localPort}`);
      
      // Send initial data if provided
      if (message.data) {
        localSocket.write(Buffer.from(message.data, 'base64'));
      }
    });
    
    localSocket.on('data', (data) => {
      // Forward data back to server
      this.ws.send(JSON.stringify({
        type: 'tcp_data',
        connId,
        data: data.toString('base64')
      }));
    });
    
    localSocket.on('end', () => {
      console.log(`🔌 Local connection closed: ${connId}`);
      this.ws.send(JSON.stringify({
        type: 'tcp_close',
        connId
      }));
      this.localConnections.delete(connId);
    });
    
    localSocket.on('error', (error) => {
      console.error(`❌ Local connection error ${connId}:`, error);
      this.ws.send(JSON.stringify({
        type: 'tcp_close',
        connId
      }));
      this.localConnections.delete(connId);
    });
  }

  handleTcpData(message) {
    const localSocket = this.localConnections.get(message.connId);
    if (localSocket) {
      localSocket.write(Buffer.from(message.data, 'base64'));
    }
  }

  handleTcpClose(message) {
    const localSocket = this.localConnections.get(message.connId);
    if (localSocket) {
      localSocket.destroy();
      this.localConnections.delete(message.connId);
    }
  }

  handleWebSocketUpgrade(message) {
    const connId = message.connId;
    console.log(`🔄 WebSocket upgrade: ${message.url}`);
    
    // Create WebSocket connection to local service
    const localWs = new WebSocket(`ws://localhost:${this.localPort}${message.url}`, {
      headers: this.filterHeaders(message.headers)
    });
    
    this.localConnections.set(connId, localWs);
    
    localWs.on('open', () => {
      console.log(`✅ WebSocket connected to local service`);
      
      // Send upgrade success back to server
      this.ws.send(JSON.stringify({
        type: 'websocket_upgrade_response',
        connId,
        success: true
      }));
    });
    
    localWs.on('message', (data) => {
      // Forward WebSocket data back to server
      this.ws.send(JSON.stringify({
        type: 'tcp_data',
        connId,
        data: Buffer.from(data).toString('base64')
      }));
    });
    
    localWs.on('close', () => {
      console.log(`🔌 WebSocket closed: ${connId}`);
      this.ws.send(JSON.stringify({
        type: 'tcp_close',
        connId
      }));
      this.localConnections.delete(connId);
    });
    
    localWs.on('error', (error) => {
      console.error(`❌ WebSocket error ${connId}:`, error);
      this.ws.send(JSON.stringify({
        type: 'websocket_upgrade_response',
        connId,
        success: false,
        error: error.message
      }));
      this.localConnections.delete(connId);
    });
  }

  filterHeaders(headers) {
    // Filter headers for WebSocket connections
    const filtered = {};
    const allowedHeaders = [
      'sec-websocket-key',
      'sec-websocket-version', 
      'sec-websocket-protocol',
      'sec-websocket-extensions',
      'origin',
      'user-agent'
    ];
    
    for (const [key, value] of Object.entries(headers)) {
      if (allowedHeaders.includes(key.toLowerCase())) {
        filtered[key] = value;
      }
    }
    
    return filtered;
  }

  async getCustomSubdomain() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise((resolve) => {
      rl.question('Custom subdomain (or press Enter for random): ', (answer) => {
        rl.close();
        resolve(answer.trim() || null);
      });
    });
  }
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`
🌵 WSTunnel Client - Your ngrok alternative

Usage: node wstunnel-client.js <local-port> <server-url> [custom-subdomain]

Examples:
  node wstunnel-client.js 3008 ws://20.193.143.179:8080
  node wstunnel-client.js 3008 ws://20.193.143.179:8080 claude
  
Arguments:
  local-port     - Port of your local service (e.g., 3008)
  server-url     - WebSocket URL of tunnel server (e.g., ws://20.193.143.179:8080)
  custom-subdomain - Optional custom subdomain (e.g., 'claude' for claude.grabr.cc)
`);
    process.exit(1);
  }
  
  const localPort = parseInt(args[0]);
  const serverUrl = args[1];
  let customSubdomain = args[2];
  
  if (!customSubdomain) {
    console.log('🎯 Quick setup for your Claude Code UI tunnel\n');
    customSubdomain = await new WSTunnelClient().getCustomSubdomain();
  }
  
  const client = new WSTunnelClient(localPort, serverUrl, customSubdomain);
  
  try {
    await client.connect();
    console.log(`\n🚀 Tunnel is active! Your local service on port ${localPort} is now accessible via HTTPS.`);
    console.log(`📋 Dashboard: https://grabr.cc/dashboard`);
    console.log(`\nPress Ctrl+C to stop the tunnel.`);
    
    // Keep process alive
    process.on('SIGINT', () => {
      console.log('\n👋 Closing tunnel...');
      client.ws.close();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to connect to tunnel server:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = WSTunnelClient; 