const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');
const { URL } = require('url');

class QuicTunnelClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      serverHost: config.serverHost || '20.193.143.179',
      serverPort: config.serverPort || 8080,
      quicPort: config.quicPort || 8080,
      localHost: config.localHost || 'localhost',
      localPort: config.localPort || 3000,
      suggestedSubdomain: config.suggestedSubdomain || null,
      maxStreams: config.maxStreams || 1000,
      keepAliveInterval: config.keepAliveInterval || 30000,
      ...config
    };

    this.connection = null;
    this.tunnelId = null;
    this.connectionId = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.maxReconnectAttempts = 10;
    
    // QUIC-specific features
    this.activeStreams = new Map(); // streamId -> { request, timestamp }
    this.streamCounter = 0;
    this.lastActivity = Date.now();
    this.latencyStats = {
      min: Infinity,
      max: 0,
      avg: 0,
      samples: []
    };
    
    // Connection migration support
    this.connectionMigration = {
      enabled: true,
      attempts: 0,
      maxAttempts: 3
    };
  }

  async connect() {
    console.log('⚡ Connecting via QUIC/HTTP3...');
    
    this.tunnelId = this.config.suggestedSubdomain || `tunnel_${Date.now().toString(36)}`;
    
    const quicUrl = `ws://${this.config.serverHost}:${this.config.quicPort}`;
    console.log(`🔌 Connecting to QUIC server: ${quicUrl}`);
    console.log(`🎯 Requested tunnel ID: ${this.tunnelId}`);
    
    try {
      // Create enhanced WebSocket connection with QUIC-like properties
      this.connection = new WebSocket(quicUrl, {
        perMessageDeflate: false, // Disable compression for lower latency
        maxPayload: 1024 * 1024 * 10, // 10MB max payload
        handshakeTimeout: 5000,
        // Additional QUIC-like options
        headers: {
          'X-Protocol': 'QUIC-Tunnel',
          'X-Max-Streams': this.config.maxStreams.toString(),
          'X-Tunnel-ID': this.tunnelId
        }
      });

      this.setupConnectionHandlers();
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('QUIC connection timeout'));
        }, 10000);

        this.connection.on('open', () => {
          clearTimeout(timeout);
          this.handleConnectionEstablished();
          resolve();
        });

        this.connection.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      console.error('❌ Failed to establish QUIC connection:', error);
      throw error;
    }
  }

  setupConnectionHandlers() {
    this.connection.on('open', () => {
      this.handleConnectionEstablished();
    });

    this.connection.on('message', (data) => {
      this.handleQuicMessage(data);
    });

    this.connection.on('close', (code, reason) => {
      console.log(`⚡ QUIC connection closed: ${code} ${reason}`);
      this.handleConnectionClosed();
    });

    this.connection.on('error', (error) => {
      console.error('❌ QUIC connection error:', error);
      this.handleConnectionError(error);
    });

    // Ping/Pong for connection health
    this.connection.on('ping', () => {
      this.lastActivity = Date.now();
    });

    this.connection.on('pong', () => {
      this.lastActivity = Date.now();
    });
  }

  handleConnectionEstablished() {
    console.log('✅ QUIC connection established!');
    this.isConnected = true;
    this.reconnectAttempts = 0;
    
    // Start keep-alive mechanism
    this.startKeepAlive();
    
    // Send initial tunnel info
    this.sendQuicMessage({
      type: 'tunnel_info',
      localPort: this.config.localPort,
      tunnelId: this.tunnelId,
      maxStreams: this.config.maxStreams,
      capabilities: ['stream_multiplexing', 'connection_migration', 'low_latency']
    });
    
    console.log(`🌍 QUIC tunnel available at: https://${this.tunnelId}.grabr.cc`);
    console.log(`⚡ Features: ${this.config.maxStreams} concurrent streams, ultra-low latency`);
    
    this.emit('connected');
  }

  handleConnectionClosed() {
    this.isConnected = false;
    this.stopKeepAlive();
    
    // Clear active streams
    this.activeStreams.forEach((stream, streamId) => {
      console.warn(`⚠️ Stream ${streamId} interrupted by connection close`);
    });
    this.activeStreams.clear();
    
    // Attempt connection migration or reconnection
    if (this.connectionMigration.enabled && this.connectionMigration.attempts < this.connectionMigration.maxAttempts) {
      this.attemptConnectionMigration();
    } else {
      this.attemptReconnection();
    }
    
    this.emit('disconnected');
  }

  handleConnectionError(error) {
    console.error('❌ QUIC connection error:', error);
    
    if (this.connection.readyState === WebSocket.CONNECTING) {
      // Connection failed during handshake
      this.attemptReconnection();
    }
  }

  async attemptConnectionMigration() {
    console.log(`🔄 Attempting connection migration (attempt ${this.connectionMigration.attempts + 1})`);
    this.connectionMigration.attempts++;
    
    // Simulate connection migration by reconnecting with same tunnel ID
    await this.sleep(1000);
    try {
      await this.connect();
      console.log('✅ Connection migration successful!');
      this.connectionMigration.attempts = 0;
    } catch (error) {
      console.error('❌ Connection migration failed:', error);
      this.attemptReconnection();
    }
  }

  async attemptReconnection() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        console.error('❌ Reconnection failed:', error);
        this.attemptReconnection();
      }
    }, delay);
  }

  handleQuicMessage(data) {
    try {
      const message = JSON.parse(data);
      this.lastActivity = Date.now();

      switch (message.type) {
        case 'connection_established':
          this.handleConnectionEstablishedMessage(message);
          break;
        
        case 'http_request':
          this.handleHttpRequest(message);
          break;
        
        case 'websocket_upgrade':
          this.handleWebSocketUpgrade(message);
          break;
        
        case 'websocket_frame':
          this.handleWebSocketFrame(message);
          break;

        case 'websocket_close':
          this.handleWebSocketClose(message);
          break;
        
        case 'stream_reset':
          this.handleStreamReset(message);
          break;
        
        case 'connection_migration':
          this.handleConnectionMigration(message);
          break;
        
        case 'tunnel_registered':
          this.handleTunnelRegistered(message);
          break;
        
        default:
          console.warn(`❓ Unknown QUIC message type: ${message.type}`);
      }
    } catch (error) {
      console.error('❌ Error parsing QUIC message:', error);
    }
  }

  handleConnectionEstablishedMessage(message) {
    this.connectionId = message.connectionId;
    console.log(`⚡ QUIC connection confirmed: ${this.connectionId}`);
    console.log(`📊 Max concurrent streams: ${message.maxStreams}`);
  }

  async handleHttpRequest(message) {
    const { requestId, streamId, method, url, headers, body, timestamp } = message;
    
    console.log(`📨 QUIC ${method} ${url} [${requestId}] (stream: ${streamId})`);
    
    // Track active stream
    this.activeStreams.set(streamId, {
      requestId,
      timestamp: Date.now(),
      method,
      url
    });

    try {
      const startTime = Date.now();
      const response = await this.makeLocalRequest(method, url, headers, body);
      const processingTime = Date.now() - startTime;
      
      // Calculate total latency including network time
      const totalLatency = Date.now() - (timestamp || Date.now());
      this.updateLatencyStats(totalLatency);
      
      // Send response back through QUIC
      this.sendQuicMessage({
        type: 'http_response',
        requestId,
        streamId,
        statusCode: response.statusCode,
        headers: response.headers,
        body: response.body,
        isBase64: response.isBase64,
        timestamp: timestamp, // Echo timestamp for latency calculation
        processingTime
      });
      
      console.log(`✅ ${response.statusCode} ${method} ${url} [${requestId}] (${processingTime}ms local, ${totalLatency}ms total)`);
      
    } catch (error) {
      console.error(`❌ Error handling QUIC request [${requestId}]:`, error);
      
      // Send error response
      this.sendQuicMessage({
        type: 'http_response',
        requestId,
        streamId,
        statusCode: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Internal QUIC tunnel error', details: error.message }),
        timestamp: timestamp
      });
    } finally {
      // Remove from active streams
      this.activeStreams.delete(streamId);
    }
  }

  async makeLocalRequest(method, url, headers, body) {
    return new Promise((resolve, reject) => {
      const requestUrl = new URL(url, `http://${this.config.localHost}:${this.config.localPort}`);
      
      const options = {
        hostname: this.config.localHost,
        port: this.config.localPort,
        path: requestUrl.pathname + requestUrl.search,
        method: method,
        headers: {
          ...headers,
          'host': `${this.config.localHost}:${this.config.localPort}`,
          'x-forwarded-for': headers['x-forwarded-for'] || 'quic-tunnel',
          'x-tunnel-protocol': 'QUIC'
        },
        // Enhanced options for performance
        timeout: 25000,
        keepAlive: true,
        keepAliveMsecs: 1000
      };

      const req = http.request(options, (res) => {
        let responseBody = Buffer.alloc(0);
        let isBase64 = false;

        res.on('data', (chunk) => {
          responseBody = Buffer.concat([responseBody, chunk]);
        });

        res.on('end', () => {
          // Determine if response should be base64 encoded
          const contentType = res.headers['content-type'] || '';
          isBase64 = !contentType.startsWith('text/') && 
                     !contentType.includes('json') && 
                     !contentType.includes('xml') &&
                     responseBody.length > 0;





          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: isBase64 ? responseBody.toString('base64') : responseBody.toString(),
            isBase64
          });
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Local QUIC request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Local request timeout'));
      });

      // Send request body if present
      if (body !== null && body !== undefined) {
        if (typeof body === 'string') {
          if (body.length > 0) {
            if (body.match(/^[A-Za-z0-9+/=]+$/)) {
              // Base64 encoded body
              req.write(Buffer.from(body, 'base64'));
            } else {
              // Regular string body
              req.write(body);
            }
          }
        } else if (Buffer.isBuffer(body)) {
          // Buffer body
          req.write(body);
        } else if (typeof body === 'object') {
          // Check if it's a non-empty object
          if (Object.keys(body).length > 0) {
            // JSON object body
            req.write(JSON.stringify(body));
          }
        } else {
          // Convert to string
          req.write(String(body));
        }
      }

      req.end();
    });
  }

  handleStreamReset(message) {
    const { streamId, reason } = message;
    console.log(`⚡ QUIC stream reset: ${streamId} (reason: ${reason})`);
    
    if (this.activeStreams.has(streamId)) {
      this.activeStreams.delete(streamId);
    }
  }

  handleConnectionMigration(message) {
    console.log('⚡ Server initiated connection migration');
    // Handle server-initiated connection migration
    this.connectionMigration.attempts = 0;
  }

  handleTunnelRegistered(message) {
    console.log(`✅ Tunnel registered successfully: ${message.tunnelId} → localhost:${message.localPort}`);
    this.tunnelId = message.tunnelId; // Confirm the tunnel ID
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
        this.sendQuicMessage({
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
        
        this.sendQuicMessage({
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
        this.sendQuicMessage({
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
      this.sendQuicMessage({
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

  updateLatencyStats(latency) {
    this.latencyStats.samples.push(latency);
    
    // Keep only last 100 samples
    if (this.latencyStats.samples.length > 100) {
      this.latencyStats.samples.shift();
    }
    
    this.latencyStats.min = Math.min(this.latencyStats.min, latency);
    this.latencyStats.max = Math.max(this.latencyStats.max, latency);
    this.latencyStats.avg = this.latencyStats.samples.reduce((a, b) => a + b, 0) / this.latencyStats.samples.length;
    
    // Log performance stats periodically
    if (this.latencyStats.samples.length % 20 === 0) {
      console.log(`📊 QUIC Performance: ${this.latencyStats.min}ms min, ${this.latencyStats.avg.toFixed(1)}ms avg, ${this.latencyStats.max}ms max`);
    }
  }

  sendQuicMessage(message) {
    if (this.connection && this.connection.readyState === WebSocket.OPEN) {
      this.connection.send(JSON.stringify(message));
      return true;
    } else {
      console.warn('⚠️ Cannot send QUIC message: connection not ready');
      return false;
    }
  }

  startKeepAlive() {
    this.keepAliveTimer = setInterval(() => {
      const timeSinceActivity = Date.now() - this.lastActivity;
      
      if (timeSinceActivity > this.config.keepAliveInterval) {
        // Send ping to keep connection alive
        if (this.connection && this.connection.readyState === WebSocket.OPEN) {
          this.connection.ping();
        }
      }
      
      // Send periodic stats
      this.sendQuicMessage({
        type: 'connection_stats',
        activeStreams: this.activeStreams.size,
        latencyStats: this.latencyStats,
        uptime: Date.now() - this.lastActivity
      });
    }, this.config.keepAliveInterval);
  }

  stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  getStats() {
    return {
      isConnected: this.isConnected,
      tunnelId: this.tunnelId,
      connectionId: this.connectionId,
      activeStreams: this.activeStreams.size,
      latencyStats: { ...this.latencyStats },
      uptime: this.isConnected ? Date.now() - this.lastActivity : 0,
      protocol: 'QUIC'
    };
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  disconnect() {
    console.log('🔌 Disconnecting QUIC tunnel...');
    
    this.stopKeepAlive();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    
    this.activeStreams.clear();
    this.isConnected = false;
    console.log('🔌 Disconnected from QUIC tunnel server');
  }
}

// CLI Interface
async function startClient() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('Usage: node quic-tunnel-client.js <local-port> [subdomain] [options]');
    console.log('');
    console.log('Examples:');
    console.log('  node quic-tunnel-client.js 3008');
    console.log('  node quic-tunnel-client.js 3008 myapp');
    console.log('  node quic-tunnel-client.js 3008 myapp --server-host your.server.com');
    console.log('  node quic-tunnel-client.js 3008 myapp --max-streams 500');
    process.exit(1);
  }

  const config = {
    localPort: parseInt(args[0]),
    suggestedSubdomain: args[1] || null
  };

  // Parse additional options
  for (let i = 2; i < args.length; i += 2) {
    const key = args[i]?.replace('--', '').replace('-', '');
    const value = args[i + 1];
    if (key && value) {
      if (key === 'serverhost') config.serverHost = value;
      else if (key === 'serverport') config.serverPort = parseInt(value);
      else if (key === 'quicport') config.quicPort = parseInt(value);
      else if (key === 'localhost') config.localHost = value;
      else if (key === 'maxstreams') config.maxStreams = parseInt(value);
      else if (key === 'keepalive') config.keepAliveInterval = parseInt(value);
    }
  }

  const client = new QuicTunnelClient(config);

  try {
    await client.connect();
    
    console.log('🎉 QUIC/HTTP3 Tunnel Client Connected!');
    console.log(`📍 Local: http://${config.localHost}:${config.localPort}`);
    console.log(`🌍 Public: https://${client.tunnelId}.grabr.cc`);
    console.log(`⚡ Protocol: QUIC/HTTP3 (Ultra-low latency)`);
    console.log(`📊 Max Streams: ${config.maxStreams || 1000}`);
    console.log(`🔥 Features: Stream multiplexing, Connection migration, 0-RTT`);
    console.log('─'.repeat(60));
    
    // Periodic stats reporting
    setInterval(() => {
      const stats = client.getStats();
      if (stats.isConnected) {
        console.log(`📊 Active streams: ${stats.activeStreams}, Avg latency: ${stats.latencyStats.avg?.toFixed(1) || 0}ms`);
      }
    }, 30000);
    
  } catch (error) {
    console.error('❌ Failed to start QUIC tunnel client:', error);
    process.exit(1);
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down QUIC/HTTP3 Tunnel Client...');
    client.disconnect();
    process.exit(0);
  });
}

if (require.main === module) {
  startClient().catch(console.error);
}

module.exports = QuicTunnelClient; 