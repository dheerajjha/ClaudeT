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
    console.log(`🔄 Processing WebSocket upgrade response: ${message.upgradeId}, success: ${message.success}`);
    
    const pending = this.pendingRequests.get(message.upgradeId);
    if (!pending) {
      console.warn(`⚠️ No pending WebSocket upgrade found for ${message.upgradeId}`);
      return;
    }

    this.pendingRequests.delete(message.upgradeId);
    const { socket, head } = pending;

    if (message.success) {
      try {
        // Ensure we have a valid accept key
        if (!message.webSocketAccept) {
          console.error(`❌ Missing WebSocket accept key for ${message.upgradeId}`);
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
          return;
        }
        
        // Send proper HTTP 101 upgrade response
        const responseHeaders = [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${message.webSocketAccept}`,
          '', ''
        ].join('\r\n');

        console.log(`✅ Sending WebSocket upgrade response: ${message.upgradeId}`);
        console.log(`📋 Accept key: ${message.webSocketAccept}`);
        
        // Check socket state before writing
        if (!socket.writable) {
          console.error(`❌ Socket not writable for ${message.upgradeId}`);
          socket.destroy();
          return;
        }
        
        socket.write(responseHeaders);
        console.log(`✅ WebSocket upgrade headers sent: ${message.upgradeId}`);
        
        // Now set up raw WebSocket frame proxying
        this.setupWebSocketProxy(socket, message.upgradeId);
        
      } catch (error) {
        console.error(`❌ Error setting up WebSocket tunnel: ${message.upgradeId}`, error);
        try {
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
        } catch (destroyError) {
          console.error(`❌ Error destroying socket: ${destroyError}`);
        }
      }
      
    } else {
      console.log(`❌ WebSocket upgrade failed: ${message.upgradeId} - ${message.error}`);
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
        try {
          // Inspect the raw WebSocket frame structure
          console.log(`📤 Raw frame from browser: ${data.length} bytes`);
          console.log(`📤 Frame header: ${data.slice(0, Math.min(10, data.length)).toString('hex')}`);
          
          // Use binary-safe base64 encoding for ALL frame data
          const frameData = data.toString('base64');
          console.log(`📤 Forwarding frame to client: ${data.length} bytes → ${frameData.length} base64 chars`);
          
          // Send frame message to tunnel client
          const frameMessage = {
            type: 'websocket_frame',
            upgradeId,
            data: frameData,
            direction: 'to_local',
            originalSize: data.length
          };
          
          const jsonString = JSON.stringify(frameMessage);
          console.log(`🔧 Sending frame message: ${jsonString.length} chars`);
          
          if (tunnel.ws.readyState === 1) {
            tunnel.ws.send(jsonString);
          } else {
            console.warn(`⚠️ Tunnel WebSocket not ready for ${upgradeId}`);
          }
        } catch (error) {
          console.error(`❌ Error encoding frame data: ${upgradeId}`, error);
        }
      }
    });

    browserSocket.on('close', () => {
      console.log(`🔌 Browser WebSocket closed: ${upgradeId}`);
      const tunnel = Array.from(this.tunnels.values())
        .find(t => t.ws.readyState === 1);
      
      if (tunnel && tunnel.ws.readyState === 1) {
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
      try {
        // Validate base64 data before decoding
        if (!message.data || typeof message.data !== 'string') {
          console.warn(`⚠️ Invalid frame data for ${message.upgradeId}: data is not a string`);
          return;
        }
        
        // Forward frame from client to browser
        const data = Buffer.from(message.data, 'base64');
        
        // Validate decoded data
        if (!data || data.length === 0) {
          console.warn(`⚠️ Empty frame data after decoding for ${message.upgradeId}`);
          return;
        }
        
        // Inspect the raw WebSocket frame structure
        console.log(`📥 Raw frame to browser: ${data.length} bytes`);
        console.log(`📥 Frame header: ${data.slice(0, Math.min(10, data.length)).toString('hex')}`);
        console.log(`📥 Forwarding frame to browser: ${message.originalSize || data.length} bytes from base64`);
        
        // CRITICAL FIX: After HTTP upgrade, we need to use WebSocket to send data
        // The 'data' we received is already a complete WebSocket frame from the local server
        // We need to extract the payload and send it properly via WebSocket
        if (pending.socket.writable && !pending.socket.destroyed) {
          // The issue is that 'data' is a complete WebSocket frame, but we're writing it
          // directly to a socket that expects WebSocket protocol handling
          // Instead, we need to parse the WebSocket frame and extract the payload
          try {
            // For now, let's create a WebSocket instance to properly handle this
            const WebSocket = require('ws');
            
            // Create a WebSocket from the existing socket
            const browserWs = new WebSocket(null);
            browserWs.setSocket(pending.socket, Buffer.alloc(0), true);
            
            // Parse the WebSocket frame to extract the actual payload
            // The 'data' buffer contains a complete WebSocket frame
            // We need to parse it according to RFC 6455
            
            let payload;
            let opcode;
            let offset = 0;
            
            // Parse WebSocket frame header
            if (data.length >= 2) {
              const firstByte = data[offset++];
              const secondByte = data[offset++];
              
              opcode = firstByte & 0x0F;
              const masked = (secondByte & 0x80) === 0x80;
              let payloadLength = secondByte & 0x7F;
              
              // Handle extended payload length
              if (payloadLength === 126) {
                if (data.length >= offset + 2) {
                  payloadLength = data.readUInt16BE(offset);
                  offset += 2;
                }
              } else if (payloadLength === 127) {
                if (data.length >= offset + 8) {
                  // For simplicity, assume payload length fits in 32 bits
                  offset += 4; // Skip high 32 bits
                  payloadLength = data.readUInt32BE(offset);
                  offset += 4;
                }
              }
              
              // Handle masking key
              if (masked && data.length >= offset + 4) {
                const maskingKey = data.slice(offset, offset + 4);
                offset += 4;
                
                // Extract and unmask payload
                if (data.length >= offset + payloadLength) {
                  payload = Buffer.alloc(payloadLength);
                  for (let i = 0; i < payloadLength; i++) {
                    payload[i] = data[offset + i] ^ maskingKey[i % 4];
                  }
                }
              } else if (!masked && data.length >= offset + payloadLength) {
                payload = data.slice(offset, offset + payloadLength);
              }
              
              // Send the payload using WebSocket
              if (payload && browserWs.readyState === WebSocket.OPEN) {
                browserWs.send(payload, { binary: opcode === 0x2 });
                console.log(`✅ WebSocket payload sent to browser: ${payload.length} bytes, opcode=${opcode}`);
              } else {
                console.warn(`⚠️ Could not extract payload or WebSocket not ready for ${message.upgradeId}`);
              }
            } else {
              console.warn(`⚠️ Invalid WebSocket frame data for ${message.upgradeId}`);
            }
            
          } catch (wsError) {
            console.error(`❌ WebSocket handling error for ${message.upgradeId}:`, wsError);
            // Fallback to raw write if WebSocket parsing fails
            pending.socket.write(data);
            console.log(`⚠️ Fallback: Raw frame written to browser socket`);
          }
        } else {
          console.warn(`⚠️ Socket not writable or destroyed for ${message.upgradeId}`);
          this.pendingRequests.delete(`ws_${message.upgradeId}`);
        }
        
      } catch (error) {
        console.error(`❌ Error handling WebSocket frame: ${message.upgradeId}`, error);
        console.error(`❌ Frame data preview: ${message.data ? message.data.substring(0, 50) : 'null'}...`);
      }
    } else {
      console.warn(`⚠️ No pending WebSocket connection found for frame: ${message.upgradeId}`);
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