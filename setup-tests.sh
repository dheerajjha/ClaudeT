#!/bin/bash

echo "🔧 Setting up WebSocket testing environment..."
echo ""

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Install Playwright browser
echo "🌐 Installing Playwright Chromium browser..."
npm run install-playwright

echo ""
echo "✅ Setup complete!"
echo ""
echo "🚀 Available test commands:"
echo "  npm run test:websockets     - Basic WebSocket functionality test"
echo "  npm run debug:websockets    - Detailed WebSocket debugging with screenshots"
echo ""
echo "📋 Before running tests, make sure:"
echo "  1. Your local server is running on localhost:3008"
echo "  2. Your production site is accessible at claude.grabr.cc"
echo ""
echo "🧪 To run the tests:"
echo "  npm run debug:websockets"
echo ""
echo "This will:"
echo "  - Test both localhost:3008 and claude.grabr.cc"
echo "  - Navigate to projects and try to open terminals"
echo "  - Monitor all WebSocket traffic in detail"
echo "  - Take screenshots for debugging"
echo "  - Generate detailed reports"
echo "  - Compare localhost vs production WebSocket behavior"
echo "" 