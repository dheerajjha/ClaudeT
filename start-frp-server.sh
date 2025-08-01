#!/bin/bash

# FRP Server Launcher
echo "🚀 Starting FRP Server Wrapper"
echo "=============================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "frp-wrapper-server.js" ]; then
    echo "❌ frp-wrapper-server.js not found. Please run this script from the project directory."
    exit 1
fi

# Parse command line arguments
QUICK_MODE=false
PORT=""
BIND_PORT=""
DASHBOARD_PORT=""

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
        --bind-port|-b)
            BIND_PORT="$2"
            shift 2
            ;;
        --dashboard-port|-d)
            DASHBOARD_PORT="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --quick, -q              Start with default settings"
            echo "  --port, -p PORT          HTTP management port (default: 80)"
            echo "  --bind-port, -b PORT     FRP bind port (default: 7000)"
            echo "  --dashboard-port, -d PORT FRP dashboard port (default: 7500)"
            echo "  --help, -h               Show this help message"
            echo ""
            echo "Features:"
            echo "  - Fast reverse proxy with Go performance"
            echo "  - Built-in web dashboard"
            echo "  - TCP, UDP, HTTP, HTTPS support"
            echo "  - Custom domains and subdomains"
            echo "  - Authentication with tokens"
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

if [ ! -z "$BIND_PORT" ]; then
    export BIND_PORT="$BIND_PORT"
fi

if [ ! -z "$DASHBOARD_PORT" ]; then
    export DASHBOARD_PORT="$DASHBOARD_PORT"
fi

# Start the server
if [ "$QUICK_MODE" = true ]; then
    echo "🔧 Quick Mode: Using default settings"
    echo "   HTTP Management Port: ${SERVER_PORT:-80}"
    echo "   FRP Bind Port: ${BIND_PORT:-7000}"
    echo "   FRP Dashboard Port: ${DASHBOARD_PORT:-7500}"
    echo ""
    node frp-wrapper-server.js --quick
else
    echo "🔧 Interactive Mode: Configure your FRP server"
    echo ""
    node frp-wrapper-server.js
fi 