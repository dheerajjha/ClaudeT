const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

class TunnelServer {
  constructor(config = {}) {
    this.config = {
      serverPort: config.serverPort || 8080,
      tunnelPort: config.tunnelPort || 8081,
      ...config
    };
    
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = null; // Will be created in start()
    this.tunnelClients = new Map();
    
    this.setupMiddleware();
    this.setupProxyRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        activeTunnels: this.tunnelClients.size
      });
    });

    // Dashboard endpoint
    this.app.get('/dashboard', (req, res) => {
      const tunnels = Array.from(this.tunnelClients.entries()).map(([id, client]) => ({
        id,
        connected: client.ws.readyState === WebSocket.OPEN,
        localPort: client.localPort,
        connectedAt: client.connectedAt
      }));

      res.json({
        server: {
          serverPort: this.config.serverPort,
          tunnelPort: this.config.tunnelPort
        },
        tunnels
      });
    });
  }

  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      const tunnelId = this.generateTunnelId();
      console.log(`🔗 New tunnel connection: ${tunnelId}`);

      const client = {
        ws,
        id: tunnelId,
        localPort: null,
        connectedAt: new Date().toISOString(),
        requestQueue: []
      };

      this.tunnelClients.set(tunnelId, client);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleTunnelMessage(tunnelId, data);
        } catch (error) {
          console.error('Invalid message from client:', error);
        }
      });

      ws.on('close', () => {
        console.log(`❌ Tunnel disconnected: ${tunnelId}`);
        this.tunnelClients.delete(tunnelId);
      });

      ws.on('error', (error) => {
        console.error(`Tunnel error for ${tunnelId}:`, error);
        this.tunnelClients.delete(tunnelId);
      });

      // Send connection confirmation
      ws.send(JSON.stringify({
        type: 'connected',
        tunnelId,
        publicUrl: `http://[VM-IP]:${this.config.serverPort}/${tunnelId}`
      }));
    });
  }

  handleTunnelMessage(tunnelId, data) {
    const client = this.tunnelClients.get(tunnelId);
    if (!client) return;

    switch (data.type) {
      case 'config':
        client.localPort = data.localPort;
        console.log(`📋 Tunnel ${tunnelId} configured for local port ${data.localPort}`);
        break;
      
      case 'response':
        // Handle HTTP response from local server
        this.forwardResponse(tunnelId, data);
        break;
      
      default:
        console.log(`Unknown message type: ${data.type}`);
    }
  }

  forwardResponse(tunnelId, responseData) {
    const client = this.tunnelClients.get(tunnelId);
    if (!client) return;

    // Find the corresponding request in queue
    const requestIndex = client.requestQueue.findIndex(req => req.id === responseData.requestId);
    if (requestIndex === -1) return;

    const [request] = client.requestQueue.splice(requestIndex, 1);
    const { res } = request;

    // Set headers
    if (responseData.headers) {
      Object.entries(responseData.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
    }

    // Set status and send body
    res.status(responseData.statusCode || 200);
    
    if (responseData.body) {
      if (typeof responseData.body === 'string') {
        res.send(responseData.body);
      } else {
        res.json(responseData.body);
      }
    } else {
      res.end();
    }
  }

  setupProxyRoutes() {
    // Handle requests to tunneled services
    this.app.use('/:tunnelId/*', (req, res, next) => {
      const tunnelId = req.params.tunnelId;
      const client = this.tunnelClients.get(tunnelId);

      if (!client || client.ws.readyState !== WebSocket.OPEN) {
        return res.status(404).json({ 
          error: 'Tunnel not found or not connected',
          tunnelId 
        });
      }

      this.forwardRequestToTunnel(tunnelId, req, res);
    });

    // Root path handler
    this.app.get('/', (req, res) => {
      res.json({
        message: 'Mini Tunnel Server',
        version: '1.0.0',
        endpoints: {
          health: '/health',
          dashboard: '/dashboard',
          tunnel: '/:tunnelId/*'
        }
      });
    });
  }

  forwardRequestToTunnel(tunnelId, req, res) {
    const client = this.tunnelClients.get(tunnelId);
    const requestId = this.generateRequestId();

    // Store request for response handling
    client.requestQueue.push({ id: requestId, req, res });

    // Forward request to client
    const requestData = {
      type: 'request',
      requestId,
      method: req.method,
      url: req.url.replace(`/${tunnelId}`, '') || '/',
      headers: req.headers,
      body: req.body
    };

    client.ws.send(JSON.stringify(requestData));

    // Set timeout for request
    setTimeout(() => {
      const index = client.requestQueue.findIndex(r => r.id === requestId);
      if (index !== -1) {
        client.requestQueue.splice(index, 1);
        if (!res.headersSent) {
          res.status(504).json({ error: 'Gateway timeout' });
        }
      }
    }, 30000); // 30 second timeout
  }

  generateTunnelId() {
    return Math.random().toString(36).substr(2, 8);
  }

  generateRequestId() {
    return Math.random().toString(36).substr(2, 12);
  }

  start() {
    // Start WebSocket server on separate port
    const tunnelServer = http.createServer();
    this.wss = new WebSocket.Server({ server: tunnelServer });
    this.setupWebSocketServer();
    
    tunnelServer.listen(this.config.tunnelPort, () => {
      console.log(`🔌 WebSocket server running on port ${this.config.tunnelPort}`);
    });
    
    // Start HTTP server
    this.server.listen(this.config.serverPort, () => {
      console.log(`🚀 Tunnel server running on port ${this.config.serverPort}`);
      console.log(`📊 Dashboard: http://localhost:${this.config.serverPort}/dashboard`);
    });
  }
}

// Start server if run directly
if (require.main === module) {
  const config = {
    serverPort: process.env.SERVER_PORT || 8080,
    tunnelPort: process.env.TUNNEL_PORT || 8081
  };

  const server = new TunnelServer(config);
  server.start();
}

module.exports = TunnelServer; 