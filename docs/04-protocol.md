# 数据模型与同步协议

状态：设计草案，M1/M2 落地时生成 TypeScript 类型、校验器和协议测试。协议版本与文档版本独立管理。

## 对象模型

| 实体 | 核心字段 |
| --- | --- |
| Board | id、schemaVersion、title、createdAt、updatedAt |
| Room | id、boardId、status、inviteVersion、ownerId |
| Member | id、roomId、role、displayName、color |
| Element | id、type、transform、style、zKey、createdBy、deleted |
| Stroke | Element + points[x,y,pressure]、brushKind |
| Text/Note | Element + Y.Text、fontSize、width |
| Image | Element + assetId、width、height、crop |
| Shape/Connector | Element + geometry 或端点元素 ID 与锚点 |
| MindNode | id、mapId、parentId、text、orderKey、collapsed |
| Asset | id、boardId、mime、bytes、width、height、storageKey |

UUID 或等价随机 ID；不使用数组下标作为对象身份。对象按 ID 存入映射，文本使用 Y.Text，变换作为原子值避免出现 x 更新而 y 未更新的中间状态。删除使用墓碑，避免迟到拖动让对象复活；清理策略需兼容断线重连窗口。

脑图父子关系为单一来源，连线与布局由关系推导。服务端串行校验分支移动，禁止自身为父、后代为父和跨脑图无效引用。布局算法按协议版本固定，折叠作为共享文档状态；个人镜头不共享。

## 三类数据通道

1. 持久文档：完成的笔迹、文字编辑、对象最终变换、删除和结构操作。需要可重放、合并和保存确认。
2. 在场状态：成员、世界坐标指针、当前工具、选择集合。可丢弃、不持久化；过期移除。Yjs Awareness 本身不存入文档，见 [官方说明](https://docs.yjs.dev/getting-started/adding-awareness)。
3. 过程预览：strokeId/operationId、序号、笔迹片段、拖动预览。限速、有 TTL；最终持久对象覆盖预览，不能双重渲染。

指针建议 20–30Hz，按设备和网络降频；笔迹片段按帧或约 30–50ms 合批。预览缓存有点数上限。预览丢失不应影响最终结果；长笔迹中间检查点用于降低掉线损失，最终按 strokeId 去重合并。停止操作后校正到持久状态。

## HTTP 接口草案

| 方法与路径 | 权限 | 语义 |
| --- | --- | --- |
| POST /api/rooms | 创建设备会话；限频 | 返回 roomId、viewer 凭证、主持人认领挑战 |
| POST /api/rooms/:id/claim | 一次性挑战及电视侧确认 | 签发主持人会话 |
| POST /api/rooms/:id/join | 有效邀请 | 返回成员身份与短期会话 |
| POST /api/rooms/:id/invite | 主持人 | 轮换邀请 |
| POST /api/rooms/:id/close | 主持人 | 关闭写入，保存并撤销会话 |
| POST /api/boards/:id/assets | 编辑者 | 校验上传、生成资产引用 |
| GET /api/boards/:id/export | 有权限的成员 | 导出版本一致的快照 |

邀请链接优先将一次性 token 放在 URL fragment，网页兑换后移除；凭证不进入分析日志或 Referer。浏览器 WebSocket 使用同源安全会话 cookie 或一次性握手票据，不把长期凭证放在 URL query。

## WebSocket 消息草案

所有控制消息包含 protocolVersion、type、roomId、requestId；服务端身份以会话为准，不信任客户端自报 actorId。二进制文档更新使用独立帧类型。

- session.ready：有效角色、当前房间状态和协议版本。
- doc.sync / doc.update：状态向量交换与增量更新。
- doc.persisted：客户端 mutationId 与服务端持久化序号；支持重试去重。
- presence.update：光标、工具、选择集合和递增序号。
- preview.begin / preview.chunk / preview.end：操作 ID、顺序与世界坐标。
- viewport.command：仅主持人/受限电视设备可请求，服务端广播电视展示目标。
- room.closed / permission.revoked：终止写入与待发送队列。
- error：code、requestId、是否可重试；不返回内部堆栈。

乱序预览按序号丢弃旧消息；TTL 清理残影。最后片段或预览结束消息丢失时，以持久文档完成记录和超时清理兜底。慢客户端采用背压，先丢旧指针预览，文档更新不能静默丢弃，必要时断开并重新同步。

## 并发与撤销

同一对象并发拖动暂定采用 CRDT 确定性收敛，界面提示其他人正在编辑，提示不是锁。同一文字通过 Y.Text 合并；删除优先于旧的变换预览。

撤销以本地 transaction origin 为范围，不能撤销别人的操作；一个连续笔画或一次拖动作为一个撤销单元。使用 [Y.UndoManager](https://docs.yjs.dev/api/undo-manager) 时需要配置作用域和 trackedOrigins，并验证删除、远端修改后的效果。脑图服务端结构命令需定义独立逆操作和合法性校验，不能直接假设 UndoManager 覆盖一切。

## 初始限制

单张图片原始大小上限候选 10MB，解码最大 16MP；预览先缩图。单消息和单房间配额在 M1 压测确定并以配置发布。超限必须返回明确错误，不允许通过截断悄悄损坏笔迹或文档。

## M3 文字与便签实现补充

新增 objects、deletedObjects、objectMutations 三个 Y.Map；对象更新区分 text 与 x/y，不接受任意字段补丁。临时对象预览与最终命令分离；导出 schemaVersion 升至 2，持久快照容器仍为 1。具体并发语义、命令、限制和兼容要求见 [文字与便签](11-text-notes.md)。

## 旧电视接收协议

hello.legacyTV=true 强制 viewer。ready.snapshot 和 snapshot 消息包含 strokes、objects、deletedStrokeIds、deletedObjectIds；不向兼容客户端发送 Yjs update。持久变更按连接合并为约 100ms 一次完整快照，过程预览和成员通道仍实时发送。主编辑器协议不变。

## M3 图片扩展（已实现）

图片作为 `kind: image` 对象加入现有 create/update/delete-object 通道，尺寸补丁与位置补丁分字段持久化。文件通过带房间凭证的 HTTP 接口存储读取，不进入 Yjs 增量或电视 JSON 快照。对象模型、限额、上传校验、导出 v3 与旧客户端更新要求见 [图片扩展](13-images-tv-view.md)。

## M3 形状与连接扩展

新增 shape、connector 对象，沿用 create-object / update-object / delete-object 和临时 object-preview。端点及绑定为一个几何字段组；目标删除时同一事务解除连接，保留解析后端点。仅允许同房间非连接对象作为目标，非法或失效引用归为空端点。包含新对象的 JSON 副本为 v4；图片仍携带 PNG 内容。详细字段、并发与升级约定见 [形状与连线](15-shapes-connectors.md)。
