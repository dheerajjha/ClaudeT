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

echo "🔌 Starting tunnel client..."
node client.js 