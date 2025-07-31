#!/bin/bash

echo "🌍 DNS Setup Checker for grabr.cc"
echo "================================="
echo ""

# Check main domain
echo "🔍 Checking grabr.cc..."
if nslookup grabr.cc | grep -q "20.193.143.179"; then
    echo "✅ grabr.cc points to 20.193.143.179"
else
    echo "❌ grabr.cc not pointing to 20.193.143.179"
    echo "   Current resolution:"
    nslookup grabr.cc | grep "Address:" | tail -1
fi
echo ""

# Check tunnel subdomain
echo "🔍 Checking tunnel.grabr.cc..."
if nslookup tunnel.grabr.cc | grep -q "20.193.143.179"; then
    echo "✅ tunnel.grabr.cc points to 20.193.143.179"
else
    echo "❌ tunnel.grabr.cc not pointing to 20.193.143.179"
    echo "   Add this record in Cloudflare:"
    echo "   Type: A, Name: tunnel, Content: 20.193.143.179"
fi
echo ""

# Check wildcard
echo "🔍 Checking *.tunnel.grabr.cc..."
if nslookup test.tunnel.grabr.cc | grep -q "20.193.143.179"; then
    echo "✅ *.tunnel.grabr.cc wildcard works"
else
    echo "❌ Wildcard *.tunnel.grabr.cc not working"
    echo "   Add this record in Cloudflare:"
    echo "   Type: A, Name: *.tunnel, Content: 20.193.143.179"
fi
echo ""

echo "📋 Required Cloudflare DNS Records:"
echo "1. Type: A, Name: tunnel, Content: 20.193.143.179, Proxy: ❌"
echo "2. Type: A, Name: *.tunnel, Content: 20.193.143.179, Proxy: ❌"
echo ""
echo "⚠️  Make sure Proxy is set to 'DNS only' (not Proxied)!" 