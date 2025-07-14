/**
 * 高性能零内存流式传输处理器
 * 专为大文件高速传输设计
 */

class HighPerformanceStreamHandler {
    constructor() {
        // 性能配置
        this.config = {
            // 动态块大小：更保守的设置
            chunkSizes: {
                lan: 64 * 1024,       // 64KB - 局域网稳定传输
                wan: 8 * 1024,        // 8KB - 广域网稳定传输
                slow: 4 * 1024        // 4KB - 慢速连接
            },
            
            // 并发配置
            maxConcurrentChunks: 2,   // 降低并发数
            
            // 缓冲配置
            bufferThresholds: {
                lan: 128 * 1024,      // 128KB
                wan: 64 * 1024,       // 64KB
                slow: 32 * 1024       // 32KB
            },
            
            // 延迟配置
            sendDelays: {
                lan: 20,              // 20ms - 保守延迟
                wan: 50,              // 50ms
                slow: 100             // 100ms
            },
            
            // 速度检测
            speedTestDuration: 3000,  // 3秒速度检测
            speedThresholds: {
                fast: 50 * 1024 * 1024,  // 50MB/s
                medium: 1 * 1024 * 1024,  // 1MB/s
            }
        };
        
        // 当前连接类型
        this.connectionType = 'wan'; // 默认为广域网
        this.currentSpeed = 0;
        
        // 活跃传输
        this.activeSenders = new Map();
        this.activeReceivers = new Map();
        
        // 性能监控
        this.performanceStats = {
            bytesSent: 0,
            bytesReceived: 0,
            startTime: 0,
            currentSpeed: 0
        };
        
        // 初始化
        this.init();
    }
    
    async init() {
        // 检测连接类型
        await this.detectConnectionType();
        
        // 注册 Service Worker（如果支持）
        if ('serviceWorker' in navigator) {
            try {
                await this.registerServiceWorker();
            } catch (error) {
                console.warn('Service Worker registration failed:', error);
            }
        }
    }
    
    /**
     * 检测连接类型和速度
     */
    async detectConnectionType() {
        // 使用 Network Information API（如果可用）
        if ('connection' in navigator) {
            const connection = navigator.connection;
            const effectiveType = connection.effectiveType;
            
            if (effectiveType === '4g' && connection.downlink > 10) {
                this.connectionType = 'lan';
            } else if (effectiveType === '4g' || effectiveType === '3g') {
                this.connectionType = 'wan';
            } else {
                this.connectionType = 'slow';
            }
        }
        
        console.log(`Detected connection type: ${this.connectionType}`);
    }
    
    /**
     * 注册 Service Worker 用于流式下载
     */
    async registerServiceWorker() {
        // 跳过 Service Worker 注册，直接使用其他方法
        console.log('Skipping Service Worker registration in this environment');
        return;
    }
    
    /**
     * 获取当前配置
     */
    getCurrentConfig() {
        return {
            chunkSize: this.config.chunkSizes[this.connectionType],
            bufferThreshold: this.config.bufferThresholds[this.connectionType],
            sendDelay: this.config.sendDelays[this.connectionType]
        };
    }
    
    /**
     * 创建高性能发送器
     */
    async createHighPerformanceSender(file, fileId, dataChannel, onProgress, onComplete, onError) {
        const config = this.getCurrentConfig();
        
        const sender = {
            file,
            fileId,
            dataChannel,
            chunkSize: config.chunkSize,
            totalChunks: Math.ceil(file.size / config.chunkSize),
            sentChunks: 0,
            isActive: true,
            startTime: Date.now(),
            bytesSent: 0,
            
            // 速度监控
            lastSpeedCheck: Date.now(),
            lastBytesSent: 0,
            currentSpeed: 0
        };
        
        this.activeSenders.set(fileId, sender);
        
        // 使用原生 File.stream() API 进行真正的流式读取
        if (typeof file.stream === 'function') {
            await this.streamWithNativeAPI(sender, onProgress, onComplete, onError);
        } else {
            // 回退到优化的分块读取
            await this.streamWithSlicing(sender, onProgress, onComplete, onError);
        }
        
        return sender;
    }
    
