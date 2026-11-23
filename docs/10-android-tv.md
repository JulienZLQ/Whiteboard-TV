# 通用 Android TV 预览安装包

更新：2026-11-23。当前 APK 为 0.3.0-local-preview，旧电视适配与真机结果见 [兼容说明](12-legacy-tv.md)。当前在 Android TV / 安卓盒子内置协作服务与原生启动界面，手机与 Pad 继续使用网页。

当前 0.3.0 已改为电视本地版，构建与架构详见 [电视本地服务](19-tv-local-host.md)。

## 设备与服务要求

- Android 8.0 / API 26 或更新版本；Android System WebView 66 或更新版本。110+ 使用完整电视网页；66–109 使用兼容只读画布，已验证一台小米电视的 WebView 66。
- 横屏电视或盒子，方向键 / 确认 / 返回键遥控器。
- 电视与手机在可互相访问的 IPv4 局域网中。APK 内置网页和协作服务，无需 NAS；没有局域网时可恢复电视上的已保存画布。
- 此包为 debug 签名的侧载预览版，没有发布到应用商店，也没有生产签名配置。

## 安装与首次使用

1. 将本地版 APK 复制到电视/盒子，用文件管理器安装，或 `adb install -r Whiteboard-TV-0.3.0-local-preview.apk`。
2. 打开“共创白板”，本地服务自动启动，不填写服务地址。
3. 按确认键创建白板。手机/Pad 与电视连同一网络，扫码加入。
4. 第一个扫码加入编辑的人自动获得主持权限，可管理成员和邀请。
5. 再次打开自动恢复最近的本地白板。退出后手机连接暂停；卸载或清除应用数据会删除本地内容。

原 NAS 服务和已有数据保留；默认界面不显示地址入口。旧 NAS 房间不会自动迁移到电视。

## 遥控器

| 按键 | 行为 |
| --- | --- |
| 上下左右 | 按画面位置切换可用控件；弹窗内限制在当前弹窗 |
| 确认 | 执行当前按钮；完整画布/显示全部内容在焦点进入时立即选择，无需确认 |
| 返回 | 先关闭最上层弹窗；没有弹窗时显示退出确认，默认选中继续展示 |
| 菜单键 | 打开原生电视菜单；无菜单键的遥控器使用右上角设置按钮 |

菜单包含继续展示、重新加载、新建白板、退出应用。新建白板有二次确认，原房间仍保留，其他设备不被踢出。退出应用不会结束房间，但会关闭本地服务，手机需等待电视再次打开。

## 恢复与网络错误

- 服务地址和不含凭证的当前房间 URL 保存在应用私有偏好设置中。关闭系统备份，并显式排除 Android 12+ 云备份和设备迁移。
- 仅 Android TV 模式将最近一次电视凭证保存在该服务来源的 WebView localStorage；普通手机浏览器仍使用标签页会话存储。
- 再次打开应用加载上次房间并自动鉴权。短时 WebSocket 断网继续由已有会话层重连。
- 清除应用数据、卸载应用或 WebView 存储被系统清理会失去本机凭证；清除应用数据或卸载还会删除电视上的本地内容。
- 已结束房间不能通过恢复重新开放，使用电视菜单新建白板。
- 主页面网络/HTTP/证书错误显示重试和退出入口；不跳过证书错误。渲染进程被系统释放时提供恢复入口。
- 显示期间保持屏幕常亮，后台暂停 WebView；应用恢复前台时恢复全屏。

## 原生与网页边界

原生层负责内置服务生命周期、网络地址发现、启动器入口、全屏、错误页面和遥控器按键转发。网页继续负责房间、二维码、画布、主持权限与实时协作。

没有向网页注入 `addJavascriptInterface` Java 对象。原生调用固定 `window.WhiteboardTV.key/back` 网页入口，并拦截同源主框架保留菜单路径打开设置菜单；顶层与子资源导航限制为配置的服务来源，不开放文件或内容 URI、外部弹窗和下载。电视安装包内隐藏 JSON 下载按钮，导出由手机或 Pad 完成。

