# 🚀 Mini Tunnel

Your own ngrok alternative - expose local services to the internet with custom domain and HTTPS.

## 🔧 Two Tunnel Modes

### 🎯 **HTTP/WebSocket Tunnel** (Current - server.js/client.js)
- ✅ HTTP/HTTPS requests
- ✅ WebSocket connections  
- ❌ Complex protocol handling

### 🚀 **TCP Tunnel** (New - tcp-tunnel-server.js/tcp-tunnel-client.js)
- ✅ **ALL TCP traffic** (HTTP, WebSocket, databases, SSH, etc.)
- ✅ Protocol-agnostic 
- ✅ Simpler, more reliable
- ✅ **Recommended for comprehensive port forwarding**

## ✨ Features

- 🌐 **Custom Subdomains**: `https://myapp.grabr.cc/` (your choice!)
- 🚀 **Multi-Port Support**: Tunnel multiple services simultaneously
- 🔌 **WebSocket Support**: Full WSS tunneling (`wss://myapp.grabr.cc/ws`)
- 🔒 **HTTPS Everywhere**: Cloudflare SSL
- 📊 **Dashboard**: `https://grabr.cc/dashboard`
- 🔧 **Simple Setup**: Two commands to start

## 🚀 Quick Start

### Server (Azure VM)

```bash
git clone https://github.com/yourusername/mini-tunnel.git
cd mini-tunnel

# Interactive script with mode selection
sudo ./start-server.sh   # Choose: 1) HTTP/WebSocket or 2) TCP (recommended)
```

### Client (Local Machine)
```bash
# Interactive script with mode selection  
./start-client.sh        # Choose: 1) HTTP/WebSocket or 2) TCP (recommended)
```

**Alternative direct commands:**
```bash
# Legacy HTTP/WebSocket mode
npm run server           # Server
npm run client           # Client

# Recommended TCP mode  
npm run tcp-server       # Server
npm run tcp-client       # Client
```

## 🌐 URLs

- **Dashboard**: `https://grabr.cc/dashboard`
- **Your Tunnel**: `https://[tunnel-id].grabr.cc/`

## ⚙️ DNS Setup (One-time)

Add these records in Cloudflare:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | @ | 20.193.143.179 | ☁️ Proxied |
| A | * | 20.193.143.179 | ☁️ Proxied |

## 📦 Dependencies

- Node.js 16+
- Domain with Cloudflare
- Azure VM (or any Linux server)

## 💡 Examples

### Single Service
```bash
./start-client.sh
Tunnel multiple ports? (y/n, default n): n
Enter local port to tunnel (default 3000): 3000
Enter preferred subdomain (optional): myapp
→ https://myapp.grabr.cc/
```

### Multiple Services with WebSockets
```bash
./start-client.sh
Tunnel multiple ports? (y/n, default n): y
Enter port (or press Enter to finish): 3000
Enter subdomain for port 3000: api
Enter port (or press Enter to finish): 3001  
Enter subdomain for port 3001: app
Enter port (or press Enter to finish): 8080
Enter subdomain for port 8080: chat
Enter port (or press Enter to finish): 
→ https://api.grabr.cc/ + wss://api.grabr.cc/ws (port 3000)
→ https://app.grabr.cc/ (port 3001)
→ https://chat.grabr.cc/ + wss://chat.grabr.cc/ (port 8080)
```

## 🔌 WebSocket Support

Full WebSocket tunneling is supported! Your WSS connections work seamlessly:

```javascript
// Your local WebSocket server on localhost:3000
const ws = new WebSocket('ws://localhost:3000/chat');

// Accessible worldwide as:
const ws = new WebSocket('wss://myapp.grabr.cc/chat');
```

**Perfect for:**
- 💬 **Chat Applications**: Real-time messaging
- 🎮 **Gaming**: Live multiplayer connections  
- 📊 **Live Data**: Real-time dashboards
- 🔄 **Live Updates**: Push notifications

### 🧪 Test Your Tunnel

**Test with any application:**
```bash
# Start your local application (e.g., React, Express, etc.)
npm start                # (or whatever starts your app)

# In another terminal, start the tunnel
./start-client.sh
# Choose TCP mode, enter your app's port

# Your app is now available at: https://yoursubdomain.grabr.cc/
```

**WebSocket Testing:**
```javascript
// Your code works unchanged - just use the tunnel URL
const ws = new WebSocket('wss://yoursubdomain.grabr.cc/ws');
ws.onopen = () => console.log('Connected via tunnel!');
```

## 📁 Project Structure

```
mini-tunnel/
├── 🚀 TCP Tunnel (Recommended)
│   ├── tcp-tunnel-server.js    # Universal TCP tunnel server
│   └── tcp-tunnel-client.js    # Universal TCP tunnel client
│
├── 🔧 HTTP/WebSocket Tunnel (Legacy)  
│   ├── server.js               # HTTP/WebSocket specific server
│   └── client.js               # HTTP/WebSocket specific client
│
├── 🎯 Easy Start Scripts
│   ├── start-server.sh         # Interactive server startup
│   └── start-client.sh         # Interactive client startup  
│
├── ⚙️ Configuration
│   ├── config.json             # Legacy tunnel settings
│   └── package.json            # Project dependencies
│
└── 📖 Documentation
    └── README.md               # This file
```

## 🎯 That's It!

Your local services are now available worldwide with HTTPS and WSS. Share the URLs with anyone!

---
*Built with Express, WebSocket, and Cloudflare* 