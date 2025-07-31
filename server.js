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
        localHost: client.localHost,
        subdomain: client.subdomain,
        customDomain: client.customDomain,
        routingRules: client.routingRules,
        connectedAt: client.connectedAt,
        publicUrls: this.generatePublicUrls(id, client)
      }));

      res.json({
        server: {
          serverPort: this.config.serverPort,
          tunnelPort: this.config.tunnelPort
        },
        tunnels,
        routingInfo: {
          message: 'Requests are routed based on: 1) Subdomain match, 2) Custom domain, 3) Path prefixes, 4) Priority/recency'
        }
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
        client.localHost = data.localHost || 'localhost';
        // Set routing preferences
        client.routingRules = data.routingRules || { priority: 1 };
        client.subdomain = data.subdomain || null;
        client.customDomain = data.customDomain || null;
        
        console.log(`📋 Tunnel ${tunnelId} configured:`);
        console.log(`   Local: ${client.localHost}:${client.localPort}`);
        if (client.subdomain) console.log(`   Subdomain: ${client.subdomain}`);
        if (client.customDomain) console.log(`   Custom Domain: ${client.customDomain}`);
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
    // Handle requests to tunneled services (with tunnel ID)
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

    // Handle direct tunnel access (when someone visits just the tunnel ID)
    this.app.use('/:tunnelId', (req, res, next) => {
      const tunnelId = req.params.tunnelId;
      const client = this.tunnelClients.get(tunnelId);

      if (client && client.ws.readyState === WebSocket.OPEN) {
        // Redirect to include trailing slash for proper relative path handling
        res.redirect(`/${tunnelId}/`);
      } else {
        next();
      }
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

    // Catch-all handler for ANY request that doesn't match above patterns
    // This will intelligently route to the correct tunnel
    this.app.use('*', (req, res) => {
      // Skip the specific server endpoints
      if (req.path === '/health' || req.path === '/dashboard' || req.path === '/') {
        return res.status(404).json({ error: 'Endpoint not found' });
      }

      const tunnelId = this.findBestTunnelForRequest(req);
      
      if (tunnelId) {
        const client = this.tunnelClients.get(tunnelId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
          console.log(`🔄 Routing ${req.method} ${req.path} to tunnel ${tunnelId}`);
          this.forwardRequestToTunnel(tunnelId, req, res, true);
        } else {
          res.status(404).json({ error: `Tunnel ${tunnelId} not available` });
        }
      } else {
        res.status(404).json({ 
          error: 'No suitable tunnel found',
          path: req.path,
          method: req.method,
          availableTunnels: Array.from(this.tunnelClients.keys())
        });
      }
    });
  }

  forwardRequestToTunnel(tunnelId, req, res, isAssetRequest = false) {
    const client = this.tunnelClients.get(tunnelId);
    const requestId = this.generateRequestId();

    // Store request for response handling
    client.requestQueue.push({ id: requestId, req, res });

    // Forward request to client
    let targetUrl;
    if (isAssetRequest) {
      // For asset requests, keep the original URL
      targetUrl = req.url;
    } else {
      // For regular requests, strip the tunnel ID
      targetUrl = req.url.replace(`/${tunnelId}`, '') || '/';
    }

    const requestData = {
      type: 'request',
      requestId,
      method: req.method,
      url: targetUrl,
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

  generatePublicUrls(tunnelId, client) {
    const baseUrl = `http://[VM-IP]:${this.config.serverPort}`;
    const urls = [`${baseUrl}/${tunnelId}/`];
    
    if (client.subdomain) {
      urls.push(`http://${client.subdomain}.[VM-IP]:${this.config.serverPort}/`);
    }
    
    if (client.customDomain) {
      urls.push(`http://${client.customDomain}/`);
    }
    
    // For path-based routing, show examples
    if (client.routingRules?.pathPrefixes) {
      client.routingRules.pathPrefixes.forEach(prefix => {
        urls.push(`${baseUrl}${prefix}`);
      });
    }
    
    return urls;
  }

  findBestTunnelForRequest(req) {
    const activeTunnels = Array.from(this.tunnelClients.entries())
      .filter(([id, client]) => client.ws.readyState === WebSocket.OPEN)
      .map(([id, client]) => ({ id, client }));

    if (activeTunnels.length === 0) return null;

    // 1. Check for exact subdomain match (if using subdomains)
    const host = req.get('host') || '';
    const subdomain = host.split('.')[0];
    
    for (const { id, client } of activeTunnels) {
      if (client.subdomain && client.subdomain === subdomain) {
        return id;
      }
    }

    // 2. Check for custom domain match
    for (const { id, client } of activeTunnels) {
      if (client.customDomain && host.includes(client.customDomain)) {
        return id;
      }
    }

    // 3. Check for path-based routing rules
    for (const { id, client } of activeTunnels) {
      if (client.routingRules && client.routingRules.pathPrefixes) {
        for (const prefix of client.routingRules.pathPrefixes) {
          if (req.path.startsWith(prefix)) {
            return id;
          }
        }
      }
    }

    // 4. Use default tunnel (highest priority, or most recent if no priority set)
    const defaultTunnel = activeTunnels
      .sort((a, b) => {
        const aPriority = a.client.routingRules?.priority || 1;
        const bPriority = b.client.routingRules?.priority || 1;
        if (aPriority !== bPriority) {
          return bPriority - aPriority; // Higher priority first
        }
        // If same priority, use most recent
        return new Date(b.client.connectedAt) - new Date(a.client.connectedAt);
      })[0];

    return defaultTunnel ? defaultTunnel.id : null;
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