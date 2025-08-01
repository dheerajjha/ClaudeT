const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const { URL } = require('url');

class TunnelClient {
  constructor(config = {}) {
    this.config = {
      serverHost: config.serverHost || '20.193.143.179',
      serverPort: config.serverPort || 8080,
      localHost: config.localHost || 'localhost',
      localPort: config.localPort || 3000,
      suggestedSubdomain: config.suggestedSubdomain || null,
      reconnectInterval: config.reconnectInterval || 5000,
      maxReconnectAttempts: config.maxReconnectAttempts || 10,
      ...config
    };

    this.ws = null;
    this.tunnelId = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
  }

  async connect() {
    try {
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
          localHost: this.config.localHost,
          localPort: this.config.localPort,
          suggestedSubdomain: this.config.suggestedSubdomain
        });
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleServerMessage(message);
        } catch (error) {
          console.error('❌ Invalid message from server:', error.message);
        }
      });

      this.ws.on('close', () => {
        console.log('❌ Disconnected from tunnel server');
        this.isConnected = false;
        
        // Close all local WebSocket connections
        if (this.localWebSockets) {
          for (const [upgradeId, localWs] of this.localWebSockets.entries()) {
            console.log(`🔌 Closing local WebSocket: ${upgradeId}`);
            localWs.close();
          }
          this.localWebSockets.clear();
        }
        
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
        this.isConnected = false;
      });

    } catch (error) {
      console.error('❌ Connection failed:', error.message);
      this.scheduleReconnect();
    }
  }

  handleServerMessage(message) {
    switch (message.type) {
      case 'connected':
        this.tunnelId = message.tunnelId;
        console.log(`🌐 Tunnel established!`);
        console.log(`📍 Tunnel ID: ${this.tunnelId}`);
        
        if (this.config.suggestedSubdomain) {
          console.log(`🌐 Requested subdomain: ${this.config.suggestedSubdomain}.grabr.cc`);
        } else {
          console.log(`🌐 Subdomain URL: https://${this.tunnelId}.grabr.cc/`);
        }
        console.log(`⬅️  Local: http://${this.config.localHost}:${this.config.localPort}`);
        break;

      case 'subdomain_updated':
        this.tunnelId = message.tunnelId;
        console.log(`✨ Using your custom subdomain: ${this.tunnelId}`);
        console.log(`🌐 Subdomain URL: https://${this.tunnelId}.grabr.cc/`);
        break;

      case 'request':
        this.handleTunnelRequest(message);
        break;

      case 'websocket_upgrade':
        console.log(`🔄 WebSocket upgrade request: ${message.url}`);
        this.handleWebSocketUpgrade(message);
        break;

      case 'websocket_frame':
        this.handleWebSocketFrame(message);
        break;

      case 'websocket_close':
        this.handleWebSocketClose(message);
        break;

      default:
        console.warn(`⚠️ Unknown message type: ${message.type}`);
    }
  }

  async handleTunnelRequest(request) {
    console.log(`📥 Received: ${request.method} ${request.url}`);
    
    try {
      // Make request to local server
      const response = await this.makeLocalRequest(request);
      
      console.log(`📤 Sending response: ${response.statusCode} (${request.requestId})`);
      
      // Send response back through tunnel
      this.sendMessage({
        type: 'response',
        requestId: request.requestId,
        statusCode: response.statusCode,
        headers: response.headers,
        body: response.body
      });

    } catch (error) {
      console.error(`❌ Error handling request ${request.requestId}:`, error.message);
      
      // Send error response
      this.sendMessage({
        type: 'response',
        requestId: request.requestId,
        statusCode: 502,
        headers: { 'content-type': 'application/json' },
        body: { error: 'Bad Gateway', message: error.message }
      });
    }
  }

  async handleWebSocketUpgrade(message) {
    console.log(`🔌 Handling WebSocket upgrade: ${message.url}`);
    
    try {
      const WebSocket = require('ws');
      const crypto = require('crypto');
      
      // Create WebSocket connection to local server
      const localUrl = `ws://${this.config.localHost}:${this.config.localPort}${message.url}`;
      const localWs = new WebSocket(localUrl, {
        headers: this.filterHeaders(message.headers)
      });

      // Store WebSocket connection
      this.localWebSockets = this.localWebSockets || new Map();
      this.localWebSockets.set(message.upgradeId, localWs);

      localWs.on('open', () => {
        console.log(`✅ Local WebSocket connected: ${localUrl}`);
        
        // Generate WebSocket accept key
        const key = message.headers['sec-websocket-key'];
        console.log(`🔑 WebSocket key: ${key}`);
        
        const acceptKey = crypto
          .createHash('sha1')
          .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
          .digest('base64');
        
        console.log(`🔑 Generated accept key: ${acceptKey}`);

        // Send success response to server
        this.sendMessage({
          type: 'websocket_upgrade_response',
          upgradeId: message.upgradeId,
          success: true,
          webSocketAccept: acceptKey
        });
        
        console.log(`📤 Sent WebSocket upgrade response for ${message.upgradeId}`);
      });

      localWs.on('message', (data, isBinary) => {
        // Forward ALL messages from local WebSocket to server (completely agnostic)
        // Handle both binary and text frames properly
        let frameData;
        let originalSize;
        
        if (Buffer.isBuffer(data)) {
          // Binary frame
          frameData = data.toString('base64');
          originalSize = data.length;
          console.log(`📤 Forwarding binary frame to server: ${originalSize} bytes`);
        } else {
          // Text frame - convert to buffer first for consistent handling
          const buffer = Buffer.from(data);
          frameData = buffer.toString('base64');
          originalSize = buffer.length;
          console.log(`📤 Forwarding text frame to server: ${originalSize} bytes`);
        }
        
        this.sendMessage({
          type: 'websocket_frame',
          upgradeId: message.upgradeId,
          data: frameData,
          direction: 'to_browser',
          originalSize: originalSize,
          isBinary: isBinary
        });
      });

      localWs.on('close', () => {
        console.log(`🔌 Local WebSocket closed: ${message.upgradeId}`);
        this.localWebSockets.delete(message.upgradeId);
      });

      localWs.on('error', (error) => {
        console.error(`❌ Local WebSocket error: ${message.upgradeId}`, error);
        
        // Send failure response to server
        this.sendMessage({
          type: 'websocket_upgrade_response',
          upgradeId: message.upgradeId,
          success: false,
          error: error.message
        });
        
        this.localWebSockets.delete(message.upgradeId);
      });

    } catch (error) {
      console.error(`❌ WebSocket upgrade failed: ${message.upgradeId}`, error);
      
      // Send failure response to server
      this.sendMessage({
        type: 'websocket_upgrade_response',
        upgradeId: message.upgradeId,
        success: false,
        error: error.message
      });
    }
  }

  handleWebSocketFrame(message) {
    const localWs = this.localWebSockets?.get(message.upgradeId);
    if (localWs && localWs.readyState === 1) {
      try {
        // Forward frame from server to local WebSocket (completely agnostic)
        const data = Buffer.from(message.data, 'base64');
        console.log(`📥 Forwarding frame to local WebSocket: ${message.originalSize || data.length} bytes`);
        
        // Send with proper binary flag
        const isBinary = message.isBinary !== undefined ? message.isBinary : Buffer.isBuffer(data);
        localWs.send(data, { binary: isBinary });
      } catch (error) {
        console.error(`❌ Error handling WebSocket frame: ${message.upgradeId}`, error);
      }
    } else {
      console.warn(`⚠️ No local WebSocket connection found for frame: ${message.upgradeId}`);
    }
  }

  handleWebSocketClose(message) {
    const localWs = this.localWebSockets?.get(message.upgradeId);
    if (localWs) {
      console.log(`🔌 Closing local WebSocket: ${message.upgradeId}`);
      localWs.close();
      this.localWebSockets.delete(message.upgradeId);
    }
  }

  filterHeaders(headers) {
    // Filter headers for WebSocket upgrade
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

  makeLocalRequest(request) {
    return new Promise((resolve, reject) => {
      const url = new URL(request.url, `http://${this.config.localHost}:${this.config.localPort}`);
      
      // Use a whitelist approach - only keep essential headers
      const allowedHeaders = ['accept', 'accept-encoding', 'accept-language', 'user-agent', 'content-type', 'content-length', 'cache-control'];
      const cleanHeaders = {};
      
      for (const [key, value] of Object.entries(request.headers)) {
        if (allowedHeaders.includes(key.toLowerCase())) {
          cleanHeaders[key] = value;
        }
      }
      
      const options = {
        hostname: this.config.localHost,
        port: this.config.localPort,
        path: url.pathname + url.search,
        method: request.method,
        headers: {
          ...cleanHeaders,
          host: `${this.config.localHost}:${this.config.localPort}` // Override host header
        },
        timeout: 25000
      };

      console.log(`🔧 Request options:`, {
        method: options.method,
        path: options.path,
        headers: Object.keys(options.headers)
      });

      const req = http.request(options, (res) => {
        
        let body = '';
        
        res.on('data', (chunk) => {
          body += chunk;
        });
        
        res.on('end', () => {
          // Process response body
          let processedBody = body;
          const contentType = res.headers['content-type'] || '';
          
          if (contentType.includes('application/json')) {
            try {
              processedBody = JSON.parse(body);
            } catch {
              // Keep as string if JSON parsing fails
            }
          }
          
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: processedBody
          });
                });
      });
      
      req.on('error', (error) => {
         console.error(`🔥 Local server connection error:`, error.message);
         reject(new Error(`Local server error: ${error.message}`));
       });

       req.on('timeout', () => {
         console.error(`⏰ Local server request timeout`);
         req.destroy();
         reject(new Error('Local server timeout'));
       });

      // Send request body if present
      if (request.body) {
        if (typeof request.body === 'object') {
          req.write(JSON.stringify(request.body));
        } else {
          req.write(request.body);
        }
      }

      req.end();
    });
  }

  sendMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const messageStr = JSON.stringify(message);
      console.log(`📡 Sending message: type=${message.type}, size=${messageStr.length} bytes`);
      this.ws.send(messageStr);
    } else {
      console.warn('⚠️ Cannot send message: WebSocket not connected');
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error(`❌ Max reconnection attempts (${this.config.maxReconnectAttempts}) reached. Exiting.`);
      process.exit(1);
    }

    this.reconnectAttempts++;
    console.log(`🔄 Reconnecting in ${this.config.reconnectInterval / 1000}s... (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.config.reconnectInterval);
  }

  async testLocalServer() {
    return new Promise((resolve) => {
      const req = http.request({
        hostname: this.config.localHost,
        port: this.config.localPort,
        method: 'HEAD',
        timeout: 3000
      }, (res) => {
        resolve(true);
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    console.log('🔌 Disconnected from tunnel server');
  }
}

// CLI Interface
async function startClient() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🚀 HTTP Tunnel Client

Usage: node tunnel-client.js [localPort] [subdomain]

Arguments:
  localPort   Local port to tunnel (default: 3000)
  subdomain   Suggested subdomain (optional)

Examples:
  node tunnel-client.js 3008
  node tunnel-client.js 3008 myapp
  node tunnel-client.js 5000 api

Environment Variables:
  SERVER_HOST     Tunnel server host (default: 20.193.143.179)
  SERVER_PORT     Tunnel server port (default: 8080)
`);
    process.exit(0);
  }

  const localPort = parseInt(args[0]) || 3008; // Default to 3008 as requested
  const suggestedSubdomain = args[1] || null;

  console.log('🚀 HTTP Tunnel Client\n');

  const config = {
    serverHost: process.env.SERVER_HOST || '20.193.143.179',
    serverPort: parseInt(process.env.SERVER_PORT) || 8080,
    localHost: 'localhost',
    localPort,
    suggestedSubdomain
  };

  console.log('📋 Configuration:');
  console.log(`   Server: ${config.serverHost}:${config.serverPort}`);
  console.log(`   Local: ${config.localHost}:${config.localPort}`);
  if (suggestedSubdomain) {
    console.log(`   Requested: ${suggestedSubdomain}.grabr.cc`);
  }
  console.log('');

  const client = new TunnelClient(config);

  // Test local server
  console.log(`🔍 Checking local server on port ${localPort}...`);
  const isLocalServerRunning = await client.testLocalServer();
  
  if (!isLocalServerRunning) {
    console.error(`❌ No server running on port ${localPort}`);
    console.log('💡 Start your local server first, then run this tunnel client');
    process.exit(1);
  }
  
  console.log(`✅ Local server is running on port ${localPort}`);

  // Connect to tunnel server
  await client.connect();

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down client...');
    client.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    client.disconnect();
    process.exit(0);
  });
}

// Auto-start if run directly
if (require.main === module) {
  startClient().catch(console.error);
}

module.exports = TunnelClient; 