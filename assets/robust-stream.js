/**
 * 鲁棒性流式传输处理器
 * 专门处理 WebRTC 数据通道不稳定的问题
 */

class RobustStreamHandler {
    constructor() {
        this.config = {
            // 超小块大小，确保稳定性
            chunkSize: 1024,           // 1KB - 极小块
            maxBuffered: 16 * 1024,    // 16KB 缓冲限制
            sendDelay: 100,            // 100ms 延迟
            maxRetries: 10,            // 最大重试次数
            channelTimeout: 30000,     // 30秒通道超时
            reconnectDelay: 2000       // 2秒重连延迟
        };
        
        this.activeSenders = new Map();
        this.activeReceivers = new Map();
        
        // 检查支持
        this.supportsFileStream = typeof File.prototype.stream === 'function';
        this.supportsFileSystemAccess = 'showSaveFilePicker' in window;
        
        // 加载 StreamSaver
        this.loadStreamSaver();
    }
    
    /**
     * 创建鲁棒性发送器
     */
    async createRobustSender(file, fileId, dataChannel, onProgress, onComplete, onError) {
        const sender = {
            file,
            fileId,
            dataChannel,
            totalSize: file.size,
            totalChunks: Math.ceil(file.size / this.config.chunkSize),
            sentChunks: 0,
            sentBytes: 0,
            isActive: true,
            startTime: Date.now(),
            retryCount: 0,
            
            // 进度回调
            onProgress,
            onComplete,
            onError
        };
        
        this.activeSenders.set(fileId, sender);
        
        // 开始发送
        await this.startRobustSending(sender);
        
        return sender;
    }
    
    /**
     * 开始鲁棒性发送
     */
    async startRobustSending(sender) {
        try {
            // 使用原生流API或分片
            if (this.supportsFileStream) {
                await this.sendWithStream(sender);
            } else {
                await this.sendWithSlicing(sender);
            }
        } catch (error) {
            console.error('Robust sending failed:', error);
            if (sender.onError) {
                sender.onError(error);
            }
        }
    }
    
    /**
     * 使用原生流发送
     */
    async sendWithStream(sender) {
        const stream = sender.file.stream();
        const reader = stream.getReader();
        
        let chunkIndex = 0;
        
        while (sender.isActive) {
            try {
                const { done, value } = await reader.read();
                if (done) break;
                
                // 如果块太大，进一步分割
                if (value.byteLength > this.config.chunkSize) {
                    await this.sendLargeChunk(sender, value, chunkIndex);
                } else {
                    await this.sendSingleChunk(sender, value, chunkIndex);
                }
                
                chunkIndex++;
                
            } catch (error) {
                console.error('Stream reading error:', error);
                if (await this.handleSendError(sender, error)) {
                    continue; // 重试
                } else {
                    break; // 放弃
                }
            }
        }
        
        if (sender.sentChunks >= sender.totalChunks && sender.onComplete) {
            sender.onComplete();
        }
    }
    
    /**
     * 使用分片发送
     */
    async sendWithSlicing(sender) {
        let offset = 0;
        let chunkIndex = 0;
        
        while (sender.isActive && offset < sender.totalSize) {
            try {
                const end = Math.min(offset + this.config.chunkSize, sender.totalSize);
                const slice = sender.file.slice(offset, end);
                const arrayBuffer = await slice.arrayBuffer();
                const chunk = new Uint8Array(arrayBuffer);
                
                await this.sendSingleChunk(sender, chunk, chunkIndex);
                
                offset = end;
                chunkIndex++;
                
            } catch (error) {
                console.error('Slicing error:', error);
                if (await this.handleSendError(sender, error)) {
                    continue; // 重试
                } else {
                    break; // 放弃
                }
            }
        }
        
        if (sender.sentChunks >= sender.totalChunks && sender.onComplete) {
            sender.onComplete();
        }
    }
    
    /**
     * 发送大块（需要进一步分割）
     */
    async sendLargeChunk(sender, largeChunk, baseIndex) {
        const subChunks = Math.ceil(largeChunk.byteLength / this.config.chunkSize);
        
        for (let i = 0; i < subChunks; i++) {
            const start = i * this.config.chunkSize;
            const end = Math.min(start + this.config.chunkSize, largeChunk.byteLength);
            const subChunk = largeChunk.slice(start, end);
            
            await this.sendSingleChunk(sender, subChunk, baseIndex * 1000 + i);
        }
    }
    
