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
    
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        activeTunnels: this.tunnels.size,
        version: '1.0.0'
      });
    });

    // Dashboard
    this.app.get('/dashboard', (req, res) => {
      const tunnels = Array.from(this.tunnels.entries()).map(([id, tunnel]) => ({
        id,
        connected: tunnel.ws.readyState === WebSocket.OPEN,
        localPort: tunnel.localPort,
        connectedAt: tunnel.connectedAt,
        requestCount: tunnel.requestCount || 0,
        url: `https://${id}.${this.config.domain}/`
      }));

      res.json({
        server: {
          httpPort: this.config.httpPort,
          wsPort: this.config.wsPort,
          domain: this.config.domain
        },
        tunnels,
        totalRequests: tunnels.reduce((sum, t) => sum + t.requestCount, 0)
      });
    });

    // Main tunnel handler - catch all requests
    this.app.use('*', (req, res) => {
      this.handleTunnelRequest(req, res);
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
          const message = JSON.parse(data);
          this.handleTunnelMessage(tunnelId, message);
        } catch (error) {
          console.error(`❌ Invalid message from ${tunnelId}:`, error.message);
        }
      });

      ws.on('close', () => {
        console.log(`🔌 Tunnel disconnected: ${tunnelId}`);
        this.tunnels.delete(tunnelId);
        
        // Clean up any pending requests for this tunnel
        for (const [requestId, pending] of this.pendingRequests.entries()) {
          if (requestId.startsWith(tunnelId)) {
            clearTimeout(pending.timeout);
            if (!pending.res.headersSent) {
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
            // Move tunnel to requested subdomain
            this.tunnels.delete(tunnelId);
            this.tunnels.set(requestedId, { ...tunnel, id: requestedId });
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
        this.handleTunnelResponse(message);
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
    
    if (!tunnel || tunnel.ws.readyState !== WebSocket.OPEN) {
      // Fallback to first active tunnel
      const activeTunnels = Array.from(this.tunnels.values())
        .filter(t => t.ws.readyState === WebSocket.OPEN);
      
      if (activeTunnels.length === 0) {
        return res.status(404).json({ 
          error: 'No active tunnels available',
          suggestion: 'Start a tunnel client first'
        });
      }
      
      tunnel = activeTunnels[0];
      console.log(`🔄 Fallback routing: ${req.method} ${req.path} → tunnel ${tunnel.id}`);
    } else {
      console.log(`🌐 Subdomain routing: ${host}${req.path} → tunnel ${tunnel.id}`);
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
      url: req.url,
      headers: req.headers,
      body: req.body
    };

    tunnel.ws.send(JSON.stringify(requestData));
  }

  handleTunnelResponse(message) {
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.requestId);

    const { res } = pending;
    if (res.headersSent) return;

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
    } catch (error) {
      console.error(`❌ Error sending response:`, error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
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