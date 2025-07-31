# Mini Tunnel 🚀

A simple, lightweight tunneling solution similar to ngrok or cloudflared that allows you to expose your local development server through your VM's public IP address.

## Features ✨

- 🔗 **Simple Tunneling**: Expose local services through your VM's public IP
- 🔄 **Auto-Reconnection**: Automatic reconnection with exponential backoff
- 📊 **Real-time Dashboard**: Monitor active tunnels and their status
- ⚡ **Fast Setup**: Quick and easy configuration
- 🛡️ **Error Handling**: Robust error handling and timeout management
- 🎯 **Multiple Tunnels**: Support for multiple concurrent tunnels

## Architecture

```
┌─────────────────┐    WebSocket     ┌─────────────────┐    HTTP/HTTPS    ┌─────────────────┐
│   Local App     │ ◄──────────────► │   VM Server     │ ◄──────────────► │   Internet      │
│ localhost:3000  │                  │ your-vm-ip:8080 │                  │   Users         │
└─────────────────┘                  └─────────────────┘                  └─────────────────┘
      Client                              Server                               Public Access
```

## Quick Start 🚀

### 1. Setup on Your VM (Server)

```bash
# Copy files to your VM
scp -r * user@your-vm-ip:/path/to/tunnel-server/

# SSH into your VM
ssh user@your-vm-ip

# Navigate to the project directory
cd /path/to/tunnel-server/

# Install dependencies
npm install

# Start the server
chmod +x start-server.sh
./start-server.sh
```

### 2. Setup on Your Local Machine (Client)

```bash
# Install dependencies
npm install

# Start the client
chmod +x start-client.sh
./start-client.sh
```

Follow the interactive prompts to configure your tunnel.

## Configuration 📋

### Server Configuration (VM)

The server can be configured via environment variables or by modifying `config.json`:

```bash
# Environment variables
export SERVER_PORT=8080      # Public HTTP port
export TUNNEL_PORT=8081      # WebSocket tunnel port

# Start server
node server.js
```

### Client Configuration (Local)

Configure the client by editing `config.json` or using the interactive CLI:

```json
{
  "client": {
    "serverHost": "your-vm-ip-here",
    "serverPort": 8081,
    "localPort": 3000,
    "localHost": "localhost"
  }
}
```

## Usage Examples 📚

### Basic Usage

1. **Start your local application** (e.g., on port 3000)
2. **Run the tunnel client**:
   ```bash
   node client.js
   ```
3. **Access your app** via the provided public URL

### Advanced Usage

#### Custom Configuration

```bash
# Run client with specific config
node client.js --config custom-config.json

# Run server with custom ports
SERVER_PORT=9000 TUNNEL_PORT=9001 node server.js
```

#### Multiple Tunnels

Each client connection creates a unique tunnel with its own subdirectory:
- Client 1: `http://your-vm-ip:8080/abc12345/`
- Client 2: `http://your-vm-ip:8080/def67890/`

## API Endpoints 🛠️

### Server Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server information |
| `/health` | GET | Health check |
| `/dashboard` | GET | Active tunnels dashboard |
| `/:tunnelId/*` | ALL | Tunneled requests |

### Dashboard Response

```json
{
  "server": {
    "serverPort": 8080,
    "tunnelPort": 8081
  },
  "tunnels": [
    {
      "id": "abc12345",
      "connected": true,
      "localPort": 3000,
      "connectedAt": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

## Monitoring & Debugging 🔍

### Server Logs

```bash
# View real-time logs
tail -f server.log

# Monitor active connections
curl http://your-vm-ip:8080/dashboard
```

### Client Logs

The client provides detailed logging:
- ✅ Connection status
- 📨 Request forwarding
- ❌ Error messages
- 🔄 Reconnection attempts

## Firewall Configuration 🔥

Make sure your VM allows incoming connections on the configured ports:

```bash
# Ubuntu/Debian
sudo ufw allow 8080
sudo ufw allow 8081

# CentOS/RHEL
sudo firewall-cmd --add-port=8080/tcp --permanent
sudo firewall-cmd --add-port=8081/tcp --permanent
sudo firewall-cmd --reload
```

## Security Considerations 🛡️

1. **Use HTTPS**: Consider putting a reverse proxy (nginx) with SSL in front
2. **Access Control**: Implement authentication if needed
3. **Rate Limiting**: Enable rate limiting in production
4. **Firewall**: Restrict access to trusted IPs only

## Production Deployment 🏭

### Using PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Start server with PM2
pm2 start server.js --name "tunnel-server"

# Save PM2 configuration
pm2 save
pm2 startup
```

### Using systemd

Create `/etc/systemd/system/tunnel-server.service`:

```ini
[Unit]
Description=Mini Tunnel Server
After=network.target

[Service]
Type=simple
User=nodejs
WorkingDirectory=/path/to/tunnel-server
ExecStart=/usr/bin/node server.js
Restart=always
Environment=NODE_ENV=production
Environment=SERVER_PORT=8080
Environment=TUNNEL_PORT=8081

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable tunnel-server
sudo systemctl start tunnel-server
```

## Troubleshooting 🔧

### Common Issues

1. **Connection Refused**
   - Check if the server is running
   - Verify firewall settings
   - Confirm port availability

2. **Local Server Not Reachable**
   - Ensure your local app is running
   - Check the correct port number
   - Verify localhost accessibility

3. **WebSocket Connection Failed**
   - Check tunnel port (8081) accessibility
   - Verify VM IP address
   - Check network connectivity

### Debug Mode

Enable detailed logging:

```bash
# Server
DEBUG=tunnel:* node server.js

# Client
DEBUG=tunnel:* node client.js
```

## Development 👨‍💻

### Setup Development Environment

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev:server    # Start server with nodemon
npm run dev:client    # Start client with nodemon
```

### Project Structure

```
mini-tunnel/
├── server.js          # Main server component
├── client.js          # Main client component
├── config.json        # Configuration template
├── package.json       # Dependencies
├── start-server.sh    # Server startup script
├── start-client.sh    # Client startup script
└── README.md          # This file
```

## Contributing 🤝

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License 📄

MIT License - see the LICENSE file for details.

## Support 💬

For issues and questions:
1. Check the troubleshooting section
2. Review server/client logs
3. Create an issue with detailed information

---

**Happy Tunneling!** 🎉 