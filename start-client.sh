#!/bin/bash

# Mini Tunnel Client Startup Script
echo "🚀 Starting Mini Tunnel Client..."

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