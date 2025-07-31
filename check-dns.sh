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

# Check root domain
echo "🔍 Checking grabr.cc root domain..."
if nslookup grabr.cc | grep -q "20.193.143.179"; then
    echo "✅ grabr.cc points to 20.193.143.179"
else
    echo "❌ grabr.cc not pointing to 20.193.143.179"
    echo "   Add this record in Cloudflare:"
    echo "   Type: A, Name: @, Content: 20.193.143.179, Proxy: ☁️"
fi
echo ""

# Check wildcard
echo "🔍 Checking *.grabr.cc wildcard..."
if nslookup test.grabr.cc | grep -q "20.193.143.179"; then
    echo "✅ *.grabr.cc wildcard works"
else
    echo "❌ Wildcard *.grabr.cc not working"
    echo "   Add this record in Cloudflare:"
    echo "   Type: A, Name: *, Content: 20.193.143.179, Proxy: ☁️"
fi
echo ""

echo "📋 Required Cloudflare DNS Records:"
echo "1. Type: A, Name: @, Content: 20.193.143.179, Proxy: ☁️ (Proxied)"
echo "2. Type: A, Name: *, Content: 20.193.143.179, Proxy: ☁️ (Proxied)"
echo ""
echo "✅ Use Proxied mode for HTTPS support!" 