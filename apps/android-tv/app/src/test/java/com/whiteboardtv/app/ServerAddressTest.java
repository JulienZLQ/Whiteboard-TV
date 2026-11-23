package com.whiteboardtv.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class ServerAddressTest {
    @Test public void normalizesOriginsAndPorts() {
        assertEquals("http://192.168.1.20:8787", ServerAddress.normalize(" 192.168.1.20:8787/ "));
        assertEquals("https://board.example.com", ServerAddress.normalize("https://BOARD.example.com:443"));
        assertEquals("http://[fd00::1]:8787", ServerAddress.normalize("http://[fd00::1]:8787"));
    }
    @Test public void rejectsUnsafeOrUnusableAddresses() {
        for (String value : new String[]{"", "file:///tmp/x", "javascript:alert(1)", "https://user:pass@example.com", "http://localhost:8787", "127.0.0.1", "http://0.0.0.0", "http://[::1]", "https://example.com/path", "https://example.com/#token=secret", "https://example.com?room=x", "http://a:65536", "http://a:0", "https://a\\@b"}) {
            try { ServerAddress.normalize(value); fail(value); } catch (IllegalArgumentException expected) { }
        }
    }
    @Test public void originChecksRejectLookalikesAndSchemes() {
        assertTrue(ServerAddress.sameOrigin("https://board.example", "https://board.example:443/?room=abc"));
        assertFalse(ServerAddress.sameOrigin("https://board.example", "https://board.example.evil/path"));
        assertFalse(ServerAddress.sameOrigin("https://board.example", "http://board.example"));
        assertFalse(ServerAddress.sameOrigin("https://board.example", "https://user@board.example"));
    }
    @Test public void resumesOnlyRoomIdWithoutSecrets() {
        String base = "https://board.example", id = "0123456789abcdef01234567";
        assertEquals(base + "/?room=" + id + "&mode=tv&tvShell=android", ServerAddress.resumeUrl(base, base + "/?room=" + id + "&mode=tv&ignored=1"));
        for (String url : new String[]{base + "/?room=" + id + "#token=x", "https://evil/?room=" + id, base + "/login?room=" + id}) assertEquals(ServerAddress.startUrl(base), ServerAddress.resumeUrl(base, url));
    }
    @Test public void legacyRoutePreservesOnlyTheRoomAndSameOrigin() {
        String base = "http://192.168.1.20:8787", id = "0123456789abcdef01234567";
        assertEquals(base + "/legacy-tv.html?room=" + id + "&mode=tv&tvShell=android", ServerAddress.legacyUrl(base, base + "/?room=" + id));
        assertEquals(base + "/?room=" + id + "&mode=tv&tvShell=android", ServerAddress.resumeUrl(base, base + "/legacy-tv.html?room=" + id));
        assertEquals(base + "/legacy-tv.html?mode=tv&tvShell=android", ServerAddress.legacyUrl(base, "https://evil/?room=" + id));
    }
}
