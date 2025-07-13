/**
 * 公网模式 - 继承自BaseChatMode
 * 支持手动输入房间号连接到公网用户
 */
class InternetMode extends BaseChatMode {
    constructor(sendWebSocketMessage, isWebSocketConnected) {
        super(sendWebSocketMessage, isWebSocketConnected);
        
        this.initializeElements();
        this.bindEvents();
    }

    /**
     * 初始化DOM元素引用
     */
    initializeElements() {
        this.domElements = {
            ...this.initializeSharedElements(),
            roomInput: document.getElementById('roomInput'),
            joinButton: document.getElementById('joinBtn'),
            leaveButton: document.getElementById('leaveBtn')
        };
    }

    bindEvents() {
        this.bindSharedEvents();
        
        this.domElements.joinButton.addEventListener('click', () => this.joinRoom());
        this.domElements.leaveButton.addEventListener('click', () => this.leaveRoom());
        
        this.domElements.roomInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
    }

    // 当WebSocket连接成功时调用
    onWebSocketConnected() {
        super.onWebSocketConnected();
        this.showNotification('✅ 已连接到信令服务器');
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
        this.domElements.attachButton.disabled = true;
        
        this.showNotification('已离开房间');
        
        if (this.isWebSocketConnected) {
            this.updateConnectionStatus('connected');
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
        this.domElements.attachButton.disabled = false;
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
}

// 导出类供使用
window.InternetMode = InternetMode;