#!/usr/bin/env node

const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const express = require('express');
const stream = require('stream');
const url = require('url');

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
    this.dstHost = options.dstHost || 'localhost';
    this.dstPort = options.dstPort || 3008;
    this.activeConnections = 0;
    
    // Create HTTP server for public traffic  
    this.app = express();
    this.httpServer = http.createServer(this.app);
    
    // Create WebSocket server for tunnel connections (like original wstunnel)
    this.wss = new WebSocket.Server({ 
      port: this.tunnelPort,
      verifyClient: (info) => {
        // Accept connections with tunnel-protocol
        return info.protocols.includes('tunnel-protocol');
      }
    });
    
    this.setupRoutes();
    this.setupTunnelServer();
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        activeConnections: this.activeConnections,
        timestamp: new Date().toISOString()
      });
    });

    // Dashboard
    this.app.get('/dashboard', (req, res) => {
      res.json({
        server: 'WSTunnel Server (Correct Architecture)',
        activeConnections: this.activeConnections,
        targetHost: this.dstHost,
        targetPort: this.dstPort,
        tunnelPort: this.tunnelPort,
        info: 'Each WebSocket connection creates a new TCP tunnel'
      });
    });

    // Catch-all: Since we use wstunnel architecture, 
    // all traffic goes through WebSocket tunnels
    this.app.use((req, res) => {
      res.status(404).json({ 
        error: 'No tunnel found. Use wstunnel client to create tunnels.',
        help: 'Each HTTP request needs a dedicated tunnel connection'
      });
    });
  }

  setupTunnelServer() {
    this.wss.on('connection', (ws, req) => {
      this.activeConnections++;
      const clientIp = req.socket.remoteAddress;
      
      console.log(`🔗 New tunnel connection from ${clientIp} (${this.activeConnections} active)`);
      
      // Parse destination from URL if provided (like original wstunnel)
      const target = this.parseUrlDst(req.url) || { 
        host: this.dstHost, 
        port: this.dstPort 
      };
      
      console.log(`🎯 Tunnel target: ${target.host}:${target.port}`);
      
      // Create TCP connection to target (like original wstunnel)
      const tcpConn = net.connect(
        { host: target.host, port: target.port, allowHalfOpen: false },
        () => {
          console.log(`✅ TCP connected to ${target.host}:${target.port}`);
          
          // Remove initial error handlers
          tcpConn.removeAllListeners('error');
          
          // Create WebSocket stream
          const wsStream = new WsStream(ws);
          
          // Bind streams for bidirectional data flow (like original wstunnel)
          bindStreams(wsStream, tcpConn);
          
          console.log(`🌉 Tunnel established: WebSocket ↔ TCP`);
        }
      );

      tcpConn.on('error', (err) => {
        console.error(`❌ TCP connection error to ${target.host}:${target.port}:`, err);
        ws.close(1011, `TCP connection failed: ${err.message}`);
      });

      ws.on('close', () => {
        this.activeConnections--;
        console.log(`🔌 Tunnel closed (${this.activeConnections} remaining)`);
        tcpConn.destroy();
      });

      ws.on('error', (error) => {
        console.error(`❌ WebSocket error:`, error);
        tcpConn.destroy();
      });
    });
  }

  // Parse destination from URL (like original wstunnel)
  parseUrlDst(requestUrl) {
    try {
      const parsed = url.parse(requestUrl, true);
      const pathParts = parsed.pathname.split('/').filter(p => p);
      
      if (pathParts.length >= 2) {
        const host = pathParts[0];
        const port = parseInt(pathParts[1]);
        if (port && port > 0 && port <= 65535) {
          return { host, port };
        }
      }
    } catch (error) {
      console.warn('Could not parse destination from URL:', requestUrl);
    }
    return null;
  }

  start() {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        console.log(`🌍 WSTunnel Server (Correct Architecture) listening on port ${this.port}`);
        console.log(`🔗 WebSocket tunnel server on port ${this.tunnelPort}`);
        console.log(`🎯 Default target: ${this.dstHost}:${this.dstPort}`);
        console.log(`📊 Dashboard: http://localhost:${this.port}/dashboard`);
        console.log(`\nArchitecture: Each WebSocket connection = One TCP tunnel`);
        resolve();
      });
    });
  }
}

// CLI usage
if (require.main === module) {
  const port = process.env.PORT || 80;
  const tunnelPort = process.env.TUNNEL_PORT || 8080;
  const dstHost = process.env.DST_HOST || 'localhost';
  const dstPort = process.env.DST_PORT || 3008;
  
  console.log(`🚀 Starting WSTunnel Server (like mhzed/wstunnel)`);
  console.log(`📍 Target: ${dstHost}:${dstPort}`);
  
  const server = new WSTunnelServer({ port, tunnelPort, dstHost, dstPort });
  server.start().catch(console.error);
}

module.exports = WSTunnelServer; 