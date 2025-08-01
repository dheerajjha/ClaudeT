#!/bin/bash

# FRP Client Launcher
echo "🚀 Starting FRP Client Wrapper"
echo "=============================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "frp-wrapper-client.js" ]; then
    echo "❌ frp-wrapper-client.js not found. Please run this script from the project directory."
    exit 1
fi

# Parse command line arguments
MODE=""
PORT=""
SERVER=""
TOKEN=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --web|-w)
            MODE="web"
            shift
            ;;
        --api|-a)
            MODE="api"
            shift
            ;;
        --tcp|-t)
            MODE="tcp"
            shift
            ;;
        --port|-p)
            PORT="$2"
            shift 2
            ;;
        --server|-s)
            SERVER="$2"
            shift 2
            ;;
        --token)
            TOKEN="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --web, -w                Quick start web HTTP mode (port 3000)"
            echo "  --api, -a                Quick start API HTTP mode (port 8000)"
            echo "  --tcp, -t                Quick start TCP mode (port 3000)"
            echo "  --port, -p PORT          Custom local port"
            echo "  --server, -s SERVER      Custom server address"
            echo "  --token TOKEN            Authentication token"
            echo "  --help, -h               Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 --web --token abc123     # HTTP tunnel for web app"
            echo "  $0 --api --token abc123     # HTTP tunnel for API"
            echo "  $0 --tcp --token abc123     # TCP tunnel"
            echo "  $0 --port 8080 --token abc123  # Custom port with interactive setup"
            echo ""
            echo "Features:"
            echo "  - Multiple proxy types: TCP, UDP, HTTP, HTTPS"
            echo "  - Custom domains and subdomains"
            echo "  - Multi-proxy support"
            echo "  - Built-in local server testing"
            echo "  - Token-based authentication"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Start the client based on mode
if [ ! -z "$MODE" ]; then
    case $MODE in
        web)
            echo "🌐 Web HTTP Mode: Tunneling localhost:3000"
            if [ -z "$TOKEN" ]; then
                echo "❌ Token required for FRP. Use --token YOUR_TOKEN"
                exit 1
            fi
            node frp-wrapper-client.js --web
            ;;
        api)
            echo "🔌 API HTTP Mode: Tunneling localhost:8000"
            if [ -z "$TOKEN" ]; then
                echo "❌ Token required for FRP. Use --token YOUR_TOKEN"
                exit 1
            fi
            node frp-wrapper-client.js --api
            ;;
        tcp)
            echo "🔧 TCP Mode: Tunneling localhost:3000"
            if [ -z "$TOKEN" ]; then
                echo "❌ Token required for FRP. Use --token YOUR_TOKEN"
                exit 1
            fi
            node frp-wrapper-client.js --tcp
            ;;
    esac
elif [ ! -z "$PORT" ]; then
    echo "🔧 Custom Port Mode: Port $PORT"
    echo "Use interactive setup to configure..."
    echo ""
    node frp-wrapper-client.js
else
    echo "🔧 Interactive Mode: Configure your FRP tunnel"
    echo ""
    node frp-wrapper-client.js
fi 