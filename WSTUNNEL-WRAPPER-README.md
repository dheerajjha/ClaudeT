# WST Tunnel Wrapper

This project provides Node.js wrapper scripts for the powerful [wstunnel](https://github.com/erebe/wstunnel) binary, offering similar functionality to the custom TCP tunnel implementation but leveraging the robust, battle-tested wstunnel tool.

## 🎯 Overview

The wstunnel wrapper provides:
- **Server wrapper**: Manages wstunnel server instances with a Node.js management interface
- **Client wrapper**: Simplified client interface with automatic binary management
- **Protocol support**: TCP, UDP, and SOCKS5 tunneling
- **Multi-port support**: Tunnel multiple services simultaneously
- **Auto-installation**: Automatic binary download and setup

## 🚀 Quick Start

### Server
```bash
# Interactive setup
node wstunnel-wrapper-server.js

# Quick start with defaults
node wstunnel-wrapper-server.js --quick

# Or using npm script
npm run wst-server
```

### Client
```bash
# Interactive setup
node wstunnel-wrapper-client.js

# Quick modes
node wstunnel-wrapper-client.js --web    # Port 3000 → web subdomain
node wstunnel-wrapper-client.js --api    # Port 8000 → api subdomain  
node wstunnel-wrapper-client.js --socks  # SOCKS5 proxy on port 1080

# Or using npm script
npm run wst-client
```

## 📋 Features

### Server Features
- **Binary Management**: Automatic wstunnel binary detection and installation
- **Process Management**: Spawns and manages wstunnel server processes
- **HTTP Dashboard**: REST API for monitoring tunnels and server status
- **Health Checks**: Built-in health monitoring endpoints
- **Graceful Shutdown**: Proper cleanup on termination

### Client Features
- **Protocol Support**: TCP, UDP, and SOCKS5 tunneling
- **Multi-port Tunneling**: Set up multiple tunnels in one session
- **Local Server Testing**: Automatic validation of local services
- **Binary Auto-install**: Downloads appropriate binary for your platform
- **Subdomain Support**: Custom subdomain prefixes for organization

## 🔧 Configuration

### Server Configuration
```javascript
const server = new WSTunnelServerWrapper({
  serverPort: 80,        // HTTP management server port
  tunnelPort: 8080,      // WST tunnel server port
  domain: 'grabr.cc'     // Base domain for subdomains
});
```

### Client Configuration
```javascript
const client = new WSTunnelClientWrapper({
  serverHost: '20.193.143.179',  // Tunnel server host
  serverPort: 8080,              // Tunnel server port
  localPort: 3000,               // Local service port
  localHost: 'localhost',        // Local service host
  protocol: 'tcp',               // tcp | udp | socks5
  subdomain: 'myapp'             // Optional subdomain prefix
});
```

## 🌐 Protocol Support

### TCP Tunneling
```bash
# Server
wstunnel server --restrict-to localhost wss://[::]:8080

# Client (via wrapper)
node wstunnel-wrapper-client.js --web
# Direct wstunnel equivalent:
# wstunnel client -L 'tcp://3000:localhost:3000' wss://server:8080
```

### UDP Tunneling
```bash
# Client
node wstunnel-wrapper-client.js
# Select: udp, port 5000
# Direct wstunnel equivalent:
# wstunnel client -L 'udp://5000:localhost:5000?timeout_sec=0' wss://server:8080
```

### SOCKS5 Proxy
```bash
# Client
node wstunnel-wrapper-client.js --socks
# Direct wstunnel equivalent:
# wstunnel client -L 'socks5://localhost:1080' wss://server:8080
```

## 📊 Management Endpoints

### Health Check
```bash
curl http://localhost:80/health
```
Response:
```json
{
  "status": "ok",
  "activeTunnels": 2,
  "wstunnelRunning": true,
  "timestamp": "2025-01-27T10:00:00Z"
}
```

### Dashboard
```bash
curl http://localhost:80/dashboard
```
Response:
```json
{
  "server": {
    "mode": "WST Tunnel Wrapper",
    "serverPort": 80,
    "tunnelPort": 8080,
    "domain": "grabr.cc"
  },
  "tunnels": [
    {
      "id": "web",
      "localPort": 3000,
      "localHost": "localhost",
      "connectedAt": "2025-01-27T10:00:00Z",
      "subdomainUrl": "https://web.grabr.cc/"
    }
  ],
  "wstunnel": {
    "running": true,
    "pid": 12345
  },
  "info": {
    "message": "WST tunnel server wrapper - uses wstunnel binary for robust tunneling",
    "documentation": "https://github.com/erebe/wstunnel"
  }
}
```

## 🔧 Binary Installation

The wrapper automatically handles wstunnel binary installation:

### Automatic Installation
1. **Detection**: Checks for existing `wstunnel` binary
2. **Download**: Downloads platform-specific binary from GitHub releases
3. **Setup**: Makes binary executable and provides installation guidance

### Manual Installation
If automatic installation fails:

#### macOS
```bash
curl -L https://github.com/erebe/wstunnel/releases/latest/download/wstunnel-macos -o wstunnel
chmod +x wstunnel
sudo mv wstunnel /usr/local/bin/
```

#### Linux
```bash
curl -L https://github.com/erebe/wstunnel/releases/latest/download/wstunnel-linux-x64 -o wstunnel
chmod +x wstunnel
sudo mv wstunnel /usr/local/bin/
```

#### Windows
```bash
curl -L https://github.com/erebe/wstunnel/releases/latest/download/wstunnel-windows-x64.exe -o wstunnel.exe
```

#### Via Cargo (Rust)
```bash
cargo install wstunnel
```

## 🌟 Advanced Usage

### Multi-Port Client Setup
```bash
node wstunnel-wrapper-client.js
# Choose: "Tunnel multiple ports? (y/n, default n): y"
# Add multiple services:
# Port 3000 → web app
# Port 8000 → API server  
# Port 5432 → database (with port forwarding)
```

### Custom Server Configuration
```bash
node wstunnel-wrapper-server.js
# Configure:
# - HTTP server port: 80
# - WST tunnel port: 8080  
# - Domain: yourdomain.com
```

### SOCKS5 Proxy Usage
Once SOCKS5 tunnel is established:
```bash
# Use with curl
curl --socks5 localhost:1080 https://httpbin.org/ip

# Use with browsers
# Set SOCKS5 proxy: localhost:1080

# Use with SSH
ssh -o ProxyCommand='nc -X 5 -x localhost:1080 %h %p' user@remote-host
```

## 🔄 Comparison with Original Implementation

| Feature | Original TCP Tunnel | WST Tunnel Wrapper |
|---------|-------------------|-------------------|
| **Protocol Support** | TCP only | TCP, UDP, SOCKS5 |
| **Reliability** | Custom WebSocket | Battle-tested wstunnel |
| **Performance** | Good | Excellent (native binary) |
| **Setup Complexity** | Low | Low (auto-install) |
| **Advanced Features** | Basic | Rich (mTLS, compression, etc.) |
| **Maintenance** | Custom code | Leverage upstream |

## 🐛 Troubleshooting

### Binary Not Found
```bash
# Check if wstunnel is installed
wstunnel --version

# Manual installation
curl -L https://github.com/erebe/wstunnel/releases/latest/download/wstunnel-linux-x64 -o wstunnel
chmod +x wstunnel
sudo mv wstunnel /usr/local/bin/
```

### Connection Issues
```bash
# Test server connectivity
telnet 20.193.143.179 8080

# Check local service
curl http://localhost:3000

# Verify tunnel server is running
curl http://localhost:80/health
```

### Permission Issues
```bash
# Run server with sudo for port 80
sudo node wstunnel-wrapper-server.js --quick

# Or use alternative port
node wstunnel-wrapper-server.js
# Choose port: 8080
```

## 📖 Related Documentation

- [WST Tunnel GitHub](https://github.com/erebe/wstunnel) - Main wstunnel repository
- [WST Tunnel Documentation](https://github.com/erebe/wstunnel/blob/main/README.md) - Comprehensive usage guide
- [WebSocket Tunneling](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) - WebSocket fundamentals

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with both wrapper and direct wstunnel
5. Submit a pull request

## 📄 License

This wrapper code is licensed under MIT. The wstunnel binary is licensed under BSD-3-Clause. 