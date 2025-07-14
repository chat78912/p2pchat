/**
 * 流式传输处理器 - 完全不依赖内存的文件传输
 */

class StreamHandler {
    constructor() {
        // 支持检测
        this.supportsFileStream = typeof File.prototype.stream === 'function';
        this.supportsFileSystemAccess = 'showSaveFilePicker' in window;
        this.supportsStreamSaver = typeof window.streamSaver !== 'undefined';
        
        // 传输配置
        this.config = {
            chunkSize: 8 * 1024, // 8KB - 更小的块大小以提高稳定性
            maxBufferedAmount: 256 * 1024, // 256KB - 最大缓冲
            backpressureThreshold: 128 * 1024, // 128KB - 背压阈值
            ackInterval: 10, // 每10个块发送一次确认
            sendDelay: 10, // 发送延迟（毫秒）
            maxRetries: 3 // 最大重试次数
        };
        
        // 总是加载 StreamSaver.js 作为主要方案
        this.loadStreamSaver();
    }
    
    /**
     * 加载 StreamSaver.js 库
     */
    async loadStreamSaver() {
        if (!window.streamSaver) {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/streamsaver@2.0.6/StreamSaver.min.js';
            document.head.appendChild(script);
            
            return new Promise((resolve) => {
                script.onload = () => {
                    // 配置 StreamSaver
                    if (window.streamSaver) {
                        streamSaver.mitm = 'https://cdn.jsdelivr.net/npm/streamsaver@2.0.6/mitm.html';
                    }
                    resolve();
                };
            });
        }
    }
    
    /**
     * 创建流式发送器
     */
    createStreamSender(file, fileId, dataChannel, onProgress, onComplete, onError) {
        const sender = {
            file,
            fileId,
            dataChannel,
            bytesSent: 0,
            isPaused: false,
            isComplete: false,
            startTime: Date.now()
        };
        
        // 使用原生流 API
        if (this.supportsFileStream) {
            return this.createNativeStreamSender(sender, onProgress, onComplete, onError);
        } else {
            // 回退到切片方式，但优化内存使用
            return this.createSliceStreamSender(sender, onProgress, onComplete, onError);
        }
    }
    
    /**
     * 使用原生 Streams API 发送
     */
    async createNativeStreamSender(sender, onProgress, onComplete, onError) {
        const { file, fileId, dataChannel } = sender;
        
        try {
            const stream = file.stream();
            const reader = stream.getReader();
            
            const pump = async () => {
                if (sender.isPaused || sender.isComplete) {
                    reader.cancel();
                    return;
                }
                
                try {
                    const { done, value } = await reader.read();
                    
                    if (done) {
                        sender.isComplete = true;
                        onComplete();
                        return;
                    }
                    
                    // 检查背压
                    if (dataChannel.bufferedAmount > this.config.backpressureThreshold) {
                        // 等待缓冲区清空
                        await this.waitForBuffer(dataChannel);
                    }
                    
                    // 发送二进制数据
                    const message = {
                        type: 'stream-chunk',
                        fileId: fileId,
                        data: value,
                        offset: sender.bytesSent,
                        isBinary: true
                    };
                    
                    // 检查通道状态
                    if (dataChannel.readyState !== 'open') {
                        throw new Error('Data channel closed');
                    }
                    
                    // 使用 ArrayBuffer 直接发送
                    dataChannel.send(this.encodeMessage(message));
                    
                    sender.bytesSent += value.byteLength;
                    
                    // 更新进度
                    if (onProgress) {
                        const progress = (sender.bytesSent / file.size) * 100;
                        const speed = sender.bytesSent / ((Date.now() - sender.startTime) / 1000);
                        onProgress(progress, speed);
                    }
                    
                    // 添加小延迟，避免过载
                    setTimeout(() => pump(), this.config.sendDelay);
                    
                } catch (error) {
                    sender.isComplete = true;
                    onError(error);
                }
            };
            
            // 开始传输
            pump();
            
            return sender;
            
        } catch (error) {
            onError(error);
        }
    }
    
    /**
     * 使用切片方式发送（优化版本）
     */
    async createSliceStreamSender(sender, onProgress, onComplete, onError) {
        const { file, fileId, dataChannel } = sender;
        let offset = 0;
        
        const sendNextChunk = async () => {
            if (sender.isPaused || sender.isComplete || offset >= file.size) {
                if (offset >= file.size) {
                    sender.isComplete = true;
                    onComplete();
                }
                return;
            }
            
            try {
                // 检查背压
                if (dataChannel.bufferedAmount > this.config.backpressureThreshold) {
                    await this.waitForBuffer(dataChannel);
                }
                
                // 读取下一个块
                const end = Math.min(offset + this.config.chunkSize, file.size);
                const slice = file.slice(offset, end);
                const arrayBuffer = await slice.arrayBuffer();
                
                // 发送二进制数据
                const message = {
                    type: 'stream-chunk',
                    fileId: fileId,
                    data: new Uint8Array(arrayBuffer),
                    offset: offset,
                    isBinary: true
                };
                
                dataChannel.send(this.encodeMessage(message));
                
                offset = end;
                sender.bytesSent = offset;
                
                // 更新进度
                if (onProgress) {
                    const progress = (offset / file.size) * 100;
                    const speed = offset / ((Date.now() - sender.startTime) / 1000);
                    onProgress(progress, speed);
                }
                
                // 继续下一个块
                setTimeout(sendNextChunk, 0);
                
            } catch (error) {
                sender.isComplete = true;
                onError(error);
            }
        };
        
        // 开始发送
        sendNextChunk();
        
        return sender;
    }
    
