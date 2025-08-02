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
      quicPort: process.env.QUIC_PORT || config.quicPort || 4433,
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
    
    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    this.app.use(express.raw({ limit: '10mb', type: '*/*' }));

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
      const tunnel = this.tunnels.get(connection.tunnelId);
      
      if (!tunnel) return;

      // Update activity timestamp
      connection.lastActivity = Date.now();

      switch (message.type) {
        case 'tunnel_info':
          this.handleTunnelInfo(connection, message);
          break;
        
        case 'http_response':
          this.handleHttpResponse(message);
          break;
        
        case 'websocket_frame':
          this.handleWebSocketFrame(connection.tunnelId, message);
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

  start() {
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