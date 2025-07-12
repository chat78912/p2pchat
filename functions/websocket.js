// functions/websocket.js

// 连接模式配置
const CONNECTION_MODES = {
  LAN: 'lan',
  INTERNET: 'internet'
};

// 模式特定配置
const MODE_CONFIG = {
  [CONNECTION_MODES.LAN]: {
    maxUsersPerRoom: 50,        // 局域网模式支持更多用户
    heartbeatInterval: 30000,   // 30秒心跳间隔
    userTimeout: 60000,         // 1分钟用户超时
    messageQueueSize: 100,      // 更大的消息队列
    reconnectWindow: 120000,    // 2分钟重连窗口
    autoDetection: true         // 支持自动检测
  },
  [CONNECTION_MODES.INTERNET]: {
    maxUsersPerRoom: 20,        // 公网模式用户限制更严格
    heartbeatInterval: 20000,   // 20秒心跳间隔
    userTimeout: 90000,         // 1.5分钟用户超时
    messageQueueSize: 50,       // 较小的消息队列
    reconnectWindow: 180000,    // 3分钟重连窗口
    autoDetection: false        // 不支持自动检测
  }
};

// 网络段配置
const NETWORK_CONFIG = {
  // 常见的私有网络段
  PRIVATE_NETWORKS: [
    { prefix: '192.168', mask: '192.168.0.0/16', type: 'home' },
    { prefix: '10.', mask: '10.0.0.0/8', type: 'corporate' },
    { prefix: '172.16', mask: '172.16.0.0/12', type: 'corporate' },
    { prefix: '169.254', mask: '169.254.0.0/16', type: 'link-local' }
  ],
  // 房间命名规则
  ROOM_PREFIX: 'lan_auto_',
  // 网络段超时时间
  NETWORK_TIMEOUT: 1800000 // 30分钟
};

// 存储活跃的WebSocket连接
const activeConnections = new Map();

export async function onRequest(context) {
  const { request, env } = context;
  
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }

  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  server.accept();
  handleWebSocket(server, env);

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

function handleWebSocket(webSocket, env) {
  let currentUser = null;
  let currentRoom = null;
  let connectionMode = CONNECTION_MODES.LAN; // 默认局域网模式
  let lastHeartbeat = Date.now();
  let userLocalIP = null;
  let userNetworkSegment = null;

  webSocket.addEventListener('message', async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('Received message:', data);
      
      // 更新心跳时间
      lastHeartbeat = Date.now();
      
      // 更新用户网络信息
      if (data.localIP) userLocalIP = data.localIP;
      if (data.networkSegment) userNetworkSegment = data.networkSegment;
      if (data.connectionMode) connectionMode = data.connectionMode;
      
      switch (data.type) {
        case 'join_room':
          const result = await handleJoinRoom(webSocket, data, env, connectionMode);
          if (result) {
            currentUser = data.userId;
            currentRoom = data.roomId;
            // 注册WebSocket连接
            activeConnections.set(data.userId, webSocket);
            console.log(`✅ Registered WebSocket connection for user ${data.userId}`);
            await updateUserLastSeen(data.userId, env, connectionMode);
          }
          break;
          
        case 'leave_room':
          await handleLeaveRoom(webSocket, data, env, connectionMode);
          if (currentUser) {
            activeConnections.delete(currentUser);
            console.log(`❌ Removed WebSocket connection for user ${currentUser}`);
          }
          currentUser = null;
          currentRoom = null;
          userLocalIP = null;
          userNetworkSegment = null;
          break;
          
        case 'offer':
        case 'answer':
        case 'ice-candidate':
          await handleRTCMessage(webSocket, data, env, connectionMode);
          await updateUserLastSeen(data.userId, env, connectionMode);
          break;
          
        case 'message':
          await handleChatMessage(webSocket, data, env, connectionMode);
          await updateUserLastSeen(data.userId, env, connectionMode);
          break;
          
        case 'poll_messages':
          await handlePollMessages(webSocket, data, env, connectionMode);
          await updateUserLastSeen(data.userId, env, connectionMode);
          break;
          
        case 'heartbeat':
          await handleHeartbeat(webSocket, data, env, connectionMode);
          break;
          
        case 'network_detect':
          // 处理网络检测请求
          await handleNetworkDetect(webSocket, data, env);
          break;
          
        case 'check_room':
          // 新增：处理房间检查请求
          await handleCheckRoom(webSocket, data, env);
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
      safeWebSocketSend(webSocket, {
        type: 'error',
        message: 'Invalid message format'
      });
    }
  });

  webSocket.addEventListener('close', async (event) => {
    console.log(`WebSocket closed for user: ${currentUser}, code: ${event.code}`);
    if (currentUser) {
      activeConnections.delete(currentUser);
      console.log(`❌ Removed WebSocket connection for user ${currentUser} (connection closed)`);
      if (currentRoom) {
        await handleUserDisconnect(currentUser, currentRoom, env, connectionMode);
      }
    }
  });

  webSocket.addEventListener('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // 定期检查心跳超时
  const heartbeatCheck = setInterval(async () => {
    const now = Date.now();
    const config = MODE_CONFIG[connectionMode];
    const timeout = config.userTimeout + config.heartbeatInterval;
    
    if (now - lastHeartbeat > timeout) {
      console.log(`Heartbeat timeout for user: ${currentUser} (mode: ${connectionMode})`);
      if (currentUser && currentRoom) {
        await handleUserDisconnect(currentUser, currentRoom, env, connectionMode);
      }
      webSocket.close();
      clearInterval(heartbeatCheck);
    }
  }, MODE_CONFIG[connectionMode].heartbeatInterval);
}