    /**
     * 使用原生 Streams API 进行零内存传输
     */
    async streamWithNativeAPI(sender, onProgress, onComplete, onError) {
        try {
            const stream = sender.file.stream();
            const reader = stream.getReader();
            
            // 并发发送管道
            const sendPipeline = [];
            
            const processChunk = async (chunkData, chunkIndex) => {
                if (!sender.isActive) return;
                
                try {
                    // 等待缓冲区可用
                    await this.waitForBufferAvailable(sender.dataChannel, sender);
                    
                    if (!sender.isActive || sender.dataChannel.readyState !== 'open') {
                        throw new Error('Channel closed');
                    }
                    
                    // 创建二进制消息
                    const message = this.createBinaryMessage({
                        type: 'hp-chunk',
                        fileId: sender.fileId,
                        chunkIndex,
                        totalChunks: sender.totalChunks,
                        data: chunkData
                    });
                    
                    // 发送
                    sender.dataChannel.send(message);
                    
                    sender.sentChunks++;
                    sender.bytesSent += chunkData.byteLength;
                    
                    // 更新进度
                    this.updateSenderProgress(sender, onProgress);
                    
                    // 检查完成
                    if (sender.sentChunks >= sender.totalChunks) {
                        sender.isActive = false;
                        this.activeSenders.delete(sender.fileId);
                        onComplete();
                    }
                    
                } catch (error) {
                    // 重试逻辑 - 暂时禁用，直接报错
                    sender.isActive = false;
                    onError(error);
                }
            };
            
            let chunkIndex = 0;
            
            // 读取循环
            while (sender.isActive) {
                const { done, value } = await reader.read();
                
                if (done) break;
                
                if (!sender.isActive) break;
                
                // 同步处理块，避免并发问题
                await processChunk(value, chunkIndex++);
                
                // 根据连接类型添加延迟
                if (this.getCurrentConfig().sendDelay > 1) {
                    await new Promise(resolve => 
                        setTimeout(resolve, this.getCurrentConfig().sendDelay)
                    );
                }
            }
            
        } catch (error) {
            sender.isActive = false;
            onError(error);
        }
    }
    
    /**
     * 使用分片方式进行流式传输（回退方案）
     */
    async streamWithSlicing(sender, onProgress, onComplete, onError) {
        let offset = 0;
        
        const sendNextBatch = async () => {
            if (!sender.isActive || offset >= sender.file.size) {
                if (offset >= sender.file.size) {
                    sender.isActive = false;
                    this.activeSenders.delete(sender.fileId);
                    onComplete();
                }
                return;
            }
            
            // 并发发送多个块
            const batchPromises = [];
            const batchSize = Math.min(this.config.maxConcurrentChunks, 
                Math.ceil((sender.file.size - offset) / sender.chunkSize));
            
            for (let i = 0; i < batchSize && offset < sender.file.size; i++) {
                const chunkStart = offset;
                const chunkEnd = Math.min(offset + sender.chunkSize, sender.file.size);
                const chunkIndex = Math.floor(chunkStart / sender.chunkSize);
                
                offset = chunkEnd;
                
                // 异步处理每个块
                const chunkPromise = this.processSliceChunk(
                    sender, chunkStart, chunkEnd, chunkIndex
                );
                batchPromises.push(chunkPromise);
            }
            
            try {
                await Promise.all(batchPromises);
                this.updateSenderProgress(sender, onProgress);
                
                // 继续下一批
                setTimeout(sendNextBatch, this.getCurrentConfig().sendDelay);
                
            } catch (error) {
                sender.isActive = false;
                onError(error);
            }
        };
        
        // 开始发送
        sendNextBatch();
    }
    
