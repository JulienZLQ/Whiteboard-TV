# Whiteboard TV

面向会议室、课堂和家庭共创的电视协作白板。电视展示完整画布；参与者扫码后，在自己的手机或 Pad 上独立编辑，电视实时显示指针、笔迹和对象操作。

**当前状态：已完成 M1 浏览器实验、M2 第一批协作闭环，以及 Android TV 预览客户端。** 支持画笔/荧光笔/整条擦除、独立镜头、真实指针与笔迹过程、电视只读总览、保存和重连。M1 的真实设备与容量验证仍待完成，性能指标仍为验收目标。

## 产品约定

- 同一份共享内容，每台设备拥有独立视角。
- 电视默认总览全部内容，主持人可临时聚焦，随时返回总览。
- 手写保留为笔迹；手写转文字属于后续增强。
- 首版优先验证 Android TV / 安卓盒子展示与移动浏览器编辑；用户已确认通用 Android TV 路线。
- 参考飞书画板的协作体验，自主设计视觉与交互。

## 开发文档

1. [产品需求与边界](docs/01-product.md)
2. [交互与视觉规范](docs/02-design.md)
3. [系统架构与技术决策](docs/03-architecture.md)
4. [数据模型与同步协议](docs/04-protocol.md)
5. [里程碑与开发任务](docs/05-roadmap.md)
6. [验收与测试计划](docs/06-quality.md)
7. [项目状态与决策记录](docs/07-status.md)
8. [M1 实现、运行与限制](docs/08-m1-implementation.md)
9. [M2 电视扫码、主持管理与验证](docs/09-m2-collaboration.md)
10. [Android TV 安装、遥控器与构建](docs/10-android-tv.md)

## 推进方式

先完成 M1 技术验证，再实现 M2 多人协作闭环，之后扩展文字、贴图、脑图与电视安装包。每个阶段交付可运行版本、验证记录和文档更新。关键能力先经过真实设备验证，再扩大范围。

当前工程包含 apps/web、apps/server 与 packages/board-core；已支持电视创建、扫码编辑、12 小时邀请、主持人认领、暂停/恢复加入、更新邀请、移除和结束会话。apps/android-tv 提供 Android TV/安卓盒子外壳、服务地址设置、原生菜单、全屏与房间恢复；真机验证仍待执行。

## 本地运行

需要 Node.js 22.12+：

```sh
npm ci
npm run dev
```

打开 http://127.0.0.1:5173，创建白板，通过“邀请加入”复制编辑链接，在另一窗口加入；“电视视图”打开只读总览。也可以 npm run build 后 npm start，访问 http://127.0.0.1:8787。

本机二维码不能直接供手机访问；跨设备试用需要可达的局域网地址。访问 /?mode=tv 可在电视创建白板并显示编辑二维码。文字、图片和脑图尚未实现，部署认证与 HTTPS 仍待完善。Android TV 预览包需要连接可达的服务地址，安装说明见 [电视端文档](docs/10-android-tv.md)。详见 [运行与限制](docs/08-m1-implementation.md)。

验证命令：npm test、npm run build、npm run test:e2e。浏览器测试需要先安装 Playwright Chromium。
