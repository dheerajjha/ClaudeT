#!/bin/bash

# Mini Tunnel Client Startup Script
echo "🚀 Starting Mini Tunnel Client..."
echo ""

# Check local server common ports
echo "🔍 Checking for local servers..."
for port in 3000 3001 3008 4000 5000 8000; do
    if lsof -i:$port &> /dev/null; then
        echo "✅ Found server on port $port"
    fi
done
echo ""

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
echo "1) HTTP/WebSocket Tunnel (legacy - client.js)"
echo "2) TCP Tunnel - Recommended (tcp-tunnel-client.js)"
echo ""
read -p "Enter choice (1 or 2, default 2): " choice
choice=${choice:-2}

# Set client file based on choice
if [ "$choice" = "1" ]; then
    CLIENT_FILE="client.js"
    echo "📋 Selected: HTTP/WebSocket Tunnel (legacy)"
else
    CLIENT_FILE="tcp-tunnel-client.js"
    echo "📋 Selected: TCP Tunnel (Recommended)"
fi

echo "🔌 Starting tunnel client..."
node $CLIENT_FILE 