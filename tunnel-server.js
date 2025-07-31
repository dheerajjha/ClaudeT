const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const httpProxy = require('http-proxy-middleware');

class TunnelServer {
  constructor(config = {}) {
    this.config = {
      httpPort: process.env.SERVER_PORT || config.httpPort || 80,
      wsPort: process.env.TUNNEL_PORT || config.wsPort || 8080,
      domain: config.domain || 'grabr.cc',
      ...config
    };
    
    this.tunnels = new Map(); // tunnelId -> { ws, localPort, connectedAt, requestCount }
    this.pendingRequests = new Map(); // requestId -> { res, timeout }
    
    this.app = express();
    this.httpServer = http.createServer(this.app);
    this.wsServer = new WebSocket.Server({ port: this.config.wsPort });
    
    this.setupRoutes();
    this.setupWebSocket();
  }

  setupRoutes() {
    // Enable trust proxy for Cloudflare
    this.app.set('trust proxy', true);
    
    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    this.app.use(express.raw({ limit: '10mb', type: '*/*' }));

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      const activeTunnels = Array.from(this.tunnels.values())
        .filter(t => t.ws.readyState === 1);
      
      res.json({
        status: 'healthy',
        activeTunnels: activeTunnels.length,
        tunnels: activeTunnels.map(t => ({
          id: t.id,
          localPort: t.localPort,
          connectedAt: t.connectedAt,
          requestCount: t.requestCount || 0
        }))
      });
    });

    // Dashboard endpoint
    this.app.get('/dashboard', (req, res) => {
      const activeTunnels = Array.from(this.tunnels.values())
        .filter(t => t.ws.readyState === 1);

      res.json({
        server: 'HTTP Tunnel Server',
        status: 'running',
        activeTunnels: activeTunnels.length,
        tunnels: activeTunnels.map(t => ({
          id: t.id,
          url: `https://${t.id}.${this.config.domain}/`,
          localPort: t.localPort,
          connectedAt: t.connectedAt,
          requestCount: t.requestCount || 0
        }))
      });
    });

    // Catch-all route for tunnel requests
    this.app.use('*', (req, res) => {
      this.handleTunnelRequest(req, res);
    });
    
    // Add WebSocket upgrade handling
    this.httpServer.on('upgrade', (request, socket, head) => {
      this.handleWebSocketUpgrade(request, socket, head);
    });
  }

  setupWebSocket() {
    this.wsServer.on('connection', (ws, req) => {
      const tunnelId = this.generateTunnelId();
      console.log(`🔗 New tunnel connection: ${tunnelId}`);

      const tunnel = {
        ws,
        id: tunnelId,
        localPort: null,
        connectedAt: new Date().toISOString(),
        requestCount: 0
      };

      this.tunnels.set(tunnelId, tunnel);

      ws.on('message', (data) => {
        try {
          // Skip binary data or data that doesn't look like JSON
          if (Buffer.isBuffer(data) && data[0] !== 0x7B) { // 0x7B is '{'
            console.log(`📡 Received binary data (${data.length} bytes) - skipping JSON parse`);
            return;
          }
          
          const message = JSON.parse(data);
          console.log(`📡 Received message: type=${message.type}, from=${tunnelId}, size=${data.length} bytes`);
          this.handleTunnelMessage(tunnelId, message);
        } catch (error) {
          console.error(`❌ Invalid message from ${tunnelId}:`, error.message);
          console.log(`📋 Raw data preview: ${data.toString().substring(0, 50)}...`);
        }
      });

      ws.on('close', () => {
        console.log(`🔌 Tunnel disconnected: ${tunnelId}`);
        this.tunnels.delete(tunnelId);
        
        // Clean up any pending requests for this tunnel
        for (const [requestId, pending] of this.pendingRequests.entries()) {
          if (requestId.startsWith(tunnelId)) {
            clearTimeout(pending.timeout);
            if (pending.res && !pending.res.headersSent) {
              pending.res.status(502).json({ error: 'Tunnel disconnected' });
            }
            this.pendingRequests.delete(requestId);
          }
        }
      });

      // Send connection info
      ws.send(JSON.stringify({
        type: 'connected',
        tunnelId,
        message: 'Tunnel established successfully'
      }));
    });
  }

  handleTunnelMessage(tunnelId, message) {
    const tunnel = this.tunnels.get(tunnelId);
    if (!tunnel) return;

    switch (message.type) {
      case 'config':
        tunnel.localPort = message.localPort;
        tunnel.localHost = message.localHost || 'localhost';
        
        // Handle custom subdomain request
        if (message.suggestedSubdomain) {
          const requestedId = message.suggestedSubdomain.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (requestedId && !this.tunnels.has(requestedId) && requestedId !== tunnelId) {
            // Create alias for custom subdomain pointing to same tunnel
            this.tunnels.set(requestedId, tunnel);
            console.log(`✨ Using custom subdomain: ${requestedId}`);
            
            tunnel.ws.send(JSON.stringify({
              type: 'subdomain_updated',
              tunnelId: requestedId,
              message: `Tunnel available at https://${requestedId}.${this.config.domain}/`
            }));
            return;
          }
        }
        
        console.log(`📋 Tunnel ${tunnelId} configured for ${tunnel.localHost}:${tunnel.localPort}`);
        break;

      case 'response':
        console.log(`📨 Received response message for request ${message.requestId}`);
        this.handleTunnelResponse(message);
        break;

      case 'websocket_upgrade_response':
        console.log(`🔌 Received WebSocket upgrade response for ${message.upgradeId}`);
        this.handleTunnelResponse(message);
        break;

      case 'websocket_frame':
        this.handleWebSocketFrame(message);
        break;

      default:
        console.warn(`⚠️ Unknown message type: ${message.type}`);
    }
  }
  
  handleTunnelRequest(req, res) {
    const host = req.get('host') || '';
    const subdomain = host.split('.')[0];
    
    // Find tunnel by subdomain or fallback to any active tunnel
    let tunnel = this.tunnels.get(subdomain);
    
    if (!tunnel || tunnel.ws.readyState !== 1) {
      // Fallback to first active tunnel
      const activeTunnels = Array.from(this.tunnels.values())
        .filter(t => t.ws.readyState === 1);
      
      if (activeTunnels.length === 0) {
        return res.status(404).json({ 
          error: 'No active tunnels available',
          suggestion: 'Start a tunnel client first'
        });
      }
      
      tunnel = activeTunnels[0];
      console.log(`🔄 Fallback routing: ${req.method} ${req.originalUrl} → tunnel ${tunnel.id}`);
    } else {
      console.log(`🌐 Subdomain routing: ${host}${req.originalUrl} → tunnel ${tunnel.id}`);
    }

    tunnel.requestCount = (tunnel.requestCount || 0) + 1;

    // Generate unique request ID
    const requestId = `${tunnel.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store pending request
    const timeout = setTimeout(() => {
      this.pendingRequests.delete(requestId);
      if (!res.headersSent) {
        res.status(504).json({ error: 'Gateway timeout' });
      }
    }, 30000);

    this.pendingRequests.set(requestId, { res, timeout });

    // Forward request to tunnel client
    const requestData = {
      type: 'request',
      requestId,
      method: req.method,
      url: req.originalUrl,
      headers: req.headers
    };
    
    // Only include body if it's meaningful
    if (req.body && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
      requestData.body = req.body;
    }

    console.log(`📤 Forwarding: ${req.method} ${req.originalUrl} → ${tunnel.id}`);
    tunnel.ws.send(JSON.stringify(requestData));
  }

  handleWebSocketUpgrade(request, socket, head) {
    try {
      const host = request.headers.host || '';
      const subdomain = host.split('.')[0];
      
      console.log(`🔄 WebSocket upgrade: ${host}${request.url} → checking tunnel ${subdomain}`);
      
      // Find tunnel by subdomain or fallback to any active tunnel
      let tunnel = this.tunnels.get(subdomain);
      
      if (!tunnel || tunnel.ws.readyState !== 1) {
        // Fallback to first active tunnel
        const activeTunnels = Array.from(this.tunnels.values())
          .filter(t => t.ws.readyState === 1);
        
        if (activeTunnels.length === 0) {
          console.log(`❌ No tunnel found for WebSocket upgrade: ${host}${request.url}`);
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }
        
        tunnel = activeTunnels[0];
        console.log(`🔄 WSS Fallback: ${request.url} → tunnel ${tunnel.id}`);
      } else {
        console.log(`🌐 WSS Subdomain: ${host}${request.url} → tunnel ${tunnel.id}`);
      }

      this.forwardWebSocketUpgrade(tunnel, request, socket, head);
      
    } catch (error) {
      console.error('❌ WebSocket upgrade error:', error);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  }

  forwardWebSocketUpgrade(tunnel, request, socket, head) {
    const upgradeId = `${tunnel.id}_ws_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    console.log(`🔌 Creating WebSocket bridge: ${upgradeId}`);
    
    // Store the socket for this WebSocket connection
    this.pendingRequests.set(upgradeId, { socket, head });
    
    // Forward WebSocket upgrade request to client
    const upgradeData = {
      type: 'websocket_upgrade',
      upgradeId,
      method: request.method,
      url: request.url,
      headers: request.headers
    };

    tunnel.ws.send(JSON.stringify(upgradeData));
    
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

  handleTunnelResponse(message) {
    if (message.type === 'websocket_upgrade_response') {
      return this.handleWebSocketUpgradeResponse(message);
    }
    
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) {
      console.warn(`⚠️ No pending request found for ${message.requestId}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.requestId);

    const { res } = pending;
    if (res.headersSent) {
      console.warn(`⚠️ Headers already sent for ${message.requestId}`);
      return;
    }

    console.log(`📥 Received response: ${message.statusCode} (${message.requestId})`);

    try {
      // Set status and headers
      res.status(message.statusCode || 200);
      
      if (message.headers) {
        Object.entries(message.headers).forEach(([key, value]) => {
          res.set(key, value);
        });
      }

      // Send response body
      if (message.body) {
        if (typeof message.body === 'object') {
          res.json(message.body);
        } else {
          res.send(message.body);
        }
      } else {
        res.end();
      }
      
      console.log(`✅ Response sent: ${message.statusCode} (${message.requestId})`);
    } catch (error) {
      console.error(`❌ Error sending response:`, error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  handleWebSocketUpgradeResponse(message) {
    const pending = this.pendingRequests.get(message.upgradeId);
    if (!pending) {
      console.warn(`⚠️ No pending WebSocket upgrade found for ${message.upgradeId}`);
      return;
    }

    this.pendingRequests.delete(message.upgradeId);
    const { socket, head } = pending;

    if (message.success) {
      // Send upgrade response to browser
      const responseHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${message.webSocketAccept}`,
        '', ''
      ].join('\r\n');

      socket.write(responseHeaders);
      
      console.log(`✅ WebSocket upgrade successful: ${message.upgradeId}`);
      
      // Now proxy WebSocket frames bidirectionally
      this.setupWebSocketProxy(socket, message.upgradeId);
      
    } else {
      console.log(`❌ WebSocket upgrade failed: ${message.upgradeId}`);
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
        .find(t => t.ws.readyState === 1);
      
      if (tunnel) {
        tunnel.ws.send(JSON.stringify({
          type: 'websocket_frame',
          upgradeId,
          data: data.toString('base64'),
          direction: 'to_local'
        }));
      }
    });

    browserSocket.on('close', () => {
      console.log(`🔌 Browser WebSocket closed: ${upgradeId}`);
      // Notify client to close local WebSocket
      const tunnel = Array.from(this.tunnels.values())
        .find(t => t.ws.readyState === 1);
      
      if (tunnel) {
        tunnel.ws.send(JSON.stringify({
          type: 'websocket_close',
          upgradeId
        }));
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
      // Forward frame from client to browser (completely agnostic)
      const data = Buffer.from(message.data, 'base64');
      pending.socket.write(data);
    }
  }

  generateTunnelId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  start() {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.httpPort, '0.0.0.0', () => {
        console.log(`🚀 HTTP server running on port ${this.config.httpPort}`);
        console.log(`🔌 WebSocket server running on port ${this.config.wsPort}`);
        console.log(`🌐 Public Dashboard: https://${this.config.domain}/dashboard`);
        resolve();
      });
    });
  }

  stop() {
    return Promise.all([
      new Promise(resolve => this.httpServer.close(resolve)),
      new Promise(resolve => this.wsServer.close(resolve))
    ]);
  }
}

// Auto-start if run directly
if (require.main === module) {
  const config = {
    httpPort: parseInt(process.env.SERVER_PORT) || 80,
    wsPort: parseInt(process.env.TUNNEL_PORT) || 8080,
    domain: process.env.DOMAIN || 'grabr.cc'
  };

  console.log('🚀 Starting HTTP Tunnel Server...');
  console.log(`📋 Configuration: HTTP=${config.httpPort}, WebSocket=${config.wsPort}, Domain=${config.domain}`);

  const server = new TunnelServer(config);
  server.start().catch(console.error);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down server...');
    await server.stop();
    process.exit(0);
  });
}

module.exports = TunnelServer;