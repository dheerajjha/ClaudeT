# 🚀 Mini Tunnel

Your own ngrok alternative - expose local services to the internet with custom domain and HTTPS.

## ✨ Features

- 🌐 **Custom Subdomains**: `https://myapp.grabr.cc/` (your choice!)
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
# Enter local port (e.g., 3000, 3008)
# Enter preferred subdomain (e.g., "myapp" → myapp.grabr.cc)
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

## 🎯 That's It!

Your local app is now available worldwide with HTTPS. Share the URL with anyone!

---
*Built with Express, WebSocket, and Cloudflare* 