# iOS App 到 OpenClaw 消息 Pipeline

本文梳理 `apps/ios` 中，从 iOS App 连接 OpenClaw Gateway，到发送消息、接收消息并更新 UI 的完整链路。

## 总览

这个 iOS app 并不是只维护一条 Gateway 连接，而是并行维护两条逻辑会话：

- `nodeGateway`：把 iPhone 作为 OpenClaw 的一个设备节点，负责 `node.invoke`、`voice.transcript`、`agent.request` 等设备能力与代理事件。
- `operatorGateway`：把 iPhone 作为聊天客户端/operator，负责 `chat.send`、`chat.history`、`sessions.list` 和服务端事件订阅。

可以把它理解为：

- `nodeGateway` = 设备侧连接
- `operatorGateway` = 聊天侧连接

## 1. App 启动

入口在 `apps/ios/Sources/OpenClawApp.swift:493`。

启动时会：

1. 初始化本地持久化：`GatewaySettingsStore.bootstrapPersistence()`
2. 创建 `NodeAppModel`
3. 创建 `GatewayConnectionController`
4. 将二者注入 SwiftUI environment

关键代码位置：

- `apps/ios/Sources/OpenClawApp.swift:499`
- `apps/ios/Sources/OpenClawApp.swift:504`
- `apps/ios/Sources/OpenClawApp.swift:507`

## 2. 连接角色：NodeAppModel 持有两条 Gateway 会话

`NodeAppModel` 是这条 pipeline 的核心协调器，定义在 `apps/ios/Sources/Model/NodeAppModel.swift:50`。

其中最关键的是这两个字段：

- `nodeGateway`：`apps/ios/Sources/Model/NodeAppModel.swift:98`
- `operatorGateway`：`apps/ios/Sources/Model/NodeAppModel.swift:100`

注释已经明确了职责划分：

- Primary `node` connection：处理设备能力和 `node.invoke`
- Secondary `operator` connection：处理 chat/talk/config/voicewake

## 3. Gateway 发现与连接入口

`GatewayConnectionController` 负责：

- 局域网 discovery
- 手动连接
- TLS 指纹确认
- 自动重连
- 把连接配置下发给 `NodeAppModel`

定义位置：`apps/ios/Sources/Gateway/GatewayConnectionController.swift:22`

初始化时会启动 discovery：

- `apps/ios/Sources/Gateway/GatewayConnectionController.swift:45`
- `apps/ios/Sources/Gateway/GatewayConnectionController.swift:55`

当用户选择某个 Gateway，或者自动连接命中时，控制器会构造 `GatewayConnectConfig`，然后调用：

- `appModel.applyGatewayConnectConfig(cfg)`

关键位置：

- `apps/ios/Sources/Gateway/GatewayConnectionController.swift:461`
- `apps/ios/Sources/Gateway/GatewayConnectionController.swift:468`

## 4. 一次连接会同时拉起两条循环

`NodeAppModel.applyGatewayConnectConfig(_:)` 最终会调用 `connectToGateway(...)`：

- `apps/ios/Sources/Model/NodeAppModel.swift:1675`
- `apps/ios/Sources/Model/NodeAppModel.swift:1638`

在 `connectToGateway(...)` 里，会同时启动：

- `startOperatorGatewayLoop(...)`
- `startNodeGatewayLoop(...)`

关键位置：

- `apps/ios/Sources/Model/NodeAppModel.swift:1658`
- `apps/ios/Sources/Model/NodeAppModel.swift:1665`

这意味着：同一个 Gateway URL 会被这个 app 用两种身份/用途接入，而不是所有事情都复用一条 WS 会话。

## 5. Operator 会话：聊天 RPC 与事件订阅

`startOperatorGatewayLoop(...)` 位于：

- `apps/ios/Sources/Model/NodeAppModel.swift:1759`

它内部会调用：

- `self.operatorGateway.connect(...)`，见 `apps/ios/Sources/Model/NodeAppModel.swift:1797`

连接成功后，会做这些聊天相关初始化：

- 设置 `operatorConnected = true`：`apps/ios/Sources/Model/NodeAppModel.swift:1805`
- 更新 talk 模式状态：`apps/ios/Sources/Model/NodeAppModel.swift:1807`
- 重载 talk 配置：`apps/ios/Sources/Model/NodeAppModel.swift:1811`
- 拉取 branding：`apps/ios/Sources/Model/NodeAppModel.swift:1812`
- 拉取 agents 列表：`apps/ios/Sources/Model/NodeAppModel.swift:1813`
- 拉取 share route：`apps/ios/Sources/Model/NodeAppModel.swift:1814`
- 启动 voice wake 同步：`apps/ios/Sources/Model/NodeAppModel.swift:1815`

此外，这条 operator 会话明确不会处理 `node.invoke`。如果收到 node 命令，会直接返回错误：

- `apps/ios/Sources/Model/NodeAppModel.swift:1829`

## 6. Node 会话：设备能力、invoke 与旁路输入

