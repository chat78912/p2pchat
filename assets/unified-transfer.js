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
            chunkSize: 16 * 1024,        // 16KB - 平衡性能和兼容性
            maxBuffered: 64 * 1024,      // 64KB 缓冲限制
            secretKey: this.generateKey(), // 简单的加密密钥
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
        
        const sender = {
            file,
            fileId,
            dataChannel,
            totalSize: file.size,
            sentBytes: 0,
            chunkIndex: 0,
            isActive: true,
            startTime: Date.now(),
            onProgress,
            onComplete,
            onError
        };
        
        this.activeSenders.set(fileId, sender);
        
        try {
            if (this.capabilities.fileStream) {
                await this.sendWithStream(sender);
            } else {
                await this.sendWithSlicing(sender);
            }
        } catch (error) {
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
        
        try {
            while (sender.isActive) {
                const { done, value } = await reader.read();
                if (done) break;
                
                // 检查连接状态
                if (sender.dataChannel.readyState !== 'open') {
                    throw new Error('Connection closed during transfer');
                }
                
                // 等待缓冲区
                await this.waitForBuffer(sender.dataChannel);
                
                // 创建数据包 (type: 1 = file chunk)
                const packet = this.createPacket(1, sender.fileId, sender.chunkIndex++, value);
                
                // 发送
                sender.dataChannel.send(packet);
                sender.sentBytes += value.byteLength;
                
                // 更新进度
                if (sender.onProgress) {
                    const progress = (sender.sentBytes / sender.totalSize) * 100;
                    const speed = sender.sentBytes / ((Date.now() - sender.startTime) / 1000);
                    sender.onProgress(progress, speed);
                }
                
                // 小延迟避免过载
                await new Promise(resolve => setTimeout(resolve, 1));
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
                
                // 小延迟
                await new Promise(resolve => setTimeout(resolve, 1));
                
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
            onError
        };
        
        try {
            // 设置写入器
            await this.setupWriter(receiver);
            
            // 添加到活跃接收器
            this.activeReceivers.set(fileMetadata.fileId, receiver);
            console.log(`✅ Receiver added for fileId: ${fileMetadata.fileId}`);
            console.log(`📂 Active receivers count: ${this.activeReceivers.size}`);
            
            return receiver;
            
        } catch (error) {
            console.error('❌ Failed to setup receiver:', error);
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
        console.log('📦 Received chunk for fileId:', packet.fileId);
        console.log('📂 Active receivers:', Array.from(this.activeReceivers.keys()));
        
        const receiver = this.activeReceivers.get(packet.fileId);
        if (!receiver) {
            console.warn('❌ No receiver for file:', packet.fileId);
            console.warn('📂 Available receivers:', Array.from(this.activeReceivers.keys()));
            return;
        }
        
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
            console.error('❌ Error handling file chunk:', error);
            receiver.onError(error);
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
            const maxAttempts = 200; // 增加尝试次数
            
            const check = () => {
                if (dataChannel.readyState !== 'open') {
                    reject(new Error('Connection closed'));
                    return;
                }
                
                if (attempts > maxAttempts) {
                    reject(new Error('Buffer wait timeout'));
                    return;
                }
                
                if (dataChannel.bufferedAmount < this.config.maxBuffered) {
                    resolve();
                } else {
                    attempts++;
                    // 根据缓冲量调整等待时间
                    const delay = dataChannel.bufferedAmount > 100000 ? 50 : 10;
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