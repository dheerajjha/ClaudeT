#!/bin/bash

# Mini Tunnel Server Startup Script
echo "🚀 Starting Mini Tunnel Server..."
echo ""

git pull

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm packages are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Ask user which tunnel mode to use
echo "🔧 Choose tunnel mode:"
echo "1) HTTP/WebSocket Tunnel (legacy - server.js)"
echo "2) TCP Tunnel - Recommended (tcp-tunnel-server.js)"
echo ""
read -p "Enter choice (1 or 2, default 2): " choice
choice=${choice:-2}

# Set server file and configuration based on choice
if [ "$choice" = "1" ]; then
    SERVER_FILE="server.js"
    echo "📋 Selected: HTTP/WebSocket Tunnel (legacy)"
    
    # Load configuration from config.json for legacy mode
    if [ -f "config.json" ]; then
        SERVER_PORT=$(node -p "require('./config.json').server.serverPort")
        TUNNEL_PORT=$(node -p "require('./config.json').server.tunnelPort")
    else
        SERVER_PORT=80
        TUNNEL_PORT=8080
    fi
else
    SERVER_FILE="tcp-tunnel-server.js"
    echo "📋 Selected: TCP Tunnel (Recommended)"
    SERVER_PORT=80
    TUNNEL_PORT=8080
fi

# Set environment variables
export SERVER_PORT=${SERVER_PORT:-80}
export TUNNEL_PORT=${TUNNEL_PORT:-8080}

echo "📋 Configuration:"
echo "   Mode: $([ "$choice" = "1" ] && echo "HTTP/WebSocket" || echo "TCP")"
echo "   HTTP Port: $SERVER_PORT (via Cloudflare)"
echo "   WebSocket Port: $TUNNEL_PORT (direct)"
echo "   Domain: grabr.cc"
echo ""

# Check DNS setup
echo "🔍 Checking DNS setup..."
if nslookup grabr.cc &> /dev/null; then
    echo "✅ grabr.cc resolves correctly"
else
    echo "⚠️  grabr.cc doesn't resolve yet - add DNS records in Cloudflare:"
    echo "   1. A record: @ → 20.193.143.179 (Proxied)"
    echo "   2. A record: * → 20.193.143.179 (Proxied)"
fi
echo ""

# Start the server
echo "🔥 Starting server..."
echo "🔧 Environment: SERVER_PORT=$SERVER_PORT, TUNNEL_PORT=$TUNNEL_PORT"
if [ "$SERVER_PORT" = "80" ]; then
    echo "⚠️  Port 80 requires sudo privileges"
    sudo SERVER_PORT=$SERVER_PORT TUNNEL_PORT=$TUNNEL_PORT node $SERVER_FILE
else
    node $SERVER_FILE
fi 