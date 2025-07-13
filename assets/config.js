// WebSocket signaling server configuration
const WS_CONFIG = {
  // 服务器列表，按优先级排序
  servers: [
    'wss://chat.canghai.org'
    // 可以添加更多备用服务器
    // 'wss://backup1.example.com',
    // 'wss://backup2.example.com'
  ],
  
  // Connection settings
  heartbeatInterval: 30000,  // 30 seconds
  reconnectDelay: 3000,      // 3 seconds
  maxReconnectAttempts: 5,
  serverSwitchDelay: 2000    // 2 seconds before trying next server
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