const express = require('express');
const http = require('http');
const { EventEmitter } = require('events');

// Note: This is a conceptual implementation as Node.js doesn't have native QUIC support yet
// Using a hybrid approach with HTTP/3 concepts and WebSocket fallback

class QuicTunnelServer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      httpPort: process.env.SERVER_PORT || config.httpPort || 80,
      quicPort: process.env.QUIC_PORT || config.quicPort || 8080,
      domain: config.domain || 'grabr.cc',
      ...config
    };
    
    this.tunnels = new Map(); // tunnelId -> { connection, localPort, connectedAt, requestCount }
    this.pendingRequests = new Map(); // requestId -> { res, timeout }
    this.quicConnections = new Map(); // connectionId -> { tunnel, streams }
    
    this.app = express();
    this.httpServer = http.createServer();
    
    this.setupRoutes();
    this.setupRawHttpHandler();
    this.setupQuicServer();
  }

  setupRoutes() {
    this.app.set('trust proxy', true);
    
    // Body parsing middleware (more specific to avoid interfering with tunneled responses)
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    // Only use raw parsing for specific endpoints, not all requests
    this.app.use('/api/*', express.raw({ limit: '10mb', type: '*/*' }));

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      const activeTunnels = Array.from(this.tunnels.values())
        .filter(t => t.connection && t.connection.readyState === 'open');
      
      res.json({
        status: 'healthy',
        activeTunnels: activeTunnels.length,
        mode: 'QUIC/HTTP3 Tunnel',
        connectedTunnels: Array.from(this.tunnels.keys()),
        uptime: process.uptime(),
        protocol: 'QUIC'
      });
    });

    // Tunnel management dashboard
    this.app.get('/dashboard', (req, res) => {
      const tunnels = Array.from(this.tunnels.entries()).map(([id, tunnel]) => ({
        id,
        localPort: tunnel.localPort,
        connectedAt: tunnel.connectedAt,
        requestCount: tunnel.requestCount,
        isConnected: tunnel.connection && tunnel.connection.readyState === 'open',
        protocol: 'QUIC',
        streams: tunnel.activeStreams || 0
      }));

      res.json({
        tunnels,
        serverConfig: {
          domain: this.config.domain,
          httpPort: this.config.httpPort,
          quicPort: this.config.quicPort,
          protocol: 'QUIC/HTTP3'
        }
      });
    });

    // Note: HTTP requests are now handled by setupRawHttpHandler() to avoid middleware interference
  }

  setupRawHttpHandler() {
    // Handle HTTP requests at the raw server level to avoid Express middleware interference
    this.httpServer.on('request', (req, res) => {
      // Check if this is a health/dashboard request
      if (req.url === '/health' || req.url === '/dashboard') {
        // Use Express for these endpoints
        this.app(req, res);
      } else {
        // Handle tunnel requests directly without Express middleware
        this.handleHttpRequest(req, res);
      }
    });
  }

  setupQuicServer() {
    console.log(`🚀 QUIC/HTTP3 Tunnel Server Starting...`);
    console.log(`📡 HTTP Server: http://localhost:${this.config.httpPort}`);
    console.log(`⚡ QUIC Server: quic://localhost:${this.config.quicPort}`);
    console.log(`🌍 Domain: *.${this.config.domain}`);
    
    // Simulated QUIC server using enhanced WebSocket with HTTP/3 concepts
    const WebSocket = require('ws');
    this.quicServer = new WebSocket.Server({ 
      port: this.config.quicPort,
      perMessageDeflate: false, // Disable compression for lower latency
    });
    
    this.quicServer.on('connection', (connection, req) => {
      this.handleQuicConnection(connection, req);
    });

    console.log('✅ QUIC/HTTP3 Tunnel Server Ready!');
    console.log('─'.repeat(60));
  }

  handleQuicConnection(connection, req) {
    const connectionId = this.generateConnectionId();
    let tunnelId = null; // Will be set when client sends tunnel_info
    
    console.log(`⚡ New QUIC connection: ${connectionId}`);
    
    // Enhanced connection with QUIC-like properties
    connection.connectionId = connectionId;
    connection.tunnelId = tunnelId; // Will be set later
    connection.activeStreams = new Map();
    connection.maxStreams = 1000; // QUIC allows many concurrent streams
    connection.lastActivity = Date.now();
    
    // Don't store tunnel yet - wait for tunnel_info message with the correct tunnel ID

    // Handle messages (simulating QUIC streams)
    connection.on('message', (data) => {
      this.handleQuicMessage(connection, data);
    });

    connection.on('close', () => {
      console.log(`⚡ QUIC connection closed: ${connectionId}`);
      if (connection.tunnelId) {
        this.tunnels.delete(connection.tunnelId);
      }
      this.quicConnections.delete(connectionId);
    });

    connection.on('error', (error) => {
      console.error(`❌ QUIC connection error: ${connectionId}`, error);
    });

    // Send connection acknowledgment (without tunnel ID yet)
    this.sendQuicMessage(connection, {
      type: 'connection_established',
      connectionId,
      maxStreams: connection.maxStreams
    });
  }

  handleQuicMessage(connection, data) {
    try {
      const message = JSON.parse(data);
      
      // Update activity timestamp
      connection.lastActivity = Date.now();
      
      console.log(`📨 Received QUIC message: ${message.type} from ${connection.connectionId}`);

      switch (message.type) {
        case 'tunnel_info':
          this.handleTunnelInfo(connection, message);
          break;
        
        case 'http_response':
          this.handleHttpResponse(message);
          break;

        case 'websocket_upgrade_response':
          console.log(`🔌 Received WebSocket upgrade response for ${message.upgradeId}`);
          this.handleWebSocketUpgradeResponse(message);
          break;
        
        case 'websocket_frame':
          this.handleWebSocketFrame(message);
          break;

        case 'websocket_close':
          this.handleWebSocketClose(message);
          break;
        
        case 'stream_data':
          this.handleStreamData(connection, message);
          break;
        
        case 'connection_stats':
          // Handle periodic stats from client (just log for now)
          console.log(`📊 Client stats: ${message.activeStreams} active streams, ${message.latencyStats?.avg?.toFixed(1) || 0}ms avg latency`);
          break;
        
        default:
          console.warn(`❓ Unknown QUIC message type: ${message.type}`);
      }
    } catch (error) {
      console.error('❌ Error parsing QUIC message:', error);
    }
  }

  async handleHttpRequest(req, res) {
    // Extract subdomain from Host header
    const host = req.get('host') || '';
    const subdomain = host.split('.')[0];
    
    if (!subdomain || subdomain === this.config.domain.split('.')[0]) {
      return res.status(404).json({ error: 'Tunnel not found' });
    }

    const tunnel = this.tunnels.get(subdomain);
    if (!tunnel || !tunnel.connection || tunnel.connection.readyState !== 1) {
      return res.status(503).json({ 
        error: 'QUIC tunnel not connected',
        subdomain,
        available: Array.from(this.tunnels.keys())
      });
    }

    const requestId = this.generateRequestId();
    const streamId = this.generateStreamId();
    
    console.log(`📥 HTTP ${req.method} ${req.url} → ${subdomain} [${requestId}] (QUIC stream: ${streamId})`);

    // Increment counters
    tunnel.requestCount++;
    tunnel.activeStreams++;

    // Create timeout for request
    const timeout = setTimeout(() => {
      if (this.pendingRequests.has(requestId)) {
        this.pendingRequests.delete(requestId);
        tunnel.activeStreams--;
        if (!res.headersSent) {
          res.status(504).json({ error: 'QUIC tunnel request timeout' });
        }
      }
    }, 30000);

    this.pendingRequests.set(requestId, { res, timeout, streamId });

    // Send request through QUIC connection with stream multiplexing
    const success = this.sendQuicMessage(tunnel.connection, {
      type: 'http_request',
      requestId,
      streamId,
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body ? (Buffer.isBuffer(req.body) ? req.body.toString('base64') : req.body) : undefined,
      timestamp: Date.now() // For latency measurement
    });

    if (!success) {
      clearTimeout(timeout);
      this.pendingRequests.delete(requestId);
      tunnel.activeStreams--;
      res.status(503).json({ error: 'Failed to send request through QUIC tunnel' });
    }
  }

  handleHttpResponse(message) {
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) return;

    const { res, timeout, streamId } = pending;
    clearTimeout(timeout);
    this.pendingRequests.delete(message.requestId);

    // Calculate latency
    const latency = Date.now() - (message.timestamp || 0);
    console.log(`⚡ QUIC Response latency: ${latency}ms (stream: ${streamId})`);

    // Decrement active streams
    const tunnel = Array.from(this.tunnels.values())
      .find(t => t.connection && t.connection.readyState === 1);
    if (tunnel) tunnel.activeStreams--;

    if (res.headersSent) return;

    // Prepare headers object
    const responseHeaders = {
      'X-Tunnel-Protocol': 'QUIC',
      'X-Tunnel-Latency': `${latency}ms`,
      'X-Tunnel-Stream-ID': streamId
    };

    // Add original headers (this will override any conflicting headers above)
    if (message.headers) {
      // Debug: Log what we received for JS files
      if (requestPath.includes('.js')) {
        console.log(`📥 Server received headers for ${requestPath}:`);
        console.log(`📥 Content-Type: ${message.headers['content-type']}`);
        console.log(`📥 Full headers:`, JSON.stringify(message.headers, null, 2));
      }
      Object.assign(responseHeaders, message.headers);
    }

    // Build raw HTTP response to ensure no Express interference
    let httpResponse = `HTTP/1.1 ${message.statusCode || 200} OK\r\n`;
    
    // Add headers
    for (const [key, value] of Object.entries(responseHeaders)) {
      httpResponse += `${key}: ${value}\r\n`;
    }
    
    httpResponse += '\r\n'; // End headers
    
    // Send raw response to bypass Express completely
    if (message.body) {
      if (message.isBase64) {
        const buffer = Buffer.from(message.body, 'base64');
        res.socket.write(httpResponse);
        res.socket.write(buffer);
      } else {
        res.socket.write(httpResponse + message.body);
      }
    } else {
      res.socket.write(httpResponse);
    }
    
    res.socket.end();
  }

  handleTunnelInfo(connection, message) {
    const tunnelId = message.tunnelId;
    const localPort = message.localPort;
    
    if (!tunnelId) {
      console.warn('⚠️ No tunnel ID provided in tunnel_info message');
      return;
    }

    // Set the tunnel ID on the connection
    connection.tunnelId = tunnelId;
    
    // Store or update tunnel
    this.tunnels.set(tunnelId, {
      id: tunnelId,
      connection,
      localPort: localPort,
      connectedAt: new Date(),
      requestCount: 0,
      activeStreams: 0,
      connectionId: connection.connectionId,
      protocol: 'QUIC'
    });

    this.quicConnections.set(connection.connectionId, {
      tunnel: tunnelId,
      streams: connection.activeStreams
    });
    
    console.log(`📋 QUIC tunnel registered: ${tunnelId} → localhost:${localPort}`);
    
    // Send confirmation back to client
    this.sendQuicMessage(connection, {
      type: 'tunnel_registered',
      tunnelId: tunnelId,
      localPort: localPort
    });
  }

  handleStreamData(connection, message) {
    // Handle multiplexed stream data (QUIC feature)
    const { streamId, data, isEnd } = message;
    
    if (!connection.activeStreams.has(streamId)) {
      connection.activeStreams.set(streamId, {
        id: streamId,
        data: Buffer.alloc(0),
        complete: false
      });
    }

    const stream = connection.activeStreams.get(streamId);
    if (data) {
      stream.data = Buffer.concat([stream.data, Buffer.from(data, 'base64')]);
    }

    if (isEnd) {
      stream.complete = true;
      // Process complete stream
      this.processStreamData(connection, stream);
      connection.activeStreams.delete(streamId);
    }
  }

  processStreamData(connection, stream) {
    // Process complete QUIC stream data
    console.log(`⚡ QUIC stream ${stream.id} complete: ${stream.data.length} bytes`);
  }

  sendQuicMessage(connection, message) {
    if (connection.readyState === 1) {
      connection.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  generateConnectionId() {
    return `quic_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateTunnelId() {
    return `tunnel_${Date.now().toString(36)}`;
  }

  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateStreamId() {
    return `stream_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  handleWebSocketUpgrade(request, socket, head) {
    try {
      const host = request.headers.host || '';
      const subdomain = host.split('.')[0];
      
      console.log(`🔄 WebSocket upgrade: ${host}${request.url} → checking tunnel ${subdomain}`);
      
      // Find tunnel by subdomain
      const tunnel = this.tunnels.get(subdomain);
      
      if (!tunnel || !tunnel.connection || tunnel.connection.readyState !== 1) {
        console.log(`❌ No tunnel found for WebSocket upgrade: ${host}${request.url}`);
        console.log(`🔍 Debug: tunnel=${!!tunnel}, connection=${!!tunnel?.connection}, readyState=${tunnel?.connection?.readyState}`);
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      console.log(`🌐 WSS: ${host}${request.url} → tunnel ${subdomain}`);
      this.forwardWebSocketUpgrade(tunnel, request, socket, head);
      
    } catch (error) {
      console.error('❌ WebSocket upgrade error:', error);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  }

  forwardWebSocketUpgrade(tunnel, request, socket, head) {
    const upgradeId = `${tunnel.id || 'unknown'}_ws_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    console.log(`🔌 Creating WebSocket bridge: ${upgradeId}`);
    
    // Store the socket for this WebSocket connection
    this.pendingRequests.set(upgradeId, { socket, head });
    
    // Forward WebSocket upgrade request to client via QUIC
    const upgradeData = {
      type: 'websocket_upgrade',
      upgradeId,
      method: request.method,
      url: request.url,
      headers: request.headers
    };

    this.sendQuicMessage(tunnel.connection, upgradeData);
    
    // Timeout for upgrade response
    setTimeout(() => {
      if (this.pendingRequests.has(upgradeId)) {
        console.log(`⏰ WebSocket upgrade timeout: ${upgradeId}`);
        this.pendingRequests.delete(upgradeId);
        socket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
        socket.destroy();
      }
    }, 10000);
  }

  handleWebSocketUpgradeResponse(message) {
    console.log(`🔄 Processing WebSocket upgrade response: ${message.upgradeId}, success: ${message.success}`);
    
    const pending = this.pendingRequests.get(message.upgradeId);
    if (!pending) {
      console.warn(`⚠️ No pending WebSocket upgrade found for ${message.upgradeId}`);
      return;
    }

    this.pendingRequests.delete(message.upgradeId);
    const { socket, head } = pending;

    if (message.success) {
      try {
        // Ensure we have a valid accept key
        if (!message.webSocketAccept) {
          console.error(`❌ Missing WebSocket accept key for ${message.upgradeId}`);
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
          return;
        }
        
        // Send proper HTTP 101 upgrade response
        const responseHeaders = [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${message.webSocketAccept}`,
          '', ''
        ].join('\r\n');

        console.log(`✅ Sending WebSocket upgrade response: ${message.upgradeId}`);
        
        if (!socket.writable) {
          console.error(`❌ Socket not writable for ${message.upgradeId}`);
          socket.destroy();
          return;
        }
        
        socket.write(responseHeaders);
        console.log(`✅ WebSocket upgrade headers sent: ${message.upgradeId}`);
        
        // Now set up raw WebSocket frame proxying
        this.setupWebSocketProxy(socket, message.upgradeId);
        
      } catch (error) {
        console.error(`❌ Error setting up WebSocket tunnel: ${message.upgradeId}`, error);
        try {
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
        } catch (destroyError) {
          console.error(`❌ Error destroying socket: ${destroyError}`);
        }
      }
      
    } else {
      console.log(`❌ WebSocket upgrade failed: ${message.upgradeId} - ${message.error}`);
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
    }
  }

  setupWebSocketProxy(browserSocket, upgradeId) {
    console.log(`🔌 Setting up transparent WebSocket proxy for ${upgradeId}`);
    
    // Store WebSocket connection for bidirectional communication
    browserSocket.on('data', (data) => {
      // Forward ALL WebSocket frames from browser to client (completely agnostic)
      const tunnel = Array.from(this.tunnels.values())
        .find(t => t.connection && t.connection.readyState === 'open');
      
      if (tunnel) {
        try {
          console.log(`📤 Raw frame from browser: ${data.length} bytes`);
          
          // Use binary-safe base64 encoding for ALL frame data
          const frameData = data.toString('base64');
          console.log(`📤 Forwarding frame to client: ${data.length} bytes`);
          
          // Send frame message to tunnel client
          const frameMessage = {
            type: 'websocket_frame',
            upgradeId,
            data: frameData,
            direction: 'to_local',
            originalSize: data.length
          };
          
          this.sendQuicMessage(tunnel.connection, frameMessage);
        } catch (error) {
          console.error(`❌ Error encoding frame data: ${upgradeId}`, error);
        }
      }
    });

    browserSocket.on('close', () => {
      console.log(`🔌 Browser WebSocket closed: ${upgradeId}`);
      const tunnel = Array.from(this.tunnels.values())
        .find(t => t.connection && t.connection.readyState === 'open');
      
      if (tunnel) {
        this.sendQuicMessage(tunnel.connection, {
          type: 'websocket_close',
          upgradeId
        });
      }
    });

    browserSocket.on('error', (error) => {
      console.error(`❌ Browser WebSocket error: ${upgradeId}`, error);
    });

    // Store reference for frames from client
    this.pendingRequests.set(`ws_${upgradeId}`, { 
      socket: browserSocket
    });
  }

  handleWebSocketFrame(message) {
    const pending = this.pendingRequests.get(`ws_${message.upgradeId}`);
    if (pending && pending.socket) {
      try {
        // Validate base64 data before decoding
        if (!message.data || typeof message.data !== 'string') {
          console.warn(`⚠️ Invalid frame data for ${message.upgradeId}: data is not a string`);
          return;
        }
        
        // Forward frame from client to browser
        const data = Buffer.from(message.data, 'base64');
        
        // Validate decoded data
        if (!data || data.length === 0) {
          console.warn(`⚠️ Empty frame data after decoding for ${message.upgradeId}`);
          return;
        }
        
        console.log(`📥 Raw frame to browser: ${data.length} bytes`);
        console.log(`📥 Forwarding frame to browser: ${message.originalSize || data.length} bytes from base64`);
        
        if (pending.socket.writable && !pending.socket.destroyed) {
          pending.socket.write(data);
          console.log(`✅ WebSocket frame sent to browser: ${data.length} bytes`);
        } else {
          console.warn(`⚠️ Socket not writable or destroyed for ${message.upgradeId}`);
          this.pendingRequests.delete(`ws_${message.upgradeId}`);
        }
        
      } catch (error) {
        console.error(`❌ Error handling WebSocket frame: ${message.upgradeId}`, error);
        console.error(`❌ Frame data preview: ${message.data ? message.data.substring(0, 50) : 'null'}...`);
      }
    } else {
      console.warn(`⚠️ No pending WebSocket connection found for frame: ${message.upgradeId}`);
    }
  }

  handleWebSocketClose(message) {
    const pending = this.pendingRequests.get(`ws_${message.upgradeId}`);
    if (pending && pending.socket) {
      console.log(`🔌 Closing WebSocket connection: ${message.upgradeId}`);
      try {
        pending.socket.destroy();
      } catch (error) {
        console.error(`❌ Error closing WebSocket: ${message.upgradeId}`, error);
      }
      this.pendingRequests.delete(`ws_${message.upgradeId}`);
    }
  }

  start() {
    // Add WebSocket upgrade handling to HTTP server
    this.httpServer.on('upgrade', (request, socket, head) => {
      this.handleWebSocketUpgrade(request, socket, head);
    });

    this.httpServer.listen(this.config.httpPort, () => {
      console.log('🚀 QUIC/HTTP3 Tunnel Server Started!');
      console.log(`📡 HTTP Server: http://localhost:${this.config.httpPort}`);
      console.log(`⚡ QUIC Server: ws://localhost:${this.config.quicPort} (simulated)`);
      console.log(`🌍 Domain: *.${this.config.domain}`);
      console.log(`🔥 Features: Ultra-low latency, Stream multiplexing, Connection migration`);
      console.log('─'.repeat(60));
    });
  }

  stop() {
    // Close all QUIC connections
    this.tunnels.forEach(tunnel => {
      if (tunnel.connection) {
        tunnel.connection.close();
      }
    });
    
    this.httpServer.close();
    this.quicServer.close();
    console.log('🛑 QUIC/HTTP3 Tunnel Server stopped');
  }
}

// CLI interface
async function startServer() {
  const config = {};
  
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace('--', '');
    const value = args[i + 1];
    if (key && value) {
      if (key === 'port' || key === 'httpPort') config.httpPort = parseInt(value);
      else if (key === 'quicPort') config.quicPort = parseInt(value);
      else if (key === 'domain') config.domain = value;
    }
  }

  const server = new QuicTunnelServer(config);
  server.start();

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down QUIC/HTTP3 Tunnel Server...');
    server.stop();
    process.exit(0);
  });
}

if (require.main === module) {
  startServer().catch(console.error);
}

module.exports = QuicTunnelServer; 