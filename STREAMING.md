# P2P 聊天流式传输实现

## 概述

本项目已升级为真正的流式传输，完全不依赖内存，支持传输任意大小的文件。

## 核心改进

### 1. 流式读取
```javascript
// 使用 File.stream() API
const stream = file.stream();
const reader = stream.getReader();

// 逐块读取，不占用内存
const { done, value } = await reader.read();
```

### 2. 二进制传输
```javascript
// 设置数据通道为二进制模式
dataChannel.binaryType = 'arraybuffer';

// 直接传输二进制数据，效率提升 33%
dataChannel.send(arrayBuffer);
```

### 3. 流式写入

#### 使用 File System Access API（推荐）
```javascript
// 显示文件保存对话框
const handle = await window.showSaveFilePicker();
const writableStream = await handle.createWritable();

// 直接写入磁盘
await writableStream.write(chunk);
```

#### 使用 StreamSaver.js（后备方案）
```javascript
const fileStream = streamSaver.createWriteStream(fileName);
const writer = fileStream.getWriter();
await writer.write(chunk);
```

## 技术特性

### 内存优化
- **块大小**: 16KB（可调整）
- **缓冲控制**: 最大 64KB
- **背压处理**: 自动调节发送速度

### 性能指标
- **内存占用**: 固定 ~16KB（不随文件大小增长）
- **传输效率**: 二进制直传，无编码损耗
- **文件大小**: 理论上无限制

### 浏览器兼容性
- **File System Access API**: Chrome 86+, Edge 86+
- **File.stream()**: Chrome 76+, Firefox 62+, Safari 14.1+
- **StreamSaver.js**: 所有现代浏览器
- **回退方案**: 优化的内存模式

## 使用说明

1. **发送文件**: 点击附件按钮或拖拽文件到聊天窗口
2. **接收文件**: 
   - Chrome/Edge: 弹出保存对话框，选择保存位置
   - 其他浏览器: 自动下载到默认下载目录
3. **取消传输**: 点击进度条上的取消按钮

## 架构设计

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   File API  │────▶│ Stream Reader│────▶│ DataChannel │
└─────────────┘     └──────────────┘     └─────────────┘
                           │                      │
                           ▼                      ▼
                    ┌──────────────┐     ┌──────────────┐
                    │ ArrayBuffer  │     │ Binary Msg   │
                    └──────────────┘     └──────────────┘
                                                  │
                                                  ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│ File System │◀────│Stream Writer │◀────│ DataChannel  │
└─────────────┘     └──────────────┘     └──────────────┘
```

## 代码结构

- `stream-handler.js`: 流式传输核心逻辑
- `main.js`: 集成流式传输的聊天逻辑
- 原有文件传输代码保留作为后备方案

## 测试建议

1. 使用大文件（>100MB）测试内存占用
2. 打开开发者工具的 Performance Monitor 监控内存
3. 测试不同浏览器的兼容性
4. 测试取消和恢复功能

## 未来优化

- [ ] 断点续传支持
- [ ] 多文件并发传输
- [ ] 压缩传输选项
- [ ] 传输加密