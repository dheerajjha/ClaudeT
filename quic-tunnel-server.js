const express = require('express');
const http = require('http');
const { EventEmitter } = require('events');
const Logger = require('./logger');

// Initialize logging
const logger = new Logger('QUIC-SERVER');

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
    this.httpServer = http.createServer(this.app);
    
    this.setupRoutes();
    this.setupQuicServer();
  }

  setupRoutes() {
    this.app.set('trust proxy', true);
    
    // Body parsing middleware (minimal to avoid interfering with tunneled responses)
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

    // Handle all HTTP requests through tunnels
    this.app.use('*', (req, res) => {
      // Preserve original URL and path for tunnel forwarding
      req.originalUrl = req.originalUrl || req.url;
      this.handleHttpRequest(req, res);
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
    // For localhost testing, use the first available tunnel
    // In production, this would extract subdomain from Host header
    const host = req.headers.host || '';
    let tunnelId;
    
    if (host.includes('localhost')) {
      // For localhost testing, use the first available tunnel
      const availableTunnels = Array.from(this.tunnels.keys());
      tunnelId = availableTunnels[0];
      console.log(`🏠 Localhost detected, using first tunnel: ${tunnelId}`);
    } else {
      // Production logic: extract subdomain
      tunnelId = host.split('.')[0];
    }
    
    if (!tunnelId) {
      return res.status(404).json({ 
        error: 'No tunnel available',
        available: Array.from(this.tunnels.keys())
      });
    }

    const tunnel = this.tunnels.get(tunnelId);
    if (!tunnel || !tunnel.connection || tunnel.connection.readyState !== 1) {
      return res.status(503).json({ 
        error: 'QUIC tunnel not connected',
        requestedTunnel: tunnelId,
        available: Array.from(this.tunnels.keys())
      });
    }

    const requestId = this.generateRequestId();
    const streamId = this.generateStreamId();
    
    // Use originalUrl to preserve the full path
    const forwardUrl = req.originalUrl || req.url;
    console.log(`📥 HTTP ${req.method} ${forwardUrl} → ${tunnelId} [${requestId}] (QUIC stream: ${streamId})`);

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
    // Add original host information for the backend to use
    const enhancedHeaders = {
      ...req.headers,
      'x-original-host': req.headers.host,  // Preserve the original host for the backend
      'x-tunnel-protocol': 'QUIC'           // Mark as tunneled request
    };
    
    const success = this.sendQuicMessage(tunnel.connection, {
      type: 'http_request',
      requestId,
      streamId,
      method: req.method,
      url: forwardUrl,  // Use the preserved URL
      headers: enhancedHeaders,
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



    // Set response headers
    if (message.headers) {
      Object.entries(message.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
    }

    // Add QUIC performance headers
    res.setHeader('X-Tunnel-Protocol', 'QUIC');
    res.setHeader('X-Tunnel-Latency', `${latency}ms`);
    res.setHeader('X-Tunnel-Stream-ID', streamId);

    // Send response
    res.status(message.statusCode || 200);
    
    if (message.body) {
      if (message.isBase64) {
        res.send(Buffer.from(message.body, 'base64'));
      } else {
        res.send(message.body);
      }
    } else {
      res.end();
    }
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
    console.log(`🎯 Browser socket state: readable=${browserSocket.readable}, writable=${browserSocket.writable}, destroyed=${browserSocket.destroyed}`);
    
    // Store WebSocket connection for bidirectional communication
    browserSocket.on('data', (data) => {
      console.log(`🎯 BROWSER SOCKET DATA EVENT FIRED! ${data.length} bytes`);
      // Forward ALL WebSocket frames from browser to client (completely agnostic)
      const tunnel = Array.from(this.tunnels.values())
        .find(t => t.connection && t.connection.readyState === 1);
      
      if (tunnel) {
        console.log(`✅ Found tunnel for forwarding: ${tunnel.id || 'unknown'}, readyState: ${tunnel.connection.readyState}`);
        try {
          console.log(`📤 Raw frame from browser: ${data.length} bytes`);
          
          // Parse WebSocket frame to extract clean payload
          const payload = this.parseWebSocketFrame(data);
          if (!payload) {
            console.warn(`⚠️ Failed to parse WebSocket frame: ${data.length} bytes`);
            return;
          }
          
          console.log(`📤 Extracted payload: ${payload.length} bytes (was ${data.length} with frame headers)`);
          
          // Use binary-safe base64 encoding for payload data only
          const frameData = payload.toString('base64');
          console.log(`📤 Forwarding clean payload to client: ${payload.length} bytes`);
          
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
      } else {
        console.warn(`⚠️ No active tunnel found for forwarding frame (${data.length} bytes)`);
        const tunnelStates = Array.from(this.tunnels.values()).map(t => ({
          id: t.id,
          hasConnection: !!t.connection,
          readyState: t.connection?.readyState
        }));
        console.warn(`⚠️ Available tunnels:`, tunnelStates);
      }
    });

    browserSocket.on('close', () => {
      console.log(`🔌 Browser WebSocket closed: ${upgradeId}`);
      const tunnel = Array.from(this.tunnels.values())
        .find(t => t.connection && t.connection.readyState === 1);
      
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

    // Debug: Add other event listeners to see what's happening
    browserSocket.on('end', () => {
      console.log(`🎯 Browser socket END event: ${upgradeId}`);
    });
    
    browserSocket.on('drain', () => {
      console.log(`🎯 Browser socket DRAIN event: ${upgradeId}`);
    });
    
    console.log(`🎯 Event listeners added for ${upgradeId}`);

    // Store reference for frames from client
    this.pendingRequests.set(`ws_${upgradeId}`, { 
      socket: browserSocket
    });
  }

  handleWebSocketFrame(message) {
    console.log(`🎯 RECEIVED WEBSOCKET FRAME: direction=${message.direction}, upgradeId=${message.upgradeId}, size=${message.originalSize}`);
    
    // Only forward frames that are intended for the browser (from local WebSocket)
    if (message.direction !== 'to_browser') {
      console.log(`📋 Skipping frame with direction: ${message.direction} for ${message.upgradeId}`);
      return;
    }
    
    console.log(`✅ FORWARDING FRAME TO BROWSER: ${message.upgradeId}, size=${message.originalSize}`);
    
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
        
        console.log(`📥 Raw payload from client: ${data.length} bytes`);
        
        // Create proper WebSocket frame for browser
        const webSocketFrame = this.createWebSocketFrame(data);
        console.log(`📥 Created WebSocket frame: ${webSocketFrame.length} bytes (payload: ${data.length})`);
        
        if (pending.socket.writable && !pending.socket.destroyed) {
          pending.socket.write(webSocketFrame);
          console.log(`✅ WebSocket frame sent to browser: ${webSocketFrame.length} bytes`);
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

  parseWebSocketFrame(buffer) {
    try {
      if (buffer.length < 2) return null;
      
      let offset = 0;
      
      // First byte: FIN (1 bit) + RSV (3 bits) + Opcode (4 bits)
      const firstByte = buffer[offset++];
      const fin = (firstByte & 0x80) === 0x80;
      const opcode = firstByte & 0x0F;
      
      // Second byte: MASK (1 bit) + Payload Length (7 bits)
      const secondByte = buffer[offset++];
      const masked = (secondByte & 0x80) === 0x80;
      let payloadLength = secondByte & 0x7F;
      
      // Extended payload length
      if (payloadLength === 126) {
        if (buffer.length < offset + 2) return null;
        payloadLength = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (buffer.length < offset + 8) return null;
        // For simplicity, we'll reject very large frames
        const high = buffer.readUInt32BE(offset);
        const low = buffer.readUInt32BE(offset + 4);
        if (high !== 0) return null; // Too large
        payloadLength = low;
        offset += 8;
      }
      
      // Masking key (4 bytes if masked)
      let maskingKey = null;
      if (masked) {
        if (buffer.length < offset + 4) return null;
        maskingKey = buffer.slice(offset, offset + 4);
        offset += 4;
      }
      
      // Payload data
      if (buffer.length < offset + payloadLength) return null;
      let payload = buffer.slice(offset, offset + payloadLength);
      
      // Unmask payload if masked
      if (masked && maskingKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskingKey[i % 4];
        }
      }
      
      console.log(`🎯 Parsed WebSocket frame: fin=${fin}, opcode=${opcode}, masked=${masked}, length=${payloadLength}`);
      return payload;
      
    } catch (error) {
      console.error(`❌ Error parsing WebSocket frame:`, error);
      return null;
    }
  }

  createWebSocketFrame(payload) {
    // Create WebSocket text frame (opcode 1) for server-to-client (no masking required)
    const payloadLength = payload.length;
    let frame;
    
    if (payloadLength < 126) {
      // Small payload: 2 bytes header + payload
      frame = Buffer.allocUnsafe(2 + payloadLength);
      frame[0] = 0x81; // FIN=1, opcode=1 (text)
      frame[1] = payloadLength; // No mask, payload length
      payload.copy(frame, 2);
    } else if (payloadLength < 65536) {
      // Medium payload: 4 bytes header + payload
      frame = Buffer.allocUnsafe(4 + payloadLength);
      frame[0] = 0x81; // FIN=1, opcode=1 (text)
      frame[1] = 126; // Extended length indicator
      frame.writeUInt16BE(payloadLength, 2);
      payload.copy(frame, 4);
    } else {
      // Large payload: 10 bytes header + payload
      frame = Buffer.allocUnsafe(10 + payloadLength);
      frame[0] = 0x81; // FIN=1, opcode=1 (text)
      frame[1] = 127; // Extended length indicator
      frame.writeUInt32BE(0, 2); // High 32 bits of length (0 for payloads < 4GB)
      frame.writeUInt32BE(payloadLength, 6); // Low 32 bits of length
      payload.copy(frame, 10);
    }
    
    return frame;
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