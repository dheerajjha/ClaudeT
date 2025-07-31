#!/bin/bash

# WST Tunnel Client Launcher
echo "🚀 Starting WST Tunnel Client Wrapper"
echo "====================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "wstunnel-wrapper-client.js" ]; then
    echo "❌ wstunnel-wrapper-client.js not found. Please run this script from the project directory."
    exit 1
fi

# Parse command line arguments
MODE=""
PORT=""
SERVER=""

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
        --socks|-s)
            MODE="socks"
            shift
            ;;
        --port|-p)
            PORT="$2"
            shift 2
            ;;
        --server)
            SERVER="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --web, -w             Quick start web mode (port 3000)"
            echo "  --api, -a             Quick start API mode (port 8000)"
            echo "  --socks, -s           Quick start SOCKS5 mode (port 1080)"
            echo "  --port, -p PORT       Custom local port"
            echo "  --server SERVER       Custom server address"
            echo "  --help, -h            Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 --web             # Tunnel localhost:3000"
            echo "  $0 --api             # Tunnel localhost:8000"
            echo "  $0 --socks           # SOCKS5 proxy on localhost:1080"
            echo "  $0 --port 8080       # Custom port with interactive setup"
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
            echo "🌐 Web Mode: Tunneling localhost:3000"
            node wstunnel-wrapper-client.js --web
            ;;
        api)
            echo "🔌 API Mode: Tunneling localhost:8000"
            node wstunnel-wrapper-client.js --api
            ;;
        socks)
            echo "🌍 SOCKS5 Mode: Proxy on localhost:1080"
            node wstunnel-wrapper-client.js --socks
            ;;
    esac
elif [ ! -z "$PORT" ]; then
    echo "🔧 Custom Port Mode: Port $PORT"
    echo "Use interactive setup to configure..."
    echo ""
    node wstunnel-wrapper-client.js
else
    echo "🔧 Interactive Mode: Configure your tunnel"
    echo ""
    node wstunnel-wrapper-client.js
fi 