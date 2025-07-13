/**
 * 模式选择器 - 负责WebSocket连接管理和模式切换
 * 实现了单例WebSocket连接，支持LAN和Internet模式无缝切换
 */
class ModeSelector {
    constructor() {
        // 模式状态
        this.currentMode = 'lan';
        this.chatModeInstance = null;
        this.isInitialized = false;
        
        // WebSocket连接状态
        this.websocket = null;
        this.isWebSocketConnected = false;
        this.reconnectionAttempts = 0;
        this.currentServerIndex = 0;
        this.availableServers = [];
        this.heartbeatTimer = null;
        
        // 等待DOM加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }
    
    async init() {
        this.initializeElements();
        this.bindEvents();
        
        // 先建立WebSocket连接
        await this.connectToAvailableServer();
        
        // 默认加载局域网模式
        await this.loadMode('lan');
        this.isInitialized = true;
    }
    
    /**
     * 初始化DOM元素引用
     */
    initializeElements() {
        this.elements = {
            lanModeButton: document.getElementById('lanMode'),
            internetModeButton: document.getElementById('internetMode'),
            internetRoomControls: document.getElementById('internetRoomControls'),
            lanStatus: document.getElementById('lanStatus')
        };
    }
    
    /**
     * 绑定事件监听器
     */
    bindEvents() {
        this.elements.lanModeButton.addEventListener('click', () => this.switchMode('lan'));
        this.elements.internetModeButton.addEventListener('click', () => this.switchMode('internet'));
    }
    
    // WebSocket连接管理
    async connectToAvailableServer() {
        try {
            if (!WS_CONFIG.servers || WS_CONFIG.servers.length === 0) {
                this.showNotification('❌ 没有可用的服务器配置');
                return;
            }
            
            // Convert server URLs to objects with priority if needed
            this.availableServers = WS_CONFIG.servers.map((server, index) => {
                if (typeof server === 'string') {
                    return { url: server, priority: index + 1 };
                }
                return server;
            });
            this.tryNextServer();
        } catch (error) {
            console.error('Failed to load server list:', error);
            this.showNotification('❌ 加载服务器列表失败');
        }
    }
    
    tryNextServer() {
        if (this.currentServerIndex >= this.availableServers.length) {
            this.showNotification('❌ 所有服务器都不可用');
            this.currentServerIndex = 0;
            return;
        }
        
        const server = this.availableServers[this.currentServerIndex];
        const serverUrl = server.url;
        console.log(`Trying server ${this.currentServerIndex + 1}/${this.availableServers.length}: ${server.name || serverUrl}`);
        this.showNotification(`🔄 连接到 ${server.name || '服务器'}...`);
        this.connectWebSocket(serverUrl);
    }
    
    connectWebSocket(serverUrl) {
        try {
            this.websocket = new WebSocket(serverUrl || WS_CONFIG.url);
            
            this.websocket.onopen = () => {
                console.log('WebSocket connected to:', serverUrl || WS_CONFIG.url);
                this.isWebSocketConnected = true;
                this.reconnectionAttempts = 0;
                this.currentServerIndex = 0;
                this.showNotification('✅ 已连接到信令服务器');
                this.startHeartbeat();
                
                // 通知当前模式WebSocket已连接
                if (this.chatModeInstance && this.chatModeInstance.onWebSocketConnected) {
                    this.chatModeInstance.onWebSocketConnected();
                }
            };
            
            this.websocket.onmessage = (event) => {
                const message = JSON.parse(event.data);
                // 将消息转发给当前模式处理
                if (this.chatModeInstance && this.chatModeInstance.handleWebSocketMessage) {
                    this.chatModeInstance.handleWebSocketMessage(message);
                }
            };
            
            this.websocket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.showNotification('❌ 连接错误，尝试下一个服务器...');
                
                this.currentServerIndex++;
                setTimeout(() => this.tryNextServer(), WS_CONFIG.serverSwitchDelay);
            };
            
            this.websocket.onclose = () => {
                console.log('WebSocket disconnected');
                this.isWebSocketConnected = false;
                this.stopHeartbeat();
                
                // 通知当前模式WebSocket已断开
                if (this.chatModeInstance && this.chatModeInstance.onWebSocketDisconnected) {
                    this.chatModeInstance.onWebSocketDisconnected();
                }
                
                if (this.reconnectionAttempts < WS_CONFIG.maxReconnectAttempts) {
                    this.showNotification(`🔄 重连中... (${this.reconnectionAttempts + 1}/${WS_CONFIG.maxReconnectAttempts})`);
                    setTimeout(() => {
                        this.reconnectionAttempts++;
                        this.connectWebSocket(serverUrl);
                    }, WS_CONFIG.reconnectDelay);
                } else {
                    this.reconnectionAttempts = 0;
                    this.currentServerIndex++;
                    this.showNotification('⚠️ 连接失败，尝试下一个服务器...');
                    setTimeout(() => this.tryNextServer(), WS_CONFIG.serverSwitchDelay);
                }
            };
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
        }
    }
    