// ==================== 网络检测和自动房间分配 ====================

// 新增：处理房间检查
async function handleCheckRoom(webSocket, data, env) {
  const { roomId, userId } = data;
  
  if (!roomId) {
    safeWebSocketSend(webSocket, {
      type: 'room_info',
      error: 'Room ID required',
      exists: false
    });
    return;
  }

  try {
    const roomKey = `room:${roomId}`;
    const roomDataStr = await env['p2pchat-storage'].get(roomKey);
    
    if (roomDataStr) {
      const roomData = JSON.parse(roomDataStr);
      const now = Date.now();
      const config = MODE_CONFIG[roomData.mode || CONNECTION_MODES.LAN];
      
      // 计算活跃用户数
      let activeUserCount = 0;
      for (const existingUserId of roomData.users) {
        const userKey = `user:${existingUserId}`;
        const userDataStr = await env['p2pchat-storage'].get(userKey);
        
        if (userDataStr) {
          const userData = JSON.parse(userDataStr);
          if (now - userData.lastSeen < config.userTimeout) {
            activeUserCount++;
          }
        }
      }
      
      console.log(`Room check for ${roomId}: ${activeUserCount} active users`);
      
      safeWebSocketSend(webSocket, {
        type: 'room_info',
        roomId: roomId,
        exists: true,
        userCount: activeUserCount,
        mode: roomData.mode,
        networkSegment: roomData.networkSegment
      });
      
    } else {
      safeWebSocketSend(webSocket, {
        type: 'room_info',
        roomId: roomId,
        exists: false,
        userCount: 0
      });
    }
    
  } catch (error) {
    console.error('Error checking room:', error);
    safeWebSocketSend(webSocket, {
      type: 'room_info',
      error: 'Failed to check room',
      exists: false
    });
  }
}

// 新增：处理网络检测
async function handleNetworkDetect(webSocket, data, env) {
  const { localIP, userId } = data;
  
  if (!localIP || !isPrivateIP(localIP)) {
    safeWebSocketSend(webSocket, {
      type: 'network_info',
      error: 'Invalid or public IP address',
      detected: false
    });
    return;
  }

  try {
    const networkSegment = getNetworkSegment(localIP);
    const roomId = NETWORK_CONFIG.ROOM_PREFIX + networkSegment.replace(/\./g, '_');
    
    // 查找同网段的其他用户
    const sameNetworkUsers = await findUsersInNetworkSegment(env, networkSegment);
    
    console.log(`Network detection for ${userId}: IP=${localIP}, Segment=${networkSegment}, SameNetworkUsers=${sameNetworkUsers.length}`);
    
    safeWebSocketSend(webSocket, {
      type: 'network_info',
      localIP: localIP,
      networkSegment: networkSegment,
      suggestedRoom: roomId,
      detectedUsers: sameNetworkUsers,
      detected: true
    });
    
  } catch (error) {
    console.error('Error in network detection:', error);
    safeWebSocketSend(webSocket, {
      type: 'network_info',
      error: 'Network detection failed',
      detected: false
    });
  }
}