    /**
     * 发送单个块
     */
    async sendSingleChunk(sender, chunk, chunkIndex) {
        // 等待通道可用
        await this.waitForChannelReady(sender.dataChannel);
        
        // 等待缓冲区清空
        await this.waitForBufferClear(sender.dataChannel);
        
        // 创建消息
        const message = this.createMessage({
            type: 'robust-chunk',
            fileId: sender.fileId,
            chunkIndex,
            totalChunks: sender.totalChunks,
            data: chunk
        });
        
        // 发送
        if (sender.dataChannel.readyState === 'open') {
            sender.dataChannel.send(message);
            
            sender.sentChunks++;
            sender.sentBytes += chunk.byteLength;
            
            // 更新进度
            if (sender.onProgress) {
                const progress = (sender.sentBytes / sender.totalSize) * 100;
                const speed = sender.sentBytes / ((Date.now() - sender.startTime) / 1000);
                sender.onProgress(progress, speed);
            }
            
            // 重置重试计数
            sender.retryCount = 0;
            
        } else {
            throw new Error('Channel not open');
        }
        
        // 添加延迟
        await new Promise(resolve => setTimeout(resolve, this.config.sendDelay));
    }
    
    /**
     * 等待通道就绪
     */
    async waitForChannelReady(dataChannel) {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 100;
            
            const check = () => {
                if (dataChannel.readyState === 'open') {
                    resolve();
                } else if (dataChannel.readyState === 'closed' || attempts > maxAttempts) {
                    reject(new Error('Channel not ready'));
                } else {
                    attempts++;
                    setTimeout(check, 50);
                }
            };
            
            check();
        });
    }
    
    /**
     * 等待缓冲区清空
     */
    async waitForBufferClear(dataChannel) {
        return new Promise((resolve, reject) => {
            let waitTime = 0;
            
            const check = () => {
                if (dataChannel.readyState !== 'open') {
                    reject(new Error('Channel closed while waiting'));
                    return;
                }
                
                if (waitTime > this.config.channelTimeout) {
                    reject(new Error('Buffer wait timeout'));
                    return;
                }
                
                if (dataChannel.bufferedAmount < this.config.maxBuffered) {
                    resolve();
                } else {
                    waitTime += 50;
                    setTimeout(check, 50);
                }
            };
            
            check();
        });
    }
    
    /**
     * 处理发送错误
     */
    async handleSendError(sender, error) {
        sender.retryCount++;
        
        if (sender.retryCount >= this.config.maxRetries) {
            if (sender.onError) {
                sender.onError(error);
            }
            return false;
        }
        
        console.log(`Retrying send (${sender.retryCount}/${this.config.maxRetries}):`, error.message);
        
        // 等待一段时间再重试
        await new Promise(resolve => setTimeout(resolve, this.config.reconnectDelay));
        
        return true;
    }
    
    /**
     * 创建鲁棒性接收器
     */
    async createRobustReceiver(fileMetadata, onProgress, onComplete, onError) {
        const receiver = {
            fileId: fileMetadata.fileId,
            fileName: fileMetadata.fileName,
            fileSize: fileMetadata.fileSize,
            totalChunks: fileMetadata.totalChunks || Math.ceil(fileMetadata.fileSize / this.config.chunkSize),
            receivedChunks: 0,
            receivedBytes: 0,
            startTime: Date.now(),
            isActive: true,
            
            // 存储块的有序数组
            chunks: new Map(),
            lastWrittenIndex: -1,
            
            // 写入流
            writer: null,
            
            // 回调
            onProgress,
            onComplete,
            onError
        };
        
        // 设置写入流
        await this.setupReceiverWriter(receiver);
        
        this.activeReceivers.set(fileMetadata.fileId, receiver);
        return receiver;
    }
    
    /**
     * 设置接收器写入流
     */
    async setupReceiverWriter(receiver) {
        try {
            // 优先使用 File System Access API
            if (this.supportsFileSystemAccess) {
                const handle = await window.showSaveFilePicker({
                    suggestedName: receiver.fileName
                });
                
                const writableStream = await handle.createWritable();
                receiver.writer = writableStream;
                receiver.useFileSystem = true;
                
            } else if (window.streamSaver) {
                // 使用 StreamSaver
                const fileStream = streamSaver.createWriteStream(receiver.fileName, {
                    size: receiver.fileSize
                });
                receiver.writer = fileStream.getWriter();
                receiver.useStreamSaver = true;
                
            } else {
                // 回退到内存模式
                receiver.useMemory = true;
                receiver.memoryChunks = [];
            }
        } catch (error) {
            console.warn('Failed to setup writer, using memory mode:', error);
            receiver.useMemory = true;
            receiver.memoryChunks = [];
        }
    }
    
    /**
     * 处理接收到的鲁棒性数据块
     */
    async handleRobustChunk(chunkData, peerId) {
        const receiver = this.activeReceivers.get(chunkData.fileId);
        if (!receiver || !receiver.isActive) {
            console.warn('No active receiver for chunk:', chunkData.fileId);
            return;
        }
        
        try {
            // 存储块
            receiver.chunks.set(chunkData.chunkIndex, chunkData.data);
            receiver.receivedChunks++;
            receiver.receivedBytes += chunkData.data.byteLength;
            
            // 尝试写入连续的块
            await this.writeSequentialChunks(receiver);
            
            // 更新进度
            if (receiver.onProgress) {
                const progress = (receiver.receivedBytes / receiver.fileSize) * 100;
                const speed = receiver.receivedBytes / ((Date.now() - receiver.startTime) / 1000);
                receiver.onProgress(progress, speed);
            }
            
            // 检查是否完成
            if (receiver.receivedChunks >= receiver.totalChunks) {
                await this.completeReceiving(receiver);
            }
            
        } catch (error) {
            console.error('Error handling robust chunk:', error);
            if (receiver.onError) {
                receiver.onError(error);
            }
        }
    }
    
    /**
     * 写入连续的块
     */
    async writeSequentialChunks(receiver) {
        while (receiver.chunks.has(receiver.lastWrittenIndex + 1)) {
            const nextIndex = receiver.lastWrittenIndex + 1;
            const chunk = receiver.chunks.get(nextIndex);
            
            if (receiver.useMemory) {
                receiver.memoryChunks.push(chunk);
            } else if (receiver.writer) {
                await receiver.writer.write(chunk);
            }
            
            receiver.chunks.delete(nextIndex);
            receiver.lastWrittenIndex = nextIndex;
        }
    }
    
    /**
     * 完成接收
     */
    async completeReceiving(receiver) {
        try {
            receiver.isActive = false;
            
            if (receiver.useMemory) {
                // 内存模式：创建 Blob 并下载
                const blob = new Blob(receiver.memoryChunks, { 
                    type: 'application/octet-stream' 
                });
                const url = URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.href = url;
                a.download = receiver.fileName;
                a.click();
                
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                
            } else if (receiver.writer) {
                await receiver.writer.close();
            }
            
            this.activeReceivers.delete(receiver.fileId);
            
            if (receiver.onComplete) {
                receiver.onComplete();
            }
            
        } catch (error) {
            console.error('Error completing receive:', error);
            if (receiver.onError) {
                receiver.onError(error);
            }
        }
    }
    
    /**
     * 创建二进制消息
     */
    createMessage(data) {
        const header = {
            type: data.type,
            fileId: data.fileId,
            chunkIndex: data.chunkIndex,
            totalChunks: data.totalChunks
        };
        
        const headerStr = JSON.stringify(header);
        const headerBytes = new TextEncoder().encode(headerStr);
        
        const totalLength = 4 + headerBytes.length + data.data.byteLength;
        const buffer = new ArrayBuffer(totalLength);
        const view = new DataView(buffer);
        
        // 写入头部长度
        view.setUint32(0, headerBytes.length, true);
        
        // 写入头部和数据
        const uint8View = new Uint8Array(buffer);
        uint8View.set(headerBytes, 4);
        uint8View.set(data.data, 4 + headerBytes.length);
        
        return buffer;
    }
    
    /**
     * 解析二进制消息
     */
    parseMessage(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const headerLength = view.getUint32(0, true);
        
        const headerBytes = new Uint8Array(arrayBuffer, 4, headerLength);
        const headerStr = new TextDecoder().decode(headerBytes);
        const header = JSON.parse(headerStr);
        
        const data = new Uint8Array(arrayBuffer, 4 + headerLength);
        
        return { ...header, data };
    }
    
    /**
     * 加载 StreamSaver
     */
    async loadStreamSaver() {
        if (window.streamSaver) return;
        
        try {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/streamsaver@2.0.6/StreamSaver.min.js';
            
            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
            
            if (window.streamSaver) {
                streamSaver.mitm = 'https://cdn.jsdelivr.net/npm/streamsaver@2.0.6/mitm.html';
            }
        } catch (error) {
            console.warn('Failed to load StreamSaver:', error);
        }
    }
    
    /**
     * 取消传输
     */
    cancelTransfer(fileId, isReceiver = false) {
        if (isReceiver) {
            const receiver = this.activeReceivers.get(fileId);
            if (receiver) {
                receiver.isActive = false;
                if (receiver.writer && !receiver.useMemory) {
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
window.robustStreamHandler = new RobustStreamHandler();