    /**
     * 创建流式接收器
     */
    async createStreamReceiver(fileMetadata, onProgress, onComplete, onError) {
        // 优先使用 StreamSaver（更稳定）
        if (this.supportsStreamSaver || window.streamSaver) {
            try {
                return await this.createStreamSaverReceiver(fileMetadata, onProgress, onComplete, onError);
            } catch (error) {
                console.warn('StreamSaver failed, trying File System Access API:', error);
            }
        }
        
        // 其次尝试 File System Access API
        if (this.supportsFileSystemAccess) {
            try {
                return await this.createFileSystemReceiver(fileMetadata, onProgress, onComplete, onError);
            } catch (error) {
                console.warn('File System Access API failed, falling back to memory:', error);
            }
        }
        
        // 最后回退到内存方式（但使用优化的处理）
        return await this.createMemoryReceiver(fileMetadata, onProgress, onComplete, onError);
    }
    
    /**
     * 使用 File System Access API 接收
     */
    async createFileSystemReceiver(fileMetadata, onProgress, onComplete, onError) {
        try {
            // 显示文件保存对话框，不限制文件类型
            const handle = await window.showSaveFilePicker({
                suggestedName: fileMetadata.fileName
            });
            
            // 创建可写流
            const writableStream = await handle.createWritable();
            
            const receiver = {
                fileId: fileMetadata.fileId,
                fileMetadata,
                writableStream,
                bytesReceived: 0,
                startTime: Date.now(),
                
                // 处理数据块
                async handleChunk(chunkData) {
                    try {
                        // 写入数据
                        await writableStream.write(chunkData.data);
                        
                        this.bytesReceived += chunkData.data.byteLength;
                        
                        // 更新进度
                        if (onProgress) {
                            const progress = (this.bytesReceived / fileMetadata.fileSize) * 100;
                            const speed = this.bytesReceived / ((Date.now() - this.startTime) / 1000);
                            onProgress(progress, speed);
                        }
                        
                        // 检查是否完成
                        if (this.bytesReceived >= fileMetadata.fileSize) {
                            await writableStream.close();
                            onComplete();
                        }
                    } catch (error) {
                        onError(error);
                    }
                },
                
                // 取消接收
                async cancel() {
                    try {
                        await writableStream.abort();
                    } catch (e) {
                        console.error('Error aborting stream:', e);
                    }
                }
            };
            
            return receiver;
            
        } catch (error) {
            // 用户取消或其他错误
            onError(error);
            return null;
        }
    }
    
    /**
     * 使用 StreamSaver 接收
     */
    async createStreamSaverReceiver(fileMetadata, onProgress, onComplete, onError) {
        try {
            const fileStream = streamSaver.createWriteStream(
                fileMetadata.fileName,
                {
                    size: fileMetadata.fileSize
                }
            );
            
            const writer = fileStream.getWriter();
            
            const receiver = {
                fileId: fileMetadata.fileId,
                fileMetadata,
                writer,
                bytesReceived: 0,
                startTime: Date.now(),
                
                // 处理数据块
                async handleChunk(chunkData) {
                    try {
                        // 写入数据
                        await writer.write(chunkData.data);
                        
                        this.bytesReceived += chunkData.data.byteLength;
                        
                        // 更新进度
                        if (onProgress) {
                            const progress = (this.bytesReceived / fileMetadata.fileSize) * 100;
                            const speed = this.bytesReceived / ((Date.now() - this.startTime) / 1000);
                            onProgress(progress, speed);
                        }
                        
                        // 检查是否完成
                        if (this.bytesReceived >= fileMetadata.fileSize) {
                            await writer.close();
                            onComplete();
                        }
                    } catch (error) {
                        onError(error);
                    }
                },
                
                // 取消接收
                async cancel() {
                    try {
                        await writer.abort();
                    } catch (e) {
                        console.error('Error aborting stream:', e);
                    }
                }
            };
            
            return receiver;
            
        } catch (error) {
            onError(error);
            return null;
        }
    }
    
