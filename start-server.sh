gi #!/bin/bash

git pull

# Mini Tunnel Server Startup Script
echo "🚀 Starting Mini Tunnel Server..."

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

# Set environment variables if provided
export SERVER_PORT=${SERVER_PORT:-8080}
export TUNNEL_PORT=${TUNNEL_PORT:-8081}

echo "📋 Configuration:"
echo "   Server Port: $SERVER_PORT"
echo "   Tunnel Port: $TUNNEL_PORT"
echo "   Domain: grabr.cc"
echo ""

# Start the server
echo "🔥 Starting server..."
node server.js 