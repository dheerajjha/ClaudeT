#!/bin/bash

# WST Tunnel Server Launcher
echo "🚀 Starting WST Tunnel Server Wrapper"
echo "======================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "wstunnel-wrapper-server.js" ]; then
    echo "❌ wstunnel-wrapper-server.js not found. Please run this script from the project directory."
    exit 1
fi

# Parse command line arguments
QUICK_MODE=false
PORT=""
TUNNEL_PORT=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --quick|-q)
            QUICK_MODE=true
            shift
            ;;
        --port|-p)
            PORT="$2"
            shift 2
            ;;
        --tunnel-port|-t)
            TUNNEL_PORT="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --quick, -q           Start with default settings"
            echo "  --port, -p PORT       HTTP server port (default: 80)"
            echo "  --tunnel-port, -t PORT WST tunnel port (default: 8080)"
            echo "  --help, -h            Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Export environment variables if provided
if [ ! -z "$PORT" ]; then
    export SERVER_PORT="$PORT"
fi

if [ ! -z "$TUNNEL_PORT" ]; then
    export TUNNEL_PORT="$TUNNEL_PORT"
fi

# Start the server
if [ "$QUICK_MODE" = true ]; then
    echo "🔧 Quick Mode: Using default settings"
    echo "   HTTP Server Port: ${SERVER_PORT:-80}"
    echo "   Tunnel Port: ${TUNNEL_PORT:-8080}"
    echo ""
    node wstunnel-wrapper-server.js --quick
else
    echo "🔧 Interactive Mode: Configure your server"
    echo ""
    node wstunnel-wrapper-server.js
fi 