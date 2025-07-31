const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const cors = require('cors');

class TCPTunnelServer {
  constructor(config = {}) {
    this.config = {
      serverPort: config.serverPort || 80,
      tunnelPort: config.tunnelPort || 8080,
      ...config
    };
    
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = null;
    this.tunnelClients = new Map();
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        activeTunnels: this.tunnelClients.size,
        timestamp: new Date().toISOString()
      });
    });

    // Dashboard
    this.app.get('/dashboard', (req, res) => {
      const tunnels = Array.from(this.tunnelClients.entries()).map(([id, client]) => ({
        id,
        connected: client.ws.readyState === WebSocket.OPEN,
        localPort: client.localPort,
        connectedAt: client.connectedAt,
        subdomainUrl: `https://${id}.grabr.cc/`
      }));

      res.json({
        server: { status: 'running', port: this.config.serverPort },
        tunnels: tunnels,
        timestamp: new Date().toISOString()
      });
    });
  }

  setupRoutes() {
    // Catch-all route for subdomain-based tunneling
    this.app.use((req, res, next) => {
      const host = req.get('host') || '';
      const subdomain = host.split('.')[0];
      
      const tunnelClient = this.tunnelClients.get(subdomain);
      if (tunnelClient && tunnelClient.ws.readyState === WebSocket.OPEN) {
        console.log(`🌐 HTTP routing: ${host}${req.path} → tunnel ${subdomain}`);
        this.handleHTTPThroughTunnel(subdomain, req, res);
        return;
      }
      
      // Fallback to first active tunnel
      const activeTunnels = Array.from(this.tunnelClients.entries())
        .filter(([id, client]) => client.ws.readyState === WebSocket.OPEN);
      
      if (activeTunnels.length > 0) {
        const [tunnelId] = activeTunnels[0];
        console.log(`🔄 HTTP Catch-all: ${req.method} ${req.path} → tunnel ${tunnelId}`);
        this.handleHTTPThroughTunnel(tunnelId, req, res);
        return;
      }
      
      res.status(404).json({ error: 'No active tunnels available' });
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
        tcpConnections: new Map() // Track TCP connections
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
        // Close all TCP connections for this tunnel
        if (client.tcpConnections) {
          for (const [connId, socket] of client.tcpConnections) {
            socket.destroy();
          }
        }
        this.tunnelClients.delete(tunnelId);
      });

      ws.on('error', (error) => {
        console.error(`Tunnel error for ${tunnelId}:`, error);
        this.tunnelClients.delete(tunnelId);
      });
    });
  }

  handleTunnelMessage(tunnelId, data, client) {
    switch (data.type) {
      case 'config':
        if (data.suggestedSubdomain) {
          const suggested = data.suggestedSubdomain.toLowerCase().replace(/[^a-z0-9-]/g, '');
          if (suggested && suggested.length > 0 && !this.tunnelClients.has(suggested)) {
            this.tunnelClients.delete(tunnelId);
            client.id = suggested;
            this.tunnelClients.set(suggested, client);
            tunnelId = suggested;
            console.log(`✨ Using custom subdomain: ${suggested}`);
          }
        }
        
        client.localPort = data.localPort;
        client.localHost = data.localHost || 'localhost';
        console.log(`📋 Tunnel ${tunnelId} configured for ${client.localHost}:${client.localPort}`);
        
        client.ws.send(JSON.stringify({
          type: 'connected',
          tunnelId,
          subdomainUrl: `https://${tunnelId}.grabr.cc/`
        }));
        break;
      
      case 'tcp_data':
        // Forward TCP data back to the connection
        this.forwardTCPData(tunnelId, data);
        break;
      
      case 'tcp_close':
        // Handle TCP connection close from client
        this.handleTCPCloseFromClient(tunnelId, data);
        break;
    }
  }

  handleHTTPThroughTunnel(tunnelId, req, res) {
    const client = this.tunnelClients.get(tunnelId);
    if (!client) return res.status(404).json({ error: 'Tunnel not found' });

    // Create a TCP connection for this HTTP request
    const connectionId = this.generateConnectionId();
    
    // Store the HTTP response object
    client.tcpConnections.set(connectionId, { type: 'http', res, buffer: Buffer.alloc(0) });

    // Build HTTP request string
    const httpRequest = this.buildHTTPRequest(req, client.localPort);
    
    // Send TCP connection request to client
    client.ws.send(JSON.stringify({
      type: 'tcp_connect',
      connectionId,
      host: client.localHost,
      port: client.localPort,
      data: httpRequest.toString('base64')
    }));

    // Set timeout
    setTimeout(() => {
      if (client.tcpConnections.has(connectionId)) {
        client.tcpConnections.delete(connectionId);
        if (!res.headersSent) {
          res.status(504).json({ error: 'Gateway timeout' });
        }
      }
    }, 30000);
  }

  buildHTTPRequest(req, localPort) {
    const lines = [];
    lines.push(`${req.method} ${req.url} HTTP/1.1`);
    
    // Add headers
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase() !== 'host') {
        lines.push(`${key}: ${value}`);
      }
    }
    lines.push(`Host: localhost:${localPort}`);
    lines.push('Connection: close');
    lines.push('');
    
    let httpRequest = lines.join('\r\n');
    
    // Add body if present
    if (req.body && Object.keys(req.body).length > 0) {
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      httpRequest += body;
    }
    
    return Buffer.from(httpRequest);
  }

  forwardTCPData(tunnelId, data) {
    const client = this.tunnelClients.get(tunnelId);
    if (!client || !client.tcpConnections) return;

    const connection = client.tcpConnections.get(data.connectionId);
    if (!connection) return;

    const buffer = Buffer.from(data.data, 'base64');
    
    if (connection.type === 'http') {
      // Accumulate HTTP response data
      connection.buffer = Buffer.concat([connection.buffer, buffer]);
      
      // Try to parse HTTP response
      const response = this.parseHTTPResponse(connection.buffer);
      if (response) {
        // Send HTTP response
        const res = connection.res;
        if (!res.headersSent) {
          res.status(response.statusCode);
          for (const [key, value] of Object.entries(response.headers)) {
            res.set(key, value);
          }
          
          // Handle different content types properly
          const contentType = response.headers['content-type'] || response.headers['Content-Type'] || '';
          if (contentType.includes('application/json')) {
            res.json(response.body);
          } else if (contentType.includes('text/')) {
            res.send(response.body);
          } else {
            res.send(response.body);
          }
        }
        client.tcpConnections.delete(data.connectionId);
      }
    } else if (connection.type === 'websocket') {
      // Forward raw WebSocket data
      if (connection.socket && !connection.socket.destroyed) {
        connection.socket.write(buffer);
      }
    }
  }

  parseHTTPResponse(buffer) {
    const str = buffer.toString();
    const headerEndIndex = str.indexOf('\r\n\r\n');
    
    if (headerEndIndex === -1) return null; // Headers not complete yet
    
    const headersPart = str.substring(0, headerEndIndex);
    const bodyPart = str.substring(headerEndIndex + 4);
    
    const lines = headersPart.split('\r\n');
    const statusLine = lines[0];
    const statusMatch = statusLine.match(/HTTP\/1\.[01] (\d+)/);
    const statusCode = statusMatch ? parseInt(statusMatch[1]) : 200;
    
    const headers = {};
    for (let i = 1; i < lines.length; i++) {
      const colonIndex = lines[i].indexOf(':');
      if (colonIndex > 0) {
        const key = lines[i].substring(0, colonIndex).trim();
        const value = lines[i].substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }
    
    return { statusCode, headers, body: bodyPart };
  }

  handleTCPCloseFromClient(tunnelId, data) {
    const client = this.tunnelClients.get(tunnelId);
    if (!client || !client.tcpConnections) return;

    const connection = client.tcpConnections.get(data.connectionId);
    if (connection) {
      if (connection.type === 'http' && connection.res && !connection.res.headersSent) {
        connection.res.status(502).json({ error: 'Connection closed by server' });
      }
      client.tcpConnections.delete(data.connectionId);
    }
  }

  generateTunnelId() {
    return Math.random().toString(36).substr(2, 8);
  }

  generateConnectionId() {
    return Math.random().toString(36).substr(2, 12);
  }

  start() {
    // Start WebSocket server for tunnel connections
    const tunnelServer = http.createServer();
    this.wss = new WebSocket.Server({ server: tunnelServer });
    this.setupWebSocketServer();
    
    tunnelServer.listen(this.config.tunnelPort, () => {
      console.log(`🔌 TCP Tunnel server running on port ${this.config.tunnelPort}`);
    });
    
    // Handle WebSocket upgrades on main server (for tunneled WebSocket connections)
    this.server.on('upgrade', (request, socket, head) => {
      this.handleWebSocketUpgrade(request, socket, head);
    });
    
    // Start main HTTP server
    this.server.listen(this.config.serverPort, () => {
      console.log(`🚀 HTTP server running on port ${this.config.serverPort}`);
      console.log(`🌐 Public Dashboard: https://grabr.cc/dashboard`);
    });
  }

  handleWebSocketUpgrade(request, socket, head) {
    const host = request.headers.host || '';
    const subdomain = host.split('.')[0];
    
    console.log(`🔄 WebSocket upgrade: ${host}${request.url} → tunnel ${subdomain}`);
    
    const tunnelClient = this.tunnelClients.get(subdomain);
    if (tunnelClient && tunnelClient.ws.readyState === WebSocket.OPEN) {
      this.forwardWebSocketUpgrade(subdomain, request, socket, head);
    } else {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
    }
  }

  forwardWebSocketUpgrade(tunnelId, request, socket, head) {
    const client = this.tunnelClients.get(tunnelId);
    const connectionId = this.generateConnectionId();
    
    // Store the socket
    client.tcpConnections.set(connectionId, { type: 'websocket', socket });
    
    // Build WebSocket upgrade request
    const upgradeRequest = this.buildWebSocketUpgradeRequest(request, client.localPort);
    
    // Send to client
    client.ws.send(JSON.stringify({
      type: 'tcp_connect',
      connectionId,
      host: client.localHost,
      port: client.localPort,
      data: upgradeRequest.toString('base64')
    }));
  }

  buildWebSocketUpgradeRequest(request, localPort) {
    const lines = [];
    lines.push(`GET ${request.url} HTTP/1.1`);
    
    for (const [key, value] of Object.entries(request.headers)) {
      if (key.toLowerCase() !== 'host') {
        lines.push(`${key}: ${value}`);
      }
    }
    lines.push(`Host: localhost:${localPort}`);
    lines.push('');
    
    return Buffer.from(lines.join('\r\n'));
  }
}

// Start server if run directly
if (require.main === module) {
  const config = {
    serverPort: parseInt(process.env.SERVER_PORT) || 80,
    tunnelPort: parseInt(process.env.TUNNEL_PORT) || 8080
  };

  console.log(`🔧 Starting TCP Tunnel Server: HTTP=${config.serverPort}, Tunnel=${config.tunnelPort}`);
  
  const server = new TCPTunnelServer(config);
  server.start();
}

module.exports = TCPTunnelServer; 