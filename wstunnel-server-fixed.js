#!/usr/bin/env node

const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const express = require('express');
const stream = require('stream');

// WebSocket Stream wrapper (like WsStream.js from wstunnel)
class WsStream extends stream.Duplex {
  constructor(ws) {
    super();
    this.ws = ws;
    this._open = true;
    
    this.ws.on('message', (data) => {
      if (this._open && Buffer.isBuffer(data)) {
        this.push(data);
      }
    });
    
    this.ws.on('close', () => {
      this._open = false;
      this.emit('close');
    });
    
    this.ws.on('error', (err) => this.emit('error', err));
  }

  _read() {}

  _write(chunk, encoding, callback) {
    if (this._open && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk, { binary: true }, callback);
    } else {
      callback(new Error('WebSocket not open'));
    }
  }

  end() {
    super.end();
    if (this._open) {
      this.ws.close();
    }
  }
}

// Stream binding function (like bindStream.js from wstunnel)
function bindStreams(stream1, stream2) {
  const cleanup = () => {
    stream1.removeAllListeners();
    stream2.removeAllListeners();
  };

  stream1.on('error', (err) => {
    console.error('Stream1 error:', err);
    cleanup();
    stream2.destroy();
  });

  stream2.on('error', (err) => {
    console.error('Stream2 error:', err);
    cleanup();
    stream1.destroy();
  });

  stream1.on('close', () => {
    cleanup();
    stream2.destroy();
  });

  stream2.on('close', () => {
    cleanup();
    stream1.destroy();
  });

  // Bidirectional pipe
  stream1.pipe(stream2, { end: true });
  stream2.pipe(stream1, { end: true });
}

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
        server: 'WSTunnel Server (Stream-based)',
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
        localPort: null
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
    }
  }

  handleHTTPTunnel(connection, req, res) {
    console.log(`🌐 HTTP ${req.method} ${req.url} → tunnel ${connection.id}`);
    
    // Create TCP connection to local service via WebSocket tunnel
    const tcpSocket = new net.Socket();
    const wsStream = new WsStream(connection.ws);
    
    // Connect to local service
    tcpSocket.connect(connection.localPort, 'localhost', () => {
      console.log(`✅ Connected to local service: localhost:${connection.localPort}`);
      
      // Bind the streams for bidirectional data flow
      bindStreams(tcpSocket, wsStream);
      
      // Build and send raw HTTP request
      const headers = Object.entries(req.headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\r\n');
      
      const httpRequest = `${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`;
      tcpSocket.write(httpRequest);
      
      // Forward request body if present
      req.on('data', (chunk) => {
        tcpSocket.write(chunk);
      });
      
      req.on('end', () => {
        // Request fully sent
      });
    });
    
    // Handle response data from local service
    tcpSocket.on('data', (data) => {
      res.write(data);
    });
    
    tcpSocket.on('end', () => {
      res.end();
    });
    
    tcpSocket.on('error', (error) => {
      console.error(`TCP connection error:`, error);
      res.status(502).end();
    });
    
    req.on('close', () => {
      tcpSocket.destroy();
    });
  }

  handleWebSocketUpgrade(connection, request, socket, head) {
    console.log(`🔄 WebSocket upgrade ${request.url} → tunnel ${connection.id}`);
    
    // Create TCP connection to local service
    const tcpSocket = new net.Socket();
    
    tcpSocket.connect(connection.localPort, 'localhost', () => {
      console.log(`✅ WebSocket connected to local service`);
      
      // Send WebSocket upgrade request to local service
      const upgradeRequest = `GET ${request.url} HTTP/1.1\r\n` +
        Object.entries(request.headers)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\r\n') + '\r\n\r\n';
      
      tcpSocket.write(upgradeRequest);
      
      // Create WebSocket stream from tunnel connection
      const wsStream = new WsStream(connection.ws);
      
      // Bind streams for bidirectional data flow
      bindStreams(tcpSocket, wsStream);
      
      // Also bind socket to WebSocket stream for raw data
      bindStreams(socket, wsStream);
    });
    
    tcpSocket.on('error', (error) => {
      console.error(`WebSocket TCP error:`, error);
      socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      socket.destroy();
    });
  }

  generateId() {
    return Math.random().toString(36).substr(2, 8);
  }

  start() {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        console.log(`🌍 WSTunnel Server (Stream-based) listening on port ${this.port}`);
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