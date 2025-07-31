const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve a simple test page
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>WebSocket Test</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        .container { background: #f5f5f5; padding: 20px; border-radius: 8px; }
        .messages { background: white; border: 1px solid #ddd; padding: 15px; height: 300px; overflow-y: auto; margin: 20px 0; }
        input[type="text"] { width: 70%; padding: 10px; margin-right: 10px; }
        button { background: #007cba; color: white; border: none; padding: 10px 20px; cursor: pointer; }
        button:hover { background: #005a87; }
        .status { margin: 10px 0; padding: 10px; border-radius: 4px; }
        .connected { background: #d4edda; color: #155724; }
        .disconnected { background: #f8d7da; color: #721c24; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔌 WebSocket Tunnel Test</h1>
        <div id="status" class="status disconnected">Disconnected</div>
        
        <div class="messages" id="messages"></div>
        
        <div>
            <input type="text" id="messageInput" placeholder="Type a message..." onkeypress="handleKeyPress(event)">
            <button onclick="sendMessage()">Send</button>
            <button onclick="connect()" id="connectBtn">Connect</button>
            <button onclick="disconnect()" id="disconnectBtn" disabled>Disconnect</button>
        </div>
        
        <div style="margin-top: 20px; color: #666;">
            <p><strong>Test Instructions:</strong></p>
            <ul>
                <li>Local: <code>ws://localhost:${process.env.PORT || 3000}/ws</code></li>
                <li>Tunneled: <code>wss://yoursubdomain.grabr.cc/ws</code></li>
            </ul>
        </div>
    </div>

    <script>
        let ws = null;
        const messages = document.getElementById('messages');
        const status = document.getElementById('status');
        const messageInput = document.getElementById('messageInput');
        const connectBtn = document.getElementById('connectBtn');
        const disconnectBtn = document.getElementById('disconnectBtn');

        function connect() {
            // Use WSS if we're on HTTPS (tunneled), WS if local
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = protocol + '//' + window.location.host + '/ws';
            
            addMessage('Connecting to: ' + wsUrl, 'system');
            ws = new WebSocket(wsUrl);

            ws.onopen = function() {
                status.textContent = 'Connected ✅';
                status.className = 'status connected';
                connectBtn.disabled = true;
                disconnectBtn.disabled = false;
                addMessage('Connected to WebSocket!', 'system');
            };

            ws.onmessage = function(event) {
                addMessage('Server: ' + event.data, 'received');
            };

            ws.onclose = function() {
                status.textContent = 'Disconnected ❌';
                status.className = 'status disconnected';
                connectBtn.disabled = false;
                disconnectBtn.disabled = true;
                addMessage('Disconnected from WebSocket', 'system');
            };

            ws.onerror = function(error) {
                addMessage('Error: ' + error, 'error');
            };
        }

        function disconnect() {
            if (ws) {
                ws.close();
            }
        }

        function sendMessage() {
            const message = messageInput.value.trim();
            if (message && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(message);
                addMessage('You: ' + message, 'sent');
                messageInput.value = '';
            }
        }

        function addMessage(message, type) {
            const div = document.createElement('div');
            div.style.marginBottom = '5px';
            div.style.color = type === 'error' ? '#dc3545' : type === 'system' ? '#6c757d' : '#000';
            div.style.fontWeight = type === 'system' ? 'bold' : 'normal';
            div.textContent = new Date().toLocaleTimeString() + ' - ' + message;
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
        }

        function handleKeyPress(event) {
            if (event.key === 'Enter') {
                sendMessage();
            }
        }
    </script>
</body>
</html>
  `);
});

// WebSocket handling
wss.on('connection', function connection(ws, req) {
  console.log('🔌 New WebSocket connection from:', req.socket.remoteAddress);
  
  // Send welcome message
  ws.send('Welcome! WebSocket tunnel is working! 🎉');
  
  ws.on('message', function incoming(message) {
    const msg = message.toString();
    console.log('📨 Received:', msg);
    
    // Echo the message back with timestamp
    ws.send(`Echo: ${msg} (at ${new Date().toLocaleTimeString()})`);
  });
  
  ws.on('close', function() {
    console.log('❌ WebSocket connection closed');
  });
  
  ws.on('error', function(error) {
    console.error('❌ WebSocket error:', error);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 WebSocket test server running on port ${PORT}`);
  console.log(`📱 Open http://localhost:${PORT} to test`);
  console.log(`🔌 WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`🌐 When tunneled: wss://yoursubdomain.grabr.cc/ws`);
}); 