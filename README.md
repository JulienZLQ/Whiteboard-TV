# Whiteboard TV

面向会议室、课堂和家庭共创的电视协作白板。电视展示完整画布；参与者扫码后，在自己的手机或 Pad 上独立编辑，电视实时显示指针、笔迹和对象操作。

**当前状态：已完成 M1 浏览器实验、M2 第一批协作闭环，Android TV 预览客户端，以及 M3 文字/便签、贴图、形状与连线、协作撤销和 PNG 导出。** 支持矩形/椭圆、箭头/连线、连接对象与实时跟随，图片上传、移动、等比缩放，文字/便签创建、编辑、移动和删除，画笔/荧光笔/整条擦除、独立镜头、真实指针与笔迹过程、电视只读总览、保存和重连。已完成一台小米电视的安装与基本同步验证；其他设备和容量验证仍待完成，性能指标仍为验收目标。

**电视本地版（0.3.0）**：安装后直接创建白板，手机扫码连接电视，无需 NAS 或填写服务地址。内容保存在电视；NAS 入口隐藏保留，在线同步尚未启用。见[本地版架构与限制](docs/19-tv-local-host.md)。

## 产品约定

- 同一份共享内容，每台设备拥有独立视角。
- 电视默认展示完整画布，也可切换显示全部内容或关注成员；视角仅影响本机。
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
11. [文字、便签与对象操作](docs/11-text-notes.md)
12. [旧版电视兼容与首次真机安装](docs/12-legacy-tv.md)
13. [贴图、资源保存与电视视图优化](docs/13-images-tv-view.md)
14. [电视按钮状态、固定二维码与画布范围](docs/14-tv-controls.md)
15. [形状、箭头与对象连接](docs/15-shapes-connectors.md)
16. [协作撤销、PNG 导出与电视方向导航](docs/16-history-export-navigation.md)
17. [电视隐藏界面、设置菜单与退出确认](docs/17-tv-presentation.md)
18. [共写品牌、图标与视觉延展](docs/18-brand-identity.md)
19. [电视本地服务、存储与 NAS 同步边界](docs/19-tv-local-host.md)

## 推进方式

先完成 M1 技术验证，再实现 M2 多人协作闭环，之后扩展文字、贴图、脑图与电视安装包。每个阶段交付可运行版本、验证记录和文档更新。关键能力先经过真实设备验证，再扩大范围。

当前工程包含 apps/web、apps/server 与 packages/board-core；已支持电视创建、扫码编辑、12 小时邀请、主持人认领、暂停/恢复加入、更新邀请、移除和结束会话。apps/android-tv 提供电视内置协作服务、原生菜单、全屏与本地房间恢复；已完成 MiTV-ASTP0 的安装与基本同步验证，其他机型待验收。

## 本地运行

需要 Node.js 22.12+：

```sh
npm ci
npm run dev
```

打开 http://127.0.0.1:5173，创建白板，通过“邀请加入”复制编辑链接，在另一窗口加入；“电视视图”打开只读总览。也可以 npm run build 后 npm start，访问 http://127.0.0.1:8787。

本机二维码不能直接供手机访问；跨设备试用需要可达的局域网地址。访问 /?mode=tv 可在电视创建白板并显示编辑二维码。图片、基础形状与连线已支持；已支持个人撤销/重做及 PNG 导出，脑图尚未实现，部署认证与 HTTPS 仍待完善。以上是开发主机运行方式。Android TV 本地版已内置服务，无需填写地址，安装说明见 [电视端文档](docs/10-android-tv.md)。详见 [运行与限制](docs/08-m1-implementation.md)。

验证命令：npm test、npm run build、npm run test:e2e。浏览器测试需要先安装 Playwright Chromium。

