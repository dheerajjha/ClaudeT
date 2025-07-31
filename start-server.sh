#!/bin/bash

# Mini Tunnel Server Startup Script
echo "🚀 Starting Mini Tunnel Server..."
echo ""

# Check if git command exists (fix the gi issue)
if command -v git &> /dev/null; then
    echo "📦 Git available for updates"
else
    echo "⚠️  Git not found - manual updates only"
fi

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

# Load configuration from config.json
SERVER_PORT=$(node -p "require('./config.json').server.serverPort")
TUNNEL_PORT=$(node -p "require('./config.json').server.tunnelPort")

# Set environment variables
export SERVER_PORT=${SERVER_PORT:-80}
export TUNNEL_PORT=${TUNNEL_PORT:-8080}

echo "📋 Configuration:"
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
    echo "   1. A record: tunnel → 20.193.143.179"
    echo "   2. A record: *.tunnel → 20.193.143.179"
fi
echo ""

# Start the server
echo "🔥 Starting server..."
echo "🔧 Environment: SERVER_PORT=$SERVER_PORT, TUNNEL_PORT=$TUNNEL_PORT"
if [ "$SERVER_PORT" = "80" ]; then
    echo "⚠️  Port 80 requires sudo privileges"
    sudo SERVER_PORT=$SERVER_PORT TUNNEL_PORT=$TUNNEL_PORT node server.js
else
    node server.js
fi 