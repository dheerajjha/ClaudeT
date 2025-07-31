# 🚀 Mini Tunnel

Your own ngrok alternative - expose local services to the internet with custom domain and HTTPS.

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
sudo ./start-server.sh
```

### Client (Local Machine)
```bash
./start-client.sh
# Single port: Enter port and subdomain
# Multi-port: Choose 'y' to tunnel multiple services
#   - API: localhost:3000 → api.grabr.cc
#   - Frontend: localhost:3001 → app.grabr.cc  
#   - Docs: localhost:8080 → docs.grabr.cc
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

### 🧪 Test WebSocket Tunneling

**Method 1: Web Browser (Recommended)**
```bash
# Start the WebSocket test server
npm run test-ws

# In another terminal, tunnel it
./start-client.sh
# Choose port 3000, subdomain "chat"

# Visit: https://chat.grabr.cc
# Click "Connect" to test WSS tunneling!
```

**Method 2: Command Line**
```bash
# Test with our WebSocket client
node test-websocket-client.js wss://yoursubdomain.grabr.cc/ws

# ❌ DON'T use curl - it doesn't support WebSocket properly:
# curl wss://... (This won't work!)
```

**Method 3: From Your Code**
```javascript
// Frontend code can directly connect
const ws = new WebSocket('wss://yoursubdomain.grabr.cc/ws');
ws.onopen = () => console.log('Connected via tunnel!');
```

## 🎯 That's It!

Your local services are now available worldwide with HTTPS and WSS. Share the URLs with anyone!

---
*Built with Express, WebSocket, and Cloudflare* 