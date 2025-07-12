// WebSocket signaling server configuration
const WS_CONFIG = {
  // Replace with your actual backend server URL when deploying
  // Example: 'wss://your-server.com' or 'ws://192.168.1.100:5082'
  url: 'ws://localhost:5082',
  
  // Connection settings
  heartbeatInterval: 30000,  // 30 seconds
  reconnectDelay: 3000,      // 3 seconds
  maxReconnectAttempts: 5
};

// WebRTC configuration
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Room settings
const ROOM_CONFIG = {
  maxUsersLan: 50,
  maxUsersInternet: 20
};