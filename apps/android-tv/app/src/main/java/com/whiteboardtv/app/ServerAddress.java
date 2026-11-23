package com.whiteboardtv.app;

import java.net.URI;
import java.util.Locale;

/** Only an origin is configurable. Invitations and credentials never enter preferences. */
public final class ServerAddress {
    private ServerAddress() {}
    public static String normalize(String input) {
        if (input == null) throw new IllegalArgumentException("请输入服务地址");
        String value = input.trim();
        if (!value.contains("://")) value = "http://" + value;
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme().toLowerCase(Locale.ROOT), host = uri.getHost();
            if ((!scheme.equals("http") && !scheme.equals("https")) || host == null || uri.getRawUserInfo() != null
                    || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || (uri.getPath() != null && !uri.getPath().isEmpty() && !uri.getPath().equals("/"))
                    || uri.getPort() == 0 || uri.getPort() > 65535 || host.equalsIgnoreCase("localhost")
                    || host.equals("0.0.0.0") || host.startsWith("127.") || host.equals("[::1]")) {
                throw new IllegalArgumentException();
            }
            int port = uri.getPort();
            if ((scheme.equals("http") && port == 80) || (scheme.equals("https") && port == 443)) port = -1;
            return new URI(scheme, null, host.toLowerCase(Locale.ROOT), port, null, null, null).toASCIIString();
        } catch (Exception e) { throw new IllegalArgumentException("请输入电视和手机都可访问的 HTTP/HTTPS 服务地址，不要包含房间链接或路径"); }
    }
    public static boolean sameOrigin(String origin, String value) {
        try {
            URI uri = new URI(value);
            if (uri.getRawUserInfo() != null || uri.getHost() == null) return false;
            String candidate = new URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), null, null, null).toString();
            return normalize(candidate).equals(origin);
        } catch (Exception e) { return false; }
    }
    public static String startUrl(String origin) { return origin + "/?mode=tv&tvShell=android"; }
    public static String resumeUrl(String origin, String value) {
        if (!sameOrigin(origin, value)) return startUrl(origin);
        try {
            URI uri = new URI(value);
            if (!"/".equals(uri.getPath()) || uri.getRawFragment() != null) return startUrl(origin);
            String room = null;
            for (String pair : (uri.getRawQuery() == null ? "" : uri.getRawQuery()).split("&")) {
                if (pair.matches("room=[a-f0-9]{24}")) room = pair.substring(5);
            }
            return room == null ? startUrl(origin) : origin + "/?room=" + room + "&mode=tv&tvShell=android";
        } catch (Exception e) { return startUrl(origin); }
    }
}
