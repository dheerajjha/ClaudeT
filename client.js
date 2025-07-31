const WebSocket = require('ws');
const axios = require('axios');
const readline = require('readline');

class TunnelClient {
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
    this.publicUrl = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.isConnected = false;
  }

  connect() {
    const wsUrl = `ws://${this.config.serverHost}:${this.config.serverPort}`;
    console.log(`🔌 Connecting to tunnel server: ${wsUrl}`);

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('✅ Connected to tunnel server');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
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
      console.log('❌ Connection to tunnel server closed');
      this.isConnected = false;
      this.attemptReconnect();
    });

    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.isConnected = false;
    });
  }

  handleServerMessage(data) {
    switch (data.type) {
      case 'connected':
        this.tunnelId = data.tunnelId;
        this.publicUrl = data.publicUrl;
        this.subdomainUrl = data.subdomainUrl;
        console.log(`🌐 Tunnel established!`);
        console.log(`📍 Tunnel ID: ${this.tunnelId}`);
        
        // Show if custom subdomain was used
        if (this.config.suggestedSubdomain) {
          if (this.tunnelId === this.config.suggestedSubdomain.toLowerCase().replace(/[^a-z0-9-]/g, '')) {
            console.log(`✨ Using your custom subdomain: ${this.tunnelId}`);
          } else {
            console.log(`⚠️  Custom subdomain unavailable, using: ${this.tunnelId}`);
          }
        }
        
        console.log(`🔗 Path URL: ${this.publicUrl}`);
        console.log(`🌐 Subdomain URL: ${this.subdomainUrl} (Recommended - works like ngrok)`);
        console.log(`⬅️  Local: http://${this.config.localHost}:${this.config.localPort}`);
        break;

      case 'request':
        this.handleIncomingRequest(data);
        break;

      default:
        console.log(`Unknown message type: ${data.type}`);
    }
  }

  async handleIncomingRequest(requestData) {
    try {
      const localUrl = `http://${this.config.localHost}:${this.config.localPort}${requestData.url}`;
      
      console.log(`📨 ${requestData.method} ${requestData.url} -> ${localUrl}`);

      // Forward request to local server
      const response = await axios({
        method: requestData.method,
        url: localUrl,
        headers: this.cleanHeaders(requestData.headers),
        data: requestData.body,
        timeout: 25000, // 25 second timeout
        validateStatus: () => true // Accept any status code
      });

      // Send response back to server
      this.sendMessage({
        type: 'response',
        requestId: requestData.requestId,
        statusCode: response.status,
        headers: response.headers,
        body: response.data
      });

      console.log(`✅ ${response.status} ${requestData.method} ${requestData.url}`);

    } catch (error) {
      console.error(`❌ Error forwarding request:`, error.message);
      
      // Send error response
      this.sendMessage({
        type: 'response',
        requestId: requestData.requestId,
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: { 
          error: 'Local server error',
          message: error.message 
        }
      });
    }
  }

  cleanHeaders(headers) {
    // Remove headers that might cause issues
    const cleaned = { ...headers };
    delete cleaned.host;
    delete cleaned.connection;
    delete cleaned['content-length'];
    return cleaned;
  }

  sendMessage(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(`❌ Max reconnection attempts reached. Giving up.`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    console.log(`🔄 Attempting to reconnect in ${delay}ms... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      if (!this.isConnected) {
        this.connect();
      }
    }, delay);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }

  async testLocalServer() {
    try {
      const response = await axios.get(`http://${this.config.localHost}:${this.config.localPort}`, {
        timeout: 5000
      });
      console.log(`✅ Local server is running on port ${this.config.localPort}`);
      return true;
    } catch (error) {
      console.log(`⚠️  Warning: Cannot reach local server on port ${this.config.localPort}`);
      console.log(`   Make sure your application is running on http://${this.config.localHost}:${this.config.localPort}`);
      return false;
    }
  }
}

// CLI interface
async function startClient() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (question) => new Promise(resolve => rl.question(question, resolve));

  console.log('🚀 Mini Tunnel Client\n');
  
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

  const client = new TunnelClient(parseInt(localPort), suggestedSubdomain);

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

// Start client if run directly
if (require.main === module) {
  startClient().catch(console.error);
}

module.exports = TunnelClient; 