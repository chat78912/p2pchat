# P2P Chat Application

A WebRTC-based peer-to-peer chat application with separate frontend and backend.

## Architecture

- **Frontend**: Static files for deployment on Cloudflare Pages or any static hosting
- **Backend**: Minimal WebSocket signaling server (Python) for Docker deployment

## Project Structure

```
/
├── index.html          # Main HTML file
├── assets/            # Frontend static assets
│   ├── app.js         # Main application logic
│   ├── config.js      # Configuration (WebSocket URL, etc.)
│   └── styles.css     # Styles
└── server/            # Backend signaling server
    ├── server.py      # WebSocket server (Python)
    ├── requirements.txt # Python dependencies
    └── Dockerfile     # Docker configuration
```

## Frontend Deployment

1. Deploy the following files to Cloudflare Pages:
   - `index.html`
   - `assets/` folder and all its contents

2. Update `assets/config.js` with your backend WebSocket URL:
   ```javascript
   const WS_CONFIG = {
     url: 'wss://your-server.com'  // Your backend server URL
   };
   ```

## Backend Deployment

### Option 1: Use Pre-built Image from Docker Hub

```bash
# Replace 'yourname' with the actual Docker Hub username
docker run -d --name p2pchat --network host yourname/p2pchat:latest
```

### Option 2: Build Locally

```bash
cd server
docker build -t p2pchat .
docker run -d --name p2pchat --network host p2pchat
```

### Environment Variables

- `PORT`: Server port (default: 5082)

### Example with custom port:

```bash
docker run -d --name p2pchat --network host -e PORT=3000 p2pchat
```

## Features

- **LAN Mode**: Automatic connection for users on the same network
- **Internet Mode**: Manual room-based connections
- **P2P Communication**: Direct peer-to-peer messaging via WebRTC
- **Minimal Server**: Backend only handles signaling, no data storage
- **Low Resource Usage**: Python implementation uses only ~20-30MB RAM