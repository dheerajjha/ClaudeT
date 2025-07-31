# 🚀 Mini Tunnel Setup - grabr.cc

Your tunnel system now uses the entire `grabr.cc` domain for tunneling!

## ✅ **What Works Now:**
- 🔗 **Dashboard:** `https://grabr.cc/dashboard`  
- 🌐 **Tunnels:** `https://abc123.grabr.cc/` (cleaner URLs!)
- 🔌 **WebSocket:** Direct connection to VM

## 📋 **Required DNS Records in Cloudflare:**

```
Type: A, Name: @, Content: 20.193.143.179, Proxy: ☁️ (Proxied)
Type: A, Name: *, Content: 20.193.143.179, Proxy: ☁️ (Proxied)
```

## 🎯 **Benefits of New Structure:**

### **Before (with tunnel subdomain):**
- Dashboard: `https://tunnel.grabr.cc/dashboard`
- Tunnels: `https://abc123.tunnel.grabr.cc/`

### **After (whole domain):**
- Dashboard: `https://grabr.cc/dashboard` ✨
- Tunnels: `https://abc123.grabr.cc/` ✨

Much cleaner URLs like ngrok! 🚀

## 🔧 **Quick Test:**

```bash
# Check DNS setup
./check-dns.sh

# Test tunnel system  
./test-tunnel.sh
```

## 🌐 **Example URLs:**

- **Dashboard:** `https://grabr.cc/dashboard`
- **Active Tunnel:** `https://b9bh6t9d.grabr.cc/`
- **Your Local App:** Accessible worldwide via HTTPS!

Perfect for sharing with clients or testing on mobile devices! 📱✨ 