# FRP Wrapper

This project provides Node.js wrapper scripts for the powerful [frp (Fast Reverse Proxy)](https://github.com/fatedier/frp) binary, offering similar functionality to the custom TCP tunnel implementation but leveraging the robust, high-performance FRP tool built in Go.

## 🎯 Overview

The FRP wrapper provides:
- **Server wrapper**: Manages FRP server instances with Node.js management interface
- **Client wrapper**: Simplified client interface with automatic binary management
- **Multi-protocol support**: TCP, UDP, HTTP, and HTTPS tunneling
- **Advanced features**: Custom domains, subdomains, authentication, dashboard
- **Auto-installation**: Automatic binary download and setup for all platforms

## 🚀 Quick Start

### Server
```bash
# Interactive setup
node frp-wrapper-server.js

# Quick start with defaults
node frp-wrapper-server.js --quick
# Or: ./start-frp-server.sh --quick

# Or using npm script
npm run frp-server
```

### Client
```bash
# Interactive setup
node frp-wrapper-client.js

# Quick modes (token required)
node frp-wrapper-client.js --web    # HTTP: Port 3000 → web subdomain
node frp-wrapper-client.js --api    # HTTP: Port 8000 → api subdomain  
node frp-wrapper-client.js --tcp    # TCP: Port 3000 → remote port 8000

# Using shell scripts
./start-frp-client.sh --web --token YOUR_TOKEN

# Or using npm script
npm run frp-client
```

## 📋 Features

### Server Features
- **Binary Management**: Automatic FRP binary detection and installation
- **Process Management**: Spawns and manages FRP server processes
- **Web Dashboard**: Built-in FRP dashboard + custom management API
- **Multi-Protocol**: TCP, UDP, HTTP, HTTPS proxy support
- **Authentication**: Token-based security
- **Virtual Hosts**: HTTP/HTTPS with subdomain and custom domain support
- **Configuration**: Auto-generated TOML configuration files

### Client Features
- **Multi-Protocol**: TCP, UDP, HTTP, HTTPS proxy types
- **Multi-Proxy**: Multiple services in a single client session
- **Local Testing**: Automatic validation of local services
- **Binary Auto-install**: Downloads platform-specific binaries automatically
- **Domain Support**: Custom domains and subdomains
- **Authentication**: Secure token-based authentication

## 🔧 Configuration

### Server Configuration
```javascript
const server = new FRPServerWrapper({
  serverPort: 80,          // HTTP management server port
  bindPort: 7000,          // FRP server bind port
  dashboardPort: 7500,     // FRP dashboard port
  vhostHTTPPort: 8080,     // HTTP virtual host port
  vhostHTTPSPort: 8443,    // HTTPS virtual host port
  token: 'your-secret',    // Authentication token
  domain: 'grabr.cc'       // Base domain for subdomains
});
```

### Client Configuration
```javascript
const client = new FRPClientWrapper({
  serverAddr: '20.193.143.179',  // FRP server address
  serverPort: 7000,              // FRP server port
  token: 'your-secret',          // Authentication token (required)
  localPort: 3000,               // Local service port
  localHost: 'localhost',        // Local service host
  proxyType: 'http',             // tcp | udp | http | https
  subdomain: 'myapp',            // Optional subdomain
  customDomain: 'mydomain.com'   // Optional custom domain
});
```

## 🌐 Protocol Support

### TCP Tunneling
```bash
# Server (auto-configured via wrapper)
# Equivalent: frps -c frps.toml

# Client
node frp-wrapper-client.js --tcp
# Direct FRP equivalent:
# frpc tcp --server_addr host --server_port 7000 --token secret --local_port 3000 --remote_port 8000
```

### UDP Tunneling
```bash
# Client
node frp-wrapper-client.js
# Select: udp, port 5000
# Direct FRP equivalent:
# frpc udp --server_addr host --server_port 7000 --token secret --local_port 5000 --remote_port 5001
```

### HTTP Tunneling
```bash
# Client
node frp-wrapper-client.js --web
# Direct FRP equivalent:
# frpc http --server_addr host --server_port 7000 --token secret --local_port 3000 --subdomain web
```

### HTTPS Tunneling
```bash
# Client
node frp-wrapper-client.js
# Select: https, subdomain: secure
# Direct FRP equivalent:
# frpc https --server_addr host --server_port 7000 --token secret --local_port 3000 --subdomain secure
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
  "frpsRunning": true,
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
    "mode": "FRP Server Wrapper",
    "serverPort": 80,
    "bindPort": 7000,
    "dashboardPort": 7500,
    "vhostHTTPPort": 8080,
    "vhostHTTPSPort": 8443,
    "domain": "grabr.cc"
  },
  "tunnels": [
    {
      "id": "web",
      "type": "http",
      "localPort": 3000,
      "subdomain": "web",
      "connectedAt": "2025-01-27T10:00:00Z",
      "url": "http://web.grabr.cc:8080"
    }
  ],
  "frp": {
    "running": true,
    "pid": 12345,
    "dashboardUrl": "http://localhost:7500",
    "token": "secret-token"
  }
}
```

### FRP Native Dashboard
Access the built-in FRP dashboard at: `http://localhost:7500` (admin/admin)

## 🔧 Binary Installation

The wrapper automatically handles FRP binary installation:

### Automatic Installation
1. **Detection**: Checks for existing `frps`/`frpc` binaries
2. **Download**: Downloads platform-specific binaries from GitHub releases
3. **Setup**: Extracts and configures binaries

### Manual Installation
If automatic installation fails:

#### macOS (Intel)
```bash
curl -L https://github.com/fatedier/frp/releases/download/v0.63.0/frp_0.63.0_darwin_amd64.tar.gz -o frp.tar.gz
tar -xzf frp.tar.gz && mv frp_*/frps . && mv frp_*/frpc .
chmod +x frps frpc
```

#### macOS (Apple Silicon)
```bash
curl -L https://github.com/fatedier/frp/releases/download/v0.63.0/frp_0.63.0_darwin_arm64.tar.gz -o frp.tar.gz
tar -xzf frp.tar.gz && mv frp_*/frps . && mv frp_*/frpc .
chmod +x frps frpc
```

#### Linux (x64)
```bash
curl -L https://github.com/fatedier/frp/releases/download/v0.63.0/frp_0.63.0_linux_amd64.tar.gz -o frp.tar.gz
tar -xzf frp.tar.gz && mv frp_*/frps . && mv frp_*/frpc .
chmod +x frps frpc
```

#### Windows
```bash
curl -L https://github.com/fatedier/frp/releases/download/v0.63.0/frp_0.63.0_windows_amd64.zip -o frp.zip
unzip frp.zip && mv frp_*/frps.exe . && mv frp_*/frpc.exe .
```

## 🌟 Advanced Usage

### Multi-Proxy Client Setup
```bash
node frp-wrapper-client.js
# Choose: "Configure multiple proxies? y"
# Add multiple services:
# Port 3000 → HTTP web app (subdomain: web)
# Port 8000 → HTTP API server (subdomain: api)
# Port 5432 → TCP database (remote port: 15432)
```

### Custom Domain Configuration
```bash
# Server: Configure domain in frps.toml
subDomainHost = "yourdomain.com"

# Client: Use custom domain
node frp-wrapper-client.js
# Choose: http, custom domain: app.yourdomain.com
```

### URL Routing (HTTP)
FRP supports URL path-based routing:
```toml
# Generated client config
[[proxies]]
name = "web-root"
type = "http"
localPort = 3000
customDomains = ["example.com"]
locations = ["/"]

[[proxies]]
name = "web-api"
type = "http"
localPort = 8000
customDomains = ["example.com"]
locations = ["/api", "/v1"]
```

### TCP Port Multiplexing
FRP supports advanced TCP multiplexing:
```bash
# Server automatically configures:
tcpmuxHTTPConnectPort = 1337

# Client can use HTTP CONNECT tunnel
# This is automatically handled by the wrapper
```

## 🔄 Comparison with Other Solutions

| Feature | Original TCP Tunnel | WST Tunnel | FRP Wrapper |
|---------|-------------------|------------|-------------|
| **Protocol Support** | TCP only | TCP, UDP, SOCKS5 | TCP, UDP, HTTP, HTTPS |
| **Performance** | Good | Excellent | Excellent (Go binary) |
| **HTTP Features** | Basic | Basic | Advanced (vhosts, routing) |
| **Authentication** | None | Basic | Token-based + dashboard |
| **Custom Domains** | None | Limited | Full support |
| **Dashboard** | Custom | None | Built-in + custom |
| **Configuration** | Code | Command line | TOML files |
| **Maintenance** | Custom code | Upstream | Upstream |

## 🐛 Troubleshooting

### Binary Not Found
```bash
# Check if FRP is installed
frps --version && frpc --version

# Manual installation
curl -L https://github.com/fatedier/frp/releases/latest/download/frp_0.63.0_linux_amd64.tar.gz -o frp.tar.gz
tar -xzf frp.tar.gz && sudo mv frp_*/frp* /usr/local/bin/
```

### Connection Issues
```bash
# Test server connectivity
telnet 20.193.143.179 7000

# Check local service
curl http://localhost:3000

# Verify FRP server is running
curl http://localhost:80/health
curl http://localhost:7500  # FRP dashboard
```

### Authentication Issues
```bash
# Ensure token matches between server and client
# Server token is shown in dashboard: curl http://localhost:80/dashboard
# Client must use same token
```

### Permission Issues
```bash
# Run server with sudo for privileged ports
sudo node frp-wrapper-server.js --quick

# Or use alternative ports
./start-frp-server.sh --port 8080 --bind-port 7000
```

## 🔍 Advanced FRP Features

Since this leverages the full FRP binary, you get access to all advanced features:

### SSH Tunnel Gateway
FRP supports SSH tunnel connections:
```bash
# Server auto-configures SSH gateway on port 2200
ssh -R :80:127.0.0.1:8080 v0@server -p 2200
```

### Virtual Network (Alpha)
```bash
# Enable in server config
featureGates = { VirtualNet = true }
```

### Plugin System
FRP supports plugins for advanced functionality:
- HTTP proxy plugin
- SOCKS5 plugin
- Static file server
- Load balancing

## 📖 Related Documentation

- [FRP GitHub](https://github.com/fatedier/frp) - Main FRP repository
- [FRP Documentation](https://github.com/fatedier/frp/blob/dev/README.md) - Comprehensive usage guide
- [FRP Examples](https://github.com/fatedier/frp/tree/dev/conf) - Configuration examples

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with both wrapper and direct FRP
5. Submit a pull request

## 📄 License

This wrapper code is licensed under MIT. The FRP binary is licensed under Apache-2.0. 