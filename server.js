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
        connectedAt: client.connectedAt,
        publicUrl: `http://grabr.cc:${this.config.serverPort}/${id}/`,
        subdomainUrl: `https://${id}.grabr.cc/`
      }));

      res.json({
        server: {
          serverPort: this.config.serverPort,
          tunnelPort: this.config.tunnelPort
        },
        tunnels,
        info: {
          message: 'All requests (except /health and /dashboard) are forwarded to active tunnels'
        }
      });
    });
  }

  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      let tunnelId = this.generateTunnelId();
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
          this.handleTunnelMessage(client.id, data, client);
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

      // Connection confirmation will be sent after config is received
    });
  }

  handleTunnelMessage(tunnelId, data, client) {
    if (!client) return;

    switch (data.type) {
      case 'config':
        // Handle subdomain suggestion
        if (data.suggestedSubdomain) {
          const suggested = data.suggestedSubdomain.toLowerCase().replace(/[^a-z0-9-]/g, '');
          if (suggested && suggested.length > 0 && !this.tunnelClients.has(suggested)) {
            // Remove old tunnelId entry and use suggested subdomain
            this.tunnelClients.delete(tunnelId);
            const newTunnelId = suggested;
            client.id = newTunnelId;
            this.tunnelClients.set(newTunnelId, client);
            console.log(`✨ Using custom subdomain: ${newTunnelId}`);
            tunnelId = newTunnelId;
          } else if (this.tunnelClients.has(suggested)) {
            console.log(`⚠️  Subdomain '${suggested}' already in use, using random: ${tunnelId}`);
          }
        }
        
        client.localPort = data.localPort;
        client.localHost = data.localHost || 'localhost';
        console.log(`📋 Tunnel ${tunnelId} configured for ${client.localHost}:${client.localPort}`);
        
        // Send connection confirmation after config is processed
        client.ws.send(JSON.stringify({
          type: 'connected',
          tunnelId,
          publicUrl: `http://grabr.cc:${this.config.serverPort}/${tunnelId}/`,
          subdomainUrl: `https://${tunnelId}.grabr.cc/`
        }));
        break;
      
      case 'response':
        // Handle HTTP response from local server
        this.forwardResponse(tunnelId, data);
        break;
      
      case 'websocket_upgrade_response':
        // Handle WebSocket upgrade response from local server
        this.handleWebSocketUpgradeResponse(tunnelId, data);
        break;
      
      case 'websocket_data':
        // Handle WebSocket data from local server
        this.forwardWebSocketData(tunnelId, data);
        break;
      
      case 'websocket_close':
        // Handle WebSocket close from local server
        this.handleWebSocketCloseFromClient(tunnelId, data);
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
    // Subdomain-based routing (like ngrok)
    this.app.use((req, res, next) => {
      const host = req.get('host') || '';
      const subdomain = host.split('.')[0];
      

      
      // Check if this is a subdomain request (tunnel-based)
      const tunnelClient = this.tunnelClients.get(subdomain);
      if (tunnelClient && tunnelClient.ws.readyState === WebSocket.OPEN) {
        console.log(`🌐 Subdomain routing: ${host}${req.path} → tunnel ${subdomain}`);
        this.forwardRequestToTunnel(subdomain, req, res, false); // Use normal tunnel forwarding
        return;
      }
      
      next();
    });

    // Root path handler - show server info
    this.app.get('/', (req, res) => {
      const activeTunnels = Array.from(this.tunnelClients.entries())
        .filter(([id, client]) => client.ws.readyState === WebSocket.OPEN);
      
      if (activeTunnels.length > 0) {
        // If there's an active tunnel, redirect to it
        const [tunnelId] = activeTunnels[0];
        res.redirect(`/${tunnelId}/`);
      } else {
        res.json({
          message: 'Mini Tunnel Server',
          version: '1.0.0',
          status: 'No active tunnels',
          endpoints: {
            health: '/health',
            dashboard: '/dashboard'
          }
        });
      }
    });

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

    // Enhanced catch-all with better priority handling
    this.app.use((req, res, next) => {
      // Skip server endpoints
      if (req.path === '/health' || req.path === '/dashboard') {
        return next();
      }

      // Find any active tunnel and forward to it
      const activeTunnels = Array.from(this.tunnelClients.entries())
        .filter(([id, client]) => client.ws.readyState === WebSocket.OPEN);
      
      if (activeTunnels.length > 0) {
        const [tunnelId] = activeTunnels[0];
        console.log(`🔄 Catch-all: ${req.method} ${req.path} → tunnel ${tunnelId}`);
        this.forwardRequestToTunnel(tunnelId, req, res, true); // Keep original URL
        return;
      }
      
      // No active tunnels
      res.status(404).json({ 
        error: 'No active tunnels available',
        path: req.path,
        method: req.method
      });
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

  handleWebSocketUpgrade(request, socket, head) {
    try {
      const host = request.headers.host || '';
      const subdomain = host.split('.')[0];
      
      console.log(`🔄 WebSocket upgrade request: ${host}${request.url} → checking tunnel ${subdomain}`);
      
      // Check if this is a subdomain request (tunnel-based)
      const tunnelClient = this.tunnelClients.get(subdomain);
      if (tunnelClient && tunnelClient.ws.readyState === WebSocket.OPEN) {
        console.log(`🌐 WSS routing: ${host}${request.url} → tunnel ${subdomain}`);
        this.forwardWebSocketUpgrade(subdomain, request, socket, head);
        return;
      }
      
      // Check if there's any active tunnel for catch-all
      const activeTunnels = Array.from(this.tunnelClients.entries())
        .filter(([id, client]) => client.ws.readyState === WebSocket.OPEN);
      
      if (activeTunnels.length > 0) {
        const [tunnelId] = activeTunnels[0];
        console.log(`🔄 WSS Catch-all: ${request.url} → tunnel ${tunnelId}`);
        this.forwardWebSocketUpgrade(tunnelId, request, socket, head);
        return;
      }
      
      // No active tunnels - close connection
      console.log(`❌ No tunnel found for WebSocket upgrade: ${host}${request.url}`);
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      
    } catch (error) {
      console.error('WebSocket upgrade error:', error);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  }

  forwardWebSocketUpgrade(tunnelId, request, socket, head) {
    const client = this.tunnelClients.get(tunnelId);
    const upgradeId = this.generateRequestId();

    // Store the socket for the WebSocket connection
    if (!client.webSocketConnections) {
      client.webSocketConnections = new Map();
    }
    
    // Store connection info for proper cleanup
    const connectionInfo = {
      socket,
      established: false,
      ws: null
    };
    client.webSocketConnections.set(upgradeId, connectionInfo);

    // Send WebSocket upgrade request to client
    const upgradeData = {
      type: 'websocket_upgrade',
      upgradeId,
      url: request.url,
      headers: request.headers,
      protocol: request.headers['sec-websocket-protocol'],
      key: request.headers['sec-websocket-key']
    };

    client.ws.send(JSON.stringify(upgradeData));

    // Set timeout for upgrade
    setTimeout(() => {
      if (client.webSocketConnections && client.webSocketConnections.has(upgradeId)) {
        const conn = client.webSocketConnections.get(upgradeId);
        if (!conn.established) {
          client.webSocketConnections.delete(upgradeId);
          if (!socket.destroyed) {
            socket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
            socket.destroy();
          }
        }
      }
    }, 10000); // 10 second timeout for WebSocket upgrade
  }

  handleWebSocketUpgradeResponse(tunnelId, data) {
    const client = this.tunnelClients.get(tunnelId);
    if (!client || !client.webSocketConnections) return;

    const connectionInfo = client.webSocketConnections.get(data.upgradeId);
    if (!connectionInfo || connectionInfo.socket.destroyed) return;

    const socket = connectionInfo.socket;

    if (data.success) {
      // Send successful upgrade response
      const responseLines = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${data.acceptKey}`,
      ];

      if (data.protocol) {
        responseLines.push(`Sec-WebSocket-Protocol: ${data.protocol}`);
      }

      responseLines.push('', ''); // Empty line to end headers
      socket.write(responseLines.join('\r\n'));

      // Mark connection as established
      connectionInfo.established = true;

      // Setup raw socket data forwarding (simpler approach)
      socket.on('data', (chunk) => {
        // Forward client WebSocket data to tunnel
        client.ws.send(JSON.stringify({
          type: 'websocket_data',
          upgradeId: data.upgradeId,
          data: chunk.toString('base64'),
          direction: 'to_local'
        }));
      });

      socket.on('error', (error) => {
        console.error(`❌ WebSocket socket error for ${data.upgradeId}:`, error.message);
        client.webSocketConnections.delete(data.upgradeId);
      });

      socket.on('close', () => {
        client.webSocketConnections.delete(data.upgradeId);
        // Notify client that WebSocket connection closed
        client.ws.send(JSON.stringify({
          type: 'websocket_close',
          upgradeId: data.upgradeId
        }));
      });

      console.log(`✅ WebSocket upgrade successful: ${data.upgradeId}`);
    } else {
      // Send error response
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      client.webSocketConnections.delete(data.upgradeId);
      console.log(`❌ WebSocket upgrade failed: ${data.upgradeId}`);
    }
  }

  forwardWebSocketData(tunnelId, data) {
    const client = this.tunnelClients.get(tunnelId);
    if (!client || !client.webSocketConnections) return;

    const connectionInfo = client.webSocketConnections.get(data.upgradeId);
    if (!connectionInfo || connectionInfo.socket.destroyed) return;

    if (data.direction === 'to_client') {
      // Forward data from local WebSocket to client
      const buffer = Buffer.from(data.data, 'base64');
      connectionInfo.socket.write(buffer);
    }
  }

  handleWebSocketCloseFromClient(tunnelId, data) {
    const client = this.tunnelClients.get(tunnelId);
    if (!client || !client.webSocketConnections) return;

    const connectionInfo = client.webSocketConnections.get(data.upgradeId);
    if (connectionInfo && connectionInfo.socket && !connectionInfo.socket.destroyed) {
      connectionInfo.socket.destroy();
      client.webSocketConnections.delete(data.upgradeId);
      console.log(`🔌 WebSocket connection closed by client: ${data.upgradeId}`);
    }
  }

  start() {
    // Start WebSocket server on separate port (direct connection)
    const tunnelServer = http.createServer();
    this.wss = new WebSocket.Server({ server: tunnelServer });
    this.setupWebSocketServer();
    
    tunnelServer.listen(this.config.tunnelPort, () => {
      console.log(`🔌 WebSocket server running on port ${this.config.tunnelPort} (direct)`);
    });
    
    // Add WebSocket upgrade handling for tunneled WSS connections
    this.server.on('upgrade', (request, socket, head) => {
      this.handleWebSocketUpgrade(request, socket, head);
    });
    
    // Start HTTP server (via Cloudflare)
    this.server.listen(this.config.serverPort, () => {
      console.log(`🚀 HTTP server running on port ${this.config.serverPort} (via Cloudflare)`);
      console.log(`📊 Dashboard: http://localhost:${this.config.serverPort}/dashboard`);
      console.log(`🌐 Public Dashboard: https://grabr.cc/dashboard`);
    });
  }
}

// Start server if run directly
if (require.main === module) {
  const config = {
    serverPort: parseInt(process.env.SERVER_PORT) || 8080,
    tunnelPort: parseInt(process.env.TUNNEL_PORT) || 8081
  };

  console.log(`🔧 Starting with config: HTTP=${config.serverPort}, WebSocket=${config.tunnelPort}`);
  
  const server = new TunnelServer(config);
  server.start();
}

module.exports = TunnelServer; 