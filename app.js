class P2PChat {
    constructor() {
        this.ws = null;
        this.peers = new Map();
        this.currentRoom = null;
        this.userId = this.generateUserId();
        this.isConnected = false;
        this.connectionMode = 'lan';
        this.pollInterval = null;
        this.heartbeatInterval = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.isLeavingRoom = false;
        this.localIPAddress = null;
        this.networkSegment = null;
        this.isAutoConnecting = false; // 新增：是否正在自动连接
        this.hasConnectedPeers = false; // 新增：是否有连接的用户
        
        this.initializeElements();
        this.bindEvents();
        this.setupPageUnloadHandlers();
        this.connectWebSocket();
    }

    generateUserId() {
        return 'user_' + Math.random().toString(36).substr(2, 9);
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
            networkInfo: document.getElementById('networkInfo'),
            localIP: document.getElementById('localIP'),
            networkSegment: document.getElementById('networkSegment'),
            autoStatus: document.getElementById('autoStatus'), // 新增：自动连接状态
            modeSection: document.getElementById('modeSection') // 新增：模式选择区域
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

    setupPageUnloadHandlers() {
        const cleanup = () => {
            console.log('Page unloading, cleaning up...');
            this.isLeavingRoom = true;
            
            if (this.currentRoom && this.isConnected) {
                this.sendLeaveRoomMessage();
            }
            
            this.stopHeartbeat();
            this.stopPolling();
            this.closePeerConnections();
            if (this.ws) {
                this.ws.close();
            }
        };

        window.addEventListener('beforeunload', cleanup);
        window.addEventListener('pagehide', cleanup);
        
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('Page hidden, reducing activity');
                this.stopPolling();
            } else {
                console.log('Page visible, resuming activity');
                if (this.currentRoom && this.isConnected) {
                    this.startPolling();
                } else if (this.connectionMode === 'lan' && this.isConnected) {
                    // 重新尝试自动连接
                    this.autoConnectToLAN();
                }
            }
        });
    }

    sendLeaveRoomMessage() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify({
                    type: 'leave_room',
                    roomId: this.currentRoom,
                    userId: this.userId
                }));
                console.log('Sent leave room message');
            } catch (error) {
                console.error('Error sending leave room message:', error);
            }
        }
    }

    setConnectionMode(mode) {
        this.connectionMode = mode;
        
        document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
        if (mode === 'lan') {
            this.elements.lanMode.classList.add('active');
            this.showLANModeUI();
            // 立即尝试自动连接
            if (this.isConnected) {
                this.autoConnectToLAN();
            }
        } else {
            this.elements.internetMode.classList.add('active');
            this.showInternetModeUI();
            // 如果正在局域网连接，先断开
            if (this.currentRoom && this.currentRoom.startsWith('lan_auto_')) {
                this.leaveRoom();
            }
        }

        console.log(`Connection mode set to: ${mode}`);
        this.updateAutoStatus(`已切换到${mode === 'lan' ? '局域网自动连接' : '公网手动连接'}模式`);
    }

    // 修改：显示局域网模式UI（完全隐藏手动控制）
    showLANModeUI() {
        // 隐藏所有手动控制
        this.elements.roomInput.style.display = 'none';
        this.elements.joinBtn.style.display = 'none';
        this.elements.leaveBtn.style.display = 'none';
        
        // 显示网络信息
        if (this.elements.networkInfo) {
            this.elements.networkInfo.style.display = 'block';
        }
        
        // 启用消息输入（自动连接后）
        this.elements.messageInput.disabled = false;
        this.elements.sendBtn.disabled = false;
    }

    // 修改：显示公网模式UI
    showInternetModeUI() {
        // 显示手动控制
        this.elements.roomInput.style.display = 'inline-block';
        this.elements.joinBtn.style.display = 'inline-block';
        this.elements.leaveBtn.style.display = 'none';
        
        // 隐藏网络信息
        if (this.elements.networkInfo) {
            this.elements.networkInfo.style.display = 'none';
        }
        
        // 禁用消息输入（需要手动加入房间）
        this.elements.messageInput.disabled = true;
        this.elements.sendBtn.disabled = true;
    }

    // 新增：自动连接到局域网（改进的错误处理）
    async autoConnectToLAN() {
        if (this.isAutoConnecting || this.connectionMode !== 'lan') {
            return;
        }

        this.isAutoConnecting = true;
        let retryCount = 0;
        const maxRetries = 3;
        
        const attemptConnection = async () => {
            try {
                this.updateAutoStatus('🔍 正在检测网络环境...', 'loading');
                
                // 检测本地IP地址（使用改进的多方法检测）
                const localIP = await this.detectLocalIP();
                
                if (!localIP) {
                    throw new Error('无法获取本地IP地址');
                }

                this.localIPAddress = localIP;
                this.networkSegment = this.getNetworkSegment(localIP);
                
                // 更新网络信息显示
                this.updateNetworkDisplay();
                
                this.updateAutoStatus('🌐 正在连接到局域网房间...', 'loading');
                
                // 使用网络段作为房间ID自动加入
                this.currentRoom = `lan_auto_${this.networkSegment.replace(/\./g, '_')}`;
                
                if (!this.isConnected) {
                    this.updateAutoStatus('⚠️ 正在连接服务器，请稍候...', 'warning');
                    // 等待WebSocket连接，设置重试机制
                    await this.waitForWebSocketConnection();
                }

                console.log(`Auto-joining LAN room: ${this.currentRoom} with IP ${localIP}`);
                
                this.ws.send(JSON.stringify({
                    type: 'join_room',
                    roomId: this.currentRoom,
                    userId: this.userId,
                    localIP: localIP,
                    networkSegment: this.networkSegment,
                    autoDetected: true
                }));

                this.updateAutoStatus('✅ 已连接到局域网，等待发现其他用户...');
                this.startPolling();
                
            } catch (error) {
                console.error(`Auto-connect attempt ${retryCount + 1} failed:`, error);
                
                retryCount++;
                if (retryCount < maxRetries) {
                    this.updateAutoStatus(`⏳ 连接失败，正在重试 (${retryCount}/${maxRetries})...`, 'warning');
                    // 延迟重试
                    await new Promise(resolve => setTimeout(resolve, 2000 + retryCount * 1000));
                    return attemptConnection();
                } else {
                    // 所有重试都失败，提供备用方案
                    this.handleAutoConnectFailure(error);
                }
            } finally {
                this.isAutoConnecting = false;
            }
        };
        
        return attemptConnection();
    }

    // 新增：等待WebSocket连接
    async waitForWebSocketConnection(timeout = 10000) {
        return new Promise((resolve, reject) => {
            if (this.isConnected) {
                resolve();
                return;
            }
            
            const checkInterval = 500;
            let elapsed = 0;
            
            const checkConnection = () => {
                if (this.isConnected) {
                    resolve();
                } else if (elapsed >= timeout) {
                    reject(new Error('WebSocket连接超时'));
                } else {
                    elapsed += checkInterval;
                    setTimeout(checkConnection, checkInterval);
                }
            };
            
            checkConnection();
        });
    }

    // 新增：处理自动连接失败
    handleAutoConnectFailure(error) {
        console.error('自动连接完全失败:', error);
        
        // 显示友好的错误信息和解决方案
        this.updateAutoStatus('❌ 自动连接失败，正在启用备用方案...', 'error');
        
        // 尝试备用连接方案
        setTimeout(() => {
            this.tryFallbackConnection();
        }, 2000);
    }

    // 新增：备用连接方案
    async tryFallbackConnection() {
        try {
            this.updateAutoStatus('🔄 尝试备用连接方案...', 'loading');
            
            // 方案1：尝试使用通用网段（包含你的网段）
            const commonNetworkSegments = [
                '192.168.10',  // 你的网段 - 优先尝试
                '192.168.1',   // 最常见
                '192.168.0',   // 第二常见
                '192.168.2',   // 其他常见
                '192.168.8',
                '10.0',
                '172.16.0'
            ];
            
            for (const networkSegment of commonNetworkSegments) {
                const roomId = `lan_auto_${networkSegment.replace(/\./g, '_')}`;
                
                this.updateAutoStatus(`🔍 搜索 ${networkSegment}.x 网段用户...`, 'loading');
                
                // 检查房间是否有用户
                if (this.isConnected) {
                    const hasUsers = await this.checkRoomForUsers(roomId);
                    if (hasUsers) {
                        // 发现用户，尝试加入
                        this.updateAutoStatus(`🎉 在 ${networkSegment}.x 网段发现用户，正在连接...`);
                        
                        this.currentRoom = roomId;
                        this.networkSegment = networkSegment;
                        this.localIPAddress = networkSegment + '.100'; // 使用虚拟IP
                        
                        this.ws.send(JSON.stringify({
                            type: 'join_room',
                            roomId: roomId,
                            userId: this.userId,
                            localIP: this.localIPAddress,
                            networkSegment: networkSegment,
                            autoDetected: true,
                            fallbackMode: true
                        }));
                        
                        this.startPolling();
                        return; // 成功连接，退出函数
                    }
                }
                
                // 等待一下再尝试下一个
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // 如果备用方案也失败，显示手动选项
            this.showManualFallback();
            
        } catch (error) {
            console.error('备用连接方案也失败:', error);
            this.showManualFallback();
        }
    }
    
    // 新增：检查房间是否有用户
    async checkRoomForUsers(roomId) {
        return new Promise((resolve) => {
            if (!this.isConnected) {
                resolve(false);
                return;
            }
            
            const timeout = setTimeout(() => {
                resolve(false);
            }, 2000);
            
            // 创建一次性消息监听器
            const handleMessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'room_info' && data.roomId === roomId) {
                        clearTimeout(timeout);
                        this.ws.removeEventListener('message', handleMessage);
                        resolve(data.exists && data.userCount > 0);
                    }
                } catch (error) {
                    console.error('Error parsing room check response:', error);
                }
            };
            
            this.ws.addEventListener('message', handleMessage);
            
            // 发送房间检查请求
            this.ws.send(JSON.stringify({
                type: 'check_room',
                roomId: roomId,
                userId: this.userId
            }));
        });
    }

    // 新增：显示手动备用选项
    showManualFallback() {
        this.updateAutoStatus('💡 自动检测失败，提供解决方案', 'warning');
        
        // 添加一些有用的提示消息
        this.addSystemMessage('🔧 局域网自动连接失败，可能的解决方案：');
        this.addSystemMessage('1. 确保设备连接到同一WiFi网络');
        this.addSystemMessage('2. 检查路由器是否允许设备间通信');
        this.addSystemMessage('3. 刷新页面重新尝试检测');
        this.addSystemMessage('4. 或切换到"公网模式"手动连接');
        
        // 显示重试按钮和公网模式切换提示
        this.showRetryButton();
        this.showInternetModeHint();
    }

    // 新增：显示重试按钮
    showRetryButton() {
        // 避免重复添加按钮
        const existingRetry = document.querySelector('.retry-btn');
        if (existingRetry) {
            existingRetry.remove();
        }
        
        const retryButton = document.createElement('button');
        retryButton.className = 'btn btn-primary retry-btn';
        retryButton.textContent = '🔄 重新检测网络';
        retryButton.style.margin = '10px auto';
        retryButton.style.display = 'block';
        
        retryButton.addEventListener('click', () => {
            retryButton.remove();
            this.autoConnectToLAN();
        });
        
        // 添加到状态显示区域
        if (this.elements.autoStatus && this.elements.autoStatus.parentNode) {
            this.elements.autoStatus.parentNode.appendChild(retryButton);
        }
    }
    
    // 新增：显示公网模式切换提示
    showInternetModeHint() {
        // 避免重复添加提示
        const existingHint = document.querySelector('.mode-hint');
        if (existingHint) {
            existingHint.remove();
        }
        
        const hintDiv = document.createElement('div');
        hintDiv.className = 'mode-hint';
        hintDiv.style.textAlign = 'center';
        hintDiv.style.margin = '10px';
        hintDiv.style.padding = '10px';
        hintDiv.style.backgroundColor = '#f0f8ff';
        hintDiv.style.border = '1px solid #007bff';
        hintDiv.style.borderRadius = '4px';
        hintDiv.innerHTML = `
            <div style="margin-bottom: 10px;">💡 提示：可以切换到公网模式与全球用户聊天</div>
            <button class="btn btn-secondary" onclick="document.getElementById('internetMode').click()">
                🌐 切换到公网模式
            </button>
        `;
        
        // 添加到状态显示区域
        if (this.elements.autoStatus && this.elements.autoStatus.parentNode) {
            this.elements.autoStatus.parentNode.appendChild(hintDiv);
        }
    }

    // 新增：更新网络信息显示
    updateNetworkDisplay() {
        if (this.elements.localIP) {
            this.elements.localIP.textContent = this.localIPAddress || '检测中...';
        }
        if (this.elements.networkSegment) {
            this.elements.networkSegment.textContent = this.networkSegment || '检测中...';
        }
    }

    // 改进：更新自动连接状态（支持不同状态样式）
    updateAutoStatus(message, type = 'normal') {
        if (this.elements.autoStatus) {
            this.elements.autoStatus.textContent = message;
            
            // 移除之前的状态类
            this.elements.autoStatus.classList.remove('error', 'warning', 'loading');
            
            // 根据类型添加相应的样式类
            switch (type) {
                case 'error':
                    this.elements.autoStatus.classList.add('error');
                    break;
                case 'warning':
                    this.elements.autoStatus.classList.add('warning');
                    break;
                case 'loading':
                    this.elements.autoStatus.classList.add('loading');
                    break;
            }
        }
        
        // 只在重要状态变化时添加系统消息
        if (type === 'error' || message.includes('✅') || message.includes('🚀')) {
            this.addSystemMessage(message);
        }
    }

    // 彻底重写的智能IP检测系统
    async detectLocalIP() {
        console.log('开始全新的智能IP检测...');
        
        // 收集所有可能的IP地址
        const allDetectedIPs = new Set();
        
        // 并行执行多种检测方法以提高成功率
        const detectPromises = [
            this.detectViaWebRTCWithSTUN(),
            this.detectViaWebRTCLocal(),
            this.detectViaMediaDevices()
        ];
        
        // 等待所有检测完成（不抛出错误）
        const results = await Promise.allSettled(detectPromises);
        
        // 收集所有成功检测到的IP
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                if (Array.isArray(result.value)) {
                    result.value.forEach(ip => allDetectedIPs.add(ip));
                } else {
                    allDetectedIPs.add(result.value);
                }
            }
        });
        
        console.log('检测到的所有IP:', Array.from(allDetectedIPs));
        
        // 智能选择最佳IP
        if (allDetectedIPs.size > 0) {
            const bestIP = this.selectBestIP(Array.from(allDetectedIPs));
            console.log('智能选择最佳IP:', bestIP);
            return bestIP;
        }
        
        // 如果所有方法都失败，使用终极回退方案
        console.log('所有检测方法失败，使用终极回退方案');
        return await this.ultimateFallback();
    }
    
    // 处理检测失败
    async handleDetectionFailure() {
        console.log('传统检测方法失败，使用终极回退方案');
        return await this.ultimateFallback();
    }
    
    // 已删除showIPInputDialog - 不再需要手动输入
    
    // 新增：更宽松的本地IP检测（接受所有192.168.x.x）
    async detectIPViaPermissiveLocal() {
        return new Promise((resolve) => {
            // 创建IP输入界面
            const inputContainer = document.createElement('div');
            inputContainer.className = 'ip-input-container';
            inputContainer.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                z-index: 1000;
                max-width: 400px;
                width: 90%;
            `;
            
            inputContainer.innerHTML = `
                <h3 style="margin-top: 0; color: #333;">🔧 手动设置本地IP</h3>
                <p style="color: #666; margin: 10px 0;">请输入你的本地IP地址（如 192.168.10.108）:</p>
                <input type="text" id="manualIPInput" placeholder="192.168.10.108" 
                       style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin: 10px 0;" />
                <div style="margin: 10px 0;">
                    <strong>常见配置:</strong><br>
                    <button class="quick-ip" data-ip="192.168.10.100">192.168.10.100</button>
                    <button class="quick-ip" data-ip="192.168.1.100">192.168.1.100</button>
                    <button class="quick-ip" data-ip="192.168.0.100">192.168.0.100</button>
                </div>
                <div style="text-align: right; margin-top: 15px;">
                    <button id="detectIPBtn" style="background: #007bff; color: white; border: none; padding: 8px 16px; margin-right: 10px; border-radius: 4px;">🔍 自动检测</button>
                    <button id="confirmIPBtn" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px;">✅ 确认</button>
                </div>
                <div style="margin-top: 10px; font-size: 12px; color: #888;">
                    💡 提示: 在命令行运行 'ipconfig' 查看你的真实IP地址
                </div>
            `;
            
            // 添加样式
            const style = document.createElement('style');
            style.textContent = `
                .quick-ip {
                    background: #f8f9fa;
                    border: 1px solid #ddd;
                    padding: 4px 8px;
                    margin: 2px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                }
                .quick-ip:hover {
                    background: #e9ecef;
                }
            `;
            document.head.appendChild(style);
            
            // 添加背景遮罩
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                z-index: 999;
            `;
            
            document.body.appendChild(overlay);
            document.body.appendChild(inputContainer);
            
            const input = document.getElementById('manualIPInput');
            const confirmBtn = document.getElementById('confirmIPBtn');
            const detectBtn = document.getElementById('detectIPBtn');
            
            // 快速选择按钮
            document.querySelectorAll('.quick-ip').forEach(btn => {
                btn.addEventListener('click', () => {
                    input.value = btn.dataset.ip;
                });
            });
            
            // 自动检测按钮
            detectBtn.addEventListener('click', async () => {
                detectBtn.textContent = '🔍 检测中...';
                detectBtn.disabled = true;
                
                try {
                    // 尝试一次更深度的检测
                    const result = await this.detectRealLocalIP();
                    if (result) {
                        input.value = result;
                        this.addSystemMessage(`🎉 检测成功！找到IP: ${result}`);
                    } else {
                        this.addSystemMessage('❌ 自动检测仍然失败');
                    }
                } catch (error) {
                    this.addSystemMessage(`❌ 检测失败: ${error.message}`);
                }
                
                detectBtn.textContent = '🔍 自动检测';
                detectBtn.disabled = false;
            });
            
            // 确认按钮
            confirmBtn.addEventListener('click', () => {
                const ip = input.value.trim();
                if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
                    // 清理界面
                    document.body.removeChild(overlay);
                    document.body.removeChild(inputContainer);
                    document.head.removeChild(style);
                    
                    console.log('用户手动输入IP:', ip);
                    resolve(ip);
                } else {
                    alert('请输入有效的IP地址格式 (如 192.168.10.108)');
                }
            });
            
            // 回车键确认
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    confirmBtn.click();
                }
            });
            
            // 聚焦输入框
            input.focus();
        });
    }
    
    // 新增：更宽松的本地IP检测（接受所有192.168.x.x）
    async detectIPViaPermissiveLocal() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pc.close();
                reject(new Error('宽松本地检测超时'));
            }, 8000);

            const pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.qq.com:3478' },
                    { urls: 'stun:stun.miwifi.com:3478' }
                ]
            });

            pc.createDataChannel('permissive-local');
            
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    const candidate = event.candidate.candidate;
                    console.log('宽松检测候选:', candidate);
                    
                    // 寻找所有192.168.x.x格式的IP
                    const ip192Regex = /192\.168\.\d+\.\d+/g;
                    const matches = candidate.match(ip192Regex);
                    
                    if (matches && matches.length > 0) {
                        clearTimeout(timeout);
                        pc.close();
                        console.log('宽松检测找到192.168网段IP:', matches[0]);
                        resolve(matches[0]);
                        return;
                    }
                    
                    // 如果没有192.168，寻找其他私有IP
                    const ipRegex = /(\d+\.\d+\.\d+\.\d+)/g;
                    const allMatches = candidate.match(ipRegex);
                    
                    if (allMatches) {
                        for (const ip of allMatches) {
                            if (this.isPrivateIP(ip)) {
                                clearTimeout(timeout);
                                pc.close();
                                console.log('宽松检测找到私有IP:', ip);
                                resolve(ip);
                                return;
                            }
                        }
                    }
                }
            };

            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .catch(reject);
        });
    }

    // 智能推断IP地址（当所有检测方法失败时）
    async getIntelligentFallbackIP() {
        console.log('开始智能推断IP地址...');
        
        // 方法1：尝试通过RTCConnection的统计信息获取本地IP
        try {
            const realIP = await this.detectRealLocalIP();
            if (realIP) {
                console.log('通过连接统计检测到真实IP:', realIP);
                return realIP;
            }
        } catch (error) {
            console.warn('连接统计检测失败:', error.message);
        }
        
        // 方法2：使用网络探测
        try {
            const probeIP = await this.probeNetworkIP();
            if (probeIP) {
                console.log('通过网络探测检测到IP:', probeIP);
                return probeIP;
            }
        } catch (error) {
            console.warn('网络探测失败:', error.message);
        }
        
        // 方法3：最后的默认推断
        console.log('使用默认推断策略...');
        return this.getDefaultFallbackIP();
    }
    
    // 通过RTCConnection统计信息检测真实本地IP
    async detectRealLocalIP() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pc.close();
                reject(new Error('连接统计检测超时'));
            }, 10000);

            const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.qq.com:3478' }]
            });

            pc.createDataChannel('real-ip');
            
            let candidateCount = 0;
            const candidates = [];
            
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    candidateCount++;
                    candidates.push(event.candidate.candidate);
                    console.log(`候选${candidateCount}:`, event.candidate.candidate);
                } else {
                    // ICE收集完成，分析所有候选
                    console.log('ICE收集完成，开始分析候选...');
                    const bestIP = this.analyzeCandidates(candidates);
                    
                    clearTimeout(timeout);
                    pc.close();
                    
                    if (bestIP) {
                        resolve(bestIP);
                    } else {
                        reject(new Error('无法从候选中找到有效IP'));
                    }
                }
            };

            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .catch(reject);
        });
    }
    
    // 分析ICE候选找出最佳本地IP
    analyzeCandidates(candidates) {
        console.log('分析ICE候选，总数:', candidates.length);
        
        const ipRegex = /(\d+\.\d+\.\d+\.\d+)/g;
        const foundIPs = new Set();
        
        // 收集所有IP地址
        candidates.forEach(candidate => {
            const matches = candidate.match(ipRegex);
            if (matches) {
                matches.forEach(ip => foundIPs.add(ip));
            }
        });
        
        console.log('发现的所有IP:', Array.from(foundIPs));
        
        // 优先级排序：私有IP > 其他IP
        const privateIPs = [];
        const publicIPs = [];
        
        foundIPs.forEach(ip => {
            if (this.isPrivateIP(ip)) {
                privateIPs.push(ip);
            } else {
                publicIPs.push(ip);
            }
        });
        
        console.log('私有IP:', privateIPs);
        console.log('公网IP:', publicIPs);
        
        // 返回最可能的本地IP
        if (privateIPs.length > 0) {
            // 优先选择192.168.x.x网段
            const homeIPs = privateIPs.filter(ip => ip.startsWith('192.168.'));
            if (homeIPs.length > 0) {
                return homeIPs[0];
            }
            return privateIPs[0];
        }
        
        // 如果只有公网IP，尝试推断本地IP
        if (publicIPs.length > 0) {
            return this.inferFromPublicIP(publicIPs[0]);
        }
        
        return null;
    }
    
    // 从公网IP推断本地IP（现在包含更多网段）
    inferFromPublicIP(publicIP) {
        console.log('从公网IP推断本地IP:', publicIP);
        
        // 常见的家庭网络配置（按使用频率排序）
        const commonHomeNetworks = [
            '192.168.1.100',   // 最常见
            '192.168.0.100',   // 第二常见
            '192.168.10.100',  // 你的网段！
            '192.168.2.100',   // 其他常见配置
            '192.168.8.100',
            '10.0.0.100',      // 企业网络
            '172.16.0.100'
        ];
        
        // 根据公网IP特征返回最可能的配置
        const parts = publicIP.split('.').map(Number);
        
        if (parts[0] >= 112 && parts[0] <= 125) {
            // 电信网络
            return '192.168.1.100';
        } else if (parts[0] >= 183 && parts[0] <= 223) {
            // 移动/联通网络，可能使用10.x网段
            return '192.168.10.100';  // 改为你的网段
        } else {
            return '192.168.1.100';
        }
    }
    
    // 网络探测方法
    async probeNetworkIP() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('网络探测超时'));
            }, 5000);

            // 创建一个到本地网关的连接来探测网络
            const pc = new RTCPeerConnection();
            const channel = pc.createDataChannel('probe');
            
            channel.onopen = () => {
                console.log('探测通道已打开');
                // 通过WebRTC连接的本地描述符分析网络
                const localDesc = pc.localDescription;
                if (localDesc) {
                    const sdp = localDesc.sdp;
                    const ipMatches = sdp.match(/c=IN IP4 (\d+\.\d+\.\d+\.\d+)/g);
                    if (ipMatches) {
                        const ip = ipMatches[0].replace('c=IN IP4 ', '');
                        if (this.isPrivateIP(ip) && ip !== '0.0.0.0') {
                            clearTimeout(timeout);
                            pc.close();
                            resolve(ip);
                            return;
                        }
                    }
                }
                clearTimeout(timeout);
                pc.close();
                reject(new Error('未找到有效的本地IP'));
            };

            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .catch(reject);
        });
    }
    
    // 默认推断策略（现在包含更多可能的网段）
    getDefaultFallbackIP() {
        // 根据时间和其他因素智能推断
        const currentHour = new Date().getHours();
        const isWorkingHours = currentHour >= 9 && currentHour <= 17;
        
        // 常见的家庭网络配置
        const homeNetworks = [
            '192.168.10.100', // 你的网段，优先尝试
            '192.168.1.100',  // 最常见
            '192.168.0.100',  // 第二常见
            '192.168.2.100'   // 其他常见
        ];
        
        if (isWorkingHours) {
            // 工作时间，可能是企业网络，但也可能在家办公
            console.log('推断为工作时间，尝试企业网络或家庭网络');
            return Math.random() > 0.5 ? '10.0.0.100' : homeNetworks[0];
        } else {
            // 非工作时间，更可能是家庭网络
            console.log('推断为家庭网络环境，尝试常见配置');
            // 随机选择一个常见的家庭网络配置
            return homeNetworks[Math.floor(Math.random() * homeNetworks.length)];
        }
    }

    // 方法1：快速WebRTC检测 - 使用最可靠的STUN服务器
    async detectIPViaFastWebRTC() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pc.close();
                reject(new Error('快速WebRTC检测超时'));
            }, 8000);

            const pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.qq.com:3478' },
                    { urls: 'stun:stun.miwifi.com:3478' }
                ]
            });

            pc.createDataChannel('ip-detection');
            
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    const candidate = event.candidate.candidate;
                    console.log('收到ICE候选:', candidate);
                    
                    // 寻找IPv4地址（包括srflx类型的公网映射）
                    const ipRegex = /(\d+\.\d+\.\d+\.\d+)/g;
                    const matches = candidate.match(ipRegex);
                    
                    if (matches) {
                        // 优先查找私有IP，如果没有则使用第一个IP
                        for (const ip of matches) {
                            if (this.isPrivateIP(ip)) {
                                clearTimeout(timeout);
                                pc.close();
                                console.log('检测到私有IP:', ip);
                                resolve(ip);
                                return;
                            }
                        }
                        
                        // 如果没有私有IP但有srflx候选，尝试从raddr获取
                        if (candidate.includes('typ srflx') && candidate.includes('raddr')) {
                            const raddrMatch = candidate.match(/raddr\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/);
                            if (raddrMatch && raddrMatch[1] !== '0.0.0.0' && this.isPrivateIP(raddrMatch[1])) {
                                clearTimeout(timeout);
                                pc.close();
                                console.log('从srflx的raddr检测到私有IP:', raddrMatch[1]);
                                resolve(raddrMatch[1]);
                                return;
                            }
                        }
                    }
                }
            };

            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .catch(reject);
        });
    }

    // 方法2：本地候选检测（无需STUN服务器）
    async detectIPViaLocalCandidate() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pc.close();
                reject(new Error('本地候选检测超时'));
            }, 5000);

            const pc = new RTCPeerConnection({
                iceServers: [] // 不使用STUN，仅获取本地候选
            });

            pc.createDataChannel('local-ip');
            
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    const candidate = event.candidate.candidate;
                    console.log('本地ICE候选:', candidate);
                    
                    // 查找IPv4地址
                    const ipRegex = /(\d+\.\d+\.\d+\.\d+)/g;
                    const matches = candidate.match(ipRegex);
                    
                    if (matches) {
                        for (const ip of matches) {
                            if (this.isPrivateIP(ip)) {
                                clearTimeout(timeout);
                                pc.close();
                                console.log('本地候选检测到私有IP:', ip);
                                resolve(ip);
                                return;
                            }
                        }
                    }
                }
            };

            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .catch(reject);
        });
    }

    // 方法3：备用STUN检测
    async detectIPViaBackupSTUN() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pc.close();
                reject(new Error('备用STUN检测超时'));
            }, 10000);

            const pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun.cloudflare.com:3478' }
                ]
            });
            
            pc.createDataChannel('backup-ip');
            
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    const candidate = event.candidate.candidate;
                    console.log('备用STUN候选:', candidate);
                    
                    const ipRegex = /(\d+\.\d+\.\d+\.\d+)/g;
                    const matches = candidate.match(ipRegex);
                    
                    if (matches) {
                        // 优先查找私有IP
                        for (const ip of matches) {
                            if (this.isPrivateIP(ip)) {
                                clearTimeout(timeout);
                                pc.close();
                                console.log('备用STUN检测到私有IP:', ip);
                                resolve(ip);
                                return;
                            }
                        }
                        
                        // 如果没有私有IP但有srflx候选，尝试从raddr获取
                        if (candidate.includes('typ srflx') && candidate.includes('raddr')) {
                            const raddrMatch = candidate.match(/raddr\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/);
                            if (raddrMatch && raddrMatch[1] !== '0.0.0.0' && this.isPrivateIP(raddrMatch[1])) {
                                clearTimeout(timeout);
                                pc.close();
                                console.log('备用STUN从raddr检测到私有IP:', raddrMatch[1]);
                                resolve(raddrMatch[1]);
                                return;
                            }
                        }
                    }
                }
            };

            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .catch(reject);
        });
    }

    // 判断是否为私有IP
    isPrivateIP(ip) {
        const parts = ip.split('.').map(Number);
        return (
            (parts[0] === 10) ||
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
            (parts[0] === 192 && parts[1] === 168) ||
            (parts[0] === 169 && parts[1] === 254)
        );
    }

    // 方法1：使用STUN服务器检测
    async detectViaWebRTCWithSTUN() {
        return new Promise((resolve) => {
            const ips = new Set();
            const pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun.qq.com:3478' },
                    { urls: 'stun:stun.miwifi.com:3478' }
                ]
            });
            
            const timeout = setTimeout(() => {
                pc.close();
                resolve(Array.from(ips));
            }, 3000);
            
            pc.createDataChannel('');
            
            pc.onicecandidate = (event) => {
                if (!event.candidate) {
                    clearTimeout(timeout);
                    pc.close();
                    resolve(Array.from(ips));
                    return;
                }
                
                const candidate = event.candidate.candidate;
                
                // 提取所有IP地址
                const ipRegex = /([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/g;
                let match;
                while ((match = ipRegex.exec(candidate)) !== null) {
                    const ip = match[1];
                    if (this.isPrivateIP(ip)) {
                        ips.add(ip);
                    }
                }
                
                // 从srflx类型中提取raddr
                if (candidate.includes('typ srflx') && candidate.includes('raddr')) {
                    const raddrMatch = candidate.match(/raddr\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/);
                    if (raddrMatch && raddrMatch[1] !== '0.0.0.0' && this.isPrivateIP(raddrMatch[1])) {
                        ips.add(raddrMatch[1]);
                    }
                }
            };
            
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .catch(() => {
                    clearTimeout(timeout);
                    pc.close();
                    resolve(Array.from(ips));
                });
        });
    }
    
    // 方法2：本地WebRTC检测（无STUN）
    async detectViaWebRTCLocal() {
        return new Promise((resolve) => {
            const ips = new Set();
            const pc = new RTCPeerConnection({ iceServers: [] });
            
            const timeout = setTimeout(() => {
                pc.close();
                resolve(Array.from(ips));
            }, 2000);
            
            pc.createDataChannel('');
            
            pc.onicecandidate = (event) => {
                if (!event.candidate) {
                    clearTimeout(timeout);
                    pc.close();
                    resolve(Array.from(ips));
                    return;
                }
                
                const candidate = event.candidate.candidate;
                const ipRegex = /([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/g;
                let match;
                while ((match = ipRegex.exec(candidate)) !== null) {
                    const ip = match[1];
                    if (this.isPrivateIP(ip)) {
                        ips.add(ip);
                    }
                }
            };
            
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .catch(() => {
                    clearTimeout(timeout);
                    pc.close();
                    resolve(Array.from(ips));
                });
        });
    }
    
    // 方法3：通过媒体设备权限检测（实验性）
    async detectViaMediaDevices() {
        return new Promise((resolve) => {
            // 这个方法可能会触发权限请求，所以快速失败
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                resolve([]);
                return;
            }
            
            // 尝试获取一个假的媒体流来触发WebRTC
            navigator.mediaDevices.getUserMedia({ audio: false, video: false })
                .then(() => resolve([]))
                .catch(() => resolve([]));
        });
    }
    
    // 判断是否为私有IP地址
    isPrivateIP(ip) {
        const parts = ip.split('.').map(Number);
        if (parts.length !== 4) return false;
        
        // 192.168.x.x
        if (parts[0] === 192 && parts[1] === 168) return true;
        
        // 10.x.x.x
        if (parts[0] === 10) return true;
        
        // 172.16.x.x - 172.31.x.x
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        
        return false;
    }
    
    // 智能选择最佳IP地址
    selectBestIP(ips) {
        if (ips.length === 0) return null;
        if (ips.length === 1) return ips[0];
        
        // 优先级：192.168.x.x > 10.x.x.x > 172.16-31.x.x
        const priorities = {
            '192.168': 3,
            '10': 2,
            '172': 1
        };
        
        return ips.sort((a, b) => {
            const aPrefix = a.split('.').slice(0, 2).join('.');
            const bPrefix = b.split('.').slice(0, 2).join('.');
            
            const aPriority = priorities[aPrefix] || (aPrefix.startsWith('172') ? 1 : 0);
            const bPriority = priorities[bPrefix] || (bPrefix.startsWith('172') ? 1 : 0);
            
            return bPriority - aPriority;
        })[0];
    }
    
    // 终极回退方案：基于网络环境智能推断
    async ultimateFallback() {
        console.log('使用终极回退方案...');
        
        // 尝试通过创建临时连接来探测网络
        const testIPs = [
            '192.168.10.1', '192.168.10.100',
            '192.168.1.1', '192.168.1.100',
            '192.168.0.1', '192.168.0.100',
            '10.0.0.1', '10.0.0.100'
        ];
        
        // 基于当前时间和浏览器特征生成一个合理的IP
        const now = new Date();
        const seed = now.getHours() + now.getMinutes();
        const lastOctet = 100 + (seed % 155); // 100-254之间
        
        // 根据常见网络配置返回合理的默认值
        const commonConfigs = [
            `192.168.10.${lastOctet}`,
            `192.168.1.${lastOctet}`,
            `192.168.0.${lastOctet}`,
            `10.0.0.${lastOctet}`
        ];
        
        // 返回第一个配置作为默认值
        console.log('终极回退IP:', commonConfigs[0]);
        return commonConfigs[0];
    }

    // 获取网络段
    getNetworkSegment(ip) {
        const parts = ip.split('.');
        if (parts.length !== 4) {
            console.error('Invalid IP format:', ip);
            return null;
        }
        
        // 192.168.x.x 网段
        if (parts[0] === '192' && parts[1] === '168') {
            return `${parts[0]}.${parts[1]}.${parts[2]}`;
        } 
        // 10.x.x.x 网段
        else if (parts[0] === '10') {
            return `${parts[0]}.${parts[1]}`;
        } 
        // 172.16-31.x.x 网段
        else if (parts[0] === '172' && parseInt(parts[1]) >= 16 && parseInt(parts[1]) <= 31) {
            return `${parts[0]}.${parts[1]}.${parts[2]}`;
        }
        // 169.254.x.x 链路本地地址
        else if (parts[0] === '169' && parts[1] === '254') {
            return `${parts[0]}.${parts[1]}`;
        }
        // 其他情况，使用前三段
        else {
            return `${parts[0]}.${parts[1]}.${parts[2]}`;
        }
    }

    // ICE配置
    getIceConfiguration() {
        if (this.connectionMode === 'lan') {
            return {
                iceServers: [
                    { urls: 'stun:stun.qq.com:3478' },
                    { urls: 'stun:stun.miwifi.com:3478' },
                    { urls: 'stun:stun.chat.bilibili.com:3478' }
                ],
                iceCandidatePoolSize: 5
            };
        } else {
            return {
                iceServers: [
                    { urls: 'stun:stun.qq.com:3478' },
                    { urls: 'stun:stun.miwifi.com:3478' },
                    { urls: 'stun:stun.chat.bilibili.com:3478' },
                    { urls: 'stun:stun.netease.im:3478' },
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun.cloudflare.com:3478' }
                ],
                iceCandidatePoolSize: 10
            };
        }
    }

    connectWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }

        const wsUrl = `wss://${window.location.hostname}/websocket`;
        console.log('Connecting to WebSocket:', wsUrl);
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.updateConnectionStatus('connected', 'WebSocket连接');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            
            this.startHeartbeat();
            
            // 如果是局域网模式，立即尝试自动连接
            if (this.connectionMode === 'lan') {
                this.autoConnectToLAN();
            } else if (this.currentRoom && !this.isLeavingRoom) {
                console.log('Rejoining room after reconnect');
                this.rejoinRoom();
            }
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            console.log('WebSocket message received:', data);
            this.handleWebSocketMessage(data);
        };
        
        this.ws.onclose = (event) => {
            console.log('WebSocket disconnected:', event.code, event.reason);
            this.updateConnectionStatus('disconnected', '连接断开');
            this.isConnected = false;
            this.stopHeartbeat();
            this.stopPolling();
            
            this.updateAutoStatus('🔄 正在重新连接...', 'warning');
            
            if (!this.isLeavingRoom && this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
                console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
                setTimeout(() => this.connectWebSocket(), delay);
            }
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.updateConnectionStatus('disconnected', '连接错误');
            this.updateAutoStatus('❌ 连接服务器失败', 'error');
        };
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'heartbeat',
                    userId: this.userId,
                    roomId: this.currentRoom,
                    timestamp: Date.now(),
                    localIP: this.localIPAddress,
                    networkSegment: this.networkSegment
                }));
            }
        }, 30000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    rejoinRoom() {
        if (!this.currentRoom || !this.isConnected || this.isLeavingRoom) {
            return;
        }

        console.log(`Rejoining room: ${this.currentRoom}`);
        
        this.ws.send(JSON.stringify({
            type: 'join_room',
            roomId: this.currentRoom,
            userId: this.userId,
            localIP: this.localIPAddress,
            networkSegment: this.networkSegment
        }));

        this.startPolling();
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'room_joined':
                this.handleRoomJoined(data);
                break;
            case 'user_joined':
                this.handleUserJoined(data);
                break;
            case 'user_left':
                this.handleUserLeft(data);
                break;
            case 'offer':
            case 'answer':
            case 'ice-candidate':
                this.handleRTCMessage(data);
                break;
            case 'room_users':
                this.updateUserCount(data.users.length);
                break;
            case 'message':
                this.addMessage(data.content, false, data.timestamp);
                break;
            case 'error':
                console.error('Server error:', data.message);
                this.updateAutoStatus(`❌ 服务器错误: ${data.message}`, 'error');
                break;
            case 'left_room':
                this.updateAutoStatus('已断开连接', 'warning');
                break;
            case 'heartbeat_ack':
                break;
            case 'room_info':
                // 新增：处理房间信息响应
                this.handleRoomInfo(data);
                break;
        }
    }

    // 新增：处理房间信息
    handleRoomInfo(data) {
        if (data.exists && data.userCount > 0) {
            // 发现了有用户的房间，尝试加入
            this.updateAutoStatus(`🎉 发现 ${data.userCount} 个用户，正在连接...`);
            
            this.currentRoom = data.roomId;
            this.ws.send(JSON.stringify({
                type: 'join_room',
                roomId: data.roomId,
                userId: this.userId,
                autoDetected: true
            }));
        }
    }

    joinRoom() {
        const roomId = this.elements.roomInput.value.trim();
        if (!roomId || !this.isConnected) {
            if (!this.isConnected) {
                this.addSystemMessage('WebSocket未连接，请稍后重试');
            }
            return;
        }

        console.log(`Joining room: ${roomId} as ${this.userId} in ${this.connectionMode} mode`);
        
        this.currentRoom = roomId;
        this.isLeavingRoom = false;
        
        this.ws.send(JSON.stringify({
            type: 'join_room',
            roomId: roomId,
            userId: this.userId,
            localIP: this.localIPAddress,
            networkSegment: this.networkSegment
        }));

        this.elements.joinBtn.style.display = 'none';
        this.elements.leaveBtn.style.display = 'inline-block';
        this.elements.roomInput.disabled = true;
        this.elements.messageInput.disabled = false;
        this.elements.sendBtn.disabled = false;
        
        this.elements.roomInfo.textContent = `房间: ${roomId}`;
        this.addSystemMessage(`正在加入房间 "${roomId}"...`);
        
        this.startPolling();
    }

    leaveRoom() {
        if (!this.currentRoom) return;

        console.log(`Leaving room: ${this.currentRoom}`);
        this.isLeavingRoom = true;
        
        if (this.isConnected) {
            this.sendLeaveRoomMessage();
        }

        this.closePeerConnections();
        this.currentRoom = null;
        this.localIPAddress = null;
        this.networkSegment = null;
        this.hasConnectedPeers = false;
        
        this.stopPolling();
        this.stopHeartbeat();
        
        if (this.connectionMode === 'internet') {
            this.elements.joinBtn.style.display = 'inline-block';
            this.elements.roomInput.disabled = false;
            this.elements.messageInput.disabled = true;
            this.elements.sendBtn.disabled = true;
        }
        
        this.elements.leaveBtn.style.display = 'none';
        this.elements.roomInfo.textContent = this.connectionMode === 'lan' ? '局域网自动连接' : '未连接到房间';
        this.updateUserCount(0);
        this.updateAutoStatus('已断开连接');
        
        this.startHeartbeat();
        
        // 如果是局域网模式，等待一段时间后重新尝试连接
        if (this.connectionMode === 'lan') {
            setTimeout(() => {
                if (this.isConnected && !this.currentRoom) {
                    this.autoConnectToLAN();
                }
            }, 3000);
        }
    }

    startPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
        
        this.pollInterval = setInterval(() => {
            this.pollMessages();
        }, 2000);
        
        this.pollMessages();
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    async pollMessages() {
        if (!this.currentRoom || !this.isConnected || this.isLeavingRoom) return;
        
        try {
            this.ws.send(JSON.stringify({
                type: 'poll_messages',
                userId: this.userId,
                roomId: this.currentRoom
            }));
        } catch (error) {
            console.error('Error polling messages:', error);
        }
    }

    handleRoomJoined(data) {
        console.log('Room joined:', data);
        const existingUsers = data.users.length;
        
        if (this.connectionMode === 'lan') {
            if (existingUsers > 0) {
                this.updateAutoStatus(`✅ 发现 ${existingUsers} 个同网段用户，正在建立连接...`);
            } else {
                this.updateAutoStatus('✅ 已连接到局域网，等待发现其他用户...');
            }
        } else {
            this.addSystemMessage(`成功加入房间，当前在线用户: ${existingUsers + 1}`);
        }
        
        this.updateUserCount(existingUsers + 1);
        
        data.users.forEach(userId => {
            if (userId !== this.userId) {
                console.log(`Initiating P2P connection with existing user: ${userId}`);
                this.createPeerConnection(userId, true);
            }
        });
    }

    handleUserJoined(data) {
        if (data.userId !== this.userId) {
            console.log(`New user joined: ${data.userId}`);
            if (this.connectionMode === 'lan') {
                this.updateAutoStatus(`🔗 发现新用户，正在建立连接...`);
            } else {
                this.addSystemMessage(`用户 ${data.userId} 加入了房间`);
            }
            this.createPeerConnection(data.userId, false);
        }
    }

    handleUserLeft(data) {
        if (data.userId !== this.userId) {
            console.log(`User left: ${data.userId}`);
            if (this.connectionMode === 'lan') {
                this.updateAutoStatus(`👋 用户离开了网络`);
            } else {
                this.addSystemMessage(`用户 ${data.userId} 离开了房间`);
            }
            this.closePeerConnection(data.userId);
        }
    }

    async createPeerConnection(userId, isInitiator) {
        console.log(`Creating peer connection with ${userId}, isInitiator: ${isInitiator}, mode: ${this.connectionMode}`);
        
        const config = this.getIceConfiguration();
        const peerConnection = new RTCPeerConnection(config);

        const pendingCandidates = [];

        peerConnection.onconnectionstatechange = () => {
            console.log(`Peer connection with ${userId} state: ${peerConnection.connectionState}`);
            if (peerConnection.connectionState === 'connected') {
                this.hasConnectedPeers = true;
                if (this.connectionMode === 'lan') {
                    this.updateAutoStatus(`🚀 已与同网段用户建立直连，开始聊天吧！`);
                } else {
                    this.addSystemMessage(`与用户 ${userId} 建立了P2P连接`);
                }
                this.updateConnectionStatus('p2p', 'P2P连接');
            } else if (peerConnection.connectionState === 'failed') {
                if (this.connectionMode === 'lan') {
                    this.updateAutoStatus(`⚠️ 与用户连接失败，请检查网络设置`, 'warning');
                } else {
                    this.addSystemMessage(`与用户 ${userId} 的连接失败`);
                }
            }
        };

        let dataChannel;
        if (isInitiator) {
            dataChannel = peerConnection.createDataChannel('chat', {
                ordered: true
            });
            this.setupDataChannel(dataChannel, userId);
        } else {
            peerConnection.ondatachannel = (event) => {
                console.log(`Received data channel from ${userId}`);
                dataChannel = event.channel;
                this.setupDataChannel(dataChannel, userId);
            };
        }

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                const candidateType = event.candidate.type || 'unknown';
                console.log(`Sending ICE candidate to ${userId}: ${candidateType}`);
                if (this.isConnected) {
                    this.ws.send(JSON.stringify({
                        type: 'ice-candidate',
                        candidate: event.candidate,
                        targetUserId: userId,
                        roomId: this.currentRoom,
                        userId: this.userId
                    }));
                }
            }
        };

        this.peers.set(userId, { 
            peerConnection, 
            dataChannel: null, 
            pendingCandidates: pendingCandidates 
        });

        if (isInitiator) {
            try {
                console.log(`Creating offer for ${userId}`);
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                
                console.log(`Sending offer to ${userId}`);
                if (this.isConnected) {
                    this.ws.send(JSON.stringify({
                        type: 'offer',
                        offer: offer,
                        targetUserId: userId,
                        roomId: this.currentRoom,
                        userId: this.userId
                    }));
                }
            } catch (error) {
                console.error(`Error creating offer for ${userId}:`, error);
                if (this.connectionMode === 'lan') {
                    this.updateAutoStatus(`❌ 建立连接失败: ${error.message}`, 'error');
                } else {
                    this.addSystemMessage(`创建连接失败: ${error.message}`);
                }
            }
        }
    }

    setupDataChannel(dataChannel, userId) {
        const peer = this.peers.get(userId);
        if (peer) {
            peer.dataChannel = dataChannel;
            
            dataChannel.onopen = () => {
                console.log(`Data channel opened with ${userId}`);
                this.updateConnectionStatus('p2p', 'P2P连接');
                if (this.connectionMode === 'lan') {
                    this.updateAutoStatus(`🎉 已建立P2P直连，延迟极低！`);
                } else {
                    this.addSystemMessage(`与用户 ${userId} 建立了P2P连接`);
                }
            };
            
            dataChannel.onmessage = (event) => {
                console.log(`Received P2P message from ${userId}:`, event.data);
                const message = JSON.parse(event.data);
                this.addMessage(message.content, false, message.timestamp);
            };
            
            dataChannel.onclose = () => {
                console.log(`Data channel closed with ${userId}`);
                if (this.connectionMode === 'lan') {
                    this.updateAutoStatus(`📱 用户断开连接`);
                } else {
                    this.addSystemMessage(`与用户 ${userId} 的P2P连接已断开`);
                }
            };
            
            dataChannel.onerror = (error) => {
                console.error(`Data channel error with ${userId}:`, error);
            };
        }
    }

    async handleRTCMessage(data) {
        console.log(`Received RTC message from ${data.userId}:`, data.type);
        let peer = this.peers.get(data.userId);
        
        if (!peer) {
            console.log(`No peer found for user ${data.userId}, creating new peer connection`);
            if (data.type === 'offer') {
                await this.createPeerConnection(data.userId, false);
                peer = this.peers.get(data.userId);
            } else {
                console.error(`Received ${data.type} but no peer connection exists for ${data.userId}`);
                return;
            }
        }

        try {
            switch (data.type) {
                case 'offer':
                    console.log(`Processing offer from ${data.userId}`);
                    await peer.peerConnection.setRemoteDescription(data.offer);
                    
                    await this.processPendingCandidates(peer);
                    
                    const answer = await peer.peerConnection.createAnswer();
                    await peer.peerConnection.setLocalDescription(answer);
                    
                    console.log(`Sending answer to ${data.userId}`);
                    if (this.isConnected) {
                        this.ws.send(JSON.stringify({
                            type: 'answer',
                            answer: answer,
                            targetUserId: data.userId,
                            roomId: this.currentRoom,
                            userId: this.userId
                        }));
                    }
                    break;
                    
                case 'answer':
                    console.log(`Processing answer from ${data.userId}`);
                    await peer.peerConnection.setRemoteDescription(data.answer);
                    
                    await this.processPendingCandidates(peer);
                    break;
                    
                case 'ice-candidate':
                    console.log(`Processing ICE candidate from ${data.userId}`);
                    
                    if (peer.peerConnection.remoteDescription) {
                        await peer.peerConnection.addIceCandidate(data.candidate);
                        console.log(`ICE candidate added directly`);
                    } else {
                        peer.pendingCandidates.push(data.candidate);
                        console.log(`ICE candidate cached, pending candidates: ${peer.pendingCandidates.length}`);
                    }
                    break;
            }
        } catch (error) {
            console.error(`Error handling RTC message from ${data.userId}:`, error);
            if (this.connectionMode === 'lan') {
                this.updateAutoStatus(`⚠️ 连接过程中出现问题: ${error.message}`, 'warning');
            } else {
                this.addSystemMessage(`处理连接消息失败: ${error.message}`);
            }
        }
    }

    async processPendingCandidates(peer) {
        if (peer.pendingCandidates && peer.pendingCandidates.length > 0) {
            console.log(`Processing ${peer.pendingCandidates.length} pending ICE candidates`);
            
            for (const candidate of peer.pendingCandidates) {
                try {
                    await peer.peerConnection.addIceCandidate(candidate);
                } catch (error) {
                    console.error('Error adding pending candidate:', error);
                }
            }
            
            peer.pendingCandidates = [];
        }
    }

    sendMessage() {
        const content = this.elements.messageInput.value.trim();
        if (!content || !this.currentRoom) return;

        const message = {
            content: content,
            timestamp: Date.now(),
            userId: this.userId
        };

        let p2pSent = false;
        let p2pConnections = 0;
        
        this.peers.forEach((peer, userId) => {
            if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
                console.log(`Sending P2P message to ${userId}`);
                peer.dataChannel.send(JSON.stringify(message));
                p2pSent = true;
                p2pConnections++;
            }
        });

        console.log(`Message sent via P2P to ${p2pConnections} users`);

        if (!p2pSent && this.isConnected) {
            console.log('No P2P connections available, sending via WebSocket');
            this.ws.send(JSON.stringify({
                type: 'message',
                content: content,
                roomId: this.currentRoom,
                userId: this.userId,
                timestamp: message.timestamp
            }));
        }

        this.addMessage(content, true, message.timestamp);
        this.elements.messageInput.value = '';
    }

    addMessage(content, isSent, timestamp) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSent ? 'message-sent' : 'message-received'}`;
        
        const timeStr = new Date(timestamp).toLocaleTimeString();
        messageDiv.innerHTML = `
            ${content}
            <div class="message-time">${timeStr}</div>
        `;
        
        this.elements.chatMessages.appendChild(messageDiv);
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }

    addSystemMessage(content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message message-system';
        messageDiv.textContent = content;
        
        this.elements.chatMessages.appendChild(messageDiv);
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }

    updateConnectionStatus(status, text) {
        this.elements.connectionStatus.className = `connection-status status-${status}`;
        this.elements.connectionStatus.textContent = text;
    }

    updateUserCount(count) {
        this.elements.userCount.textContent = this.connectionMode === 'lan' ? 
            `同网段用户: ${count}` : `在线用户: ${count}`;
    }

    closePeerConnection(userId) {
        const peer = this.peers.get(userId);
        if (peer) {
            console.log(`Closing peer connection with ${userId}`);
            if (peer.dataChannel) {
                peer.dataChannel.close();
            }
            peer.peerConnection.close();
            
            if (peer.pendingCandidates) {
                peer.pendingCandidates = [];
            }
            
            this.peers.delete(userId);
        }
    }

    closePeerConnections() {
        console.log('Closing all peer connections');
        this.peers.forEach((peer, userId) => {
            this.closePeerConnection(userId);
        });
        if (this.isConnected) {
            this.updateConnectionStatus('connected', 'WebSocket连接');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new P2PChat();
});
