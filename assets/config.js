// WebSocket signaling server configuration
const WS_CONFIG = {
  // 现在服务器地址由用户输入
  url: '',
  
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