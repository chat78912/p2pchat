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
            autoConnectInfo: document.getElementById('autoConnectInfo'),
            manualConnectInfo: document.getElementById('manualConnectInfo')
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
            const response = await fetch('assets/servers.json');
            const data = await response.json();
            
            if (!data.servers || data.servers.length === 0) {
                this.showNotification('❌ 没有可用的服务器配置');
                return;
            }
            
            this.availableServers = data.servers.sort((a, b) => (a.priority || 999) - (b.priority || 999));
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
                    await this.loadScript('assets/lan-mode.js');
                }
                    // 创建实例时传入发送消息的方法
                this.chatModeInstance = new window.LANMode(
                    (data) => this.sendWebSocketMessage(data),
                    this.isWebSocketConnected
                );
            } else {
                if (!window.InternetMode) {
                    await this.loadScript('assets/internet-mode.js');
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
            this.elements.autoConnectInfo.style.display = 'block';
            this.elements.manualConnectInfo.style.display = 'none';
            
            const messageInput = document.getElementById('messageInput');
            if (messageInput) {
                messageInput.placeholder = '检测到同网段用户后即可开始聊天...';
            }
        } else {
            this.elements.internetModeButton.classList.add('active');
            this.elements.autoConnectInfo.style.display = 'none';
            this.elements.manualConnectInfo.style.display = 'block';
            
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

// 创建全局实例
window.modeSelector = new ModeSelector();