`startNodeGatewayLoop(...)` 位于：

- `apps/ios/Sources/Model/NodeAppModel.swift:1853`

它内部会调用：

- `self.nodeGateway.connect(...)`，见 `apps/ios/Sources/Model/NodeAppModel.swift:1902`

连接成功后会做这些设备侧初始化：

- 更新连接状态：`apps/ios/Sources/Model/NodeAppModel.swift:1910`
- 保存 share relay 配置：`apps/ios/Sources/Model/NodeAppModel.swift:1924`
- 按需显示 A2UI：`apps/ios/Sources/Model/NodeAppModel.swift:1939`
- 调用 `onNodeGatewayConnected()`：`apps/ios/Sources/Model/NodeAppModel.swift:1940`
- 启动显著位置变化监听：`apps/ios/Sources/Model/NodeAppModel.swift:1942`

这条 node 会话负责处理 Gateway 下发的设备调用请求：

- `onInvoke` -> `handleInvoke(req)`
- 入口位置：`apps/ios/Sources/Model/NodeAppModel.swift:1962`

## 7. Chat UI 如何接入 operator 会话

聊天页不是直接拿底层 WebSocket，而是通过 transport 适配层接入。

### 7.1 RootCanvas 打开 ChatSheet

在 `RootCanvas` 中，打开聊天 sheet 时传入的是：

- `gateway: self.appModel.operatorSession`
- `sessionKey: self.appModel.chatSessionKey`

代码位置：

- `apps/ios/Sources/RootCanvas.swift:99`
- `apps/ios/Sources/RootCanvas.swift:102`
- `apps/ios/Sources/RootCanvas.swift:103`

这里非常关键：聊天 UI 使用的是 `operatorSession`，不是 `nodeSession`。

### 7.2 ChatSheet 创建 transport 和 view model

`ChatSheet` 会创建：

- `IOSGatewayChatTransport(gateway: gateway)`
- `OpenClawChatViewModel(sessionKey: sessionKey, transport: transport)`

代码位置：

- `apps/ios/Sources/Chat/ChatSheet.swift:11`
- `apps/ios/Sources/Chat/ChatSheet.swift:12`
- `apps/ios/Sources/Chat/ChatSheet.swift:14`

因此聊天链路是：

```text
ChatSheet -> IOSGatewayChatTransport -> OpenClawChatViewModel -> OpenClawChatView
```

## 8. 发消息链路

聊天输入框发消息时，最终调用的是 `IOSGatewayChatTransport.sendMessage(...)`：

- `apps/ios/Sources/Chat/IOSGatewayChatTransport.swift:50`

这个方法会：

1. 组装 `sessionKey`、`message`、`thinking`、`attachments`、`idempotencyKey`
2. JSON 编码
3. 调用 operator 会话的 RPC：`gateway.request(method: "chat.send", ...)`

关键位置：

- 参数定义：`apps/ios/Sources/Chat/IOSGatewayChatTransport.swift:63`
- RPC 调用：`apps/ios/Sources/Chat/IOSGatewayChatTransport.swift:82`
- 返回结果 decode：`apps/ios/Sources/Chat/IOSGatewayChatTransport.swift:83`

也就是说，发消息的主链路是：

```text
OpenClawChatView
-> OpenClawChatViewModel
-> IOSGatewayChatTransport.sendMessage(...)
-> operatorGateway.request("chat.send")
-> Gateway
```

## 9. 会话列表与历史记录链路

聊天界面除了发送消息，还依赖两个 RPC：

### 9.1 会话列表

方法：`listSessions(limit:)`

- `apps/ios/Sources/Chat/IOSGatewayChatTransport.swift:25`
- 实际 RPC：`sessions.list`
- 调用点：`apps/ios/Sources/Chat/IOSGatewayChatTransport.swift:33`

### 9.2 历史消息

方法：`requestHistory(sessionKey:)`

- `apps/ios/Sources/Chat/IOSGatewayChatTransport.swift:42`
- 实际 RPC：`chat.history`
- 调用点：`apps/ios/Sources/Chat/IOSGatewayChatTransport.swift:46`

因此，聊天页初始化通常依赖：

```text
operatorGateway.request("sessions.list")
operatorGateway.request("chat.history")
```

## 10. 收消息链路

接收消息不是轮询，而是订阅 Gateway 的服务端事件流。

入口在：

- `apps/ios/Sources/Chat/IOSGatewayChatTransport.swift:98`

这里做了两层映射：

1. 调用 `self.gateway.subscribeServerEvents()` 订阅底层事件流
2. 将 Gateway 事件转换成聊天层的 `OpenClawChatTransportEvent`

关键代码位置：

- 订阅事件流：`apps/ios/Sources/Chat/IOSGatewayChatTransport.swift:101`
- `chat` 事件 decode：`apps/ios/Sources/Chat/IOSGatewayChatTransport.swift:115`
- `agent` 事件 decode：`apps/ios/Sources/Chat/IOSGatewayChatTransport.swift:123`
- `health` 事件 decode：`apps/ios/Sources/Chat/IOSGatewayChatTransport.swift:109`

