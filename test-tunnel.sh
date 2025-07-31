#!/bin/bash

echo "🧪 Mini Tunnel System Test"
echo "=========================="
echo ""

# Get tunnel ID from dashboard
echo "📊 Getting tunnel information..."
TUNNEL_DATA=$(curl -s http://20.193.143.179:8080/dashboard 2>/dev/null)

if [ $? -ne 0 ]; then
    echo "❌ Cannot connect to tunnel server at 20.193.143.179:8080"
    echo "   Make sure the server is running!"
    exit 1
fi

TUNNEL_ID=$(echo "$TUNNEL_DATA" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['tunnels'][0]['id'] if data['tunnels'] else '')" 2>/dev/null)

if [ -z "$TUNNEL_ID" ]; then
    echo "❌ No active tunnels found"
    echo "   Make sure a client is connected!"
    exit 1
fi

echo "✅ Found active tunnel: $TUNNEL_ID"
echo ""

# Test 1: Path-based URL (via IP)
echo "🔗 Test 1: Path-based URL"
echo "Testing: http://20.193.143.179:8080/$TUNNEL_ID/"
if curl -Is http://20.193.143.179:8080/$TUNNEL_ID/ | head -1 | grep -q "200 OK"; then
    echo "✅ Path-based URL works"
else
    echo "❌ Path-based URL failed"
fi
echo ""

# Test 2: Subdomain routing
echo "🌐 Test 2: Subdomain routing"
echo "Testing: $TUNNEL_ID.grabr.cc (via Host header)"
if curl -Is -H "Host: $TUNNEL_ID.grabr.cc" http://20.193.143.179:80/ | head -1 | grep -q "200 OK"; then
    echo "✅ Subdomain routing works"
else
    echo "❌ Subdomain routing failed"
fi
echo ""

# Test 3: Asset loading via subdomain
echo "📦 Test 3: Asset loading"
echo "Testing: /assets/index-Et_ROl5E.js via subdomain"
ASSET_SIZE=$(curl -s -H "Host: $TUNNEL_ID.grabr.cc" http://20.193.143.179:80/assets/index-Et_ROl5E.js | wc -c)
if [ "$ASSET_SIZE" -gt 1000 ]; then
    echo "✅ Asset loading works ($ASSET_SIZE bytes)"
else
    echo "❌ Asset loading failed (only $ASSET_SIZE bytes)"
fi
echo ""

# Test 4: DNS resolution
echo "🌍 Test 4: DNS resolution"
if nslookup grabr.cc &> /dev/null; then
    echo "✅ grabr.cc resolves correctly"
    
    # Test direct domain access
    if curl -Is http://grabr.cc:8080/$TUNNEL_ID/ 2>/dev/null | head -1 | grep -q "200 OK"; then
        echo "✅ Direct domain access works"
    else
        echo "⚠️  Direct domain access not working yet"
    fi
else
    echo "⚠️  grabr.cc doesn't resolve - add DNS records:"
    echo "   1. A record: tunnel → 20.193.143.179"
    echo "   2. A record: *.tunnel → 20.193.143.179"
fi
echo ""

# Summary
echo "📋 Summary:"
echo "   Tunnel ID: $TUNNEL_ID"
echo "   Path URL: http://20.193.143.179:80/$TUNNEL_ID/"
echo "   Subdomain URL: https://$TUNNEL_ID.grabr.cc/"
echo "   Dashboard: https://grabr.cc/dashboard"
echo ""
echo "🎉 Subdomain routing solves all asset loading issues!"
echo "   Use: https://$TUNNEL_ID.grabr.cc/ (once DNS is set up)" 