    /**
     * 发送WebSocket消息
     * @param {Object} data - 要发送的数据
     */
    sendWebSocketMessage(data) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify(data));
        } else {
            console.error('WebSocket is not connected');
        }
    }
    
    /**
     * 启动心跳检测
     */
    startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                this.websocket.send(JSON.stringify({ type: 'heartbeat' }));
            }
        }, 30000);
    }
    
    /**
     * 停止心跳检测
     */
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    
    // 模式管理
    async loadMode(mode) {
        try {
            // 清理当前模式状态（但不断开WebSocket）
            if (this.chatModeInstance) {
                this.cleanupMode();
            }
            
            // 更新UI
            this.updateUI(mode);
            
            // 动态加载对应的脚本
            if (mode === 'lan') {
                if (!window.LANMode) {
                    await this.loadScript('assets/lan.js');
                }
                    // 创建实例时传入发送消息的方法
                this.chatModeInstance = new window.LANMode(
                    (data) => this.sendWebSocketMessage(data),
                    this.isWebSocketConnected
                );
            } else {
                if (!window.InternetMode) {
                    await this.loadScript('assets/net.js');
                }
                this.chatModeInstance = new window.InternetMode(
                    (data) => this.sendWebSocketMessage(data),
                    this.isWebSocketConnected
                );
            }
            
            // 如果WebSocket已连接，通知新模式
            if (this.isWebSocketConnected && this.chatModeInstance.onWebSocketConnected) {
                this.chatModeInstance.onWebSocketConnected();
            }
            
            this.currentMode = mode;
            console.log(`Loaded ${mode} mode`);
            
        } catch (error) {
            console.error(`Failed to load ${mode} mode:`, error);
            this.showNotification(`❌ 加载${mode === 'lan' ? '局域网' : '公网'}模式失败`);
        }
    }
    
    loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    switchMode(mode) {
        if (mode === this.currentMode) return;
        
        this.showNotification(`切换到${mode === 'lan' ? '局域网' : '公网'}模式...`);
        this.loadMode(mode);
    }
    
    /**
     * 清理当前模式实例
     */
    cleanupMode() {
        if (!this.chatModeInstance) return;
        
        // 调用模式的清理方法
        if (this.chatModeInstance.cleanup) {
            this.chatModeInstance.cleanup();
        }
        
        this.chatModeInstance = null;
    }
    
    updateUI(mode) {
        // 更新按钮状态
        document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
        
        if (mode === 'lan') {
            this.elements.lanModeButton.classList.add('active');
            this.elements.lanStatus.style.display = 'block';
            this.elements.internetRoomControls.style.display = 'none';
            
            const messageInput = document.getElementById('messageInput');
            if (messageInput) {
                messageInput.placeholder = '检测到同网段用户后即可开始聊天...';
            }
        } else {
            this.elements.internetModeButton.classList.add('active');
            this.elements.lanStatus.style.display = 'none';
            this.elements.internetRoomControls.style.display = 'flex';
            
            const messageInput = document.getElementById('messageInput');
            if (messageInput) {
                messageInput.placeholder = '加入房间后即可开始聊天...';
            }
        }
        
        // 清空聊天记录
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
            chatMessages.innerHTML = '';
        }
        
        // 清空用户列表
        const userListContainer = document.getElementById('userListContainer');
        if (userListContainer) {
            userListContainer.innerHTML = '';
        }
    }
    
    showNotification(text) {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = text;
        
        const existingNotifications = document.querySelectorAll('.notification:not(.notification-exit)');
        const offset = existingNotifications.length * 60;
        notification.style.top = `${20 + offset}px`;
        
        document.body.appendChild(notification);
        
        setTimeout(() => notification.classList.add('notification-show'), 10);
        
        setTimeout(() => {
            notification.classList.add('notification-exit');
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }
}

/**
 * 基础聊天模式类 - 包含所有模式共享的功能
 */
class BaseChatMode {
    constructor(sendWebSocketMessage, isWebSocketConnected) {
        this.sendWebSocketMessage = sendWebSocketMessage;
        this.isWebSocketConnected = isWebSocketConnected;
        
        // P2P 连接管理
        this.peerConnections = new Map();
        this.currentRoomId = null;
        this.currentUserId = null;
        this.currentUserInfo = null;
        this.roomUsers = new Map();
    }

    // 共享的DOM元素初始化
    initializeSharedElements() {
        return {
            messageInput: document.getElementById('messageInput'),
            sendButton: document.getElementById('sendBtn'),
            chatMessages: document.getElementById('chatMessages'),
            connectionStatus: document.getElementById('connectionStatus')
        };
    }

    // 共享的事件绑定
    bindSharedEvents() {
        this.domElements.sendButton.addEventListener('click', () => this.sendChatMessage());
        this.domElements.messageInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') this.sendChatMessage();
        });
    }

    // WebSocket连接管理
    onWebSocketConnected() {
        this.isWebSocketConnected = true;
        this.updateConnectionStatus('connected');
    }

    onWebSocketDisconnected() {
        this.isWebSocketConnected = false;
        this.updateConnectionStatus('disconnected');
        this.closePeerConnections();
    }

    // WebSocket消息处理
    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'joined':
                this.currentUserId = message.userId;
                this.currentUserInfo = message.userInfo || this.generateUserInfo();
                this.handleJoinedRoom(message);
                break;
            case 'user-joined':
                this.handleUserJoined(message);
                break;
            case 'user-left':
                this.handleUserLeft(message);
                break;
            case 'user-list':
                this.updateUserList(message.users);
                break;
            case 'offer':
                this.handleOffer(message);
                break;
            case 'answer':
                this.handleAnswer(message);
                break;
            case 'ice-candidate':
                this.handleIceCandidate(message);
                break;
            case 'heartbeat-ack':
                break;
        }
    }

    // 用户管理
    handleUserJoined(data) {
        if (data.userInfo) {
            this.roomUsers.set(data.userId, data.userInfo);
        }
        
        const userInfo = this.roomUsers.get(data.userId);
        const userName = userInfo ? userInfo.name : '用户';
        this.showNotification(`👋 ${userName} 加入了房间`);
        this.updateUserList();
        
        if (data.userId !== this.currentUserId) {
            this.createPeerConnection(data.userId, false);
        }
    }

    handleUserLeft(data) {
        const userInfo = this.roomUsers.get(data.userId);
        const userName = userInfo ? userInfo.name : '用户';
        this.showNotification(`👋 ${userName} 离开了房间`);
        
        this.roomUsers.delete(data.userId);
        this.updateUserList();
        
        if (this.peerConnections.has(data.userId)) {
            const peerData = this.peerConnections.get(data.userId);
            peerData.pc.close();
            this.peerConnections.delete(data.userId);
        }
    }

    // P2P连接管理
    createPeerConnection(peerId, createOffer) {
        console.log(`Creating peer connection with ${this.formatUserId(peerId)}, createOffer: ${createOffer}`);
        const pc = new RTCPeerConnection(RTC_CONFIG);
        const peerData = { pc, dataChannel: null };
        this.peerConnections.set(peerId, peerData);
        
        pc.onconnectionstatechange = () => {
            console.log(`Connection state with ${this.formatUserId(peerId)}: ${pc.connectionState}`);
            if (pc.connectionState === 'connected') {
                this.showNotification(`✅ 已与用户建立P2P连接`);
            } else if (pc.connectionState === 'failed') {
                this.showNotification(`❌ 与用户的P2P连接失败`);
            }
        };
        
        if (createOffer) {
            const dataChannel = pc.createDataChannel('chat');
            peerData.dataChannel = dataChannel;
            this.setupDataChannel(dataChannel, peerId);
        }
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`Sending ICE candidate to ${this.formatUserId(peerId)}`);
                this.sendWebSocketMessage({
                    type: 'ice-candidate',
                    target: peerId,
                    data: event.candidate
                });
            }
        };
        
        pc.ondatachannel = (event) => {
            console.log(`Received data channel from ${this.formatUserId(peerId)}`);
            peerData.dataChannel = event.channel;
            this.setupDataChannel(event.channel, peerId);
        };
        
        if (createOffer) {
            pc.createOffer().then(offer => {
                console.log(`Creating offer for ${this.formatUserId(peerId)}`);
                pc.setLocalDescription(offer);
                this.sendWebSocketMessage({
                    type: 'offer',
                    target: peerId,
                    data: offer
                });
            }).catch(error => {
                console.error(`Failed to create offer for ${this.formatUserId(peerId)}:`, error);
            });
        }
        
        return pc;
    }

    setupDataChannel(dataChannel, peerId) {
        dataChannel.onopen = () => {
            console.log(`Data channel opened with ${this.formatUserId(peerId)}`);
            this.showNotification(`💬 数据通道已建立，可以开始聊天`);
            this.updateChannelStatus();
            this.renderUserList();
        };
        
        dataChannel.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.displayMessage(message, false);
        };
        
        dataChannel.onerror = (error) => {
            console.error(`Data channel error with ${this.formatUserId(peerId)}:`, error);
            this.showNotification(`⚠️ 数据通道错误`);
        };
        
        dataChannel.onclose = () => {
            console.log(`Data channel closed with ${this.formatUserId(peerId)}`);
            this.updateChannelStatus();
            this.renderUserList();
        };
    }

    updateChannelStatus() {
        this.renderUserList();
    }

    handleOffer(data) {
        const pc = this.createPeerConnection(data.from, false);
        
        pc.setRemoteDescription(new RTCSessionDescription(data.data))
            .then(() => pc.createAnswer())
            .then(answer => {
                pc.setLocalDescription(answer);
                this.sendWebSocketMessage({
                    type: 'answer',
                    target: data.from,
                    data: answer
                });
            });
    }

    handleAnswer(data) {
        const peerData = this.peerConnections.get(data.from);
        if (peerData) {
            peerData.pc.setRemoteDescription(new RTCSessionDescription(data.data));
        }
    }

    handleIceCandidate(data) {
        const peerData = this.peerConnections.get(data.from);
        if (peerData) {
            peerData.pc.addIceCandidate(new RTCIceCandidate(data.data));
        }
    }

    // 消息功能
    sendChatMessage() {
        const message = this.domElements.messageInput.value.trim();
        if (!message) return;
        
        const messageData = {
            text: message,
            userId: this.currentUserId,
            userInfo: this.currentUserInfo,
            timestamp: Date.now()
        };
        
        let sentToAnyPeer = false;
        this.peerConnections.forEach((peerData) => {
            if (peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
                peerData.dataChannel.send(JSON.stringify(messageData));
                sentToAnyPeer = true;
            }
        });
        
        this.displayMessage(messageData, true);
        this.domElements.messageInput.value = '';
        
        if (!sentToAnyPeer && this.roomUsers.size <= 1) {
            this.showNotification('💡 当前只有您在房间中');
        }
    }

    displayMessage(data, isOwn) {
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${isOwn ? 'own' : 'other'}`;
        
        const messageHeader = document.createElement('div');
        messageHeader.className = 'message-header';
        
        const avatar = document.createElement('img');
        avatar.className = 'message-avatar';
        avatar.src = data.userInfo.avatar;
        avatar.alt = data.userInfo.name;
        
        const headerText = document.createElement('div');
        headerText.className = 'message-header-text';
        
        const name = document.createElement('span');
        name.className = 'message-name';
        name.textContent = data.userInfo.name;
        
        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = new Date(data.timestamp).toLocaleTimeString();
        
        headerText.appendChild(name);
        headerText.appendChild(time);
        
        messageHeader.appendChild(avatar);
        messageHeader.appendChild(headerText);
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isOwn ? 'message-own' : 'message-other'}`;
        
        const messageText = document.createElement('p');
        messageText.className = 'message-text';
        messageText.innerHTML = this.escapeHtml(data.text);
        
        messageDiv.appendChild(messageText);
        
        messageWrapper.appendChild(messageHeader);
        messageWrapper.appendChild(messageDiv);
        
        this.domElements.chatMessages.appendChild(messageWrapper);
        this.domElements.chatMessages.scrollTop = this.domElements.chatMessages.scrollHeight;
    }

    // 工具方法
    generateUserInfo() {
        const names = [
            '孙悟空', '唐僧', '猪八戒', '沙僧', '白龙马', '观音菩萨', '如来佛祖', '玉皇大帝', '太白金星', '哪吒',
            '贾宝玉', '林黛玉', '薛宝钗', '王熙凤', '贾母', '刘姥姥', '史湘云', '妙玉', '晴雯', '袭人',
            '刘备', '关羽', '张飞', '诸葛亮', '曹操', '赵云', '吕布', '貂蝉', '周瑜', '小乔',
            '宋江', '林冲', '武松', '鲁智深', '李逵', '燕青', '潘金莲', '孙二娘', '扈三娘', '时迁'
        ];
        
        const name = names[Math.floor(Math.random() * names.length)];
        const seed = Math.random().toString(36).substring(2, 15);
        const avatar = `https://api.dicebear.com/7.x/adventurer/svg?seed=${seed}`;
        
        return { name, avatar };
    }

    formatUserId(userId) {
        if (!userId) return 'user_unknown';
        const shortId = userId.substring(0, 8).toLowerCase();
        return `user_${shortId}`;
    }

    updateUserList(usersList) {
        if (usersList) {
            this.roomUsers.clear();
            for (const [userId, userInfo] of Object.entries(usersList)) {
                this.roomUsers.set(userId, userInfo);
            }
        }
        
        this.renderUserList();
        
        if (this.isWebSocketConnected) {
            this.updateConnectionStatus('connected');
        }
    }

    renderUserList() {
        let userListContainer = document.getElementById('userListContainer');
        if (!userListContainer) {
            userListContainer = document.createElement('div');
            userListContainer.id = 'userListContainer';
            userListContainer.className = 'user-list-container';
            
            const roomSection = document.querySelector('.room-section');
            roomSection.appendChild(userListContainer);
        }
        
        const allUsers = Array.from(this.roomUsers.entries());
        const myself = allUsers.find(([userId]) => userId === this.currentUserId);
        const otherUsers = allUsers.filter(([userId]) => userId !== this.currentUserId);
        
        const sortedUsers = myself ? [myself, ...otherUsers] : otherUsers;
        
        const userItems = sortedUsers.map(([userId, userInfo]) => {
            const isConnected = this.peerConnections.has(userId) && 
                               this.peerConnections.get(userId).dataChannel && 
                               this.peerConnections.get(userId).dataChannel.readyState === 'open';
            const isSelf = userId === this.currentUserId;
            
            let selfStatus = '';
            if (isSelf) {
                let hasAnyConnection = false;
                this.peerConnections.forEach((peerData) => {
                    if (peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
                        hasAnyConnection = true;
                    }
                });
                selfStatus = hasAnyConnection ? 'connected' : 'pending';
            }
            
            const statusDot = `<span class="status-dot ${isSelf ? selfStatus : (isConnected ? 'connected' : 'pending')}"></span>`;
            
            return `
                <div class="user-item ${isSelf ? 'user-self' : ''}">
                    ${statusDot}
                    <img class="user-avatar-small" src="${userInfo.avatar}" alt="${userInfo.name}">
                    <span class="user-name">${userInfo.name}${isSelf ? ' (我)' : ''}</span>
                </div>
            `;
        }).join('');
        
        userListContainer.innerHTML = `<div class="user-list">${userItems}</div>`;
    }

    closePeerConnections() {
        this.peerConnections.forEach((peerData) => {
            peerData.pc.close();
        });
        this.peerConnections.clear();
        this.renderUserList();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showNotification(text) {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = text;
        
        const existingNotifications = document.querySelectorAll('.notification:not(.notification-exit)');
        const offset = existingNotifications.length * 60;
        notification.style.top = `${20 + offset}px`;
        
        document.body.appendChild(notification);
        
        setTimeout(() => notification.classList.add('notification-show'), 10);
        
        setTimeout(() => {
            notification.classList.add('notification-exit');
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }

    cleanup() {
        this.closePeerConnections();
        this.roomUsers.clear();
        this.currentRoomId = null;
    }

    // 抽象方法，子类需要实现
    handleJoinedRoom(data) {
        throw new Error('handleJoinedRoom must be implemented by subclass');
    }

    updateConnectionStatus(status) {
        throw new Error('updateConnectionStatus must be implemented by subclass');
    }
}

// 导出基类
window.BaseChatMode = BaseChatMode;

// 创建全局实例
window.modeSelector = new ModeSelector();