因此收消息的主链路是：

```text
Gateway server events
-> operatorGateway.subscribeServerEvents()
-> IOSGatewayChatTransport.events()
-> OpenClawChatViewModel
-> OpenClawChatView / SwiftUI 刷新
```

## 11. sessionKey 的选择逻辑

`NodeAppModel` 并不是固定用一个 session key，而是会结合当前选中的 agent 来生成。

### 11.1 主会话 key

- `mainSessionKey`：`apps/ios/Sources/Model/NodeAppModel.swift:1610`

如果当前 agent 不是默认 agent，会拼成 agent-specific 的 key：

- `apps/ios/Sources/Model/NodeAppModel.swift:1614`

### 11.2 聊天页 session key

- `chatSessionKey`：`apps/ios/Sources/Model/NodeAppModel.swift:1618`

聊天页在打开时使用的就是这个 key：

- `apps/ios/Sources/RootCanvas.swift:103`

## 12. 聊天以外的“消息输入”路径

除了聊天输入框，这个 app 里还有几条会把用户意图发到 OpenClaw 的路径。

### 12.1 语音唤醒 -> `voice.transcript`

`voiceWake` 触发后，会调用：

- `sendVoiceTranscript(text:sessionKey:)`：`apps/ios/Sources/Model/NodeAppModel.swift:2546`

这个方法会通过 `nodeGateway` 发事件：

- `nodeGateway.sendEvent(event: "voice.transcript", ...)`
- 代码位置：`apps/ios/Sources/Model/NodeAppModel.swift:2563`

### 12.2 Deep link / A2UI action -> `agent.request`

`NodeAppModel` 还会把 deep link、A2UI 按钮点击等动作编码成 agent 请求。

最终入口：

- `sendAgentRequest(link:)`：`apps/ios/Sources/Model/NodeAppModel.swift:2641`

这个方法通过 `nodeGateway` 发事件：

- `nodeGateway.sendEvent(event: "agent.request", ...)`
- 代码位置：`apps/ios/Sources/Model/NodeAppModel.swift:2654`

所以聊天输入和这些旁路输入是分开的：

- 聊天 UI：走 `operatorGateway` + `chat.send`
- 语音/深链/A2UI：走 `nodeGateway` + `voice.transcript` / `agent.request`

## 13. RootCanvas 与聊天打开时机

聊天页的弹出由 `RootCanvas` 控制。

当 `appModel.openChatRequestID` 变化时，会自动弹出聊天页：

- `apps/ios/Sources/RootCanvas.swift:150`
- `apps/ios/Sources/RootCanvas.swift:151`

这使得系统内其它逻辑可以通过更新 `openChatRequestID` 来把用户带入聊天界面，而不必直接操作 UI 路由。

## 14. 整体时序图

### 14.1 建连阶段

```text
App launch
-> OpenClawApp
-> NodeAppModel + GatewayConnectionController
-> Gateway discovery / manual connect
-> GatewayConnectionController.startAutoConnect(...)
-> NodeAppModel.applyGatewayConnectConfig(...)
-> connectToGateway(...)
-> startOperatorGatewayLoop(...)
-> startNodeGatewayLoop(...)
```

### 14.2 聊天发送阶段

```text
User types message in chat UI
-> OpenClawChatView
-> OpenClawChatViewModel
-> IOSGatewayChatTransport.sendMessage(...)
-> operatorGateway.request("chat.send")
-> Gateway handles prompt / run
```

### 14.3 聊天接收阶段

```text
Gateway emits chat/agent events
-> operatorGateway.subscribeServerEvents()
-> IOSGatewayChatTransport.events()
-> OpenClawChatViewModel consumes events
-> SwiftUI message list updates
```

### 14.4 设备侧输入阶段

```text
Voice wake / deep link / A2UI action
-> NodeAppModel
-> nodeGateway.sendEvent("voice.transcript" or "agent.request")
-> Gateway / agent pipeline
```

## 15. 架构上的关键结论

这个 iOS app 的设计重点不是“一个 app 连一个 websocket 就完事”，而是把职责拆开：

- `operatorGateway` 专注聊天体验与 operator RPC
- `nodeGateway` 专注设备能力、代理触发与 node.invoke

这样做的好处是：

- 聊天 UI 不需要理解 node 协议细节
- 设备能力不会和聊天 RPC 耦合在一起
- 同一个 app 同时具备“设备节点”和“聊天客户端”两种角色
- 更适合作为未来独立客户端架构的参考

## 16. 一句话总结

在 `apps/ios` 中，聊天主链路是：

```text
UI -> ChatViewModel -> IOSGatewayChatTransport -> operatorGateway -> Gateway RPC/events -> UI
```

而设备侧主链路是：

```text
Device/voice/deeplink -> NodeAppModel -> nodeGateway -> Gateway -> node.invoke / agent flow
```

两条链路共享同一个 Gateway，但职责清晰分离。
