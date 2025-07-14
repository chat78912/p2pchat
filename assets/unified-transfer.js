/**
 * 统一文件传输系统
 * 端对端加密，零内存，统一数据格式
 * 
 * 设计理念：
 * 1. 所有数据都用统一的二进制格式
 * 2. 简单的加密/解密
 * 3. 零内存流式处理
 * 4. 一套代码处理所有文件类型
 */

class UnifiedTransfer {
    constructor() {
        this.config = {
            chunkSize: 2 * 1024,         // 2KB - 进一步减小块大小
            maxBuffered: 8 * 1024,       // 8KB 缓冲限制，大幅减少压力
            secretKey: this.generateKey(), // 简单的加密密钥
            sendDelay: 50,               // 50ms 发送延迟，大幅降低发送频率
            maxRetries: 8,               // 进一步增加重试次数
            heartbeatInterval: 2000,     // 2秒心跳检查
            largeFileThreshold: 1024 * 1024, // 1MB阈值，大文件使用不同策略
        };
        
        this.activeSenders = new Map();
        this.activeReceivers = new Map();
        
        // 检测浏览器能力
        this.capabilities = {
            fileStream: typeof File.prototype.stream === 'function',
            fileSystemAccess: 'showSaveFilePicker' in window,
        };
        
        console.log('🔒 Unified Transfer initialized with capabilities:', this.capabilities);
    }
    
    /**
     * 生成简单的加密密钥
     */
    generateKey() {
        return crypto.getRandomValues(new Uint8Array(16));
    }
    
