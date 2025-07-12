class P2PChat {
    constructor() {
        this.ws = null;
        this.peers = new Map();
        this.currentRoom = null;
        this.userId = null;
        this.userInfo = null;
        this.users = new Map(); // 存储所有用户信息
        this.isConnected = false;
        this.connectionMode = 'lan';
        this.heartbeatInterval = null;
        this.reconnectAttempts = 0;
        
        this.initializeElements();
        this.bindEvents();
        // 不再自动连接，等待用户输入服务器地址
        this.loadSavedServer();
    }

    initializeElements() {
        this.elements = {
            roomInput: document.getElementById('roomInput'),
            joinBtn: document.getElementById('joinBtn'),
            leaveBtn: document.getElementById('leaveBtn'),
            messageInput: document.getElementById('messageInput'),
            sendBtn: document.getElementById('sendBtn'),
            chatMessages: document.getElementById('chatMessages'),
            connectionStatus: document.getElementById('connectionStatus'),
            roomInfo: document.getElementById('roomInfo'),
            userCount: document.getElementById('userCount'),
            lanMode: document.getElementById('lanMode'),
            internetMode: document.getElementById('internetMode'),
            autoStatus: document.getElementById('autoStatus'),
            serverUrl: document.getElementById('serverUrl'),
            connectBtn: document.getElementById('connectBtn')
        };
    }

    bindEvents() {
        this.elements.joinBtn.addEventListener('click', () => this.joinRoom());
        this.elements.leaveBtn.addEventListener('click', () => this.leaveRoom());
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
        
        this.elements.roomInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        
        this.elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        this.elements.lanMode.addEventListener('click', () => this.setConnectionMode('lan'));
        this.elements.internetMode.addEventListener('click', () => this.setConnectionMode('internet'));
        this.elements.connectBtn.addEventListener('click', () => this.handleConnect());
        this.elements.serverUrl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleConnect();
        });
    }

    loadSavedServer() {
        const savedInput = localStorage.getItem('serverUrl');
        if (savedInput) {
            this.elements.serverUrl.value = savedInput;
            // 自动连接保存的服务器
            let serverUrl = savedInput;
            if (!savedInput.startsWith('ws://') && !savedInput.startsWith('wss://')) {
                serverUrl = 'wss://' + savedInput;
            }
            this.connectWebSocket(serverUrl);
        }
    }
    
    handleConnect() {
        const serverInput = this.elements.serverUrl.value.trim();
        if (!serverInput) {
            this.addSystemMessage('请输入服务器地址');
            return;
        }
        
        // 自动添加wss://前缀
        let serverUrl = serverInput;
        if (!serverInput.startsWith('ws://') && !serverInput.startsWith('wss://')) {
            serverUrl = 'wss://' + serverInput;
        }
        
        // 关闭现有连接
        if (this.ws) {
            this.ws.close();
        }
        
        // 保存原始输入（不含前缀）
        localStorage.setItem('serverUrl', serverInput);
        
        // 连接新服务器
        this.connectWebSocket(serverUrl);
    }
    
    connectWebSocket(serverUrl) {
        try {
            this.ws = new WebSocket(serverUrl || WS_CONFIG.url);
            
            this.ws.onopen = () => {
                console.log('WebSocket connected to:', serverUrl || WS_CONFIG.url);
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.updateConnectionStatus('connected');
                this.addSystemMessage('✅ 已连接到信令服务器');
                this.startHeartbeat();
                
                if (this.connectionMode === 'lan') {
                    this.autoConnectToLAN();
                }
            };
            
            this.ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                this.handleWebSocketMessage(message);
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateConnectionStatus('error');
                this.addSystemMessage('❌ 连接错误，请检查网络');
            };
            
            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                this.isConnected = false;
                this.updateConnectionStatus('disconnected');
                this.stopHeartbeat();
                this.closePeerConnections();
                
                if (this.reconnectAttempts < WS_CONFIG.maxReconnectAttempts) {
                    setTimeout(() => {
                        this.reconnectAttempts++;
                        this.connectWebSocket(serverUrl);
                    }, WS_CONFIG.reconnectDelay);
                }
            };
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            this.updateConnectionStatus('error');
        }
    }

    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'joined':
                this.userId = message.userId;
                this.userInfo = message.userInfo || this.generateUserInfo();
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
                // Heartbeat acknowledged
                break;
        }
    }
    
    generateUserInfo() {
        // 四大名著人物名字
        const names = [
            // 西游记
            '孙悟空', '唐僧', '猪八戒', '沙僧', '白龙马', '观音菩萨', '如来佛祖', '玉皇大帝', '太白金星', '哪吒',
            // 红楼梦
            '贾宝玉', '林黛玉', '薛宝钗', '王熙凤', '贾母', '刘姥姥', '史湘云', '妙玉', '晴雯', '袭人',
            // 三国演义
            '刘备', '关羽', '张飞', '诸葛亮', '曹操', '赵云', '吕布', '貂蝉', '周瑜', '小乔',
            // 水浒传
            '宋江', '林冲', '武松', '鲁智深', '李逵', '燕青', '潘金莲', '孙二娘', '扈三娘', '时迁'
        ];
        
        const name = names[Math.floor(Math.random() * names.length)];
        
        // 使用 DiceBear API 生成随机头像
        const seed = Math.random().toString(36).substring(2, 15);
        const avatar = `https://api.dicebear.com/7.x/adventurer/svg?seed=${seed}`;
        
        return { name, avatar };
    }

    setConnectionMode(mode) {
        // 如果模式没有改变，不做任何操作
        if (this.connectionMode === mode) return;
        
        this.connectionMode = mode;
        
        // 清空聊天记录
        this.clearChatMessages();
        
        // 关闭所有P2P连接
        this.closePeerConnections();
        
        // 更新UI
        document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
        
        if (mode === 'lan') {
            this.elements.lanMode.classList.add('active');
            document.getElementById('autoConnectInfo').style.display = 'block';
            document.getElementById('manualConnectInfo').style.display = 'none';
            
            // 先离开当前房间（如果有）
            if (this.currentRoom) {
                this.currentRoom = null;
            }
            
            // 立即尝试自动连接
            if (this.isConnected) {
                this.autoConnectToLAN();
            }
        } else {
            this.elements.internetMode.classList.add('active');
            document.getElementById('autoConnectInfo').style.display = 'none';
            document.getElementById('manualConnectInfo').style.display = 'block';
            
            // 离开当前房间
            if (this.currentRoom) {
                this.currentRoom = null;
            }
            
            // 重置UI状态
            this.elements.roomInput.style.display = 'inline-block';
            this.elements.joinBtn.style.display = 'inline-block';
            this.elements.leaveBtn.style.display = 'none';
            this.elements.messageInput.disabled = true;
            this.elements.sendBtn.disabled = true;
            this.updateRoomInfo('未连接到房间');
        }
        
        this.addSystemMessage(`已切换到${mode === 'lan' ? '局域网' : '公网'}模式`);
    }
    
    clearChatMessages() {
        // 保留第一条欢迎消息
        const messages = this.elements.chatMessages.querySelectorAll('.message');
        messages.forEach((msg, index) => {
            if (index > 0) {  // 跳过第一条
                msg.remove();
            }
        });
    }

    autoConnectToLAN() {
        // 使用固定的默认房间名，让所有局域网用户能够相遇
        const defaultRoom = 'lan_auto_default';
        
        // 生成用户信息
        if (!this.userInfo) {
            this.userInfo = this.generateUserInfo();
        }
        
        this.ws.send(JSON.stringify({
            type: 'join',
            room: defaultRoom,
            userInfo: this.userInfo
        }));
    }

    joinRoom() {
        const roomId = this.elements.roomInput.value.trim();
        if (!roomId) {
            this.addSystemMessage('请输入房间号');
            return;
        }

        if (!this.isConnected) {
            this.addSystemMessage('WebSocket未连接，请稍后再试');
            return;
        }

        // 先离开当前房间（如果有）
        if (this.currentRoom) {
            // 只清理本地状态，不发送leave消息
            this.closePeerConnections();
            this.currentRoom = null;
        }

        // 生成用户信息
        if (!this.userInfo) {
            this.userInfo = this.generateUserInfo();
        }
        
        // 加入新房间
        this.ws.send(JSON.stringify({
            type: 'join',
            room: roomId,
            userInfo: this.userInfo
        }));
    }

    leaveRoom() {
        if (!this.currentRoom) return;
        
        this.closePeerConnections();
        this.currentRoom = null;
        
        this.elements.roomInput.style.display = 'inline-block';
        this.elements.joinBtn.style.display = 'inline-block';
        this.elements.leaveBtn.style.display = 'none';
        this.elements.messageInput.disabled = true;
        this.elements.sendBtn.disabled = true;
        
        this.updateRoomInfo('未连接到房间');
        this.addSystemMessage('已离开房间');
    }

    handleJoinedRoom(data) {
        this.currentRoom = data.roomId || this.currentRoom;
        const users = data.users || [];
        const usersInfo = data.usersInfo || {};
        
        console.log('Joined room:', this.currentRoom, 'with users:', users);
        
        // 更新用户列表
        this.users.clear();
        for (const [userId, userInfo] of Object.entries(usersInfo)) {
            this.users.set(userId, userInfo);
        }
        // 添加自己
        this.users.set(this.userId, this.userInfo);
        
        if (this.connectionMode === 'lan') {
            this.elements.roomInfo.textContent = '局域网房间';
        } else {
            this.elements.roomInput.style.display = 'none';
            this.elements.joinBtn.style.display = 'none';
            this.elements.leaveBtn.style.display = 'inline-block';
            this.elements.roomInfo.textContent = `房间: ${this.currentRoom}`;
        }
        
        this.elements.messageInput.disabled = false;
        this.elements.sendBtn.disabled = false;
        
        this.updateUserList();
        this.addSystemMessage(`${this.userInfo.name} 加入了房间`);
        
        // Connect to existing users
        users.forEach(userId => {
            if (userId !== this.userId) {
                console.log('Creating peer connection with:', userId);
                this.createPeerConnection(userId, true);
            }
        });
    }

    handleUserJoined(data) {
        // 更新用户信息
        if (data.userInfo) {
            this.users.set(data.userId, data.userInfo);
        }
        
        const userInfo = this.users.get(data.userId);
        const userName = userInfo ? userInfo.name : '用户';
        this.addSystemMessage(`${userName} 加入了房间`);
        this.updateUserList();
        
        // Create peer connection for new user
        if (data.userId !== this.userId) {
            this.createPeerConnection(data.userId, false);
        }
    }

    handleUserLeft(data) {
        const userInfo = this.users.get(data.userId);
        const userName = userInfo ? userInfo.name : '用户';
        this.addSystemMessage(`${userName} 离开了房间`);
        
        // 从用户列表中移除
        this.users.delete(data.userId);
        this.updateUserList();
        
        // Close peer connection
        if (this.peers.has(data.userId)) {
            const peerData = this.peers.get(data.userId);
            peerData.pc.close();
            this.peers.delete(data.userId);
        }
    }

    createPeerConnection(peerId, createOffer) {
        console.log(`Creating peer connection with ${peerId}, createOffer: ${createOffer}`);
        const pc = new RTCPeerConnection(RTC_CONFIG);
        const peerData = { pc, dataChannel: null };
        this.peers.set(peerId, peerData);
        
        // Monitor connection state
        pc.onconnectionstatechange = () => {
            console.log(`Connection state with ${peerId}: ${pc.connectionState}`);
            if (pc.connectionState === 'connected') {
                this.addSystemMessage(`✅ 已与用户建立P2P连接`);
            } else if (pc.connectionState === 'failed') {
                this.addSystemMessage(`❌ 与用户的P2P连接失败`);
            }
        };
        
        // Create data channel
        if (createOffer) {
            const dataChannel = pc.createDataChannel('chat');
            peerData.dataChannel = dataChannel;
            this.setupDataChannel(dataChannel, peerId);
        }
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`Sending ICE candidate to ${peerId}`);
                this.ws.send(JSON.stringify({
                    type: 'ice-candidate',
                    target: peerId,
                    data: event.candidate
                }));
            }
        };
        
        pc.ondatachannel = (event) => {
            console.log(`Received data channel from ${peerId}`);
            peerData.dataChannel = event.channel;
            this.setupDataChannel(event.channel, peerId);
        };
        
        if (createOffer) {
            pc.createOffer().then(offer => {
                console.log(`Creating offer for ${peerId}`);
                pc.setLocalDescription(offer);
                this.ws.send(JSON.stringify({
                    type: 'offer',
                    target: peerId,
                    data: offer
                }));
            }).catch(error => {
                console.error(`Failed to create offer for ${peerId}:`, error);
            });
        }
        
        return pc;
    }

    setupDataChannel(dataChannel, peerId) {
        dataChannel.onopen = () => {
            console.log(`Data channel opened with ${peerId}`);
            this.addSystemMessage(`💬 数据通道已建立，可以开始聊天`);
            // 更新界面状态
            this.updateChannelStatus();
            // 更新用户列表的连接状态
            this.renderUserList();
        };
        
        dataChannel.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.displayMessage(message, false);
        };
        
        dataChannel.onerror = (error) => {
            console.error(`Data channel error with ${peerId}:`, error);
            this.addSystemMessage(`⚠️ 数据通道错误`);
        };
        
        dataChannel.onclose = () => {
            console.log(`Data channel closed with ${peerId}`);
            this.updateChannelStatus();
            // 更新用户列表的连接状态
            this.renderUserList();
        };
    }
    
    updateChannelStatus() {
        // 检查是否有任何活跃的数据通道
        let hasActiveChannel = false;
        this.peers.forEach(peerData => {
            if (peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
                hasActiveChannel = true;
            }
        });
        
        // 根据通道状态更新UI
        if (hasActiveChannel) {
            this.elements.messageInput.placeholder = '输入消息...';
        } else {
            this.elements.messageInput.placeholder = '等待建立P2P连接...';
        }
    }

    handleOffer(data) {
        const pc = this.createPeerConnection(data.from, false);
        
        pc.setRemoteDescription(new RTCSessionDescription(data.data))
            .then(() => pc.createAnswer())
            .then(answer => {
                pc.setLocalDescription(answer);
                this.ws.send(JSON.stringify({
                    type: 'answer',
                    target: data.from,
                    data: answer
                }));
            });
    }

    handleAnswer(data) {
        const peerData = this.peers.get(data.from);
        if (peerData) {
            peerData.pc.setRemoteDescription(new RTCSessionDescription(data.data));
        }
    }

    handleIceCandidate(data) {
        const peerData = this.peers.get(data.from);
        if (peerData) {
            peerData.pc.addIceCandidate(new RTCIceCandidate(data.data));
        }
    }

    sendMessage() {
        const message = this.elements.messageInput.value.trim();
        if (!message) return;
        
        const messageData = {
            text: message,
            userId: this.userId,
            userInfo: this.userInfo,
            timestamp: Date.now()
        };
        
        // Send to all peers
        this.peers.forEach((peerData, peerId) => {
            const dataChannel = peerData.dataChannel;
            if (dataChannel && dataChannel.readyState === 'open') {
                dataChannel.send(JSON.stringify(messageData));
            }
        });
        
        // Display own message
        this.displayMessage(messageData, true);
        this.elements.messageInput.value = '';
    }

    displayMessage(data, isOwn) {
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${isOwn ? 'own' : 'other'}`;
        
        const userInfo = data.userInfo || this.users.get(data.userId) || { 
            name: '未知用户', 
            avatar: 'https://api.dicebear.com/7.x/adventurer/svg?seed=unknown' 
        };
        
        const time = new Date(data.timestamp).toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        // 为他人消息创建头部信息（头像 + 名字 + 时间）
        if (!isOwn) {
            const messageHeader = document.createElement('div');
            messageHeader.className = 'message-header';
            
            const avatar = document.createElement('img');
            avatar.className = 'message-avatar';
            avatar.src = userInfo.avatar;
            avatar.alt = userInfo.name;
            
            const headerText = document.createElement('div');
            headerText.className = 'message-header-text';
            headerText.innerHTML = `<span class="message-name">${userInfo.name}</span><span class="message-time">${time}</span>`;
            
            messageHeader.appendChild(avatar);
            messageHeader.appendChild(headerText);
            messageWrapper.appendChild(messageHeader);
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isOwn ? 'message-own' : 'message-other'}`;
        
        // 消息文本
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.textContent = data.text;
        messageDiv.appendChild(textDiv);
        
        // 自己的消息时间放在气泡外面
        if (isOwn) {
            const timeDiv = document.createElement('div');
            timeDiv.className = 'message-timestamp';
            timeDiv.textContent = time;
            messageWrapper.appendChild(messageDiv);
            messageWrapper.appendChild(timeDiv);
        } else {
            messageWrapper.appendChild(messageDiv);
        }
        
        this.elements.chatMessages.appendChild(messageWrapper);
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }

    addSystemMessage(text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message message-system';
        messageDiv.textContent = text;
        
        this.elements.chatMessages.appendChild(messageDiv);
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }

    updateConnectionStatus(status) {
        const statusElement = this.elements.connectionStatus;
        const statusText = statusElement.querySelector('.status-text');
        statusElement.className = 'connection-status';
        
        switch (status) {
            case 'connected':
                statusElement.classList.add('status-connected');
                if (statusText) statusText.textContent = '已连接';
                break;
            case 'disconnected':
                statusElement.classList.add('status-disconnected');
                if (statusText) statusText.textContent = '未连接';
                break;
            case 'error':
                statusElement.classList.add('status-error');
                if (statusText) statusText.textContent = '连接错误';
                break;
        }
    }

    updateAutoStatus(text) {
        if (this.elements.autoStatus) {
            this.elements.autoStatus.textContent = text;
        }
    }

    updateRoomInfo(room) {
        this.elements.roomInfo.textContent = room;
    }

    updateUserList(usersList) {
        // 如果提供了新的用户列表，更新本地存储
        if (usersList) {
            this.users.clear();
            for (const [userId, userInfo] of Object.entries(usersList)) {
                this.users.set(userId, userInfo);
            }
        }
        
        // 更新用户数
        const count = this.users.size;
        const prefix = this.connectionMode === 'lan' ? '同网段用户' : '在线用户';
        this.elements.userCount.textContent = `${prefix}: ${count}`;
        
        // 更新用户列表显示
        this.renderUserList();
    }
    
    renderUserList() {
        // 创建或更新用户列表容器
        let userListContainer = document.getElementById('userListContainer');
        if (!userListContainer) {
            userListContainer = document.createElement('div');
            userListContainer.id = 'userListContainer';
            userListContainer.className = 'user-list-container';
            
            // 插入到房间控制区域
            const roomSection = document.querySelector('.room-section');
            roomSection.appendChild(userListContainer);
        }
        
        // 构建用户列表HTML
        const userItems = Array.from(this.users.entries()).map(([userId, userInfo]) => {
            const isConnected = this.peers.has(userId) && 
                               this.peers.get(userId).dataChannel && 
                               this.peers.get(userId).dataChannel.readyState === 'open';
            const isSelf = userId === this.userId;
            
            return `
                <div class="user-item ${isSelf ? 'user-self' : ''} ${isConnected || isSelf ? 'user-connected' : ''}">
                    <img class="user-avatar-small" src="${userInfo.avatar}" alt="${userInfo.name}">
                    <span class="user-name">${userInfo.name}${isSelf ? ' (我)' : ''}</span>
                </div>
            `;
        }).join('');
        
        userListContainer.innerHTML = `
            <div class="user-list">
                ${userItems}
            </div>
        `;
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'heartbeat' }));
            }
        }, WS_CONFIG.heartbeatInterval);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    closePeerConnections() {
        this.peers.forEach(peerData => peerData.pc.close());
        this.peers.clear();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize chat when page loads
document.addEventListener('DOMContentLoaded', () => {
    new P2PChat();
});