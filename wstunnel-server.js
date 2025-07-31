#!/usr/bin/env node

const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const express = require('express');

class WSTunnelServer {
  constructor(options = {}) {
    this.port = options.port || 80;
    this.tunnelPort = options.tunnelPort || 8080;
    this.connections = new Map();
    
    // Create HTTP server for public traffic
    this.app = express();
    this.httpServer = http.createServer(this.app);
    
    // Create WebSocket server for tunnel connections
    this.wss = new WebSocket.Server({ port: this.tunnelPort });
    
    this.setupRoutes();
    this.setupTunnelServer();
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        connections: this.connections.size,
        timestamp: new Date().toISOString()
      });
    });

    // Dashboard
    this.app.get('/dashboard', (req, res) => {
      const tunnels = Array.from(this.connections.values()).map(conn => ({
        id: conn.id,
        connected: conn.ws.readyState === WebSocket.OPEN,
        localPort: conn.localPort,
        connectedAt: conn.connectedAt,
        host: conn.host
      }));

      res.json({
        server: 'WSTunnel Server',
        tunnels,
        totalConnections: this.connections.size
      });
    });

    // Catch-all for tunneled traffic
    this.app.use((req, res, next) => {
      const host = req.get('host') || '';
      const subdomain = host.split('.')[0];
      
      // Try subdomain-based routing first
      let connection = this.connections.get(subdomain);
      
      // Fallback to first available connection
      if (!connection && this.connections.size > 0) {
        connection = Array.from(this.connections.values())[0];
      }
      
      if (connection && connection.ws.readyState === WebSocket.OPEN) {
        this.handleHTTPTunnel(connection, req, res);
      } else {
        res.status(404).json({ error: 'No active tunnel found' });
      }
    });

    // Handle WebSocket upgrades for tunneled traffic
    this.httpServer.on('upgrade', (request, socket, head) => {
      const host = request.headers.host || '';
      const subdomain = host.split('.')[0];
      
      let connection = this.connections.get(subdomain);
      if (!connection && this.connections.size > 0) {
        connection = Array.from(this.connections.values())[0];
      }
      
      if (connection && connection.ws.readyState === WebSocket.OPEN) {
        this.handleWebSocketUpgrade(connection, request, socket, head);
      } else {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
      }
    });
  }

  setupTunnelServer() {
    this.wss.on('connection', (ws, req) => {
      const connectionId = this.generateId();
      console.log(`🔗 New tunnel connection: ${connectionId}`);
      
      const connection = {
        id: connectionId,
        ws,
        connectedAt: new Date().toISOString(),
        host: null,
        localPort: null,
        tcpConnections: new Map()
      };
      
      this.connections.set(connectionId, connection);
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleTunnelMessage(connection, message);
        } catch (error) {
          console.error('Invalid tunnel message:', error);
        }
      });
      
      ws.on('close', () => {
        console.log(`🔌 Tunnel disconnected: ${connectionId}`);
        // Close all TCP connections for this tunnel
        for (const [connId, tcpSocket] of connection.tcpConnections) {
          tcpSocket.destroy();
        }
        this.connections.delete(connectionId);
      });
      
      ws.on('error', (error) => {
        console.error(`Tunnel error for ${connectionId}:`, error);
      });
      
      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        tunnelId: connectionId,
        message: 'Tunnel established'
      }));
    });
  }

  handleTunnelMessage(connection, message) {
    switch (message.type) {
      case 'config':
        connection.localPort = message.localPort;
        connection.host = message.host || connection.id;
        if (message.host && message.host !== connection.id) {
          // Update connection mapping for custom subdomain
          this.connections.delete(connection.id);
          this.connections.set(message.host, connection);
          connection.id = message.host;
        }
        console.log(`📝 Tunnel ${connection.id} configured: port ${connection.localPort}`);
        break;
        
      case 'tcp_data':
        const conn = connection.tcpConnections.get(message.connId);
        if (conn) {
          if (conn.type === 'http') {
            // Forward data to HTTP response
            conn.res.write(Buffer.from(message.data, 'base64'));
          } else {
            // Forward data to TCP socket
            conn.write(Buffer.from(message.data, 'base64'));
          }
        }
        break;
        
      case 'tcp_close':
        const connToClose = connection.tcpConnections.get(message.connId);
        if (connToClose) {
          if (connToClose.type === 'http') {
            connToClose.res.end();
          } else {
            connToClose.destroy();
          }
          connection.tcpConnections.delete(message.connId);
        }
        break;
    }
  }

  handleHTTPTunnel(connection, req, res) {
    const connId = this.generateId();
    console.log(`🌐 HTTP ${req.method} ${req.url} → tunnel ${connection.id}`);
    
    // Store response object for this connection
    connection.tcpConnections.set(connId, { res, type: 'http' });
    
    // Build raw HTTP request
    const headers = Object.entries(req.headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\r\n');
    
    const httpRequest = `${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`;
    
    // Send initial request to tunnel
    connection.ws.send(JSON.stringify({
      type: 'tcp_connect',
      connId,
      data: Buffer.from(httpRequest).toString('base64')
    }));
    
    // Handle request body if present
    req.on('data', (chunk) => {
      connection.ws.send(JSON.stringify({
        type: 'tcp_data',
        connId,
        data: chunk.toString('base64')
      }));
    });
    
    req.on('end', () => {
      // Request fully sent
    });
    
    req.on('close', () => {
      connection.ws.send(JSON.stringify({
        type: 'tcp_close',
        connId
      }));
      connection.tcpConnections.delete(connId);
    });
  }

  handleWebSocketUpgrade(connection, request, socket, head) {
    const connId = this.generateId();
    console.log(`🔄 WebSocket upgrade ${request.url} → tunnel ${connection.id}`);
    
    // Forward WebSocket upgrade to tunnel
    connection.ws.send(JSON.stringify({
      type: 'websocket_upgrade',
      connId,
      url: request.url,
      headers: request.headers
    }));
    
    // Store socket for bidirectional communication
    connection.tcpConnections.set(connId, socket);
    
    socket.on('data', (data) => {
      connection.ws.send(JSON.stringify({
        type: 'tcp_data',
        connId,
        data: data.toString('base64')
      }));
    });
    
    socket.on('close', () => {
      connection.ws.send(JSON.stringify({
        type: 'tcp_close',
        connId
      }));
      connection.tcpConnections.delete(connId);
    });
  }

  generateId() {
    return Math.random().toString(36).substr(2, 8);
  }

  start() {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        console.log(`🌍 WSTunnel Server listening on port ${this.port}`);
        console.log(`🔗 Tunnel connections on port ${this.tunnelPort}`);
        console.log(`📊 Dashboard: http://localhost:${this.port}/dashboard`);
        resolve();
      });
    });
  }
}

// CLI usage
if (require.main === module) {
  const port = process.env.PORT || 80;
  const tunnelPort = process.env.TUNNEL_PORT || 8080;
  
  const server = new WSTunnelServer({ port, tunnelPort });
  server.start().catch(console.error);
}

module.exports = WSTunnelServer; 