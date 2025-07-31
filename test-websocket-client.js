#!/usr/bin/env node

const WebSocket = require('ws');

// Get URL from command line argument
const wsUrl = process.argv[2];

if (!wsUrl) {
  console.log('Usage: node test-websocket-client.js <websocket-url>');
  console.log('');
  console.log('Examples:');
  console.log('  node test-websocket-client.js ws://localhost:3000/ws');
  console.log('  node test-websocket-client.js wss://claude.grabr.cc/ws');
  console.log('  node test-websocket-client.js wss://claude.grabr.cc/terminal');
  process.exit(1);
}

console.log(`🔌 Testing WebSocket connection to: ${wsUrl}`);
console.log('');

const ws = new WebSocket(wsUrl);

ws.on('open', function open() {
  console.log('✅ WebSocket connection established!');
  console.log('📤 Sending test message...');
  
  // Send a test message
  ws.send('Hello from test client! ' + new Date().toISOString());
  
  // Send another message after 1 second
  setTimeout(() => {
    ws.send('Second test message! ' + new Date().toISOString());
  }, 1000);
  
  // Close after 3 seconds
  setTimeout(() => {
    console.log('📤 Closing connection...');
    ws.close();
  }, 3000);
});

ws.on('message', function message(data) {
  console.log('📥 Received:', data.toString());
});

ws.on('close', function close() {
  console.log('🔌 WebSocket connection closed');
  process.exit(0);
});

ws.on('error', function error(err) {
  console.error('❌ WebSocket error:', err.message);
  process.exit(1);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n👋 Closing WebSocket connection...');
  ws.close();
  process.exit(0);
}); 