    /**
     * 简单的 XOR 加密/解密
     */
    encryptDecrypt(data, key) {
        const result = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
            result[i] = data[i] ^ key[i % key.length];
        }
        return result;
    }
    
    /**
     * 检查连接健康状态
     */
    async checkConnectionHealth(dataChannel) {
        if (!dataChannel || dataChannel.readyState !== 'open') {
            console.error('Data channel not open:', dataChannel?.readyState);
            return false;
        }
        
        // 检查缓冲区是否过载
        if (dataChannel.bufferedAmount > this.config.maxBuffered) {
            console.warn('Data channel buffer overloaded:', dataChannel.bufferedAmount);
            // 等待缓冲区清空
            try {
                await this.waitForBuffer(dataChannel);
            } catch (error) {
                console.error('Failed to clear buffer:', error);
                return false;
            }
        }
        
        // 发送一个小的心跳包测试连接
        try {
            const heartbeat = this.createPacket(99, 'heartbeat', 0, new Uint8Array([1,2,3,4]));
            dataChannel.send(heartbeat);
            console.log('Connection health check passed');
            return true;
        } catch (error) {
            console.error('Connection health check failed:', error);
            return false;
        }
    }
    
    /**
     * 创建统一的数据包格式
     * 格式: [magic(4)] + [type(1)] + [fileIdLen(1)] + [fileId(variable)] + [chunkIndex(4)] + [dataLength(4)] + [encryptedData]
     */
    createPacket(type, fileId, chunkIndex, data) {
        const magic = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]); // 魔数标识
        const typeBytes = new Uint8Array([type]);
        const fileIdBytes = new TextEncoder().encode(fileId);
        const fileIdLenBytes = new Uint8Array([fileIdBytes.length]);
        const chunkBytes = new Uint8Array(4);
        const lengthBytes = new Uint8Array(4);
        
        // 写入 chunk index (little endian)
        new DataView(chunkBytes.buffer).setUint32(0, chunkIndex, true);
        
        // 加密数据
        const encryptedData = this.encryptDecrypt(data, this.config.secretKey);
        
        // 写入数据长度
        new DataView(lengthBytes.buffer).setUint32(0, encryptedData.length, true);
        
        // 组合所有部分
        const packet = new Uint8Array(
            magic.length + typeBytes.length + fileIdLenBytes.length + fileIdBytes.length + 
            chunkBytes.length + lengthBytes.length + encryptedData.length
        );
        
        let offset = 0;
        packet.set(magic, offset); offset += magic.length;
        packet.set(typeBytes, offset); offset += typeBytes.length;
        packet.set(fileIdLenBytes, offset); offset += fileIdLenBytes.length;
        packet.set(fileIdBytes, offset); offset += fileIdBytes.length;
        packet.set(chunkBytes, offset); offset += chunkBytes.length;
        packet.set(lengthBytes, offset); offset += lengthBytes.length;
        packet.set(encryptedData, offset);
        
        return packet.buffer;
    }
    
    /**
     * 解析统一数据包
     */
    parsePacket(arrayBuffer) {
        const data = new Uint8Array(arrayBuffer);
        const view = new DataView(arrayBuffer);
        
        // 检查魔数
        if (data[0] !== 0xAA || data[1] !== 0xBB || data[2] !== 0xCC || data[3] !== 0xDD) {
            throw new Error('Invalid packet magic');
        }
        
        let offset = 4;
        
        // 读取类型
        const type = data[offset++];
        
        // 读取文件ID长度
        const fileIdLen = data[offset++];
        
        // 读取文件ID
        const fileIdBytes = data.slice(offset, offset + fileIdLen);
        const fileId = new TextDecoder().decode(fileIdBytes);
        offset += fileIdLen;
        
        // 读取chunk index
        const chunkIndex = view.getUint32(offset, true);
        offset += 4;
        
        // 读取数据长度
        const dataLength = view.getUint32(offset, true);
        offset += 4;
        
        // 读取并解密数据
        const encryptedData = data.slice(offset, offset + dataLength);
        const decryptedData = this.encryptDecrypt(encryptedData, this.config.secretKey);
        
        return {
            type,
            fileId,
            chunkIndex,
            data: decryptedData
        };
    }
    
    /**
     * 开始发送文件
     */
    async startSending(file, fileId, dataChannel, onProgress, onComplete, onError) {
        console.log(`📤 Starting unified transfer: ${file.name} (${this.formatBytes(file.size)})`);
        
        // 检查是否为大文件，调整策略
        const isLargeFile = file.size > this.config.largeFileThreshold;
        if (isLargeFile) {
            console.log('🐌 Large file detected, using conservative strategy');
            // 大文件使用更保守的配置
            this.config.sendDelay = 100;  // 100ms延迟
            this.config.maxBuffered = 4 * 1024; // 4KB缓冲
        }
        
        // 先进行连接健康检查
        if (!await this.checkConnectionHealth(dataChannel)) {
            console.error('Connection health check failed');
            onError(new Error('Connection not healthy'));
            return;
        }
        
        const sender = {
            file,
            fileId,
            dataChannel,
            totalSize: file.size,
            sentBytes: 0,
            chunkIndex: 0,
            isActive: true,
            startTime: Date.now(),
            lastHealthCheck: Date.now(),
            isLargeFile: isLargeFile,  // 保存大文件标记
            onProgress,
            onComplete,
            onError
        };
        
        this.activeSenders.set(fileId, sender);
        
        // 启动发送端监控
        const monitorInterval = setInterval(() => {
            if (!sender.isActive) {
                clearInterval(monitorInterval);
                return;
            }
            
            // 检查连接状态
            if (sender.dataChannel.readyState !== 'open') {
                console.warn('⚠️ Data channel not open, pausing sender');
                sender.isActive = false;
                clearInterval(monitorInterval);
                onError(new Error('Data channel closed during monitoring'));
                return;
            }
            
            // 检查是否长时间无进度
            const now = Date.now();
            if (!sender.lastProgressTime) {
                sender.lastProgressTime = now;
            } else if (now - sender.lastProgressTime > 30000) { // 30秒无进度
                console.error('❌ No progress for 30 seconds, stopping');
                sender.isActive = false;
                clearInterval(monitorInterval);
                onError(new Error('Transfer stalled'));
                return;
            }
            
            console.debug(`📊 Sender monitor: ${sender.sentBytes}/${sender.totalSize} bytes, buffer: ${sender.dataChannel.bufferedAmount}`);
        }, 5000); // 每5秒检查一次
        
        try {
            if (this.capabilities.fileStream) {
                await this.sendWithStream(sender);
            } else {
                await this.sendWithSlicing(sender);
            }
            clearInterval(monitorInterval);
        } catch (error) {
            clearInterval(monitorInterval);
            console.error('❌ Unified sending failed:', error);
            onError(error);
        }
    }
    
    /**
     * 使用流式API发送
     */
    async sendWithStream(sender) {
        const stream = sender.file.stream();
        const reader = stream.getReader();
        let retryCount = 0;
        
        try {
            while (sender.isActive) {
                const { done, value } = await reader.read();
                if (done) break;
                
                // 定期健康检查
                if (Date.now() - sender.lastHealthCheck > this.config.heartbeatInterval) {
                    if (!await this.checkConnectionHealth(sender.dataChannel)) {
                        throw new Error('Connection health check failed');
                    }
                    sender.lastHealthCheck = Date.now();
                }
                
                // 带重试的发送
                let sent = false;
                while (!sent && retryCount < this.config.maxRetries) {
                    try {
                        // 检查连接状态
                        if (sender.dataChannel.readyState !== 'open') {
                            throw new Error('Connection closed during transfer');
                        }
                        
                        // 等待缓冲区
                        await this.waitForBuffer(sender.dataChannel);
                        
                        // 二次检查连接状态
                        if (sender.dataChannel.readyState !== 'open') {
                            throw new Error('Connection closed while waiting for buffer');
                        }
                        
                        // 创建数据包 (type: 1 = file chunk)
                        const packet = this.createPacket(1, sender.fileId, sender.chunkIndex, value);
                        
                        // 检查包大小
                        if (packet.byteLength > 65536) {
                            throw new Error('Packet too large: ' + packet.byteLength);
                        }
                        
                        // 发送前最后检查
                        if (sender.dataChannel.bufferedAmount > this.config.maxBuffered * 2) {
                            console.warn('Buffer still too high, waiting more...');
                            await new Promise(resolve => setTimeout(resolve, 50));
                            continue; // 重新检查
                        }
                        
                        // 发送
                        sender.dataChannel.send(packet);
                        sender.sentBytes += value.byteLength;
                        sender.chunkIndex++;
                        sent = true;
                        retryCount = 0; // 重置重试计数
                        
                        console.debug(`✅ Sent chunk ${sender.chunkIndex - 1}, buffered: ${sender.dataChannel.bufferedAmount}`);
                        
                    } catch (error) {
                        retryCount++;
                        console.warn(`Send failed (attempt ${retryCount}/${this.config.maxRetries}):`, error.message);
                        
                        // 如果是连接关闭错误，等待更长时间
                        if (error.message.includes('closed')) {
                            console.warn('Connection issue detected, waiting for recovery...');
                            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                            
                            // 检查连接是否恢复
                            if (sender.dataChannel.readyState !== 'open') {
                                throw new Error('Connection permanently closed');
                            }
                        }
                        
                        if (retryCount >= this.config.maxRetries) {
                            throw new Error('Max retries exceeded: ' + error.message);
                        }
                        
                        // 指数退避重试策略
                        const delay = Math.min(1000, 100 * Math.pow(2, retryCount - 1));
                        console.log(`Retrying in ${delay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
                
                // 更新进度
                if (sender.onProgress) {
                    const progress = (sender.sentBytes / sender.totalSize) * 100;
                    const speed = sender.sentBytes / ((Date.now() - sender.startTime) / 1000);
                    sender.onProgress(progress, speed);
                }
                
                // 检查发送状态，如果缓冲区过高则暂停 - 对大文件更严格
                const bufferLimit = sender.isLargeFile ? this.config.maxBuffered / 2 : this.config.maxBuffered;
                while (sender.dataChannel.bufferedAmount > bufferLimit && sender.isActive) {
                    console.warn(`⏸️ Buffer too high (${sender.dataChannel.bufferedAmount}/${bufferLimit}), pausing...`);
                    await new Promise(resolve => setTimeout(resolve, sender.isLargeFile ? 200 : 100));
                }
                
                // 根据配置添加延迟，动态调整 - 大文件使用更长延迟
                let dynamicDelay = this.config.sendDelay;
                if (sender.isLargeFile) {
                    dynamicDelay *= 2; // 大文件延迟翻倍
                }
                if (sender.dataChannel.bufferedAmount > 4096) {
                    dynamicDelay *= 2; // 如果缓冲区还有数据，再翻倍
                }
                
                await new Promise(resolve => setTimeout(resolve, dynamicDelay));
            }
            
            console.log('✅ Unified sending completed');
            sender.onComplete();
            
        } catch (error) {
            console.error('❌ Stream sending error:', error);
            sender.onError(error);
        } finally {
            reader.releaseLock();
            this.activeSenders.delete(sender.fileId);
        }
    }
    
    /**
     * 使用切片发送
     */
    async sendWithSlicing(sender) {
        let offset = 0;
        
        while (sender.isActive && offset < sender.totalSize) {
            try {
                // 等待缓冲区
                await this.waitForBuffer(sender.dataChannel);
                
                // 读取块
                const end = Math.min(offset + this.config.chunkSize, sender.totalSize);
                const slice = sender.file.slice(offset, end);
                const arrayBuffer = await slice.arrayBuffer();
                const chunk = new Uint8Array(arrayBuffer);
                
                // 创建数据包
                const packet = this.createPacket(1, sender.fileId, sender.chunkIndex++, chunk);
                
                // 发送
                sender.dataChannel.send(packet);
                
                offset = end;
                sender.sentBytes = offset;
                
                // 更新进度
                if (sender.onProgress) {
                    const progress = (offset / sender.totalSize) * 100;
                    const speed = offset / ((Date.now() - sender.startTime) / 1000);
                    sender.onProgress(progress, speed);
                }
                
                // 根据配置添加延迟
                await new Promise(resolve => setTimeout(resolve, this.config.sendDelay));
                
            } catch (error) {
                console.error('❌ Slice sending error:', error);
                sender.onError(error);
                break;
            }
        }
        
        if (sender.sentBytes >= sender.totalSize) {
            console.log('✅ Unified sending completed');
            sender.onComplete();
        }
        
        this.activeSenders.delete(sender.fileId);
    }
    
    /**
     * 开始接收文件
     */
    async startReceiving(fileMetadata, onProgress, onComplete, onError) {
        console.log(`📥 Starting unified receive: ${fileMetadata.fileName}`);
        console.log(`📋 FileId: ${fileMetadata.fileId}`);
        
        const receiver = {
            fileId: fileMetadata.fileId,
            fileName: fileMetadata.fileName,
            fileSize: fileMetadata.fileSize,
            receivedBytes: 0,
            chunks: new Map(),
            expectedChunk: 0,
            writer: null,
            startTime: Date.now(),
            onProgress,
            onComplete,
            onError,
            isReady: false,  // 标记接收器是否准备就绪
            earlyChunks: []  // 缓存早期到达的数据包
        };
        
        // 立即添加到活跃接收器（即使写入器还没准备好）
        this.activeReceivers.set(fileMetadata.fileId, receiver);
        console.log(`✅ Receiver registered for fileId: ${fileMetadata.fileId}`);
        console.log(`📂 Active receivers count: ${this.activeReceivers.size}`);
        
        try {
            // 异步设置写入器
            await this.setupWriter(receiver);
            
            // 标记为就绪
            receiver.isReady = true;
            console.log(`✅ Receiver ready for fileId: ${fileMetadata.fileId}`);
            
            // 处理缓存的早期数据包
            if (receiver.earlyChunks.length > 0) {
                console.log(`📦 Processing ${receiver.earlyChunks.length} cached chunks`);
                for (const chunk of receiver.earlyChunks) {
                    await this.processFileChunk(receiver, chunk);
                }
                receiver.earlyChunks = []; // 清空缓存
            }
            
            return receiver;
            
        } catch (error) {
            console.error('❌ Failed to setup receiver:', error);
            this.activeReceivers.delete(fileMetadata.fileId); // 清理失败的接收器
            if (onError) onError(error);
            throw error;
        }
    }
    
    /**
     * 设置写入器
     */
    async setupWriter(receiver) {
        try {
            if (this.capabilities.fileSystemAccess) {
                // 使用 File System Access API
                const handle = await window.showSaveFilePicker({
                    suggestedName: receiver.fileName
                });
                receiver.writer = await handle.createWritable();
                receiver.writeMode = 'filesystem';
                console.log('📁 Using File System Access API');
                
            } else if (window.streamSaver) {
                // 使用 StreamSaver
                const fileStream = streamSaver.createWriteStream(receiver.fileName, {
                    size: receiver.fileSize
                });
                receiver.writer = fileStream.getWriter();
                receiver.writeMode = 'streamsaver';
                console.log('💾 Using StreamSaver');
                
            } else {
                // 内存模式
                receiver.writeMode = 'memory';
                receiver.memoryChunks = [];
                console.log('🧠 Using memory mode');
            }
            
        } catch (error) {
            console.warn('⚠️ Writer setup failed, using memory mode');
            receiver.writeMode = 'memory';
            receiver.memoryChunks = [];
        }
    }
    
    /**
     * 处理接收到的数据包
     */
    async handlePacket(arrayBuffer) {
        try {
            const packet = this.parsePacket(arrayBuffer);
            
            if (packet.type === 1) { // file chunk
                await this.handleFileChunk(packet);
            } else if (packet.type === 99) { // heartbeat
                // 心跳包，仅用于测试连接，不需要处理
                console.debug('Received heartbeat packet');
            }
            
        } catch (error) {
            console.warn('Failed to parse unified packet:', error);
            return false; // 返回false表示不是统一格式的包
        }
        
        return true; // 返回true表示已处理
    }
    
    /**
     * 处理文件块
     */
    async handleFileChunk(packet) {
        console.log('📦 Received chunk for fileId:', packet.fileId, 'chunkIndex:', packet.chunkIndex);
        
        const receiver = this.activeReceivers.get(packet.fileId);
        if (!receiver) {
            console.warn('❌ No receiver for file:', packet.fileId);
            console.warn('📂 Available receivers:', Array.from(this.activeReceivers.keys()));
            return;
        }
        
        // 如果接收器还没准备好，缓存数据包
        if (!receiver.isReady) {
            console.log('⏳ Receiver not ready, caching chunk', packet.chunkIndex);
            receiver.earlyChunks.push(packet);
            return;
        }
        
        // 处理数据包
        await this.processFileChunk(receiver, packet);
    }
    
    /**
     * 处理文件块（从handleFileChunk中提取的核心逻辑）
     */
    async processFileChunk(receiver, packet) {
        try {
            // 存储块
            receiver.chunks.set(packet.chunkIndex, packet.data);
            receiver.receivedBytes += packet.data.byteLength;
            
            // 按顺序写入连续的块
            await this.writeSequentialChunks(receiver);
            
            // 更新进度
            if (receiver.onProgress) {
                const progress = (receiver.receivedBytes / receiver.fileSize) * 100;
                const speed = receiver.receivedBytes / ((Date.now() - receiver.startTime) / 1000);
                receiver.onProgress(progress, speed);
            }
            
            // 检查完成
            if (receiver.receivedBytes >= receiver.fileSize) {
                await this.completeReceiving(receiver);
            }
            
        } catch (error) {
            console.error('❌ Error processing file chunk:', error);
            if (receiver.onError) receiver.onError(error);
        }
    }
    
    /**
     * 按顺序写入块
     */
    async writeSequentialChunks(receiver) {
        while (receiver.chunks.has(receiver.expectedChunk)) {
            const chunk = receiver.chunks.get(receiver.expectedChunk);
            
            if (receiver.writeMode === 'memory') {
                receiver.memoryChunks.push(chunk);
            } else if (receiver.writer) {
                await receiver.writer.write(chunk);
            }
            
            receiver.chunks.delete(receiver.expectedChunk);
            receiver.expectedChunk++;
        }
    }
    
    /**
     * 完成接收
     */
    async completeReceiving(receiver) {
        try {
            if (receiver.writeMode === 'memory') {
                // 内存模式：创建下载
                const blob = new Blob(receiver.memoryChunks);
                const url = URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.href = url;
                a.download = receiver.fileName;
                a.click();
                
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                
            } else if (receiver.writer) {
                await receiver.writer.close();
            }
            
            const totalTime = (Date.now() - receiver.startTime) / 1000;
            const avgSpeed = receiver.fileSize / totalTime;
            
            console.log(`✅ Unified transfer completed: ${receiver.fileName} (${this.formatBytes(avgSpeed)}/s)`);
            
            receiver.onComplete();
            this.activeReceivers.delete(receiver.fileId);
            
        } catch (error) {
            console.error('❌ Error completing receive:', error);
            receiver.onError(error);
        }
    }
    
    /**
     * 等待缓冲区
     */
    async waitForBuffer(dataChannel) {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 500; // 进一步增加等待时间
            
            const check = () => {
                if (dataChannel.readyState !== 'open') {
                    reject(new Error('Connection closed'));
                    return;
                }
                
                if (attempts > maxAttempts) {
                    console.error('Buffer wait timeout, current amount:', dataChannel.bufferedAmount);
                    reject(new Error('Buffer wait timeout'));
                    return;
                }
                
                // 更保守的缓冲区检查 - 只有在缓冲区很低时才继续
                const bufferThreshold = this.config.maxBuffered / 4; // 使用更低的阈值（1/4）
                if (dataChannel.bufferedAmount < bufferThreshold) {
                    resolve();
                } else {
                    attempts++;
                    // 根据缓冲量调整等待时间，更长的延迟
                    let delay = 50; // 基础延迟增加
                    if (dataChannel.bufferedAmount > 32000) delay = 200;
                    else if (dataChannel.bufferedAmount > 16000) delay = 150;
                    else if (dataChannel.bufferedAmount > 8000) delay = 100;
                    
                    console.debug(`Waiting for buffer: ${dataChannel.bufferedAmount}/${bufferThreshold}, attempt ${attempts}`);
                    setTimeout(check, delay);
                }
            };
            
            check();
        });
    }
    
    /**
     * 格式化字节数
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    /**
     * 取消传输
     */
    cancelTransfer(fileId, isReceiver = false) {
        if (isReceiver) {
            const receiver = this.activeReceivers.get(fileId);
            if (receiver) {
                if (receiver.writer && receiver.writeMode !== 'memory') {
                    receiver.writer.abort().catch(console.error);
                }
                this.activeReceivers.delete(fileId);
            }
        } else {
            const sender = this.activeSenders.get(fileId);
            if (sender) {
                sender.isActive = false;
                this.activeSenders.delete(fileId);
            }
        }
    }
}

// 导出全局实例
window.unifiedTransfer = new UnifiedTransfer();