HTTP 仅为受信局域网试用保留；HTTPS 页面不允许混合加载 HTTP 内容。已隐藏的远程地址配置仍只接受 HTTP/HTTPS 来源（主机及端口）；本地模式仅为固定回环来源单独放行。

## 源码与构建

目录 `apps/android-tv`，使用 Java + Android 系统 API，无额外原生 UI 依赖。

构建要求：JDK 17、Gradle 8.9、Android SDK Platform 35、Build Tools 35.0.0。AGP 固定 8.7.3，不使用动态插件版本。设置 `ANDROID_HOME` 为 SDK 目录，并按 [本地版构建步骤](19-tv-local-host.md) 配置 NDK 与 nodejs-mobile。

```sh
npm run android:prepare
gradle -p apps/android-tv :app:assembleDebug :app:testDebugUnitTest :app:lintDebug --no-daemon
```

产物：`apps/android-tv/app/build/outputs/apk/debug/app-debug.apk`。Gradle 由本机安装或 CI 的 setup-gradle 提供；本仓库不包含 Gradle wrapper JAR。

`.github/workflows/android.yml` 提供 Android 构建、单元测试、Lint 和 APK artifact 上传。CI 的临时 debug 签名可能与本地包不同，不能保证覆盖安装；正式分发前需要固定生产签名。

本地 NAS 构建工具安装在工作目录，Gradle 使用 `--no-watch-fs` 绕过该宿主文件系统枚举问题；不影响 APK 行为。SDK、缓存、签名密钥、构建产物不提交 Git。

## 0.2.0 历史验证

以下为上一版本记录；当前版本与真机证据以 [兼容说明](12-legacy-tv.md) 为准。

- Android debug APK 构建成功，Java URL 策略单元测试 4/4 通过。
- Android Lint 无错误；保留 2 项已说明警告：电视横屏固定方向、320×180 的简单矢量启动横幅。
- APK 使用 debug RSA 签名，apksigner 校验通过，v2 签名有效；zipalign 检查通过。启动器声明包含 LEANBACK_LAUNCHER 与 LAUNCHER，触屏和 Leanback 均非必需。
- npm test：8/8；npm run build（含 TypeScript）：通过；Playwright Chromium：5/5，最终一轮 45.2 秒。
- 新增浏览器场景覆盖电视创建、原生调用的固定 JS 按键入口、焦点范围、嵌套弹窗返回、移除 sessionStorage 后凭借同源 localStorage 恢复原房间与主持身份。
- 1920×1080 网页截图检查页面身份、非空、焦点高亮、弹窗和恢复状态；无页面/控制台错误、无横向溢出。Browser 插件不可用，使用已有 Playwright。

浏览器测试验证网页遥控器入口，不等同于 Android 遥控器硬件测试。截图是 Chromium 网页画面，不是原生设置页或真实电视截图。

真机仍需执行：安装与启动器图标、原生输入法输入服务地址、真实遥控器按键、系统返回与菜单、证书错误、网络切换、应用退出/重启、后台恢复、WebView 进程回收、手机摄像头扫码、不同分辨率及长时运行。

## 依据

- [Android TV 应用入口与设备声明](https://developer.android.com/training/tv/get-started/create)
- [AGP 8.7 与 Gradle/JDK 兼容要求](https://developer.android.com/build/releases/agp-8-7-0-release-notes)
- [WebView 生命周期与渲染进程处理](https://developer.android.com/develop/ui/views/layout/webapps/managing-webview)
- [WebView 原生桥接边界](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges)

## 0.2.4 视觉与安装更新

使用用户确认的共写 SVG 标识生成 Android 自适应图标、原生加载图形和带中文名称的 320×180 电视封面；连接与加载背景采用同源曲线。设置／新建／退出使用统一卡片，原房间恢复保持。构建使用 --no-watch-fs；本地同证书覆盖安装验证通过。Android 8.0/API 26 起可安装，WebView 66+ 使用既有兼容分流。APK 不包含白板服务，其他电视填写可达的同一个服务来源地址。品牌规范见 [视觉标识](18-brand-identity.md)。
