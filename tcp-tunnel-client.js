const WebSocket = require('ws');
const net = require('net');
const readline = require('readline');

class TCPTunnelClient {
  constructor(localPort = 3000, suggestedSubdomain = null) {
    this.config = {
      serverHost: '20.193.143.179',
      serverPort: 8080,
      localPort: localPort,
      localHost: 'localhost',
      suggestedSubdomain: suggestedSubdomain
    };
    
    this.ws = null;
    this.tunnelId = null;
    this.isConnected = false;
    this.tcpConnections = new Map(); // Track TCP connections to local server
  }

  connect() {
    const wsUrl = `ws://${this.config.serverHost}:${this.config.serverPort}`;
    console.log(`🔌 Connecting to tunnel server: ${wsUrl}`);
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.on('open', () => {
      console.log('✅ Connected to tunnel server');
      this.isConnected = true;
      
      // Send configuration
      this.sendMessage({
        type: 'config',
        localPort: this.config.localPort,
        localHost: this.config.localHost,
        suggestedSubdomain: this.config.suggestedSubdomain
      });
    });
    
    this.ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        this.handleServerMessage(data);
      } catch (error) {
        console.error('Invalid message from server:', error);
      }
    });
    
    this.ws.on('close', () => {
      console.log('❌ Disconnected from tunnel server');
      this.isConnected = false;
      // Close all TCP connections
      for (const [connId, socket] of this.tcpConnections) {
        socket.destroy();
      }
      this.tcpConnections.clear();
    });
    
    this.ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
    });
  }

  handleServerMessage(data) {
    switch (data.type) {
      case 'connected':
        this.tunnelId = data.tunnelId;
        console.log(`🌐 Tunnel established!`);
        console.log(`📍 Tunnel ID: ${this.tunnelId}`);
        
        if (this.config.suggestedSubdomain) {
          if (this.tunnelId === this.config.suggestedSubdomain.toLowerCase().replace(/[^a-z0-9-]/g, '')) {
            console.log(`✨ Using your custom subdomain: ${this.tunnelId}`);
          } else {
            console.log(`⚠️  Custom subdomain unavailable, using: ${this.tunnelId}`);
          }
        }
        
        console.log(`🌐 Subdomain URL: ${data.subdomainUrl}`);
        console.log(`⬅️  Local: http://${this.config.localHost}:${this.config.localPort}`);
        break;

      case 'tcp_connect':
        this.handleTCPConnect(data);
        break;
    }
  }

  handleTCPConnect(data) {
    console.log(`🔗 New TCP connection: ${data.connectionId} → ${data.host}:${data.port}`);
    
    // Create TCP connection to local server
    const socket = new net.Socket();
    this.tcpConnections.set(data.connectionId, socket);
    
    socket.connect(data.port, data.host, () => {
      console.log(`✅ Connected to local TCP server: ${data.host}:${data.port}`);
      
      // Send initial data if present
      if (data.data) {
        const buffer = Buffer.from(data.data, 'base64');
        socket.write(buffer);
      }
    });
    
    socket.on('data', (buffer) => {
      // Forward data back to tunnel server
      this.sendMessage({
        type: 'tcp_data',
        connectionId: data.connectionId,
        data: buffer.toString('base64')
      });
    });
    
    socket.on('close', () => {
      console.log(`🔌 TCP connection closed: ${data.connectionId}`);
      this.tcpConnections.delete(data.connectionId);
      
      // Notify server
      this.sendMessage({
        type: 'tcp_close',
        connectionId: data.connectionId
      });
    });
    
    socket.on('error', (error) => {
      console.error(`❌ TCP connection error for ${data.connectionId}:`, error.message);
      this.tcpConnections.delete(data.connectionId);
      
      // Notify server
      this.sendMessage({
        type: 'tcp_close',
        connectionId: data.connectionId,
        error: error.message
      });
    });
  }

  sendMessage(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }

  async testLocalServer() {
    return new Promise((resolve) => {
      const testSocket = new net.Socket();
      testSocket.setTimeout(3000);
      
      testSocket.connect(this.config.localPort, this.config.localHost, () => {
        console.log(`✅ Local server is running on port ${this.config.localPort}`);
        testSocket.destroy();
        resolve(true);
      });
      
      testSocket.on('error', () => {
        console.log(`❌ No server running on port ${this.config.localPort}`);
        resolve(false);
      });
      
      testSocket.on('timeout', () => {
        console.log(`⏰ Timeout connecting to port ${this.config.localPort}`);
        testSocket.destroy();
        resolve(false);
      });
    });
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

async function setupSingleClient(client) {
  // Test local server first
  await client.testLocalServer();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down tunnel...');
    client.disconnect();
    process.exit(0);
  });

  // Connect to tunnel server
  client.connect();
}