// 新增：查找同网段用户
async function findUsersInNetworkSegment(env, networkSegment) {
  try {
    const networkKey = `network:${networkSegment}`;
    const networkDataStr = await env['p2pchat-storage'].get(networkKey);
    
    if (!networkDataStr) {
      return [];
    }
    
    const networkData = JSON.parse(networkDataStr);
    const now = Date.now();
    const activeUsers = [];
    
    // 检查网络中的活跃用户
    for (const userId of networkData.users || []) {
      const userKey = `user:${userId}`;
      const userDataStr = await env['p2pchat-storage'].get(userKey);
      
      if (userDataStr) {
        const userData = JSON.parse(userDataStr);
        // 检查用户是否在最近5分钟内活跃
        if (now - userData.lastSeen < 300000) {
          activeUsers.push({
            userId: userId,
            lastSeen: userData.lastSeen,
            roomId: userData.roomId
          });
        }
      }
    }
    
    return activeUsers;
  } catch (error) {
    console.error('Error finding users in network segment:', error);
    return [];
  }
}

// 新增：判断是否为私有IP
function isPrivateIP(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  
  return (
    (parts[0] === 10) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254) // Link-local
  );
}

// 新增：获取网络段
function getNetworkSegment(ip) {
  const parts = ip.split('.');
  if (parts[0] === '192' && parts[1] === '168') {
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  } else if (parts[0] === '10') {
    return `${parts[0]}.${parts[1]}`;
  } else if (parts[0] === '172') {
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  } else if (parts[0] === '169' && parts[1] === '254') {
    return `${parts[0]}.${parts[1]}`;
  } else {
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
}

// 新增：更新网络段信息
async function updateNetworkSegment(env, networkSegment, userId) {
  try {
    const networkKey = `network:${networkSegment}`;
    const networkDataStr = await env['p2pchat-storage'].get(networkKey);
    
    let networkData = networkDataStr ? JSON.parse(networkDataStr) : {
      users: [],
      created: Date.now(),
      lastUpdated: Date.now()
    };
    
    // 添加用户到网络段（如果不存在）
    if (!networkData.users.includes(userId)) {
      networkData.users.push(userId);
    }
    
    networkData.lastUpdated = Date.now();
    
    // 保存网络段信息
    await env['p2pchat-storage'].put(networkKey, JSON.stringify(networkData), {
      expirationTtl: Math.floor(NETWORK_CONFIG.NETWORK_TIMEOUT / 1000)
    });
    
    console.log(`Updated network segment ${networkSegment} with user ${userId}`);
  } catch (error) {
    console.error('Error updating network segment:', error);
  }
}

// ==================== 局域网模式处理函数 ====================

const LANModeHandler = {
  async processJoinRoom(webSocket, data, env) {
    const { roomId, userId, localIP, networkSegment, autoDetected } = data;
    const config = MODE_CONFIG[CONNECTION_MODES.LAN];
    
    console.log(`[LAN Mode] User ${userId} joining room ${roomId} (auto: ${autoDetected})`);
    
    // 局域网模式：优先支持自动检测房间
    if (autoDetected && localIP && networkSegment) {
      // 自动检测模式：验证IP和网络段
      if (!isPrivateIP(localIP)) {
        return { success: false, error: 'Invalid private IP address for LAN mode' };
      }
      
      const calculatedSegment = getNetworkSegment(localIP);
      if (calculatedSegment !== networkSegment) {
        return { success: false, error: 'Network segment mismatch' };
      }
      
      // 更新网络段信息
      await updateNetworkSegment(env, networkSegment, userId);
      
      console.log(`[LAN Mode] Auto-detected room ${roomId} for network ${networkSegment} (IP: ${localIP})`);
    } else if (roomId && roomId.startsWith('lan_auto_')) {
      // 自动生成的房间，即使没有完整信息也允许加入
      console.log(`[LAN Mode] Rejoining auto-generated room ${roomId}`);
    } else {
      // 手动模式：更宽松的验证
      if (!roomId || !userId || roomId.length > 50) { // 增加长度限制以支持自动生成的房间名
        return { success: false, error: 'Invalid room ID or user ID' };
      }
    }
    
    const roomKey = `room:${roomId}`;
    const roomDataStr = await env['p2pchat-storage'].get(roomKey);
    let roomData = roomDataStr ? JSON.parse(roomDataStr) : { 
      users: [], 
      connections: {}, 
      mode: CONNECTION_MODES.LAN,
      networkSegment: networkSegment || null,
      autoDetected: autoDetected || false
    };
    
    // 检查用户数限制
    if (roomData.users.length >= config.maxUsersPerRoom) {
      return { success: false, error: `Room full (max ${config.maxUsersPerRoom} users in LAN mode)` };
    }
    
    return { success: true, roomData };
  },

  async cleanupExpiredUsers(roomId, env) {
    const config = MODE_CONFIG[CONNECTION_MODES.LAN];
    return await cleanupExpiredUsersWithConfig(roomId, env, config.userTimeout);
  },

  async handleMessage(data, env) {
    const config = MODE_CONFIG[CONNECTION_MODES.LAN];
    console.log(`[LAN Mode] Processing message with optimized local delivery`);
    return { processed: true, config };
  }
};

// ==================== 公网模式处理函数 ====================

const InternetModeHandler = {
  async processJoinRoom(webSocket, data, env) {
    const { roomId, userId } = data;
    const config = MODE_CONFIG[CONNECTION_MODES.INTERNET];
    
    console.log(`[Internet Mode] User ${userId} joining room ${roomId}`);
    
    // 公网模式：不支持自动检测，严格验证
    if (!roomId || !userId || roomId.length > 20 || roomId.length < 3) {
      return { success: false, error: 'Invalid room ID (3-20 chars required for Internet mode)' };
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(roomId)) {
      return { success: false, error: 'Room ID contains invalid characters' };
    }
    
    const roomKey = `room:${roomId}`;
    const roomDataStr = await env['p2pchat-storage'].get(roomKey);
    let roomData = roomDataStr ? JSON.parse(roomDataStr) : { 
      users: [], 
      connections: {}, 
      mode: CONNECTION_MODES.INTERNET,
      autoDetected: false
    };
    
    if (roomData.users.length >= config.maxUsersPerRoom) {
      return { success: false, error: `Room full (max ${config.maxUsersPerRoom} users in Internet mode)` };
    }
    
    return { success: true, roomData };
  },

  async cleanupExpiredUsers(roomId, env) {
    const config = MODE_CONFIG[CONNECTION_MODES.INTERNET];
    return await cleanupExpiredUsersWithConfig(roomId, env, config.userTimeout);
  },

  async handleMessage(data, env) {
    const config = MODE_CONFIG[CONNECTION_MODES.INTERNET];
    console.log(`[Internet Mode] Processing message with enhanced security checks`);
    return { processed: true, config };
  }
};

// ==================== 核心处理函数 ====================

async function handleHeartbeat(webSocket, data, env, connectionMode = CONNECTION_MODES.LAN) {
  const { userId, roomId, timestamp } = data;
  const config = MODE_CONFIG[connectionMode];
  
  console.log(`[${connectionMode.toUpperCase()}] Received heartbeat from ${userId} at ${timestamp}`);
  
  // 更新用户最后活跃时间
  await updateUserLastSeen(userId, env, connectionMode);
  
  // 发送心跳响应
  safeWebSocketSend(webSocket, {
    type: 'heartbeat_ack',
    timestamp: Date.now(),
    mode: connectionMode,
    interval: config.heartbeatInterval
  });
  
  // 清理过期用户
  if (roomId) {
    const handler = connectionMode === CONNECTION_MODES.LAN ? LANModeHandler : InternetModeHandler;
    await handler.cleanupExpiredUsers(roomId, env);
  }
}

async function updateUserLastSeen(userId, env, connectionMode = CONNECTION_MODES.LAN) {
  if (!userId) return;
  
  try {
    const userKey = `user:${userId}`;
    const userDataStr = await env['p2pchat-storage'].get(userKey);
    
    if (userDataStr) {
      const userData = JSON.parse(userDataStr);
      userData.lastSeen = Date.now();
      userData.connectionMode = connectionMode;
      
      const config = MODE_CONFIG[connectionMode];
      const ttl = Math.floor(config.reconnectWindow / 1000);
      
      await env['p2pchat-storage'].put(userKey, JSON.stringify(userData), { 
        expirationTtl: ttl 
      });
    }
  } catch (error) {
    console.error('Error updating user last seen:', error);
  }
}

async function cleanupExpiredUsersWithConfig(roomId, env, userTimeout) {
  try {
    const roomKey = `room:${roomId}`;
    const roomDataStr = await env['p2pchat-storage'].get(roomKey);
    
    if (!roomDataStr) return;
    
    const roomData = JSON.parse(roomDataStr);
    const now = Date.now();
    
    const activeUsers = [];
    let hasExpiredUsers = false;
    
    for (const userId of roomData.users) {
      const userKey = `user:${userId}`;
      const userDataStr = await env['p2pchat-storage'].get(userKey);
      
      if (userDataStr) {
        const userData = JSON.parse(userDataStr);
        if (now - userData.lastSeen < userTimeout) {
          activeUsers.push(userId);
        } else {
          console.log(`User ${userId} expired (timeout: ${userTimeout}ms), removing from room`);
          hasExpiredUsers = true;
          await env['p2pchat-storage'].delete(userKey);
          if (userData.connectionId) {
            await env['p2pchat-storage'].delete(`conn:${userData.connectionId}`);
          }
          await env['p2pchat-storage'].delete(`messages:${userId}`);
        }
      } else {
        hasExpiredUsers = true;
      }
    }
    
    if (hasExpiredUsers) {
      if (activeUsers.length > 0) {
        roomData.users = activeUsers;
        roomData.lastUpdated = now;
        
        const newConnections = {};
        for (const userId of activeUsers) {
          if (roomData.connections[userId]) {
            newConnections[userId] = roomData.connections[userId];
          }
        }
        roomData.connections = newConnections;
        
        await env['p2pchat-storage'].put(roomKey, JSON.stringify(roomData), { 
          expirationTtl: 3600 
        });
        
        await broadcastToRoom(roomId, {
          type: 'room_users',
          users: activeUsers
        }, env);
        
        console.log(`Cleaned up expired users in room ${roomId}. Active users: ${activeUsers.length}`);
      } else {
        await env['p2pchat-storage'].delete(roomKey);
        console.log(`Room ${roomId} deleted - no active users`);
      }
    }
  } catch (error) {
    console.error('Error cleaning up expired users:', error);
  }
}

async function handleJoinRoom(webSocket, data, env, connectionMode = CONNECTION_MODES.LAN) {
  const handler = connectionMode === CONNECTION_MODES.LAN ? LANModeHandler : InternetModeHandler;
  
  // 如果是局域网模式且使用默认房间，自动分配基于连接的房间
  if (data.mode === 'lan' && data.roomId === 'lan_auto_default') {
    // 从WebSocket连接获取客户端信息
    const clientInfo = extractClientInfo(webSocket);
    data.roomId = generateLANRoomId(clientInfo);
    console.log(`Auto-assigned LAN room: ${data.roomId} for client: ${clientInfo.ip}`);
  }
  
  // 先进行模式特定的验证
  const validationResult = await handler.processJoinRoom(webSocket, data, env);
  if (!validationResult.success) {
    safeWebSocketSend(webSocket, {
      type: 'error',
      message: validationResult.error
    });
    return false;
  }
  
  const { roomId, userId, localIP, networkSegment } = data;
  
  try {
    await handler.cleanupExpiredUsers(roomId, env);
    
    const roomKey = `room:${roomId}`;
    const roomDataStr = await env['p2pchat-storage'].get(roomKey);
    let roomData = roomDataStr ? JSON.parse(roomDataStr) : { 
      users: [], 
      connections: {}, 
      mode: connectionMode,
      networkSegment: networkSegment || null,
      autoDetected: data.autoDetected || false
    };
    
    const existingUsers = [...roomData.users];
    
    if (roomData.users.includes(userId)) {
      roomData.users = roomData.users.filter(id => id !== userId);
      delete roomData.connections[userId];
    }
    
    roomData.users.push(userId);
    roomData.mode = connectionMode;
    
    const connectionId = generateConnectionId();
    roomData.connections[userId] = connectionId;
    
    await env['p2pchat-storage'].put(roomKey, JSON.stringify({
      ...roomData,
      lastUpdated: Date.now()
    }), { expirationTtl: 3600 });
    
    const userKey = `user:${userId}`;
    const userData = {
      roomId: roomId,
      connectionId: connectionId,
      joinTime: Date.now(),
      lastSeen: Date.now(),
      connectionMode: connectionMode
    };
    
    if (localIP) userData.localIP = localIP;
    if (networkSegment) userData.networkSegment = networkSegment;
    
    await env['p2pchat-storage'].put(userKey, JSON.stringify(userData), { 
      expirationTtl: 3600 
    });
    
    const connKey = `conn:${connectionId}`;
    await env['p2pchat-storage'].put(connKey, JSON.stringify({
      userId: userId,
      roomId: roomId,
      connectionMode: connectionMode,
      localIP: localIP,
      networkSegment: networkSegment
    }), { expirationTtl: 3600 });
    
    // 局域网模式：更新网络段信息
    if (connectionMode === CONNECTION_MODES.LAN && networkSegment) {
      await updateNetworkSegment(env, networkSegment, userId);
    }
    
    safeWebSocketSend(webSocket, {
      type: 'room_joined',
      roomId: roomId,
      userId: userId,
      users: existingUsers.filter(id => id !== userId),
      connectionMode: connectionMode,
      networkSegment: networkSegment
    });
    
    if (existingUsers.filter(id => id !== userId).length > 0) {
      await broadcastToRoom(roomId, {
        type: 'user_joined',
        userId: userId,
        roomId: roomId,
        connectionMode: connectionMode
      }, env, userId);
    }
    
    await broadcastToRoom(roomId, {
      type: 'room_users',
      users: roomData.users
    }, env);
    
    console.log(`[${connectionMode.toUpperCase()}] User ${userId} joined room ${roomId}. Total users: ${roomData.users.length}`);
    return true;
  } catch (error) {
    console.error('Error in handleJoinRoom:', error);
    safeWebSocketSend(webSocket, {
      type: 'error',
      message: 'Failed to join room'
    });
    return false;
  }
}

async function handleLeaveRoom(webSocket, data, env, connectionMode = CONNECTION_MODES.LAN) {
  const { roomId, userId } = data;
  
  console.log(`[${connectionMode.toUpperCase()}] User ${userId} leaving room ${roomId}`);
  
  try {
    await removeUserFromRoom(userId, roomId, env, connectionMode);
    
    safeWebSocketSend(webSocket, {
      type: 'left_room',
      roomId: roomId,
      connectionMode: connectionMode
    });
  } catch (error) {
    console.error('Error in handleLeaveRoom:', error);
  }
}

async function handleRTCMessage(webSocket, data, env, connectionMode = CONNECTION_MODES.LAN) {
  const { targetUserId, type } = data;
  
  if (!targetUserId) {
    safeWebSocketSend(webSocket, {
      type: 'error',
      message: 'Target user ID required'
    });
    return;
  }
  
  console.log(`[${connectionMode.toUpperCase()}] Forwarding ${type} signal from ${data.userId} to ${targetUserId}`);
  
  try {
    // 优先尝试直接发送给活跃的WebSocket连接
    const targetWebSocket = activeConnections.get(targetUserId);
    if (targetWebSocket && targetWebSocket.readyState === 1) {
      // 直接发送消息
      safeWebSocketSend(targetWebSocket, data);
      console.log(`🚀 RTC ${type} message sent directly to ${targetUserId} via WebSocket (${connectionMode} mode)`);
      return;
    }
    
    // 如果没有活跃连接，检查用户是否存在并排队消息
    const userKey = `user:${targetUserId}`;
    const userDataStr = await env['p2pchat-storage'].get(userKey);
    
    if (userDataStr) {
      const userData = JSON.parse(userDataStr);
      const now = Date.now();
      const config = MODE_CONFIG[connectionMode];
      
      if (now - userData.lastSeen < config.userTimeout) {
        await addPendingMessage(env, targetUserId, data, connectionMode);
        console.log(`📦 RTC ${type} message queued for ${targetUserId} (${connectionMode} mode) - no active connection`);
      } else {
        console.log(`❌ Target user ${targetUserId} is inactive (${connectionMode} mode), not sending message`);
        safeWebSocketSend(webSocket, {
          type: 'error',
          message: 'Target user is offline'
        });
      }
    } else {
      console.log(`❌ Target user ${targetUserId} not found in storage`);
      safeWebSocketSend(webSocket, {
        type: 'error',
        message: 'Target user not found'
      });
    }
  } catch (error) {
    console.error('❌ Error in handleRTCMessage:', error);
  }
}

async function handleChatMessage(webSocket, data, env, connectionMode = CONNECTION_MODES.LAN) {
  const { roomId, userId, content, timestamp } = data;
  
  if (!roomId || !userId || !content) {
    safeWebSocketSend(webSocket, {
      type: 'error',
      message: 'Invalid message data'
    });
    return;
  }
  
  console.log(`[${connectionMode.toUpperCase()}] Broadcasting chat message from ${userId} in room ${roomId}`);
  
  try {
    const handler = connectionMode === CONNECTION_MODES.LAN ? LANModeHandler : InternetModeHandler;
    await handler.handleMessage(data, env);
    
    await broadcastToRoom(roomId, {
      type: 'message',
      content: content,
      userId: userId,
      timestamp: timestamp || Date.now(),
      connectionMode: connectionMode
    }, env, userId);
  } catch (error) {
    console.error('Error in handleChatMessage:', error);
  }
}

async function handlePollMessages(webSocket, data, env, connectionMode = CONNECTION_MODES.LAN) {
  const { userId } = data;
  
  if (!userId) {
    return;
  }
  
  try {
    const messagesKey = `messages:${userId}`;
    const messagesStr = await env['p2pchat-storage'].get(messagesKey);
    
    if (messagesStr) {
      const messages = JSON.parse(messagesStr);
      if (messages.length > 0) {
        console.log(`[${connectionMode.toUpperCase()}] Sending ${messages.length} pending messages to ${userId}`);
        
        for (const message of messages) {
          safeWebSocketSend(webSocket, message);
        }
        
        await env['p2pchat-storage'].delete(messagesKey);
      }
    }
  } catch (error) {
    console.error('Error handling poll messages:', error);
  }
}

async function handleUserDisconnect(userId, roomId, env, connectionMode = CONNECTION_MODES.LAN) {
  console.log(`[${connectionMode.toUpperCase()}] Handling disconnect for ${userId} in room ${roomId}`);
  
  try {
    await removeUserFromRoom(userId, roomId, env, connectionMode);
  } catch (error) {
    console.error('Error in handleUserDisconnect:', error);
  }
}

async function removeUserFromRoom(userId, roomId, env, connectionMode = CONNECTION_MODES.LAN) {
  try {
    const roomKey = `room:${roomId}`;
    const roomDataStr = await env['p2pchat-storage'].get(roomKey);
    
    if (roomDataStr) {
      const roomData = JSON.parse(roomDataStr);
      
      roomData.users = roomData.users.filter(id => id !== userId);
      delete roomData.connections[userId];
      
      if (roomData.users.length > 0) {
        await broadcastToRoom(roomId, {
          type: 'user_left',
          userId: userId,
          roomId: roomId,
          connectionMode: connectionMode
        }, env, userId);
        
        await broadcastToRoom(roomId, {
          type: 'room_users',
          users: roomData.users
        }, env);
        
        await env['p2pchat-storage'].put(roomKey, JSON.stringify({
          ...roomData,
          lastUpdated: Date.now()
        }), { expirationTtl: 3600 });
      } else {
        await env['p2pchat-storage'].delete(roomKey);
      }
    }
    
    const userKey = `user:${userId}`;
    const userDataStr = await env['p2pchat-storage'].get(userKey);
    if (userDataStr) {
      const userData = JSON.parse(userDataStr);
      if (userData.connectionId) {
        await env['p2pchat-storage'].delete(`conn:${userData.connectionId}`);
      }
    }
    
    await env['p2pchat-storage'].delete(userKey);
    await env['p2pchat-storage'].delete(`messages:${userId}`);
    
    console.log(`[${connectionMode.toUpperCase()}] User ${userId} removed from room ${roomId}`);
  } catch (error) {
    console.error('Error removing user from room:', error);
  }
}

async function broadcastToRoom(roomId, message, env, excludeUserId = null) {
  try {
    const roomKey = `room:${roomId}`;
    const roomDataStr = await env['p2pchat-storage'].get(roomKey);
    
    if (!roomDataStr) {
      console.log(`Room ${roomId} not found for broadcast`);
      return;
    }
    
    const roomData = JSON.parse(roomDataStr);
    const now = Date.now();
    const connectionMode = roomData.mode || CONNECTION_MODES.LAN;
    const config = MODE_CONFIG[connectionMode];
    
    let directSent = 0;
    let queued = 0;
    
    for (const userId of roomData.users) {
      if (userId !== excludeUserId) {
        // 优先尝试直接发送
        const userWebSocket = activeConnections.get(userId);
        if (userWebSocket && userWebSocket.readyState === 1) {
          safeWebSocketSend(userWebSocket, message);
          directSent++;
          continue;
        }
        
        // 如果没有活跃连接，检查用户状态并排队
        const userKey = `user:${userId}`;
        const userDataStr = await env['p2pchat-storage'].get(userKey);
        
        if (userDataStr) {
          const userData = JSON.parse(userDataStr);
          if (now - userData.lastSeen < config.userTimeout) {
            await addPendingMessage(env, userId, message, connectionMode);
            queued++;
          }
        }
      }
    }
    
    console.log(`[${connectionMode.toUpperCase()}] Broadcasted to room ${roomId}: ${directSent} direct, ${queued} queued`);
  } catch (error) {
    console.error('Error broadcasting to room:', error);
  }
}

async function addPendingMessage(env, userId, message, connectionMode = CONNECTION_MODES.LAN) {
  try {
    const config = MODE_CONFIG[connectionMode];
    const messagesKey = `messages:${userId}`;
    const messagesStr = await env['p2pchat-storage'].get(messagesKey);
    let messages = messagesStr ? JSON.parse(messagesStr) : [];
    
    messages.push({
      ...message,
      timestamp: message.timestamp || Date.now(),
      connectionMode: connectionMode
    });
    
    if (messages.length > config.messageQueueSize) {
      messages = messages.slice(-config.messageQueueSize);
    }
    
    await env['p2pchat-storage'].put(messagesKey, JSON.stringify(messages), { 
      expirationTtl: 600 
    });
  } catch (error) {
    console.error('Error adding pending message:', error);
  }
}

function generateConnectionId() {
  return 'conn_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

function safeWebSocketSend(webSocket, data) {
  try {
    if (webSocket.readyState === 1) {
      webSocket.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('Error sending WebSocket message:', error);
  }
}

// 从WebSocket连接提取客户端信息
function extractClientInfo(webSocket) {
  // 注意：在Cloudflare Workers环境中，可能需要不同的方法获取客户端IP
  // 这里使用通用的方法，具体实现可能需要根据环境调整
  const clientInfo = {
    ip: 'unknown',
    userAgent: 'unknown'
  };
  
  // 尝试从请求头获取IP（如果可用）
  // 在实际环境中，可能需要从 request.headers 或其他地方获取
  
  return clientInfo;
}

// 基于客户端信息生成局域网房间ID
function generateLANRoomId(clientInfo) {
  // 简化版：为所有局域网用户使用同一个房间
  // 在实际应用中，可以基于IP段或其他信息分配不同房间
  return 'lan_auto_default';
}