    /**
     * 处理单个分片块
     */
    async processSliceChunk(sender, start, end, chunkIndex) {
        try {
            // 等待缓冲区可用
            await this.waitForBufferAvailable(sender.dataChannel, sender);
            
            if (!sender.isActive || sender.dataChannel.readyState !== 'open') {
                throw new Error('Channel closed');
            }
            
            // 读取块（不将整个文件加载到内存）
            const slice = sender.file.slice(start, end);
            const arrayBuffer = await slice.arrayBuffer();
            
            // 创建二进制消息
            const message = this.createBinaryMessage({
                type: 'hp-chunk',
                fileId: sender.fileId,
                chunkIndex,
                totalChunks: sender.totalChunks,
                data: new Uint8Array(arrayBuffer)
            });
            
            // 发送
            sender.dataChannel.send(message);
            
            sender.sentChunks++;
            sender.bytesSent += arrayBuffer.byteLength;
            
        } catch (error) {
            throw error;
        }
    }
    
    /**
     * 等待缓冲区可用
     */
    async waitForBufferAvailable(dataChannel, sender) {
        const threshold = this.getCurrentConfig().bufferThreshold;
        
        return new Promise((resolve, reject) => {
            let waitTime = 0;
            const maxWait = 30000; // 30秒超时
            
            const check = () => {
                if (!sender.isActive || dataChannel.readyState !== 'open') {
                    reject(new Error('Channel closed'));
                    return;
                }
                
                if (waitTime > maxWait) {
                    reject(new Error('Buffer wait timeout'));
                    return;
                }
                
                if (dataChannel.bufferedAmount < threshold) {
                    resolve();
                } else {
                    waitTime += 10;
                    setTimeout(check, 10);
                }
            };
            
            check();
        });
    }
    
