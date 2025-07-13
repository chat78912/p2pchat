# P2P 聊天室

一个基于 WebRTC 的点对点聊天应用，支持局域网自动发现和公网手动连接两种模式。

## ✨ 特性

- 🔗 **P2P 直连**：使用 WebRTC 技术实现真正的点对点通信
- 🏠 **局域网模式**：自动检测同网段用户，无需手动配置
- 🌐 **公网模式**：支持通过房间号连接任意网络用户
- 📱 **响应式设计**：适配各种设备屏幕尺寸
- 🔄 **无缝切换**：模式间切换不断开连接
- 💬 **实时聊天**：低延迟的实时消息传输
- 👤 **用户识别**：随机生成的用户名和头像

## 🚀 快速开始

### 方式一：直接使用

1. 克隆项目
```bash
git clone <repository-url>
cd p2pchat
```

2. 启动本地服务器
```bash
# 使用 Python
python -m http.server 8080

# 或使用 Node.js (需要安装 http-server)
npx http-server -p 8080
```

3. 打开浏览器访问 `http://localhost:8080`

### 方式二：Docker 部署

```bash
cd core
docker build -t p2pchat .
docker run -p 8080:8080 p2pchat
```

## 📖 使用说明

### 局域网模式

1. 确保设备连接在同一局域网
2. 打开应用，默认即为局域网模式
3. 应用会自动检测网络环境并分配房间
4. 同网段的其他用户会自动出现在用户列表
5. 无需任何配置即可开始聊天

### 公网模式

1. 点击"公网"按钮切换模式
2. 输入相同的房间号
3. 点击"加入房间"
4. 等待其他用户加入同一房间
5. 建立连接后即可聊天

## 🏗️ 项目架构

### 文件结构

```
p2pchat/
├── index.html              # 主页面
├── assets/
│   ├── config.js          # 配置文件
│   ├── mode-selector.js   # 模式选择器（连接管理）
│   ├── lan-mode.js        # 局域网模式实现
│   ├── internet-mode.js   # 公网模式实现
│   ├── servers.json       # 信令服务器配置
│   └── styles.css         # 样式文件
├── core/
│   ├── server.py          # Python 信令服务器
│   ├── Dockerfile         # Docker 配置
│   └── requirements.txt   # Python 依赖
└── README.md
```

### 技术架构

```
┌─────────────────────────────────────────────────────┐
│                   前端架构                          │
├─────────────────────────────────────────────────────┤
│  ModeSelector (模式选择器)                          │
│  ├─ WebSocket 连接管理                              │
│  ├─ 服务器切换逻辑                                  │
│  └─ 消息转发机制                                    │
├─────────────────────────────────────────────────────┤
│  LANMode (局域网模式)     │  InternetMode (公网模式) │
│  ├─ 网络自动检测          │  ├─ 手动房间连接         │
│  ├─ P2P 连接建立          │  ├─ P2P 连接建立         │
│  └─ 消息收发              │  └─ 消息收发             │
└─────────────────────────────────────────────────────┘
                           │
                    WebSocket 信令
                           │
┌─────────────────────────────────────────────────────┐
│                 后端架构                            │
├─────────────────────────────────────────────────────┤
│  WebSocket 信令服务器                               │
│  ├─ 用户注册/注销                                   │
│  ├─ 房间管理                                        │
│  ├─ 消息转发                                        │
│  └─ 连接状态监控                                    │
└─────────────────────────────────────────────────────┘
```

## ⚙️ 配置说明

### 信令服务器配置

编辑 `assets/servers.json` 文件配置信令服务器：

```json
{
  "servers": [
    {
      "name": "本地服务器",
      "url": "ws://localhost:8765",
      "priority": 1
    },
    {
      "name": "备用服务器", 
      "url": "wss://your-server.com/ws",
      "priority": 2
    }
  ]
}
```

### WebRTC 配置

编辑 `assets/config.js` 文件配置 STUN/TURN 服务器：

```javascript
const RTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};
```

## 🔧 开发说明

### 核心组件

#### ModeSelector (模式选择器)
- 负责 WebSocket 连接的生命周期管理
- 实现服务器自动切换和重连机制
- 将消息转发给当前激活的模式

#### LANMode (局域网模式)
- 自动检测公网 IP 和本地网段
- 基于网络信息生成房间 ID
- 实现同网段用户的自动发现

#### InternetMode (公网模式)
- 支持手动输入房间号
- 实现跨网络的用户连接
- 提供房间管理界面

### 网络检测机制

局域网模式使用以下策略检测网络环境：

1. **公网 IP 检测**：通过 STUN 服务器获取公网 IP
2. **本地网段检测**：通过 WebRTC 获取本地 IP 段
3. **房间 ID 生成**：结合公网 IP 和本地网段生成唯一房间标识

示例房间 ID：`lan_192.168.1_192.168.1`

### P2P 连接流程

```
用户A                    信令服务器                    用户B
  │                          │                          │
  ├─── join room ──────────→ │                          │
  │                          ├─── user-joined ──────→  │
  │                          │ ←──── offer ─────────────┤
  │ ←──── offer ─────────────┤                          │
  ├─── answer ─────────────→ │                          │
  │                          ├─── answer ──────────→   │
  ├─── ice-candidate ────→   │                          │
  │                          ├─── ice-candidate ───→   │
  │                          │                          │
  │ ←────── P2P 直连建立 ──────────────────────────────→ │
```

## 🛠️ 故障排除

### 常见问题

1. **无法连接到信令服务器**
   - 检查 `servers.json` 配置
   - 确认服务器是否正常运行
   - 检查防火墙设置

2. **P2P 连接失败**
   - 检查网络防火墙设置
   - 确认 STUN 服务器可访问
   - 考虑使用 TURN 服务器

3. **局域网模式无法发现用户**
   - 确认设备在同一局域网
   - 检查网络设置和路由配置
   - 尝试刷新页面重新检测

### 调试模式

打开浏览器开发者工具查看详细日志：

```javascript
// 控制台中查看连接状态
console.log('WebSocket状态:', modeSelector.isWebSocketConnected);
console.log('当前模式:', modeSelector.currentMode);
console.log('P2P连接:', modeSelector.chatModeInstance.peerConnections);
```

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 🙏 致谢

- [WebRTC](https://webrtc.org/) - 实时通信技术
- [DiceBear](https://dicebear.com/) - 头像生成服务
- 所有贡献者和测试用户

---

**注意**：本项目仅用于学习和演示目的，生产环境使用请确保适当的安全措施和服务器配置。