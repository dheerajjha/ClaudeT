#!/usr/bin/env node

const WebSocket = require('ws');
const net = require('net');
const stream = require('stream');
const readline = require('readline');

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

class WSTunnelClient {
  constructor() {
    this.tcpServer = net.createServer();
    this.serverUrl = null;
    this.remoteAddr = null;
    this.customSubdomain = null;
  }

  // Like wstunnel's _connect method
  _connect(wsHostUrl, remoteAddr, callback) {
    const ws = new WebSocket(wsHostUrl, 'tunnel-protocol');
    
    ws.on('open', () => {
      console.log('📡 WebSocket tunnel established');
      const wsStream = new WsStream(ws);
      callback(null, wsStream);
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocket connection failed:', error);
      callback(error);
    });
  }

  // Like wstunnel's start method
  start(localHost, localPort, wsHostUrl, remoteAddr, customSubdomain = null) {
    this.serverUrl = wsHostUrl;
    this.remoteAddr = remoteAddr;
    this.customSubdomain = customSubdomain;

    console.log(`🔗 Starting tunnel client`);
    console.log(`📍 Local: ${localHost}:${localPort}`);
    console.log(`🌐 Server: ${wsHostUrl}`);
    console.log(`🎯 Target: ${remoteAddr}`);
    if (customSubdomain) {
      console.log(`🏷️  Subdomain: https://${customSubdomain}.grabr.cc/`);
    }

    this.tcpServer.listen(localPort, localHost, (err) => {
      if (err) {
        console.error('❌ Failed to start local server:', err);
        return;
      }
      console.log(`✅ Tunnel client listening on ${localHost}:${localPort}`);
    });

    // For EACH incoming TCP connection, create a NEW WebSocket tunnel
    this.tcpServer.on('connection', (tcpConn) => {
      console.log(`🔗 New local connection, creating WebSocket tunnel...`);
      
      const bind = (tcp, wsStream) => {
        console.log(`✅ Binding streams for tunnel`);
        bindStreams(tcp, wsStream);
      };

      this._connect(this.serverUrl, this.remoteAddr, (err, wsStream) => {
        if (err) {
          console.error('❌ Tunnel connection failed:', err);
          tcpConn.destroy();
        } else {
          bind(tcpConn, wsStream);
        }
      });
    });

    this.tcpServer.on('error', (error) => {
      console.error('❌ TCP server error:', error);
    });
  }

  async getCustomSubdomain() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise((resolve) => {
      rl.question('Custom subdomain (or press Enter for random): ', (answer) => {
        rl.close();
        resolve(answer.trim() || null);
      });
    });
  }

  stop() {
    this.tcpServer.close();
  }
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`
🌵 WSTunnel Client (Correct Architecture) - Your ngrok alternative

Usage: node wstunnel-client-correct.js <local-port> <server-url> [custom-subdomain]

Examples:
  node wstunnel-client-correct.js 3008 ws://20.193.143.179:8080
  node wstunnel-client-correct.js 3008 ws://20.193.143.179:8080 claude
  
Arguments:
  local-port     - Port of your local service (e.g., 3008)
  server-url     - WebSocket URL of tunnel server (e.g., ws://20.193.143.179:8080)
  custom-subdomain - Optional custom subdomain (e.g., 'claude' for claude.grabr.cc)

Architecture:
  ✅ Each TCP connection creates a NEW WebSocket tunnel (like original wstunnel)
  ✅ Stream-based bidirectional data flow
  ✅ Protocol-agnostic raw data forwarding
`);
    process.exit(1);
  }
  
  const localPort = parseInt(args[0]);
  const serverUrl = args[1];
  let customSubdomain = args[2];
  
  if (!customSubdomain) {
    console.log('🎯 Claude Code UI Tunnel Setup\n');
    customSubdomain = await new WSTunnelClient().getCustomSubdomain();
  }
  
  // Build remote address
  const remoteAddr = `localhost:${localPort}`;
  
  const client = new WSTunnelClient();
  
  try {
    client.start('localhost', localPort, serverUrl, remoteAddr, customSubdomain);
    
    console.log(`\n🚀 Tunnel is active!`);
    console.log(`📋 Each connection creates a new WebSocket tunnel`);
    console.log(`🌐 Access your service via HTTPS`);
    console.log(`\nPress Ctrl+C to stop the tunnel.`);
    
    // Keep process alive
    process.on('SIGINT', () => {
      console.log('\n👋 Closing tunnel...');
      client.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start tunnel client:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = WSTunnelClient; 