    /**
     * 创建高性能接收器
     */
    async createHighPerformanceReceiver(fileMetadata, onProgress, onComplete, onError) {
        const receiver = {
            fileId: fileMetadata.fileId,
            fileName: fileMetadata.fileName,
            fileSize: fileMetadata.fileSize,
            totalChunks: fileMetadata.totalChunks,
            receivedChunks: 0,
            receivedBytes: 0,
            startTime: Date.now(),
            isActive: true,
            
            // 使用 WritableStream 进行零内存写入
            writableStream: null,
            writer: null
        };
        
        // 优先使用 File System Access API
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: fileMetadata.fileName
                });
                
                receiver.writableStream = await handle.createWritable();
                receiver.writer = receiver.writableStream;
                
            } catch (error) {
                console.warn('File System Access failed, using StreamSaver');
                await this.setupStreamSaverReceiver(receiver);
            }
        } else {
            await this.setupStreamSaverReceiver(receiver);
        }
        
        this.activeReceivers.set(fileMetadata.fileId, receiver);
        return receiver;
    }
    
    /**
     * 设置 StreamSaver 接收器
     */
    async setupStreamSaverReceiver(receiver) {
        // 确保 StreamSaver 已加载
        if (!window.streamSaver) {
            await this.loadStreamSaver();
        }
        
        if (window.streamSaver) {
            const fileStream = streamSaver.createWriteStream(receiver.fileName, {
                size: receiver.fileSize
            });
            receiver.writer = fileStream.getWriter();
        } else {
            // 最终回退：Service Worker 方式
            if (this.serviceWorker) {
                this.serviceWorker.postMessage({
                    type: 'START_DOWNLOAD',
                    fileId: receiver.fileId,
                    fileName: receiver.fileName,
                    fileSize: receiver.fileSize
                });
                receiver.useServiceWorker = true;
            } else {
                throw new Error('No suitable download method available');
            }
        }
    }
    
    /**
     * 处理接收到的高性能数据块
     */
    async handleHighPerformanceChunk(chunkData, peerId) {
        const receiver = this.activeReceivers.get(chunkData.fileId);
        if (!receiver || !receiver.isActive) {
            console.warn('No active receiver for chunk:', chunkData.fileId);
            return;
        }
        
        try {
            // 直接写入，不存储在内存中
            if (receiver.useServiceWorker) {
                this.serviceWorker.postMessage({
                    type: 'CHUNK_DATA',
                    fileId: chunkData.fileId,
                    chunk: chunkData.data
                });
            } else if (receiver.writer) {
                await receiver.writer.write(chunkData.data);
            }
            
            receiver.receivedChunks++;
            receiver.receivedBytes += chunkData.data.byteLength;
            
            // 更新进度
            const progress = (receiver.receivedBytes / receiver.fileSize) * 100;
            const speed = receiver.receivedBytes / ((Date.now() - receiver.startTime) / 1000);
            
            // 检查完成
            if (receiver.receivedChunks >= receiver.totalChunks) {
                await this.completeReceiving(receiver);
            }
            
        } catch (error) {
            console.error('Error handling chunk:', error);
            receiver.isActive = false;
            this.activeReceivers.delete(chunkData.fileId);
        }
    }
    
    /**
     * 完成接收
     */
    async completeReceiving(receiver) {
        try {
            if (receiver.writer && !receiver.useServiceWorker) {
                await receiver.writer.close();
            }
            
            receiver.isActive = false;
            this.activeReceivers.delete(receiver.fileId);
            
            console.log(`File received: ${receiver.fileName}`);
            
        } catch (error) {
            console.error('Error completing receive:', error);
        }
    }
    
    /**
     * 更新发送器进度
     */
    updateSenderProgress(sender, onProgress) {
        const now = Date.now();
        const progress = (sender.bytesSent / sender.file.size) * 100;
        
        // 计算速度（每秒更新一次）
        if (now - sender.lastSpeedCheck >= 1000) {
            const timeDiff = (now - sender.lastSpeedCheck) / 1000;
            const bytesDiff = sender.bytesSent - sender.lastBytesSent;
            sender.currentSpeed = bytesDiff / timeDiff;
            
            sender.lastSpeedCheck = now;
            sender.lastBytesSent = sender.bytesSent;
            
            // 动态调整块大小
            this.adjustChunkSize(sender);
        }
        
        if (onProgress) {
            onProgress(progress, sender.currentSpeed);
        }
    }
    
    /**
     * 动态调整块大小
     */
    adjustChunkSize(sender) {
        // 根据当前速度调整块大小
        if (sender.currentSpeed > this.config.speedThresholds.fast) {
            sender.chunkSize = this.config.chunkSizes.lan;
        } else if (sender.currentSpeed > this.config.speedThresholds.medium) {
            sender.chunkSize = this.config.chunkSizes.wan;
        } else {
            sender.chunkSize = this.config.chunkSizes.slow;
        }
    }
    
    /**
     * 创建二进制消息
     */
    createBinaryMessage(messageData) {
        // 序列化头部
        const header = {
            type: messageData.type,
            fileId: messageData.fileId,
            chunkIndex: messageData.chunkIndex,
            totalChunks: messageData.totalChunks
        };
        
        const headerStr = JSON.stringify(header);
        const headerBytes = new TextEncoder().encode(headerStr);
        
        // 组合头部和数据
        const totalLength = 4 + headerBytes.length + messageData.data.byteLength;
        const buffer = new ArrayBuffer(totalLength);
        const view = new DataView(buffer);
        
        // 写入头部长度
        view.setUint32(0, headerBytes.length, true);
        
        // 写入头部
        const uint8View = new Uint8Array(buffer);
        uint8View.set(headerBytes, 4);
        
        // 写入数据
        uint8View.set(messageData.data, 4 + headerBytes.length);
        
        return buffer;
    }
    
    /**
     * 解析二进制消息
     */
    parseBinaryMessage(arrayBuffer) {
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
        return new Promise((resolve, reject) => {
            if (window.streamSaver) {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/streamsaver@2.0.6/StreamSaver.min.js';
            script.onload = () => {
                if (window.streamSaver) {
                    streamSaver.mitm = 'https://cdn.jsdelivr.net/npm/streamsaver@2.0.6/mitm.html';
                }
                resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    /**
     * 取消传输
     */
    cancelTransfer(fileId, isReceiver = false) {
        if (isReceiver) {
            const receiver = this.activeReceivers.get(fileId);
            if (receiver) {
                receiver.isActive = false;
                if (receiver.writer && !receiver.useServiceWorker) {
                    receiver.writer.abort();
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
window.highPerformanceStreamHandler = new HighPerformanceStreamHandler();