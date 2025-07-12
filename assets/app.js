class P2PChat {
    constructor() {
        this.ws = null;
        this.peers = new Map();
        this.currentRoom = null;
        this.userId = null;
        this.isConnected = false;
        this.connectionMode = 'lan';
        this.heartbeatInterval = null;
        this.reconnectAttempts = 0;
        
        this.initializeElements();
        this.bindEvents();
        this.connectWebSocket();
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
            autoStatus: document.getElementById('autoStatus')
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
    }

    connectWebSocket() {
        try {
            this.ws = new WebSocket(WS_CONFIG.url);
            
            this.ws.onopen = () => {
                console.log('WebSocket connected to:', WS_CONFIG.url);
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
                        this.connectWebSocket();
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
                this.handleJoinedRoom(message);
                break;
            case 'user-joined':
                this.handleUserJoined(message);
                break;
            case 'user-left':
                this.handleUserLeft(message);
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

    setConnectionMode(mode) {
        this.connectionMode = mode;
        
        document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
        
        if (mode === 'lan') {
            this.elements.lanMode.classList.add('active');
            document.getElementById('autoConnectInfo').style.display = 'block';
            document.getElementById('manualConnectInfo').style.display = 'none';
            
            if (this.currentRoom) {
                this.leaveRoom();
            }
            
            if (this.isConnected) {
                this.autoConnectToLAN();
            }
        } else {
            this.elements.internetMode.classList.add('active');
            document.getElementById('autoConnectInfo').style.display = 'none';
            document.getElementById('manualConnectInfo').style.display = 'block';
            
            if (this.currentRoom) {
                this.leaveRoom();
            }
        }
    }

    autoConnectToLAN() {
        this.updateAutoStatus('🔍 正在自动连接局域网...');
        // 使用固定的默认房间名，让所有局域网用户能够相遇
        const defaultRoom = 'lan_auto_default';
        
        this.ws.send(JSON.stringify({
            type: 'join',
            room: defaultRoom
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

        this.ws.send(JSON.stringify({
            type: 'join',
            room: roomId
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
        
        this.updateRoomInfo('未连接到房间', 0);
        this.addSystemMessage('已离开房间');
    }

    handleJoinedRoom(data) {
        this.currentRoom = data.roomId || this.currentRoom;
        const users = data.users || [];
        
        console.log('Joined room:', this.currentRoom, 'with users:', users);
        
        if (this.connectionMode === 'lan') {
            this.updateAutoStatus('✅ 已自动连接到局域网');
            this.elements.roomInfo.textContent = '局域网自动连接';
        } else {
            this.elements.roomInput.style.display = 'none';
            this.elements.joinBtn.style.display = 'none';
            this.elements.leaveBtn.style.display = 'inline-block';
            this.elements.roomInfo.textContent = `房间: ${this.currentRoom}`;
        }
        
        this.elements.messageInput.disabled = false;
        this.elements.sendBtn.disabled = false;
        
        this.updateUserCount(users.length);
        this.addSystemMessage(`已加入房间${this.connectionMode === 'lan' ? '（局域网自动连接）' : ''}，当前 ${users.length} 人在线`);
        
        // Connect to existing users
        users.forEach(userId => {
            if (userId !== this.userId) {
                console.log('Creating peer connection with:', userId);
                this.createPeerConnection(userId, true);
            }
        });
    }

    handleUserJoined(data) {
        this.addSystemMessage(`用户加入房间`);
        this.updateUserCount();
        
        // Create peer connection for new user
        if (data.userId !== this.userId) {
            this.createPeerConnection(data.userId, false);
        }
    }

    handleUserLeft(data) {
        this.addSystemMessage(`用户离开房间`);
        this.updateUserCount();
        
        // Close peer connection
        if (this.peers.has(data.userId)) {
            const peerData = this.peers.get(data.userId);
            peerData.pc.close();
            this.peers.delete(data.userId);
        }
    }

    createPeerConnection(peerId, createOffer) {
        const pc = new RTCPeerConnection(RTC_CONFIG);
        const peerData = { pc, dataChannel: null };
        this.peers.set(peerId, peerData);
        
        // Create data channel
        if (createOffer) {
            const dataChannel = pc.createDataChannel('chat');
            peerData.dataChannel = dataChannel;
            this.setupDataChannel(dataChannel, peerId);
        }
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.ws.send(JSON.stringify({
                    type: 'ice-candidate',
                    target: peerId,
                    data: event.candidate
                }));
            }
        };
        
        pc.ondatachannel = (event) => {
            peerData.dataChannel = event.channel;
            this.setupDataChannel(event.channel, peerId);
        };
        
        if (createOffer) {
            pc.createOffer().then(offer => {
                pc.setLocalDescription(offer);
                this.ws.send(JSON.stringify({
                    type: 'offer',
                    target: peerId,
                    data: offer
                }));
            });
        }
        
        return pc;
    }

    setupDataChannel(dataChannel, peerId) {
        dataChannel.onopen = () => {
            console.log(`Data channel opened with ${peerId}`);
        };
        
        dataChannel.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.displayMessage(message, false);
        };
        
        dataChannel.onerror = (error) => {
            console.error(`Data channel error with ${peerId}:`, error);
        };
        
        dataChannel.onclose = () => {
            console.log(`Data channel closed with ${peerId}`);
        };
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
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isOwn ? 'message-own' : 'message-other'}`;
        
        const time = new Date(data.timestamp).toLocaleTimeString();
        messageDiv.innerHTML = `
            <div class="message-info">
                <span class="message-user">${isOwn ? '我' : '用户'}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-text">${this.escapeHtml(data.text)}</div>
        `;
        
        this.elements.chatMessages.appendChild(messageDiv);
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
        statusElement.className = 'connection-status';
        
        switch (status) {
            case 'connected':
                statusElement.classList.add('status-connected');
                statusElement.textContent = '已连接';
                break;
            case 'disconnected':
                statusElement.classList.add('status-disconnected');
                statusElement.textContent = '未连接';
                break;
            case 'error':
                statusElement.classList.add('status-error');
                statusElement.textContent = '连接错误';
                break;
        }
    }

    updateAutoStatus(text) {
        if (this.elements.autoStatus) {
            this.elements.autoStatus.textContent = text;
        }
    }

    updateRoomInfo(room, userCount) {
        this.elements.roomInfo.textContent = room;
        this.updateUserCount(userCount);
    }

    updateUserCount(count) {
        const prefix = this.connectionMode === 'lan' ? '同网段用户' : '在线用户';
        this.elements.userCount.textContent = `${prefix}: ${count || 0}`;
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