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
        
        // 流式传输管理
        this.streamSenders = new Map();
        this.streamReceivers = new Map();
        
        // 加载流处理器
        this.loadStreamHandler();
    }

    // 加载流处理器
    async loadStreamHandler() {
        if (!window.robustStreamHandler) {
            const script = document.createElement('script');
            script.src = 'assets/robust-stream.js';
            document.head.appendChild(script);
            
            return new Promise((resolve) => {
                script.onload = resolve;
            });
        }
    }
    
    // 共享的DOM元素初始化
    initializeSharedElements() {
        return {
            messageInput: document.getElementById('messageInput'),
            sendButton: document.getElementById('sendBtn'),
            chatMessages: document.getElementById('chatMessages'),
            connectionStatus: document.getElementById('connectionStatus'),
            fileInput: document.getElementById('fileInput'),
            attachButton: document.getElementById('attachBtn')
        };
    }

    // 共享的事件绑定
    bindSharedEvents() {
        this.domElements.sendButton.addEventListener('click', () => this.sendChatMessage());
        this.domElements.messageInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') this.sendChatMessage();
        });
        
        // 输入框粘贴事件
        this.domElements.messageInput.addEventListener('paste', (event) => {
            const items = (event.clipboardData || window.clipboardData).items;
            
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                
                // 检查是否为文件
                if (item.kind === 'file') {
                    let file = item.getAsFile();
                    if (file) {
                        // 如果是粘贴的图片且没有文件名，自动生成文件名
                        if (file.type.startsWith('image/') && (!file.name || file.name === 'image.png')) {
                            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                            const extension = file.type.split('/')[1] || 'png';
                            
                            // 创建新的File对象，带有自定义名称
                            file = new File([file], `粘贴图片-${timestamp}.${extension}`, {
                                type: file.type,
                                lastModified: file.lastModified
                            });
                        }
                        
                        event.preventDefault(); // 阻止默认粘贴行为
                        this.handleFileSelection(file);
                        this.showNotification(`📎 已粘贴文件: ${file.name}`);
                        break;
                    }
                }
            }
        });
        
        // 文件相关事件
        this.domElements.attachButton.addEventListener('click', () => {
            this.domElements.fileInput.click();
        });
        
        this.domElements.fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                this.handleFileSelection(file);
            }
        });
        
        // 拖放事件处理
        this.setupDragAndDrop();
        
        // 全局粘贴支持
        this.setupGlobalPaste();
    }
    
    // 设置拖放功能
    setupDragAndDrop() {
        const chatContainer = document.querySelector('.chat-container');
        let dragOverlay = null;
        
        // 创建拖拽覆盖层
        const createDragOverlay = () => {
            if (dragOverlay) return;
            
            dragOverlay = document.createElement('div');
            dragOverlay.className = 'drag-overlay';
            dragOverlay.innerHTML = '📁 拖放文件到此处发送';
            dragOverlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(102, 126, 234, 0.95);
                color: white;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 28px;
                font-weight: 600;
                z-index: 99999;
                border: 4px dashed rgba(255, 255, 255, 0.9);
                border-radius: 20px;
                margin: 20px;
                backdrop-filter: blur(15px);
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s ease;
            `;
            
            document.body.appendChild(dragOverlay);
            
            // 强制重绘后显示
            requestAnimationFrame(() => {
                if (dragOverlay) {
                    dragOverlay.style.opacity = '1';
                }
            });
        };
        
        // 移除拖拽覆盖层
        const removeDragOverlay = () => {
            if (dragOverlay) {
                dragOverlay.style.opacity = '0';
                setTimeout(() => {
                    if (dragOverlay && dragOverlay.parentNode) {
                        document.body.removeChild(dragOverlay);
                    }
                    dragOverlay = null;
                }, 200);
            }
        };
        
        // 阻止默认拖放行为
        ['dragenter', 'dragover', 'drop'].forEach(eventName => {
            document.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });
        
        // 拖拽进入
        document.addEventListener('dragenter', (e) => {
            if (e.dataTransfer && e.dataTransfer.types && 
                e.dataTransfer.types.includes('Files')) {
                createDragOverlay();
            }
        });
        
        // 拖拽离开
        document.addEventListener('dragleave', (e) => {
            // 检查是否离开了浏览器窗口
            const rect = document.documentElement.getBoundingClientRect();
            if (e.clientX <= rect.left || e.clientX >= rect.right ||
                e.clientY <= rect.top || e.clientY >= rect.bottom) {
                removeDragOverlay();
            }
        });
        
        // 文件放置
        document.addEventListener('drop', (e) => {
            removeDragOverlay();
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileSelection(files[0]);
            }
        });
    }
    
    // 设置全局粘贴功能
    setupGlobalPaste() {
        document.addEventListener('paste', (event) => {
            // 如果当前焦点在输入框，则由输入框的粘贴事件处理
            if (document.activeElement === this.domElements.messageInput) {
                return;
            }
            
            const items = (event.clipboardData || window.clipboardData).items;
            
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                
                // 检查是否为文件
                if (item.kind === 'file') {
                    let file = item.getAsFile();
                    if (file) {
                        // 如果是粘贴的图片且没有文件名，自动生成文件名
                        if (file.type.startsWith('image/') && (!file.name || file.name === 'image.png')) {
                            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                            const extension = file.type.split('/')[1] || 'png';
                            
                            // 创建新的File对象，带有自定义名称
                            file = new File([file], `粘贴图片-${timestamp}.${extension}`, {
                                type: file.type,
                                lastModified: file.lastModified
                            });
                        }
                        
                        event.preventDefault(); // 阻止默认粘贴行为
                        this.handleFileSelection(file);
                        this.showNotification(`📎 已粘贴文件: ${file.name}`);
                        break;
                    }
                }
            }
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
            const dataChannel = pc.createDataChannel('chat', {
                ordered: true,
                maxRetransmits: 30, // 增加重传次数
                protocol: 'binary',
                negotiated: false,
                id: 0
            });
            // 设置二进制类型
            dataChannel.binaryType = 'arraybuffer';
            // 减少缓冲区阈值，更频繁地触发缓冲区低事件
            dataChannel.bufferedAmountLowThreshold = 16384; // 16KB
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
            // 设置二进制类型
            event.channel.binaryType = 'arraybuffer';
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
        
        // 监听缓冲区低阈值事件
        dataChannel.onbufferedamountlow = () => {
            console.log(`Buffer amount low for ${this.formatUserId(peerId)}`);
        };
        
        dataChannel.onmessage = async (event) => {
            // 检查是否为二进制消息
            if (event.data instanceof ArrayBuffer) {
                // 优先使用统一传输系统
                if (window.unifiedTransfer) {
                    const handled = await window.unifiedTransfer.handlePacket(event.data);
                    if (handled) {
                        return; // 已被统一系统处理
                    }
                }
                
                // 如果是未识别的二进制消息，直接返回
                console.warn('Unrecognized binary message, ignoring');
                return;
            }
            
            // 确保只处理字符串类型的文本消息
            if (typeof event.data !== 'string') {
                console.error('Non-string message reached text parsing section:', typeof event.data, event.data);
                return;
            }
            
            // 处理文本消息
            const message = JSON.parse(event.data);
            
            // 处理不同类型的消息
            switch (message.type) {
                case 'file-offer':
                    this.handleFileOffer(message, peerId);
                    break;
                case 'file-accept':
                    this.handleFileAccept(message, peerId);
                    break;
                case 'file-reject':
                    this.handleFileReject(message, peerId);
                    break;
                case 'file-cancel':
                    this.handleFileCancel(message, peerId);
                    break;
                case 'file-cancel-receive':
                    this.handleFileCancelReceive(message, peerId);
                    break;
                case 'file-metadata':
                    this.handleFileMetadata(message, peerId);
                    break;
                case 'file-chunk':
                    this.handleFileChunk(message, peerId);
                    break;
                case 'file-progress':
                    this.handleFileProgress(message, peerId);
                    break;
                default:
                    // 普通文本消息
                    this.displayMessage(message, false);
                    break;
            }
        };
        
        dataChannel.onerror = (error) => {
            console.error(`Data channel error with ${this.formatUserId(peerId)}:`, error);
            
            // 清理可能正在进行的文件传输
            if (this.fileSenders) {
                for (const [fileId, sender] of this.fileSenders.entries()) {
                    if (sender.peerId === peerId) {
                        sender.isPaused = true;
                        this.showNotification(`❌ 文件传输中断: ${sender.file.name}`);
                        this.fileSenders.delete(fileId);
                    }
                }
            }
            
            // 清理流式传输
            if (this.streamSenders) {
                for (const [fileId, sender] of this.streamSenders.entries()) {
                    if (sender.dataChannel === dataChannel) {
                        sender.isPaused = true;
                        sender.isComplete = true;
                        this.streamSenders.delete(fileId);
                        this.showNotification(`❌ 流式传输中断: ${sender.file.name}`);
                    }
                }
            }
            
            if (this.streamReceivers) {
                for (const [fileId, receiver] of this.streamReceivers.entries()) {
                    if (receiver.cancel) {
                        receiver.cancel();
                    }
                    this.streamReceivers.delete(fileId);
                }
            }
            
            this.showNotification(`⚠️ 与 ${this.formatUserId(peerId)} 的数据通道出现错误，请重新连接`);
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
    
    // 文件处理相关方法
    handleFileSelection(file) {
        // 所有文件都需要先发送offer，包括图片
        // 这样可以实现流式传输，避免将大文件完全加载到内存
        
        // 生成文件offer
        const fileOffer = {
            type: 'file-offer',
            fileId: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            userId: this.currentUserId,
            userInfo: this.currentUserInfo,
            timestamp: Date.now()
        };
        
        // 保存文件引用，等待对方接受
        this.pendingFiles = this.pendingFiles || new Map();
        this.pendingFiles.set(fileOffer.fileId, file);
        
        // 发送文件传输请求给所有连接的对等方
        let sentToAnyPeer = false;
        this.peerConnections.forEach((peerData, peerId) => {
            if (peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
                peerData.dataChannel.send(JSON.stringify(fileOffer));
                sentToAnyPeer = true;
            }
        });
        
        if (sentToAnyPeer) {
            // 显示等待确认的消息
            this.displayFileOffer(fileOffer, true);
        } else {
            this.showNotification('💡 当前没有连接的用户，无法发送文件');
            this.pendingFiles.delete(fileOffer.fileId);
        }
        
        this.domElements.fileInput.value = ''; // 清空文件选择
    }
    
    // 此方法已被移除，改用流式传输机制

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
    
    // 文件接收相关
    fileReceivers = new Map(); // 存储正在接收的文件
    
    handleFileMetadata(metadata, peerId) {
        // 获取接收器
        let receiver = this.fileReceivers.get(metadata.fileId);
        
        if (!receiver) {
            // 如果没有接收器，说明不是通过 acceptFileOffer 流程，创建一个
            receiver = {
                metadata: metadata,
                chunks: new Array(metadata.totalChunks),
                receivedChunks: 0,
                progressElement: null,
                startTime: Date.now(),
                lastUpdateTime: Date.now(),
                lastReceivedBytes: 0
            };
            this.fileReceivers.set(metadata.fileId, receiver);
        } else {
            // 更新元数据
            receiver.metadata = metadata;
            if (!receiver.isStreaming) {
                receiver.chunks = new Array(metadata.totalChunks);
            }
        }
        
        // 显示文件接收进度
        this.showFileProgress(metadata.fileId, metadata.fileName, 0, metadata.fileSize, false, metadata.userInfo);
        console.log(`开始接收文件: ${metadata.fileName} (${metadata.totalChunks} 块)`);
    }
    
    
    handleFileChunk(chunkData, peerId) {
        const receiver = this.fileReceivers.get(chunkData.fileId);
        if (!receiver) {
            console.error('收到未知文件的数据块:', chunkData.fileId);
            return;
        }
        
        // 如果是流式下载模式
        if (receiver.isStreaming) {
            if (!receiver.chunks) {
                receiver.chunks = [];
            }
            
            // 将 base64 数据转换为二进制
            const binaryData = atob(chunkData.data.split(',')[1] || chunkData.data);
            const uint8Array = new Uint8Array(binaryData.length);
            for (let i = 0; i < binaryData.length; i++) {
                uint8Array[i] = binaryData.charCodeAt(i);
            }
            receiver.chunks.push(uint8Array);
        } else {
            // 非流式模式，按原来的方式处理
            receiver.chunks[chunkData.chunkIndex] = chunkData.data;
        }
        
        receiver.receivedChunks++;
        
        // 计算进度和速度
        const progress = (receiver.receivedChunks / receiver.metadata.totalChunks) * 100;
        const currentTime = Date.now();
        const receivedBytes = (receiver.receivedChunks * receiver.metadata.chunkSize) || (receiver.receivedChunks * 64 * 1024);
        
        // 计算速度（每秒更新一次）
        if (currentTime - receiver.lastUpdateTime >= 1000) {
            const timeDiff = (currentTime - receiver.lastUpdateTime) / 1000;
            const bytesDiff = receivedBytes - receiver.lastReceivedBytes;
            const speed = bytesDiff / timeDiff;
            
            receiver.lastUpdateTime = currentTime;
            receiver.lastReceivedBytes = receivedBytes;
            
            this.updateFileProgress(chunkData.fileId, progress, speed);
        } else {
            this.updateFileProgress(chunkData.fileId, progress);
        }
        
        // 检查是否接收完成
        if (receiver.receivedChunks === receiver.metadata.totalChunks) {
            // 移除进度条
            this.removeFileProgress(chunkData.fileId);
            
            // 接收完成提示
            const totalTime = (Date.now() - receiver.startTime) / 1000;
            const avgSpeed = receiver.metadata.fileSize / totalTime;
            this.showNotification(`✅ 文件接收完成 (平均速度: ${this.formatSpeed(avgSpeed)})`);
            
            if (receiver.isStreaming) {
                // 流式下载模式，创建完整文件并触发下载
                const fullBlob = new Blob(receiver.chunks, { type: receiver.metadata.fileType || 'application/octet-stream' });
                const finalUrl = URL.createObjectURL(fullBlob);
                
                // 使用新的下载链接
                const downloadLink = document.createElement('a');
                downloadLink.href = finalUrl;
                downloadLink.download = receiver.metadata.fileName;
                downloadLink.style.display = 'none';
                document.body.appendChild(downloadLink);
                downloadLink.click();
                
                // 清理
                setTimeout(() => {
                    URL.revokeObjectURL(finalUrl);
                    document.body.removeChild(downloadLink);
                }, 1000);
            } else {
                // 原有的处理方式
                const completeData = receiver.chunks.join('');
                const blob = this.dataURLtoBlob(completeData);
                const url = URL.createObjectURL(blob);
                
                const downloadLink = document.createElement('a');
                downloadLink.href = url;
                downloadLink.download = receiver.metadata.fileName;
                downloadLink.style.display = 'none';
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                }, 1000);
            }
            
            // 在聊天记录中显示已接收的文件信息
            this.displayFileRecord({
                ...receiver.metadata,
                isReceived: true
            }, false);
            
            // 清理接收器
            this.fileReceivers.delete(chunkData.fileId);
        }
    }
    
    displayImage(imageData, isOwn) {
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${isOwn ? 'own' : 'other'}`;
        
        const messageHeader = document.createElement('div');
        messageHeader.className = 'message-header';
        
        const avatar = document.createElement('img');
        avatar.className = 'message-avatar';
        avatar.src = imageData.userInfo.avatar;
        avatar.alt = imageData.userInfo.name;
        
        const headerText = document.createElement('div');
        headerText.className = 'message-header-text';
        
        const name = document.createElement('span');
        name.className = 'message-name';
        name.textContent = imageData.userInfo.name;
        
        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = new Date(imageData.timestamp).toLocaleTimeString();
        
        headerText.appendChild(name);
        headerText.appendChild(time);
        
        messageHeader.appendChild(avatar);
        messageHeader.appendChild(headerText);
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isOwn ? 'message-own' : 'message-other'}`;
        
        const img = document.createElement('img');
        img.src = imageData.data;
        img.alt = imageData.fileName;
        img.style.maxWidth = '300px';
        img.style.maxHeight = '300px';
        img.style.borderRadius = '8px';
        img.style.cursor = 'pointer';
        
        // 点击图片查看大图
        img.onclick = () => {
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.8);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                cursor: pointer;
            `;
            
            const fullImg = document.createElement('img');
            fullImg.src = imageData.data;
            fullImg.style.maxWidth = '90%';
            fullImg.style.maxHeight = '90%';
            fullImg.style.objectFit = 'contain';
            
            modal.appendChild(fullImg);
            modal.onclick = () => modal.remove();
            document.body.appendChild(modal);
        };
        
        messageDiv.appendChild(img);
        
        messageWrapper.appendChild(messageHeader);
        messageWrapper.appendChild(messageDiv);
        
        this.domElements.chatMessages.appendChild(messageWrapper);
        this.domElements.chatMessages.scrollTop = this.domElements.chatMessages.scrollHeight;
    }
    
    displayFile(fileData, isOwn) {
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${isOwn ? 'own' : 'other'}`;
        
        const messageHeader = document.createElement('div');
        messageHeader.className = 'message-header';
        
        const avatar = document.createElement('img');
        avatar.className = 'message-avatar';
        avatar.src = fileData.userInfo.avatar;
        avatar.alt = fileData.userInfo.name;
        
        const headerText = document.createElement('div');
        headerText.className = 'message-header-text';
        
        const name = document.createElement('span');
        name.className = 'message-name';
        name.textContent = fileData.userInfo.name;
        
        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = new Date(fileData.timestamp).toLocaleTimeString();
        
        headerText.appendChild(name);
        headerText.appendChild(time);
        
        messageHeader.appendChild(avatar);
        messageHeader.appendChild(headerText);
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isOwn ? 'message-own' : 'message-other'}`;
        
        const fileContainer = document.createElement('div');
        fileContainer.className = 'file-container';
        fileContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 15px;
            min-width: 250px;
        `;
        
        // 文件图标
        const fileIcon = document.createElement('div');
        fileIcon.style.cssText = `
            font-size: 48px;
            flex-shrink: 0;
        `;
        fileIcon.textContent = this.getFileIcon(fileData.fileType);
        
        // 文件信息
        const fileInfo = document.createElement('div');
        fileInfo.style.cssText = `
            flex: 1;
            overflow: hidden;
        `;
        
        const fileName = document.createElement('div');
        fileName.style.cssText = `
            font-weight: 600;
            color: ${isOwn ? 'rgba(255, 255, 255, 0.95)' : '#374151'};
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        fileName.textContent = fileData.fileName;
        
        const fileSize = document.createElement('div');
        fileSize.style.cssText = `
            font-size: 12px;
            color: ${isOwn ? 'rgba(255, 255, 255, 0.75)' : '#6b7280'};
            margin-top: 4px;
        `;
        fileSize.textContent = this.formatFileSize(fileData.fileSize);
        
        fileInfo.appendChild(fileName);
        fileInfo.appendChild(fileSize);
        
        // 下载按钮
        const downloadBtn = document.createElement('a');
        downloadBtn.href = fileData.blob ? fileData.data : fileData.data; // 如果有blob使用blob URL
        downloadBtn.download = fileData.fileName;
        downloadBtn.style.cssText = `
            padding: 8px 16px;
            background: ${isOwn ? 'rgba(255, 255, 255, 0.2)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'};
            color: white;
            border-radius: 20px;
            text-decoration: none;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.3s ease;
            border: ${isOwn ? '1px solid rgba(255, 255, 255, 0.3)' : 'none'};
        `;
        downloadBtn.textContent = '下载';
        downloadBtn.onmouseover = () => {
            downloadBtn.style.transform = 'translateY(-2px)';
            downloadBtn.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
            if (isOwn) {
                downloadBtn.style.background = 'rgba(255, 255, 255, 0.3)';
            }
        };
        downloadBtn.onmouseout = () => {
            downloadBtn.style.transform = 'translateY(0)';
            downloadBtn.style.boxShadow = 'none';
            if (isOwn) {
                downloadBtn.style.background = 'rgba(255, 255, 255, 0.2)';
            }
        };
        
        fileContainer.appendChild(fileIcon);
        fileContainer.appendChild(fileInfo);
        fileContainer.appendChild(downloadBtn);
        
        messageDiv.appendChild(fileContainer);
        
        messageWrapper.appendChild(messageHeader);
        messageWrapper.appendChild(messageDiv);
        
        this.domElements.chatMessages.appendChild(messageWrapper);
        this.domElements.chatMessages.scrollTop = this.domElements.chatMessages.scrollHeight;
    }
    
    getFileIcon(fileNameOrType) {
        // 支持通过文件名或MIME类型获取图标
        let fileType = fileNameOrType;
        
        // 如果是文件名，提取扩展名
        if (fileNameOrType && fileNameOrType.includes('.')) {
            const ext = fileNameOrType.split('.').pop().toLowerCase();
            // 根据扩展名判断类型
            if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(ext)) return '🖼️';
            if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'].includes(ext)) return '🎥';
            if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) return '🎵';
            if (ext === 'pdf') return '📑';
            if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
            if (['doc', 'docx'].includes(ext)) return '📝';
            if (['xls', 'xlsx'].includes(ext)) return '📊';
            if (['ppt', 'pptx'].includes(ext)) return '📈';
            if (['txt', 'text'].includes(ext)) return '📃';
            if (['js', 'json', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h'].includes(ext)) return '💻';
        }
        
        // 如果是MIME类型
        if (!fileType) return '📄';
        if (fileType.startsWith('image/')) return '🖼️';
        if (fileType.startsWith('video/')) return '🎥';
        if (fileType.startsWith('audio/')) return '🎵';
        if (fileType.includes('pdf')) return '📑';
        if (fileType.includes('zip') || fileType.includes('rar') || fileType.includes('7z')) return '📦';
        if (fileType.includes('doc') || fileType.includes('docx')) return '📝';
        if (fileType.includes('xls') || fileType.includes('xlsx')) return '📊';
        if (fileType.includes('ppt') || fileType.includes('pptx')) return '📈';
        if (fileType.includes('text') || fileType.includes('txt')) return '📃';
        if (fileType.includes('javascript') || fileType.includes('json')) return '💻';
        
        return '📄';
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    formatSpeed(bytesPerSecond) {
        if (bytesPerSecond === 0) return '0 B/s';
        
        const k = 1024;
        const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
        const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
        
        return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    // 显示文件记录（仅显示文件信息，不包含实际内容）
    displayFileRecord(fileData, isOwn) {
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${isOwn ? 'own' : 'other'}`;
        
        const messageHeader = document.createElement('div');
        messageHeader.className = 'message-header';
        
        const avatar = document.createElement('img');
        avatar.className = 'message-avatar';
        avatar.src = fileData.userInfo.avatar;
        avatar.alt = fileData.userInfo.name;
        
        const headerText = document.createElement('div');
        headerText.className = 'message-header-text';
        
        const name = document.createElement('span');
        name.className = 'message-name';
        name.textContent = fileData.userInfo.name;
        
        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = new Date(fileData.timestamp || Date.now()).toLocaleTimeString();
        
        headerText.appendChild(name);
        headerText.appendChild(time);
        
        messageHeader.appendChild(avatar);
        messageHeader.appendChild(headerText);
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isOwn ? 'message-own' : 'message-other'}`;
        
        const fileRecord = document.createElement('div');
        fileRecord.className = 'file-record';
        fileRecord.innerHTML = `
            <div class="file-record-icon">${this.getFileIcon(fileData.fileName)}</div>
            <div class="file-record-info">
                <div class="file-record-name">${fileData.fileName}</div>
                <div class="file-record-details">
                    <span class="file-size">${this.formatFileSize(fileData.fileSize)}</span>
                    <span class="file-status">${isOwn ? '已发送' : '已接收'}</span>
                </div>
            </div>
        `;
        
        messageDiv.appendChild(fileRecord);
        messageWrapper.appendChild(messageHeader);
        messageWrapper.appendChild(messageDiv);
        
        this.domElements.chatMessages.appendChild(messageWrapper);
        this.domElements.chatMessages.scrollTop = this.domElements.chatMessages.scrollHeight;
    }
    
    dataURLtoBlob(dataURL) {
        const arr = dataURL.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        
        return new Blob([u8arr], { type: mime });
    }
    
    dataURLtoArrayBuffer(dataURL) {
        const arr = dataURL.split(',');
        const bstr = atob(arr[1]);
        const buffer = new ArrayBuffer(bstr.length);
        const u8arr = new Uint8Array(buffer);
        
        for (let i = 0; i < bstr.length; i++) {
            u8arr[i] = bstr.charCodeAt(i);
        }
        
        return buffer;
    }
    
    // 文件传输请求处理
    handleFileOffer(offer, peerId) {
        // 显示文件接收请求
        this.displayFileOffer(offer, false, peerId);
    }
    
    displayFileOffer(offer, isOwn, peerId = null) {
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${isOwn ? 'own' : 'other'}`;
        messageWrapper.id = `file-offer-${offer.fileId}`;
        
        const messageHeader = document.createElement('div');
        messageHeader.className = 'message-header';
        
        const avatar = document.createElement('img');
        avatar.className = 'message-avatar';
        avatar.src = offer.userInfo.avatar;
        avatar.alt = offer.userInfo.name;
        
        const headerText = document.createElement('div');
        headerText.className = 'message-header-text';
        
        const name = document.createElement('span');
        name.className = 'message-name';
        name.textContent = offer.userInfo.name;
        
        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = new Date(offer.timestamp).toLocaleTimeString();
        
        headerText.appendChild(name);
        headerText.appendChild(time);
        
        messageHeader.appendChild(avatar);
        messageHeader.appendChild(headerText);
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isOwn ? 'message-own' : 'message-other'}`;
        
        const fileOfferContainer = document.createElement('div');
        fileOfferContainer.className = 'file-offer-container';
        fileOfferContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 15px;
            min-width: 250px;
        `;
        
        // 文件图标
        const fileIcon = document.createElement('div');
        fileIcon.style.cssText = `
            font-size: 48px;
            flex-shrink: 0;
        `;
        fileIcon.textContent = this.getFileIcon(offer.fileType);
        
        // 文件信息
        const fileInfo = document.createElement('div');
        fileInfo.style.cssText = `
            flex: 1;
            overflow: hidden;
        `;
        
        const fileName = document.createElement('div');
        fileName.style.cssText = `
            font-weight: 600;
            color: ${isOwn ? 'rgba(255, 255, 255, 0.95)' : '#374151'};
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
        fileName.textContent = offer.fileName;
        
        const fileSize = document.createElement('div');
        fileSize.style.cssText = `
            font-size: 12px;
            color: ${isOwn ? 'rgba(255, 255, 255, 0.75)' : '#6b7280'};
            margin-top: 4px;
        `;
        fileSize.textContent = this.formatFileSize(offer.fileSize);
        
        fileInfo.appendChild(fileName);
        fileInfo.appendChild(fileSize);
        
        fileOfferContainer.appendChild(fileIcon);
        fileOfferContainer.appendChild(fileInfo);
        
        if (isOwn) {
            // 发送方显示等待状态
            const statusDiv = document.createElement('div');
            statusDiv.className = 'file-status';
            statusDiv.style.cssText = `
                font-size: 14px;
                color: rgba(255, 255, 255, 0.8);
            `;
            statusDiv.textContent = '等待对方接收...';
            fileOfferContainer.appendChild(statusDiv);
        } else {
            // 接收方显示接受/拒绝按钮
            const buttonsDiv = document.createElement('div');
            buttonsDiv.style.cssText = `
                display: flex;
                gap: 10px;
            `;
            
            const acceptBtn = document.createElement('button');
            acceptBtn.style.cssText = `
                padding: 8px 16px;
                background: #10b981;
                color: white;
                border: none;
                border-radius: 20px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
            `;
            acceptBtn.textContent = '接收';
            acceptBtn.onclick = () => this.acceptFileOffer(offer, peerId);
            
            const rejectBtn = document.createElement('button');
            rejectBtn.style.cssText = `
                padding: 8px 16px;
                background: #ef4444;
                color: white;
                border: none;
                border-radius: 20px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
            `;
            rejectBtn.textContent = '拒绝';
            rejectBtn.onclick = () => this.rejectFileOffer(offer, peerId);
            
            buttonsDiv.appendChild(acceptBtn);
            buttonsDiv.appendChild(rejectBtn);
            fileOfferContainer.appendChild(buttonsDiv);
        }
        
        messageDiv.appendChild(fileOfferContainer);
        
        messageWrapper.appendChild(messageHeader);
        messageWrapper.appendChild(messageDiv);
        
        this.domElements.chatMessages.appendChild(messageWrapper);
        this.domElements.chatMessages.scrollTop = this.domElements.chatMessages.scrollHeight;
    }
    
    acceptFileOffer(offer, peerId) {
        // 立即开始流式下载
        this.startStreamDownload(offer, peerId);
        
        // 发送接受响应
        const response = {
            type: 'file-accept',
            fileId: offer.fileId,
            userId: this.currentUserId
        };
        
        const peerData = this.peerConnections.get(peerId);
        if (peerData && peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
            peerData.dataChannel.send(JSON.stringify(response));
        }
        
        // 移除offer UI
        const offerElement = document.getElementById(`file-offer-${offer.fileId}`);
        if (offerElement) {
            offerElement.remove();
        }
    }
    
    rejectFileOffer(offer, peerId) {
        // 发送拒绝响应
        const response = {
            type: 'file-reject',
            fileId: offer.fileId,
            userId: this.currentUserId
        };
        
        const peerData = this.peerConnections.get(peerId);
        if (peerData && peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
            peerData.dataChannel.send(JSON.stringify(response));
        }
        
        // 移除UI元素
        const offerElement = document.getElementById(`file-offer-${offer.fileId}`);
        if (offerElement) {
            offerElement.remove();
        }
        
        this.showNotification('❌ 已拒绝接收文件');
    }
    
    handleFileAccept(response, peerId) {
        const file = this.pendingFiles?.get(response.fileId);
        if (!file) {
            console.error('找不到待发送的文件:', response.fileId);
            return;
        }
        
        // 立即移除offer UI，显示进度条
        const offerElement = document.getElementById(`file-offer-${response.fileId}`);
        if (offerElement) {
            offerElement.remove();
        }
        
        // 稍微延迟一下，给接收方时间准备
        setTimeout(() => {
            this.startUnifiedFileSending(file, response.fileId, peerId);
        }, 500); // 500ms延迟
    }
    
    handleFileReject(response, peerId) {
        // 移除待发送文件
        this.pendingFiles?.delete(response.fileId);
        
        // 更新UI
        const offerElement = document.getElementById(`file-offer-${response.fileId}`);
        if (offerElement) {
            const statusDiv = offerElement.querySelector('.file-status');
            if (statusDiv) {
                statusDiv.textContent = '对方拒绝接收';
                statusDiv.style.color = '#ef4444';
            }
        }
        
        this.showNotification('❌ 对方拒绝接收文件');
    }
    
    handleFileCancel(message, peerId) {
        // 处理发送方取消文件传输
        const receiver = this.fileReceivers?.get(message.fileId);
        if (receiver) {
            // 清理接收器
            this.fileReceivers.delete(message.fileId);
            
            // 移除进度条
            this.removeFileProgress(message.fileId);
            
            // 显示取消通知
            const fileName = receiver.metadata?.fileName || '文件';
            this.showNotification(`⚠️ 发送方取消了文件传输: ${fileName}`);
        }
    }
    
    handleFileCancelReceive(message, peerId) {
        // 处理接收方取消文件传输
        const sender = this.fileSenders?.get(message.fileId);
        if (sender) {
            // 停止发送
            sender.isPaused = true;
            
            // 从发送队列中移除
            this.fileSenders.delete(message.fileId);
            
            // 移除进度条UI
            this.removeFileProgress(message.fileId);
            
            this.showNotification(`⚠️ 接收方取消了文件传输: ${sender.file.name}`);
        }
    }
    
    // 开始实时发送文件（流式传输）
    startFileSending(file, fileId, peerId) {
        const chunkSize = 4 * 1024; // 4KB chunks - 更小的块大小
        const totalChunks = Math.ceil(file.size / chunkSize);
        
        // 立即显示发送进度UI
        this.showFileSendProgress(fileId, file.name, 0, file.size);
        
        // 发送文件元数据
        const metadata = {
            type: 'file-metadata',
            fileId: fileId,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            totalChunks: totalChunks,
            chunkSize: chunkSize,
            userId: this.currentUserId,
            userInfo: this.currentUserInfo,
            timestamp: Date.now()
        };
        
        const peerData = this.peerConnections.get(peerId);
        if (peerData && peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
            peerData.dataChannel.send(JSON.stringify(metadata));
        }
        
        // 创建发送进度跟踪
        this.fileSenders = this.fileSenders || new Map();
        const sender = {
            file: file,
            fileId: fileId,
            totalChunks: totalChunks,
            currentChunk: 0,
            chunkSize: chunkSize,
            peerId: peerId,
            isPaused: false,
            sendNextChunk: null,
            startTime: Date.now(),
            lastUpdateTime: Date.now(),
            lastSentBytes: 0
        };
        
        // 定义发送下一个块的函数
        sender.sendNextChunk = () => {
            if (sender.isPaused || sender.currentChunk >= totalChunks) {
                return;
            }
            
            const start = sender.currentChunk * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = file.slice(start, end);
            
            const reader = new FileReader();
            reader.onload = (e) => {
                const chunkData = {
                    type: 'file-chunk',
                    fileId: fileId,
                    chunkIndex: sender.currentChunk,
                    totalChunks: totalChunks,
                    data: e.target.result
                };
                
                const peerData = this.peerConnections.get(peerId);
                if (peerData && peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
                    try {
                        // 检查数据大小，确保不超过WebRTC限制
                        const chunkStr = JSON.stringify(chunkData);
                        if (chunkStr.length > 256 * 1024) { // 256KB limit for maximum stability
                            console.warn('Chunk too large, skipping:', chunkStr.length);
                            sender.currentChunk++;
                            setTimeout(() => sender.sendNextChunk(), 50);
                            return;
                        }
                        
                        // 检查缓冲区状态，如果缓冲区满了就等待
                        const bufferedAmount = peerData.dataChannel.bufferedAmount;
                        const maxBuffer = 256 * 1024; // 256KB buffer limit
                        
                        if (bufferedAmount > maxBuffer) {
                            // 缓冲区满了，等待后重试
                            console.log('Buffer full, waiting...', bufferedAmount);
                            setTimeout(() => sender.sendNextChunk(), 100);
                            return;
                        }
                        
                        peerData.dataChannel.send(chunkStr);
                        
                        sender.currentChunk++;
                        
                        // 更新进度和速度
                        const progress = (sender.currentChunk / totalChunks) * 100;
                        const currentTime = Date.now();
                        const sentBytes = sender.currentChunk * chunkSize;
                        
                        // 计算速度（每秒更新一次）
                        if (currentTime - sender.lastUpdateTime >= 1000) {
                            const timeDiff = (currentTime - sender.lastUpdateTime) / 1000;
                            const bytesDiff = sentBytes - sender.lastSentBytes;
                            const speed = bytesDiff / timeDiff;
                            
                            sender.lastUpdateTime = currentTime;
                            sender.lastSentBytes = sentBytes;
                            
                            this.updateSendingProgress(fileId, progress, speed);
                        } else {
                            this.updateSendingProgress(fileId, progress);
                        }
                        
                        // 发送下一个块，根据缓冲区状态调整延迟
                        if (sender.currentChunk < totalChunks) {
                            // 更保守的延迟策略
                            let delay = 100; // 基础延迟
                            if (bufferedAmount > 32 * 1024) {
                                delay = 500; // 高负载时大幅增加延迟
                            } else if (bufferedAmount > 16 * 1024) {
                                delay = 200; // 中等负载
                            }
                            setTimeout(() => sender.sendNextChunk(), delay);
                        } else {
                            // 发送完成
                            this.fileSendingComplete(fileId);
                            this.fileSenders.delete(fileId);
                            this.pendingFiles?.delete(fileId);
                        }
                    } catch (error) {
                        console.error('Error sending chunk:', error);
                        sender.isPaused = true;
                        this.showNotification(`❌ 文件发送失败: ${sender.file.name}`);
                        this.fileSenders.delete(fileId);
                    }
                } else {
                    console.warn('Data channel not ready, stopping file transfer');
                    sender.isPaused = true;
                    this.showNotification(`❌ 连接已断开，文件发送停止`);
                    this.fileSenders.delete(fileId);
                }
            };
            
            reader.readAsDataURL(chunk);
        };
        
        this.fileSenders.set(fileId, sender);
        
        // 开始发送
        sender.sendNextChunk();
    }
    
    updateSendingProgress(fileId, progress, speed = null) {
        // 先移除旧的offer元素，显示新的进度条UI
        const offerElement = document.getElementById(`file-offer-${fileId}`);
        if (offerElement && !document.getElementById(`progress-${fileId}`)) {
            // 获取文件信息
            const sender = this.fileSenders.get(fileId);
            if (sender) {
                offerElement.remove();
                // 使用新的进度条UI显示发送进度
                this.showFileSendProgress(fileId, sender.file.name, progress, sender.file.size);
            }
        }
        
        // 更新进度
        const progressWrapper = document.getElementById(`progress-${fileId}`);
        if (progressWrapper) {
            const progressFill = progressWrapper.querySelector('.file-progress-fill');
            const progressPercent = progressWrapper.querySelector('.progress-percent');
            
            if (progressFill) {
                progressFill.style.width = `${progress}%`;
            }
            if (progressPercent) {
                progressPercent.textContent = `${Math.round(progress)}%`;
            }
            
            // 更新速度显示
            if (speed !== null) {
                const speedElement = progressWrapper.querySelector('.transfer-speed');
                if (speedElement) {
                    speedElement.textContent = `速度: ${this.formatSpeed(speed)}`;
                }
            }
        }
    }
    
    fileSendingComplete(fileId) {
        const sender = this.fileSenders.get(fileId);
        
        // 移除进度条
        this.removeFileProgress(fileId);
        
        // 移除可能存在的offer元素
        const offerElement = document.getElementById(`file-offer-${fileId}`);
        if (offerElement) {
            offerElement.remove();
        }
        
        if (sender) {
            const totalTime = (Date.now() - sender.startTime) / 1000;
            const avgSpeed = sender.file.size / totalTime;
            this.showNotification(`✅ 文件发送完成 (平均速度: ${this.formatSpeed(avgSpeed)})`);
            
            // 显示文件发送记录
            this.displayFileRecord({
                fileId: fileId,
                fileName: sender.file.name,
                fileType: sender.file.type,
                fileSize: sender.file.size,
                userId: this.currentUserId,
                userInfo: this.currentUserInfo,
                timestamp: Date.now()
            }, true);
            
            // 清理发送器
            this.fileSenders.delete(fileId);
            this.pendingFiles?.delete(fileId);
        } else {
            this.showNotification('✅ 文件发送完成');
        }
    }
    
    prepareFileReceiver(offer) {
        // 为接收文件做准备
        this.fileReceivers = this.fileReceivers || new Map();
        this.fileReceivers.set(offer.fileId, {
            offer: offer,
            metadata: null,
            chunks: null,
            receivedChunks: 0,
            lastChunkTime: Date.now()
        });
    }
    
    // 开始流式下载
    startStreamDownload(offer, peerId) {
        // 准备接收器
        this.fileReceivers = this.fileReceivers || new Map();
        
        // 初始化接收器（流式模式）
        const receiver = {
            offer: offer,
            metadata: null,
            chunks: [],
            receivedChunks: 0,
            startTime: Date.now(),
            lastUpdateTime: Date.now(),
            lastReceivedBytes: 0,
            isStreaming: true
        };
        
        this.fileReceivers.set(offer.fileId, receiver);
    }
    
    handleFileProgress(progress, peerId) {
        // 处理文件传输进度更新（用于断点续传）
        console.log(`文件进度更新: ${progress.fileId} - ${progress.receivedChunks}/${progress.totalChunks}`);
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
    
    // 统一的文件进度显示方法（适用于发送和接收）
    showFileProgress(fileId, fileName, progress = 0, fileSize = 0, isOwn = false, userInfo = null) {
        const progressWrapper = document.createElement('div');
        progressWrapper.className = `message-wrapper ${isOwn ? 'own' : 'other'}`;
        progressWrapper.id = `progress-${fileId}`;
        
        // 添加消息头部
        const messageHeader = document.createElement('div');
        messageHeader.className = 'message-header';
        
        const avatar = document.createElement('img');
        avatar.className = 'message-avatar';
        avatar.src = userInfo ? userInfo.avatar : this.currentUserInfo.avatar;
        avatar.alt = userInfo ? userInfo.name : this.currentUserInfo.name;
        
        const headerText = document.createElement('div');
        headerText.className = 'message-header-text';
        
        const name = document.createElement('span');
        name.className = 'message-name';
        name.textContent = userInfo ? userInfo.name : this.currentUserInfo.name;
        
        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = new Date().toLocaleTimeString();
        
        headerText.appendChild(name);
        headerText.appendChild(time);
        
        messageHeader.appendChild(avatar);
        messageHeader.appendChild(headerText);
        
        progressWrapper.appendChild(messageHeader);
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isOwn ? 'message-own' : 'message-other'}`;
        
        // 创建现代化的进度卡片
        const progressCard = document.createElement('div');
        progressCard.className = 'file-progress-card';
        progressCard.innerHTML = `
            <div class="file-progress-header">
                <div class="file-progress-icon">${this.getFileIcon(fileName)}</div>
                <div class="file-progress-info">
                    <div class="file-progress-name">${fileName}</div>
                    <div class="file-progress-details">
                        <span class="file-size">${this.formatFileSize(fileSize)}</span>
                        <span class="transfer-speed"></span>
                    </div>
                </div>
                <button class="file-progress-cancel" data-file-id="${fileId}">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
                    </svg>
                </button>
            </div>
            <div class="file-progress-status">
                <span class="progress-label">${isOwn ? '发送中' : '接收中'}</span>
                <span class="progress-percent">${Math.round(progress)}%</span>
            </div>
            <div class="file-progress-bar">
                <div class="file-progress-fill" style="width: ${progress}%"></div>
            </div>
        `;
        
        messageDiv.appendChild(progressCard);
        progressWrapper.appendChild(messageDiv);
        
        this.domElements.chatMessages.appendChild(progressWrapper);
        this.domElements.chatMessages.scrollTop = this.domElements.chatMessages.scrollHeight;
        
        // 添加取消按钮事件
        const cancelBtn = progressCard.querySelector('.file-progress-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                if (isOwn) {
                    this.cancelFileSending(fileId);
                } else {
                    this.cancelFileReceiving(fileId);
                }
            });
        }
        
        // 保存进度元素引用
        if (!isOwn) {
            const receiver = this.fileReceivers.get(fileId);
            if (receiver) {
                receiver.progressElement = progressWrapper;
            }
        }
    }
    
    updateFileProgress(fileId, progress, speed = null) {
        const progressWrapper = document.getElementById(`progress-${fileId}`);
        if (progressWrapper) {
            const progressFill = progressWrapper.querySelector('.file-progress-fill');
            const progressPercent = progressWrapper.querySelector('.progress-percent');
            
            if (progressFill) {
                progressFill.style.width = `${progress}%`;
            }
            if (progressPercent) {
                progressPercent.textContent = `${Math.round(progress)}%`;
            }
            
            // 更新速度显示
            if (speed !== null) {
                const speedElement = progressWrapper.querySelector('.transfer-speed');
                if (speedElement) {
                    speedElement.textContent = `• ${this.formatSpeed(speed)}`;
                }
            }
        }
    }
    
    removeFileProgress(fileId) {
        const progressWrapper = document.getElementById(`progress-${fileId}`);
        if (progressWrapper) {
            progressWrapper.remove();
        }
    }
    
    // 取消文件接收
    cancelFileReceiving(fileId) {
        // 检查流式接收器
        const streamReceiver = this.streamReceivers?.get(fileId);
        if (streamReceiver) {
            // 取消流式接收
            if (streamReceiver.cancel) {
                streamReceiver.cancel();
            }
            
            // 从接收队列中移除
            this.streamReceivers.delete(fileId);
            
            // 移除进度条UI
            this.removeFileProgress(fileId);
            
            // 发送取消通知给发送方
            this.peerConnections.forEach((peerData) => {
                if (peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
                    peerData.dataChannel.send(JSON.stringify({
                        type: 'file-cancel-receive',
                        fileId: fileId,
                        userId: this.currentUserId
                    }));
                }
            });
            
            const fileName = streamReceiver.fileMetadata?.fileName || streamReceiver.offer?.fileName || '文件';
            this.showNotification(`❌ 已取消接收: ${fileName}`);
            return;
        }
        
        // 原有逻辑处理非流式接收
        const receiver = this.fileReceivers?.get(fileId);
        if (receiver) {
            // 清理接收器
            this.fileReceivers.delete(fileId);
            
            // 移除进度条UI
            this.removeFileProgress(fileId);
            
            // 发送取消通知给发送方
            this.peerConnections.forEach((peerData) => {
                if (peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
                    peerData.dataChannel.send(JSON.stringify({
                        type: 'file-cancel-receive',
                        fileId: fileId,
                        userId: this.currentUserId
                    }));
                }
            });
            
            this.showNotification(`❌ 已取消接收: ${receiver.metadata?.fileName || '文件'}`);
        }
    }
    
    // 取消文件发送
    cancelFileSending(fileId) {
        // 检查流式发送器
        const streamSender = this.streamSenders?.get(fileId);
        if (streamSender) {
            // 停止流式发送
            streamSender.isPaused = true;
            streamSender.isComplete = true;
            
            // 从发送队列中移除
            this.streamSenders.delete(fileId);
            
            // 从待发送文件中移除
            this.pendingFiles?.delete(fileId);
            
            // 移除进度条UI
            this.removeFileProgress(fileId);
            
            // 发送取消通知给接收方
            this.peerConnections.forEach((peerData) => {
                if (peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
                    peerData.dataChannel.send(JSON.stringify({
                        type: 'file-cancel',
                        fileId: fileId,
                        userId: this.currentUserId
                    }));
                }
            });
            
            this.showNotification(`❌ 已取消发送: ${streamSender.file.name}`);
            return;
        }
        
        // 原有逻辑处理非流式发送
        const sender = this.fileSenders?.get(fileId);
        if (sender) {
            // 停止发送
            sender.isPaused = true;
            
            // 从发送队列中移除
            this.fileSenders.delete(fileId);
            
            // 从待发送文件中移除
            this.pendingFiles?.delete(fileId);
            
            // 移除进度条UI
            this.removeFileProgress(fileId);
            
            // 发送取消通知给接收方
            this.peerConnections.forEach((peerData) => {
                if (peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
                    peerData.dataChannel.send(JSON.stringify({
                        type: 'file-cancel',
                        fileId: fileId,
                        userId: this.currentUserId
                    }));
                }
            });
            
            this.showNotification(`❌ 已取消发送: ${sender.file.name}`);
        }
    }
    
    // 显示文件发送进度（使用统一方法）
    showFileSendProgress(fileId, fileName, progress = 0, fileSize = 0) {
        this.showFileProgress(fileId, fileName, progress, fileSize, true, this.currentUserInfo);
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
    
    // 鲁棒性流式传输方法
    async startRobustFileSending(file, fileId, peerId) {
        const peerData = this.peerConnections.get(peerId);
        if (!peerData || !peerData.dataChannel || peerData.dataChannel.readyState !== 'open') {
            console.error('Data channel not ready');
            return;
        }
        
        // 显示发送进度
        this.showFileSendProgress(fileId, file.name, 0, file.size);
        
        try {
            await window.robustStreamHandler.createRobustSender(
                file,
                fileId,
                peerData.dataChannel,
                // 进度回调
                (progress, speed) => {
                    this.updateSendingProgress(fileId, progress, speed);
                },
                // 完成回调
                () => {
                    this.removeFileProgress(fileId);
                    this.showNotification(`✅ 文件发送完成: ${file.name}`);
                    
                    // 显示发送记录
                    this.displayFileRecord({
                        fileId: fileId,
                        fileName: file.name,
                        fileType: file.type,
                        fileSize: file.size,
                        userId: this.currentUserId,
                        userInfo: this.currentUserInfo,
                        timestamp: Date.now()
                    }, true);
                },
                // 错误回调
                (error) => {
                    console.error('Robust sending error:', error);
                    this.removeFileProgress(fileId);
                    this.showNotification(`❌ 文件发送失败: ${file.name}`);
                }
            );
        } catch (error) {
            console.error('Failed to start robust sending:', error);
            this.showNotification(`❌ 启动鲁棒性传输失败: ${file.name}`);
        }
    }
    
    async startRobustFileReceiving(offer, peerId) {
        // 显示接收进度
        this.showFileProgress(offer.fileId, offer.fileName, 0, offer.fileSize, false, offer.userInfo);
        
        try {
            await window.robustStreamHandler.createRobustReceiver(
                {
                    fileId: offer.fileId,
                    fileName: offer.fileName,
                    fileSize: offer.fileSize,
                    totalChunks: Math.ceil(offer.fileSize / 1024) // 1KB 块
                },
                // 进度回调
                (progress, speed) => {
                    this.updateFileProgress(offer.fileId, progress, speed);
                },
                // 完成回调
                () => {
                    this.removeFileProgress(offer.fileId);
                    this.showNotification(`✅ 文件接收完成: ${offer.fileName}`);
                    
                    // 显示接收记录
                    this.displayFileRecord({
                        ...offer,
                        isReceived: true
                    }, false);
                },
                // 错误回调
                (error) => {
                    console.error('Robust receiving error:', error);
                    this.removeFileProgress(offer.fileId);
                    if (error.name !== 'AbortError') {
                        this.showNotification(`❌ 文件接收失败: ${offer.fileName}`);
                    }
                }
            );
        } catch (error) {
            console.error('Failed to start robust receiving:', error);
            this.showNotification(`❌ 启动鲁棒性接收失败: ${offer.fileName}`);
        }
    }
    
    // 高性能流式传输方法
    async startHighPerformanceFileSending(file, fileId, peerId) {
        const peerData = this.peerConnections.get(peerId);
        if (!peerData || !peerData.dataChannel || peerData.dataChannel.readyState !== 'open') {
            console.error('Data channel not ready');
            return;
        }
        
        // 显示发送进度
        this.showFileSendProgress(fileId, file.name, 0, file.size);
        
        try {
            await window.highPerformanceStreamHandler.createHighPerformanceSender(
                file,
                fileId,
                peerData.dataChannel,
                // 进度回调
                (progress, speed) => {
                    this.updateSendingProgress(fileId, progress, speed);
                },
                // 完成回调
                () => {
                    this.removeFileProgress(fileId);
                    this.showNotification(`✅ 文件发送完成: ${file.name}`);
                    
                    // 显示发送记录
                    this.displayFileRecord({
                        fileId: fileId,
                        fileName: file.name,
                        fileType: file.type,
                        fileSize: file.size,
                        userId: this.currentUserId,
                        userInfo: this.currentUserInfo,
                        timestamp: Date.now()
                    }, true);
                },
                // 错误回调
                (error) => {
                    console.error('High performance sending error:', error);
                    this.removeFileProgress(fileId);
                    this.showNotification(`❌ 文件发送失败: ${file.name}`);
                }
            );
        } catch (error) {
            console.error('Failed to start high performance sending:', error);
            this.showNotification(`❌ 启动高性能传输失败: ${file.name}`);
        }
    }
    
    async startHighPerformanceFileReceiving(offer, peerId) {
        // 显示接收进度
        this.showFileProgress(offer.fileId, offer.fileName, 0, offer.fileSize, false, offer.userInfo);
        
        try {
            await window.highPerformanceStreamHandler.createHighPerformanceReceiver(
                {
                    fileId: offer.fileId,
                    fileName: offer.fileName,
                    fileSize: offer.fileSize,
                    totalChunks: Math.ceil(offer.fileSize / (256 * 1024)) // 估算块数
                },
                // 进度回调
                (progress, speed) => {
                    this.updateFileProgress(offer.fileId, progress, speed);
                },
                // 完成回调
                () => {
                    this.removeFileProgress(offer.fileId);
                    this.showNotification(`✅ 文件接收完成: ${offer.fileName}`);
                    
                    // 显示接收记录
                    this.displayFileRecord({
                        ...offer,
                        isReceived: true
                    }, false);
                },
                // 错误回调
                (error) => {
                    console.error('High performance receiving error:', error);
                    this.removeFileProgress(offer.fileId);
                    if (error.name !== 'AbortError') {
                        this.showNotification(`❌ 文件接收失败: ${offer.fileName}`);
                    }
                }
            );
        } catch (error) {
            console.error('Failed to start high performance receiving:', error);
            this.showNotification(`❌ 启动高性能接收失败: ${offer.fileName}`);
        }
    }
    
    // 流式传输方法
    startStreamFileSending(file, fileId, peerId) {
        if (!window.streamHandler) {
            console.error('Stream handler not loaded');
            this.startFileSending(file, fileId, peerId);
            return;
        }
        
        const peerData = this.peerConnections.get(peerId);
        if (!peerData || !peerData.dataChannel || peerData.dataChannel.readyState !== 'open') {
            console.error('Data channel not ready');
            return;
        }
        
        // 先发送元数据
        const metadata = {
            type: 'file-metadata',
            fileId: fileId,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            userId: this.currentUserId,
            userInfo: this.currentUserInfo,
            timestamp: Date.now(),
            isStreaming: true
        };
        
        peerData.dataChannel.send(JSON.stringify(metadata));
        
        // 显示发送进度
        this.showFileSendProgress(fileId, file.name, 0, file.size);
        
        // 创建流式发送器
        const sender = window.streamHandler.createStreamSender(
            file,
            fileId,
            peerData.dataChannel,
            // 进度回调
            (progress, speed) => {
                this.updateSendingProgress(fileId, progress, speed);
            },
            // 完成回调
            () => {
                this.streamSenders.delete(fileId);
                this.fileSendingComplete(fileId);
            },
            // 错误回调
            (error) => {
                console.error('Stream sending error:', error);
                this.streamSenders.delete(fileId);
                this.showNotification(`❌ 文件发送失败: ${file.name}`);
                this.removeFileProgress(fileId);
            }
        );
        
        this.streamSenders.set(fileId, sender);
    }
    
    handleStreamChunk(chunkData, peerId) {
        const receiver = this.streamReceivers.get(chunkData.fileId);
        
        if (!receiver) {
            console.error('No receiver for stream chunk:', chunkData.fileId);
            return;
        }
        
        // 处理数据块
        receiver.handleChunk(chunkData);
    }
    
    acceptFileOffer(offer, peerId) {
        // 使用统一传输系统接收
        this.startUnifiedFileReceiving(offer, peerId);
        
        // 发送接受响应
        const response = {
            type: 'file-accept',
            fileId: offer.fileId,
            userId: this.currentUserId
        };
        
        const peerData = this.peerConnections.get(peerId);
        if (peerData && peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
            peerData.dataChannel.send(JSON.stringify(response));
        }
        
        // 移除offer UI
        const offerElement = document.getElementById(`file-offer-${offer.fileId}`);
        if (offerElement) {
            offerElement.remove();
        }
    }
    
    async startStreamReceiving(offer, peerId) {
        if (!window.streamHandler) {
            console.error('Stream handler not loaded');
            this.startStreamDownload(offer, peerId);
            return;
        }
        
        // 显示接收进度
        this.showFileProgress(offer.fileId, offer.fileName, 0, offer.fileSize, false, offer.userInfo);
        
        // 创建流式接收器
        const receiver = await window.streamHandler.createStreamReceiver(
            offer,
            // 进度回调
            (progress, speed) => {
                this.updateFileProgress(offer.fileId, progress, speed);
            },
            // 完成回调
            () => {
                this.streamReceivers.delete(offer.fileId);
                this.removeFileProgress(offer.fileId);
                this.showNotification(`✅ 文件接收完成: ${offer.fileName}`);
                
                // 显示文件记录
                this.displayFileRecord({
                    ...offer,
                    isReceived: true
                }, false);
            },
            // 错误回调
            (error) => {
                console.error('Stream receiving error:', error);
                this.streamReceivers.delete(offer.fileId);
                this.removeFileProgress(offer.fileId);
                if (error.name !== 'AbortError') {
                    this.showNotification(`❌ 文件接收失败: ${offer.fileName}`);
                }
            }
        );
        
        if (receiver) {
            this.streamReceivers.set(offer.fileId, receiver);
        }
    }
    
    // 处理元数据消息以支持流式传输
    handleFileMetadata(metadata, peerId) {
        // 如果是流式传输
        if (metadata.isStreaming && window.streamHandler) {
            // 检查是否已有接收器
            let receiver = this.streamReceivers.get(metadata.fileId);
            
            if (!receiver) {
                // 自动创建接收器
                this.startStreamReceiving(metadata, peerId);
            }
            return;
        }
        
        // 原有逻辑
        let receiver = this.fileReceivers.get(metadata.fileId);
        
        if (!receiver) {
            receiver = {
                metadata: metadata,
                chunks: new Array(metadata.totalChunks),
                receivedChunks: 0,
                progressElement: null,
                startTime: Date.now(),
                lastUpdateTime: Date.now(),
                lastReceivedBytes: 0
            };
            this.fileReceivers.set(metadata.fileId, receiver);
        } else {
            receiver.metadata = metadata;
            if (!receiver.isStreaming) {
                receiver.chunks = new Array(metadata.totalChunks);
            }
        }
        
        this.showFileProgress(metadata.fileId, metadata.fileName, 0, metadata.fileSize, false, metadata.userInfo);
        console.log(`开始接收文件: ${metadata.fileName} (${metadata.totalChunks} 块)`);
    }
    
    /**
     * 启动统一传输发送
     */
    async startUnifiedFileSending(file, fileId, peerId) {
        try {
            console.log(`🔒 启动统一传输发送: ${file.name}`);
            
            // 获取数据通道
            const peerData = this.peerConnections.get(peerId);
            if (!peerData || !peerData.dataChannel || peerData.dataChannel.readyState !== 'open') {
                throw new Error('没有可用的连接');
            }
            
            // 添加额外的延迟，确保接收方准备就绪
            console.log('等待接收方准备就绪...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // 显示发送进度
            this.showFileProgress(fileId, file.name, 0, file.size, true, this.currentUserInfo);
            
            // 保存this引用以在回调中使用
            const self = this;
            
            // 使用统一传输系统
            await window.unifiedTransfer.startSending(
                file,
                fileId,
                peerData.dataChannel,
                (progress, speed) => {
                    // 更新进度
                    self.updateFileProgress(fileId, progress, speed, true);
                },
                () => {
                    // 完成回调
                    console.log(`✅ 统一传输发送完成: ${file.name}`);
                    self.pendingFiles?.delete(fileId);
                    
                    // 显示完成状态
                    setTimeout(() => {
                        self.removeFileProgress(fileId);
                        self.displayFileRecord({
                            fileName: file.name,
                            fileSize: file.size,
                            fileType: file.type,
                            userInfo: self.currentUserInfo,
                            timestamp: Date.now()
                        }, true);
                    }, 1000);
                },
                (error) => {
                    // 错误回调
                    console.error('❌ 统一传输发送失败:', error);
                    self.pendingFiles?.delete(fileId);
                    self.removeFileProgress(fileId);
                    self.showNotification(`❌ 文件发送失败: ${error.message}`);
                }
            );
            
        } catch (error) {
            console.error('启动统一传输发送失败:', error);
            this.showNotification(`❌ 启动文件发送失败: ${error.message}`);
        }
    }
    
    /**
     * 启动统一传输接收
     */
    async startUnifiedFileReceiving(offer, peerId) {
        try {
            console.log(`🔒 启动统一传输接收: ${offer.fileName}`);
            
            // 显示接收进度
            this.showFileProgress(offer.fileId, offer.fileName, 0, offer.fileSize, false, offer.userInfo);
            
            // 保存this引用以在回调中使用
            const self = this;
            
            // 使用统一传输系统
            await window.unifiedTransfer.startReceiving(
                {
                    fileId: offer.fileId,
                    fileName: offer.fileName,
                    fileSize: offer.fileSize,
                    fileType: offer.fileType
                },
                (progress, speed) => {
                    // 更新进度
                    self.updateFileProgress(offer.fileId, progress, speed, false);
                },
                () => {
                    // 完成回调
                    console.log(`✅ 统一传输接收完成: ${offer.fileName}`);
                    
                    // 显示完成状态
                    setTimeout(() => {
                        self.removeFileProgress(offer.fileId);
                        self.displayFileRecord({
                            fileName: offer.fileName,
                            fileSize: offer.fileSize,
                            fileType: offer.fileType,
                            userInfo: offer.userInfo,
                            timestamp: Date.now()
                        }, false);
                    }, 1000);
                },
                (error) => {
                    // 错误回调
                    console.error('❌ 统一传输接收失败:', error);
                    self.removeFileProgress(offer.fileId);
                    self.showNotification(`❌ 文件接收失败: ${error.message}`);
                }
            );
            
        } catch (error) {
            console.error('启动统一传输接收失败:', error);
            this.showNotification(`❌ 启动文件接收失败: ${error.message}`);
        }
    }
    
    /**
     * 启动混合传输发送
     */
    async startHybridFileSending(file, fileId, peerId) {
        try {
            console.log(`🚀 启动混合传输发送: ${file.name}`);
            
            // 获取所有可用连接
            const connections = [];
            this.peerConnections.forEach((peerData, id) => {
                if (peerData.dataChannel && peerData.dataChannel.readyState === 'open') {
                    connections.push(peerData.dataChannel);
                }
            });
            
            if (connections.length === 0) {
                throw new Error('没有可用的连接');
            }
            
            // 显示发送进度
            this.showFileProgress(
                fileId, 
                file.name, 
                0, 
                file.size, 
                true, 
                this.currentUserInfo
            );
            
            // 创建混合发送器
            const sender = await window.hybridTransferEngine.createHybridSender(
                file,
                fileId,
                connections,
                (progress, speed) => {
                    // 更新进度
                    this.updateFileProgress(fileId, progress, speed, true);
                },
                () => {
                    // 完成回调
                    console.log(`✅ 混合传输发送完成: ${file.name}`);
                    this.pendingFiles?.delete(fileId);
                    
                    // 显示完成状态
                    setTimeout(() => {
                        this.removeFileProgress(fileId);
                        this.displayFileRecord({
                            fileName: file.name,
                            fileSize: file.size,
                            fileType: file.type,
                            userInfo: this.currentUserInfo,
                            timestamp: Date.now()
                        }, true);
                    }, 1000);
                },
                (error) => {
                    // 错误回调
                    console.error('❌ 混合传输发送失败:', error);
                    this.pendingFiles?.delete(fileId);
                    this.removeFileProgress(fileId);
                    this.showNotification(`❌ 文件发送失败: ${error.message}`);
                }
            );
            
        } catch (error) {
            console.error('启动混合传输发送失败:', error);
            this.showNotification(`❌ 启动文件发送失败: ${error.message}`);
        }
    }
    
    /**
     * 启动混合传输接收
     */
    async startHybridFileReceiving(offer, peerId) {
        try {
            console.log(`📥 启动混合传输接收: ${offer.fileName}`);
            
            // 初始化接收器映射
            if (!this.hybridReceivers) {
                this.hybridReceivers = new Map();
            }
            
            // 显示接收进度
            this.showFileProgress(
                offer.fileId,
                offer.fileName,
                0,
                offer.fileSize,
                false,
                offer.userInfo
            );
            
            // 创建混合接收器
            const receiver = await window.hybridTransferEngine.createHybridReceiver(
                {
                    fileId: offer.fileId,
                    fileName: offer.fileName,
                    fileSize: offer.fileSize,
                    fileType: offer.fileType
                },
                (progress, speed) => {
                    // 更新进度
                    this.updateFileProgress(offer.fileId, progress, speed, false);
                },
                () => {
                    // 完成回调
                    console.log(`✅ 混合传输接收完成: ${offer.fileName}`);
                    this.hybridReceivers?.delete(offer.fileId);
                    
                    // 显示完成状态
                    setTimeout(() => {
                        this.removeFileProgress(offer.fileId);
                        this.displayFileRecord({
                            fileName: offer.fileName,
                            fileSize: offer.fileSize,
                            fileType: offer.fileType,
                            userInfo: offer.userInfo,
                            timestamp: Date.now()
                        }, false);
                    }, 1000);
                },
                (error) => {
                    // 错误回调
                    console.error('❌ 混合传输接收失败:', error);
                    this.hybridReceivers?.delete(offer.fileId);
                    this.removeFileProgress(offer.fileId);
                    this.showNotification(`❌ 文件接收失败: ${error.message}`);
                }
            );
            
            // 保存接收器
            this.hybridReceivers.set(offer.fileId, receiver);
            
        } catch (error) {
            console.error('启动混合传输接收失败:', error);
            this.showNotification(`❌ 启动文件接收失败: ${error.message}`);
        }
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