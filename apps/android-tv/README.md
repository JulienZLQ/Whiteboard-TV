# Whiteboard TV Android

Android TV / 安卓盒子预览客户端。Java 17，Gradle 8.9，AGP 8.7.3，compile/target SDK 35，min SDK 26，WebView 66+（66–109 使用兼容电视画布）。

构建：

```sh
gradle :app:assembleDebug :app:testDebugUnitTest :app:lintDebug --no-daemon
```

从此目录运行，需要 JDK 和 Android SDK。APK 在 app/build/outputs/apk/debug/app-debug.apk。

首次启动输入已部署白板服务的来源地址，例如 http://192.168.1.20:8787。APK 不包含服务端。菜单键或右上角“设置”打开设置/重新加载/新建入口；返回先关闭弹窗，在白板主界面显示退出确认。

完整安装、按键、恢复和验证说明见 [Android TV 文档](../../docs/10-android-tv.md)。

0.2.4-preview 使用共写 SVG 派生图标、电视横版封面和统一原生卡片。其他电视安装后填写可达的服务地址即可；应用本身不内置服务。品牌源文件和使用规则见 [视觉标识](../../docs/18-brand-identity.md)。