    /**
     * 使用内存接收（优化版本）
     */
    async createMemoryReceiver(fileMetadata, onProgress, onComplete, onError) {
        // 使用 Blob 流式构建
        const chunks = [];
        let totalSize = 0;
        
        const receiver = {
            fileId: fileMetadata.fileId,
            fileMetadata,
            bytesReceived: 0,
            startTime: Date.now(),
            
            // 处理数据块
            async handleChunk(chunkData) {
                try {
                    // 添加到块列表
                    chunks.push(chunkData.data);
                    totalSize += chunkData.data.byteLength;
                    
                    this.bytesReceived += chunkData.data.byteLength;
                    
                    // 更新进度
                    if (onProgress) {
                        const progress = (this.bytesReceived / fileMetadata.fileSize) * 100;
                        const speed = this.bytesReceived / ((Date.now() - this.startTime) / 1000);
                        onProgress(progress, speed);
                    }
                    
                    // 检查是否完成
                    if (this.bytesReceived >= fileMetadata.fileSize) {
                        // 创建 Blob 并下载
                        const blob = new Blob(chunks, { type: fileMetadata.fileType });
                        const url = URL.createObjectURL(blob);
                        
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = fileMetadata.fileName;
                        a.click();
                        
                        // 清理
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                        chunks.length = 0;
                        
                        onComplete();
                    }
                } catch (error) {
                    onError(error);
                }
            },
            
            // 取消接收
            async cancel() {
                chunks.length = 0;
            }
        };
        
        return receiver;
    }
    
    /**
     * 编码消息为二进制格式
     */
    encodeMessage(message) {
        // 创建头部信息
        const header = {
            type: message.type,
            fileId: message.fileId,
            offset: message.offset
        };
        
        // 将头部转换为 JSON 字符串
        const headerStr = JSON.stringify(header);
        const headerBytes = new TextEncoder().encode(headerStr);
        
        // 创建最终的二进制消息
        // 格式: [头部长度(4字节)] + [头部数据] + [二进制数据]
        const totalLength = 4 + headerBytes.byteLength + message.data.byteLength;
        const buffer = new ArrayBuffer(totalLength);
        const view = new DataView(buffer);
        
        // 写入头部长度
        view.setUint32(0, headerBytes.byteLength, true);
        
        // 写入头部数据
        const uint8View = new Uint8Array(buffer);
        uint8View.set(headerBytes, 4);
        
        // 写入二进制数据
        uint8View.set(message.data, 4 + headerBytes.byteLength);
        
        return buffer;
    }
    
    /**
     * 解码二进制消息
     */
    decodeMessage(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        
        // 读取头部长度
        const headerLength = view.getUint32(0, true);
        
        // 读取头部数据
        const headerBytes = new Uint8Array(arrayBuffer, 4, headerLength);
        const headerStr = new TextDecoder().decode(headerBytes);
        const header = JSON.parse(headerStr);
        
        // 读取二进制数据
        const dataStart = 4 + headerLength;
        const data = new Uint8Array(arrayBuffer, dataStart);
        
        return {
            ...header,
            data: data
        };
    }
    
    /**
     * 等待缓冲区清空
     */
    waitForBuffer(dataChannel) {
        return new Promise((resolve) => {
            const checkBuffer = () => {
                if (dataChannel.bufferedAmount < this.config.maxBufferedAmount) {
                    resolve();
                } else {
                    setTimeout(checkBuffer, 50);
                }
            };
            checkBuffer();
        });
    }
    
    /**
     * 获取文件类型配置
     */
    getFileTypes(fileMetadata) {
        const mimeType = fileMetadata.fileType || 'application/octet-stream';
        const fileName = fileMetadata.fileName || 'file';
        const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : 'bin';
        
        // 常见文件类型映射
        const typeMap = {
            'image/jpeg': [{ description: 'JPEG images', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }],
            'image/png': [{ description: 'PNG images', accept: { 'image/png': ['.png'] } }],
            'image/gif': [{ description: 'GIF images', accept: { 'image/gif': ['.gif'] } }],
            'application/pdf': [{ description: 'PDF documents', accept: { 'application/pdf': ['.pdf'] } }],
            'application/zip': [{ description: 'ZIP archives', accept: { 'application/zip': ['.zip'] } }],
            'video/mp4': [{ description: 'MP4 videos', accept: { 'video/mp4': ['.mp4'] } }],
            'audio/mpeg': [{ description: 'MP3 audio', accept: { 'audio/mpeg': ['.mp3'] } }],
            'text/plain': [{ description: 'Text files', accept: { 'text/plain': ['.txt'] } }]
        };
        
        // 返回对应的类型配置，或根据扩展名生成
        return typeMap[mimeType] || [{
            description: `${extension.toUpperCase()} files`,
            accept: { '*/*': [`.${extension}`] }
        }];
    }
}

// 导出全局实例
window.streamHandler = new StreamHandler();