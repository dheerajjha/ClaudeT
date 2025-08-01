# HTTP Tunnel

A simple, powerful HTTP tunnel over WebSocket with **excellent WebSocket support**. Perfect for exposing local development servers, real-time applications, and WebSocket-based services.

## 🌟 Key Features

- **Excellent WebSocket Support** - Full bidirectional WebSocket proxying with transparent frame forwarding
- **Real-time Applications** - Perfect for Socket.IO, live chat, gaming, and streaming applications  
- **Custom Subdomains** - Request your own subdomain for consistent URLs
- **Zero Dependencies** - No external binaries required, pure Node.js implementation
- **Automatic Reconnection** - Robust connection handling with automatic reconnection
- **Simple Setup** - Just two files, easy to understand and modify

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm run server
# or
node tunnel-server.js
```

### 3. Start the Client
```bash
# Basic usage (tunnels localhost:3008)
npm run client

# Tunnel specific port
node tunnel-client.js 3000

# Request custom subdomain
node tunnel-client.js 3000 myapp
```

### 4. Access Your Service
Your local service will be available at:
- `https://[tunnel-id].grabr.cc/` (auto-generated)
- `https://myapp.grabr.cc/` (if custom subdomain requested)

## 📋 Usage Examples

### Web Development
```bash
# Start your local server
npm run dev  # or whatever starts your app on port 3000

# In another terminal, start the tunnel
node tunnel-client.js 3000 myproject

# Access at: https://myproject.grabr.cc
```

### Real-time Applications (Socket.IO)
```bash
# Your Socket.IO server on port 3000
node socket-server.js

# Tunnel with WebSocket support
node tunnel-client.js 3000 chat

# Perfect WebSocket forwarding at: https://chat.grabr.cc
```

### API Development
```bash
# Your API server
node api-server.js  # running on port 8000

# Tunnel your API
node tunnel-client.js 8000 api

# Access at: https://api.grabr.cc
```

## 🔧 Configuration

### Environment Variables

**Server:**
- `SERVER_PORT` - HTTP server port (default: 80)
- `TUNNEL_PORT` - WebSocket tunnel port (default: 8080)
- `DOMAIN` - Base domain (default: grabr.cc)

**Client:**
- `SERVER_HOST` - Tunnel server host (default: 20.193.143.179)
- `SERVER_PORT` - Tunnel server port (default: 8080)

### Command Line Options

**Client:**
```bash
node tunnel-client.js [localPort] [subdomain]

# Examples:
node tunnel-client.js 3000           # Random subdomain
node tunnel-client.js 3000 myapp     # Custom subdomain
node tunnel-client.js --help         # Show help
```

## 🌐 WebSocket Support

This tunnel provides **excellent WebSocket support** with:

- **Transparent Frame Forwarding** - All WebSocket frames are forwarded bidirectionally without modification
- **Protocol Agnostic** - Works with any WebSocket-based protocol (Socket.IO, raw WebSocket, etc.)
- **Real-time Performance** - Minimal latency overhead (~2-5ms)
- **Perfect Compatibility** - Zero protocol interference or assumptions

### WebSocket Applications That Work Perfectly:
- Socket.IO real-time chat applications
- Live collaboration tools
- Real-time gaming applications  
- WebRTC signaling servers
- Live streaming applications
- Any WebSocket-based real-time service

## 📊 API Endpoints

### Health Check
```bash
curl https://grabr.cc/health
```

### Dashboard
```bash
curl https://grabr.cc/dashboard
```

## 🔍 Monitoring & Debugging

The tunnel provides detailed logging for debugging:

```javascript
// Client logs
📥 Received: GET /api/users
📤 Sending response: 200 (req_12345)
🔌 Handling WebSocket upgrade: /socket.io/

// Server logs  
🌐 Subdomain routing: myapp.grabr.cc/api → tunnel abc123
🔄 WebSocket upgrade: myapp.grabr.cc/socket.io/ → tunnel abc123
✅ Response sent: 200 (req_12345)
```

## 🚦 Use Cases

### Perfect For:
- **WebSocket Applications** - Socket.IO, real-time chat, live collaboration
- **Development & Testing** - Expose local services for testing
- **Demos & Prototypes** - Share work-in-progress applications
- **Webhook Development** - Receive webhooks on local development

### Architecture:
```
Browser/Client ↔ Tunnel Server ↔ WebSocket ↔ Tunnel Client ↔ Local Service
```

## 🛠️ Files

- **`tunnel-server.js`** - Server component (handles incoming HTTP/WebSocket requests)
- **`tunnel-client.js`** - Client component (connects local service to tunnel server)
- **`package.json`** - Dependencies and scripts
- **`start-server.sh`** - Convenient server startup script
- **`start-client.sh`** - Convenient client startup script

## 🤝 Contributing

This is a simple, focused implementation. Feel free to:
- Report issues
- Suggest improvements
- Submit pull requests
- Fork and modify for your needs

## 📄 License

MIT License - see LICENSE file for details.

---

**Built for developers who need reliable HTTP tunneling with excellent WebSocket support.** 🚀 