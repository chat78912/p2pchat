/**
 * 公网模式 - 轻量级版本（不含WebSocket连接）
 * 支持手动输入房间号连接到公网用户
 */
class InternetMode {
    constructor(sendWebSocketMessage, isWebSocketConnected) {
        this.sendWebSocketMessage = sendWebSocketMessage; // 从mode-selector传入的发送消息方法
        this.isWebSocketConnected = isWebSocketConnected; // 从mode-selector传入的连接状态
        
        // P2P 连接管理
        this.peerConnections = new Map();
        this.currentRoomIdId = null;
        this.currentUserId = null;
        this.currentUserInfo = null;
        this.roomUsers = new Map();
        
        this.initializeElements();
        this.bindEvents();
    }

    /**
     * 初始化DOM元素引用
     */
    initializeElements() {
        this.domElements = {
            roomInput: document.getElementById('roomInput'),
            joinButton: document.getElementById('joinBtn'),
            leaveButton: document.getElementById('leaveBtn'),
            messageInput: document.getElementById('messageInput'),
            sendButton: document.getElementById('sendBtn'),
            chatMessages: document.getElementById('chatMessages'),
            connectionStatus: document.getElementById('connectionStatus')
        };
    }

    bindEvents() {
        this.domElements.joinButton.addEventListener('click', () => this.joinRoom());
        this.domElements.leaveButton.addEventListener('click', () => this.leaveRoom());
        this.domElements.sendButton.addEventListener('click', () => this.sendChatMessage());
        
        this.domElements.roomInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        
        this.domElements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChatMessage();
        });
    }

    // 当WebSocket连接成功时调用
    onWebSocketConnected() {
        this.isWebSocketConnected = true;
        this.updateConnectionStatus('connected');
        this.showNotification('✅ 已连接到信令服务器');
    }

    // 当WebSocket断开时调用
    onWebSocketDisconnected() {
        this.isWebSocketConnected = false;
        this.updateConnectionStatus('disconnected');
        this.closePeerConnections();
    }

    joinRoom() {
        const roomId = this.domElements.roomInput.value.trim();
        if (!roomId) {
            this.showNotification('请输入房间号');
            return;
        }
        
        if (!this.isWebSocketConnected) {
            this.showNotification('WebSocket未连接，请稍后再试');
            return;
        }
        
        if (this.currentRoomId) {
            this.leaveRoom();
        }
        
        this.currentUserInfo = this.generateUserInfo();
        
        this.sendWebSocketMessage({
            type: 'join',
            room: roomId,
            userInfo: this.currentUserInfo
        });
    }

    leaveRoom() {
        if (!this.currentRoomId) return;
        
        this.sendWebSocketMessage({
            type: 'leave',
            room: this.currentRoomId
        });
        
        this.currentRoomId = null;
        this.roomUsers.clear();
        this.updateUserList();
        
        this.domElements.roomInput.style.display = 'inline-block';
        this.domElements.joinButton.style.display = 'inline-block';
        this.domElements.leaveButton.style.display = 'none';
        this.domElements.messageInput.disabled = true;
        this.domElements.sendButton.disabled = true;
        
        this.showNotification('已离开房间');
        
        if (this.isWebSocketConnected) {
            this.updateConnectionStatus('connected');
        }
    }

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

    handleJoinedRoom(data) {
        this.currentRoomId = data.roomId || this.domElements.roomInput.value.trim();
        
        const users = data.users || [];
        const usersInfo = data.usersInfo || {};
        
        console.log('Joined room:', this.currentRoomId, 'with users:', users.map(id => this.formatUserId(id)));
        
        this.roomUsers.clear();
        this.roomUsers.set(this.currentUserId, this.currentUserInfo);
        
        for (const [userId, userInfo] of Object.entries(usersInfo)) {
            if (userId !== this.currentUserId) {
                this.roomUsers.set(userId, userInfo);
            }
        }
        
        this.domElements.roomInput.style.display = 'none';
        this.domElements.joinButton.style.display = 'none';
        this.domElements.leaveButton.style.display = 'inline-block';
        this.domElements.messageInput.disabled = false;
        this.domElements.sendButton.disabled = false;
        this.domElements.messageInput.placeholder = '输入消息...';
        
        this.updateUserList();
        this.updateConnectionStatus('connected');
        
        users.forEach(userId => {
            if (userId !== this.currentUserId) {
                console.log('Creating peer connection with:', this.formatUserId(userId));
                this.createPeerConnection(userId, true);
            }
        });
    }

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

    updateConnectionStatus(status) {
        const statusElement = this.domElements.connectionStatus;
        statusElement.className = 'connection-status';
        
        let statusHtml = '';
        
        switch (status) {
            case 'connected':
                statusElement.classList.add('status-connected');
                
                let roomInfo = '';
                
                if (this.currentRoomId) {
                    const userCount = this.roomUsers.size;
                    roomInfo = `
                        <div class="status-room-info">
                            <span class="room-name">${this.currentRoomId}</span>
                            <span class="room-separator">·</span>
                            <span class="room-users">在线用户 ${userCount}</span>
                        </div>
                    `;
                }
                
                statusHtml = `
                    <div class="status-content">
                        ${roomInfo}
                        <div class="status-indicator">
                            <span class="status-dot"></span>
                            <span class="status-text">已连接</span>
                        </div>
                    </div>
                `;
                break;
            case 'disconnected':
                statusElement.classList.add('status-disconnected');
                statusHtml = `
                    <div class="status-content">
                        <div class="status-indicator">
                            <span class="status-dot"></span>
                            <span class="status-text">未连接</span>
                        </div>
                    </div>
                `;
                break;
            case 'error':
                statusElement.classList.add('status-error');
                statusHtml = `
                    <div class="status-content">
                        <div class="status-indicator">
                            <span class="status-dot"></span>
                            <span class="status-text">连接错误</span>
                        </div>
                    </div>
                `;
                break;
        }
        
        statusElement.innerHTML = statusHtml;
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
}

// 导出类供使用
window.InternetMode = InternetMode;