async function startMultiPortClient(ask, rl) {
  const clients = [];
  
  console.log('\n🌟 Multi-Port TCP Tunnel Setup');
  console.log('Add multiple services (press Enter with empty port to finish):\n');
  
  while (true) {
    const port = await ask('Enter port (or press Enter to finish): ');
    if (!port) break;
    
    const subdomain = await ask(`Enter subdomain for port ${port} (optional): `) || null;
    
    // Validate port
    const portNum = parseInt(port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      console.log('❌ Invalid port number, skipping...');
      continue;
    }
    
    clients.push({
      port: portNum,
      subdomain: subdomain,
      client: new TCPTunnelClient(portNum, subdomain)
    });
    
    console.log(`✅ Added: localhost:${port} → ${subdomain || 'random'}.grabr.cc`);
  }
  
  rl.close();
  
  if (clients.length === 0) {
    console.log('❌ No ports specified. Exiting...');
    process.exit(0);
  }
  
  console.log(`\n📋 Starting ${clients.length} TCP tunnel(s):`);
  
  // Setup shutdown handler for all clients
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down all tunnels...');
    clients.forEach(({ client }) => client.disconnect());
    process.exit(0);
  });
  
  // Test and connect all clients
  for (const { port, subdomain, client } of clients) {
    console.log(`\n🔌 Setting up TCP tunnel for port ${port}...`);
    await client.testLocalServer();
    client.connect();
    
    // Small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`\n🎉 All ${clients.length} TCP tunnels are starting up!`);
  console.log('Check the logs above for your URLs 🌐');
}

async function startClient() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('🚀 TCP Tunnel Client\n');
  
  const multiPort = await ask('Tunnel multiple ports? (y/n, default n): ');
  
  if (multiPort.toLowerCase() === 'y') {
    await startMultiPortClient(ask, rl);
  } else {
    const localPort = await ask('Enter local port to tunnel (default 3000): ') || '3000';
    const suggestedSubdomain = await ask('Enter preferred subdomain (optional, e.g., "myapp"): ') || null;
    
    rl.close();

    console.log('\n📋 Configuration:');
    console.log(`   WebSocket: 20.193.143.179:8080 (direct)`);
    console.log(`   Local: localhost:${localPort}`);
    if (suggestedSubdomain) {
      console.log(`   Requested: ${suggestedSubdomain}.grabr.cc`);
    }
    console.log('');

    const client = new TCPTunnelClient(parseInt(localPort), suggestedSubdomain);
    await setupSingleClient(client);
  }
}

// Start client if run directly
if (require.main === module) {
  // Quick test mode - skip all prompts
  if (process.argv.includes('--quick')) {
    console.log('🚀 Quick Test Mode - TCP Tunnel Client');
    console.log('📋 Using defaults: localhost:3000 → claude.grabr.cc\n');
    
    const client = new TCPTunnelClient(3000, 'claude');
    client.connect();
  } else {
    startClient().catch(console.error);
  }
}

module.exports = TCPTunnelClient; 