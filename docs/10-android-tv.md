# 通用 Android TV 预览安装包

更新：2026-11-23。本阶段为现有协作白板增加 Android TV / 安卓盒子的原生启动外壳，手机与 Pad 继续使用网页。

## 设备与服务要求

- Android 8.0 / API 26 或更新版本；Android System WebView 110 或更新版本。最低版本是当前实现门槛，仍需真实设备验证。
- 横屏电视或盒子，方向键 / 确认 / 返回键遥控器。
- 电视与手机能访问相同白板服务地址。APK 不内置协作服务，不能仅安装 APK 就离线多人协作。
- 此包为 debug 签名的侧载预览版，没有发布到应用商店，也没有生产签名配置。

## 安装与首次使用

1. 在服务主机部署本仓库对应版本：`npm ci`、`npm run build`。
2. 受信局域网试用可执行 `HOST=0.0.0.0 PORT=8787 npm start`。设备访问主机局域网地址，而非 localhost。不要在未知网络直接开放端口；HTTPS/正式部署另行配置。
3. 将预览 APK 复制到电视/盒子，通过其文件管理器安装。已配置 ADB 的开发设备可使用 `adb install -r Whiteboard-TV-0.2.0-preview.apk`。
4. 在电视应用列表打开“共创白板”。输入服务地址，例如 `http://192.168.1.20:8787`。该地址只是示例，不是本次部署地址。
5. 连接检查通过后进入电视创建页，按确认键创建白板。手机/Pad 扫电视上的二维码即可独立编辑。
6. 需要手机管理时，电视选择“管理 → 手机认领主持权限”，由主持人扫描专用二维码。

本次没有自动读取电视、安装到用户电视或启动常驻局域网服务。

## 遥控器

| 按键 | 行为 |
| --- | --- |
| 上下左右 | 按画面位置切换可用控件；弹窗内限制在当前弹窗 |
| 确认 | 执行当前按钮；电视关注选择器用上下键切换成员，左右离开选择器 |
| 返回 | 先关闭最上层网页弹窗；没有弹窗时打开原生电视菜单 |
| 菜单键 | 打开原生电视菜单；无菜单键的遥控器使用返回键 |

菜单包含继续展示、重新加载、新建白板、服务地址设置、退出应用。新建白板有二次确认，原房间仍保留，其他设备不被踢出。退出应用不会结束房间。

## 恢复与网络错误

- 服务地址和不含凭证的当前房间 URL 保存在应用私有偏好设置中。关闭系统备份，并显式排除 Android 12+ 云备份和设备迁移。
- 仅 Android TV 模式将最近一次电视凭证保存在该服务来源的 WebView localStorage；普通手机浏览器仍使用标签页会话存储。
- 再次打开应用加载上次房间并自动鉴权。短时 WebSocket 断网继续由已有会话层重连。
- 清除应用数据、卸载应用或 WebView 存储被系统清理会失去本机凭证；这不删除服务端内容。
- 已结束房间不能通过恢复重新开放，使用电视菜单新建白板。
- 主页面网络/HTTP/证书错误显示重试和修改地址入口；不跳过证书错误。渲染进程被系统释放时提供恢复入口。
- 显示期间保持屏幕常亮，后台暂停 WebView；应用恢复前台时恢复全屏。

## 原生与网页边界

原生层负责地址设置、网络预检、启动器入口、全屏、生命周期、错误页面和遥控器按键转发。网页继续负责房间、二维码、画布、主持权限与实时协作。

没有向网页注入 `addJavascriptInterface` Java 对象。原生只调用固定 `window.WhiteboardTV.key/back` 网页入口；顶层与子资源导航限制为配置的服务来源，不开放文件或内容 URI、外部弹窗和下载。电视安装包内隐藏 JSON 下载按钮，导出由手机或 Pad 完成。

HTTP 仅为受信局域网试用保留；HTTPS 页面不允许混合加载 HTTP 内容。服务地址输入只接受 HTTP/HTTPS 来源（主机及端口），拒绝用户密码、房间片段、额外路径和回环地址。

## 源码与构建

目录 `apps/android-tv`，使用 Java + Android 系统 API，无额外原生 UI 依赖。

构建要求：JDK 17、Gradle 8.9、Android SDK Platform 35、Build Tools 35.0.0。AGP 固定 8.7.3，不使用动态插件版本。设置 `ANDROID_HOME` 为 SDK 目录。

```sh
gradle -p apps/android-tv :app:assembleDebug :app:testDebugUnitTest :app:lintDebug --no-daemon
```

产物：`apps/android-tv/app/build/outputs/apk/debug/app-debug.apk`。Gradle 由本机安装或 CI 的 setup-gradle 提供；本仓库不包含 Gradle wrapper JAR。

`.github/workflows/android.yml` 提供 Android 构建、单元测试、Lint 和 APK artifact 上传。CI 的临时 debug 签名可能与本地包不同，不能保证覆盖安装；正式分发前需要固定生产签名。

本地 NAS 构建工具安装在工作目录，Gradle 使用 `--no-watch-fs` 绕过该宿主文件系统枚举问题；不影响 APK 行为。SDK、缓存、签名密钥、构建产物不提交 Git。

## 验证

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
