import java.io.FileOutputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.atomic.AtomicBoolean;

/** Fixed one-shot read-only reader; no controls, bundles, URIs, or source logging. */
public final class OnnMetadataReader {
    private static final String SCHEMA = "onn-metadata/2.0";
    private static final String FAILURE = "{\"schema\":\"onn-metadata/2.0\",\"failure\":\"metadata-read-unavailable\"}\n";
    private static final String PREFIX = "android.media.metadata.";
    private static final String[] KEYS = {"TITLE", "DISPLAY_TITLE", "DISPLAY_SUBTITLE", "ARTIST", "ALBUM", "GENRE", "DISPLAY_DESCRIPTION", "MEDIA_ID"};
    private static final String[] FIELDS = {"title", "displayTitle", "subtitle", "artist", "album", "genre", "description", "mediaId"};
    private static final long SAFE = 9007199254740991L;
    private static final int MAX_TEXT_BYTES = 8192;
    private static final int MAX_OUTPUT_BYTES = 262144;
    private static final int MAX_CONTROLLERS = 32;
    private static final int MAX_SESSIONS = 8;
    private static final long DEADLINE_MS = 4000;

    private static final String REDACTED = "[REDACTED]";
    private static final String VALUE = "(?:\\\"(?:\\\\.|[^\\\"\\\\])*\\\"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;&]+)";
    private static final Pattern AUTHORIZATION = Pattern.compile("(?i)(?<![a-z0-9_])(authorization\\s*[:=]\\s*)(?:(bearer|basic)[ \\t]+)?(" + VALUE + ")");
    private static final Pattern ASSIGNMENT = Pattern.compile("(?i)(?<![a-z0-9_])((?:password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|session[_-]?cookie)\\s*[:=]\\s*)(" + VALUE + ")");
    private static final Pattern BEARER = Pattern.compile("(?i)(?<![a-z0-9_])(bearer[ \\t]+)([a-z0-9._~+/-]+={0,2})");

    private OnnMetadataReader() { }

    private static String decodeAscii(String text) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < text.length(); i++) {
            if (text.charAt(i) == '%' && i + 2 < text.length()) {
                int high = Character.digit(text.charAt(i + 1), 16);
                int low = Character.digit(text.charAt(i + 2), 16);
                if (high >= 0 && low >= 0) {
                    out.append((char) (high * 16 + low));
                    i += 2;
                    continue;
                }
            }
            out.append(text.charAt(i));
        }
        return out.toString();
    }
    private static boolean credentialQueryKey(String key) {
        String normalized = decodeAscii(key).toLowerCase(Locale.ROOT).replace("-", "_");
        return normalized.equals("token") || normalized.equals("access_token") || normalized.equals("refresh_token")
            || normalized.equals("id_token") || normalized.equals("authorization") || normalized.equals("auth")
            || normalized.equals("api_key") || normalized.equals("apikey") || normalized.equals("password")
            || normalized.equals("passwd") || normalized.equals("pwd") || normalized.equals("client_secret")
            || normalized.equals("session_cookie");
    }
    private static String redactUrl(String url) {
        int start = url.indexOf("://") + 3;
        int end = url.length();
        for (char delimiter : new char[] {'/', '?', '#'}) {
            int n = url.indexOf(delimiter, start);
            if (n >= 0 && n < end) end = n;
        }
        String authority = url.substring(start, end);
        int at = authority.lastIndexOf('@');
        if (at >= 0 && decodeAscii(authority.substring(0, at)).indexOf(':') >= 0) {
            url = url.substring(0, start) + REDACTED + authority.substring(at) + url.substring(end);
        }
        int fragment = url.indexOf('#');
        String base = fragment < 0 ? url : url.substring(0, fragment);
        int query = base.indexOf('?');
        if (query >= 0) base = base.substring(0, query + 1) + redactParameters(base.substring(query + 1));
        return base + (fragment < 0 ? "" : "#" + redactParameters(url.substring(fragment + 1)));
    }
    private static String redactParameters(String source) {
        StringBuilder out = new StringBuilder();
        int cursor = 0;
        while (cursor < source.length()) {
            int next = cursor;
            while (next < source.length() && source.charAt(next) != '&' && source.charAt(next) != ';') next++;
            String item = source.substring(cursor, next);
            int equals = item.indexOf('=');
            if (equals >= 0 && credentialQueryKey(item.substring(0, equals)) && equals + 1 < item.length()) {
                item = item.substring(0, equals + 1) + REDACTED;
            }
            out.append(item);
            if (next < source.length()) out.append(source.charAt(next));
            cursor = next + 1;
        }
        return out.toString();
    }
    private static boolean schemeChar(char c) {
        return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '+' || c == '-' || c == '.';
    }
    private static String redactUrls(String source) {
        StringBuilder out = new StringBuilder();
        int cursor = 0;
        int search = 0;
        while (true) {
            int colon = source.indexOf("://", search);
            if (colon < 0) break;
            int start = colon;
            while (start > cursor && schemeChar(source.charAt(start - 1))) start--;
            if (start == colon || !Character.isLetter(source.charAt(start))) {
                search = colon + 3;
                continue;
            }
            int end = colon + 3;
            while (end < source.length()) {
                char c = source.charAt(end);
                if (Character.isWhitespace(c) || c == '<' || c == '>' || c == '"' || c == '\'') break;
                end++;
            }
            out.append(redactPlain(source.substring(cursor, start))).append(redactUrl(source.substring(start, end)));
            cursor = end;
            search = end;
        }
        return out.append(redactPlain(source.substring(cursor))).toString();
    }
    private static String redactPlain(String source) {
        String value = source;
        StringBuffer output;
        Matcher authorization = AUTHORIZATION.matcher(value);
        output = new StringBuffer();
        while (authorization.find()) {
            String scheme = authorization.group(2);
            authorization.appendReplacement(output, Matcher.quoteReplacement(authorization.group(1) + (scheme == null ? "" : scheme + " ") + REDACTED));
        }
        authorization.appendTail(output);
        value = output.toString();
        Matcher assignments = ASSIGNMENT.matcher(value);
        output = new StringBuffer();
        while (assignments.find()) assignments.appendReplacement(output, Matcher.quoteReplacement(assignments.group(1) + REDACTED));
        assignments.appendTail(output);
        value = output.toString();
        Matcher bearer = BEARER.matcher(value);
        output = new StringBuffer();
        while (bearer.find()) {
            String token = bearer.group(2);
            boolean shaped = false;
            for (int n = 0; n < token.length(); n++) {
                char c = token.charAt(n);
                if (!Character.isLetter(c)) shaped = true;
            }
            String replacement = token.length() >= 8 && shaped ? bearer.group(1) + REDACTED : bearer.group();
            bearer.appendReplacement(output, Matcher.quoteReplacement(replacement));
        }
        bearer.appendTail(output);
        return output.toString();
    }

    private static Method method(String type, String name, Class<?>... args) throws Exception {
        return Class.forName(type).getMethod(name, args);
    }
    private static Object call(String type, Object instance, String name) throws Exception {
        return method(type, name).invoke(instance);
    }
    private static long integer(Object value, long min, long max) {
        if (!(value instanceof Long) && !(value instanceof Integer)) throw new IllegalStateException();
        long result = ((Number) value).longValue();
        if (result < min || result > max) throw new IllegalStateException();
        return result;
    }
    private static String quote(String value) {
        if (value == null) return "null";
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '\\': out.append("\\\\"); break;
                case '"': out.append("\\\""); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default:
                    if (c < 32 || Character.isSurrogate(c)) {
                        String h = Integer.toHexString(c);
                        out.append("\\u");
                        for (int n = h.length(); n < 4; n++) out.append('0');
                        out.append(h);
                    } else out.append(c);
            }
        }
        return out.append('"').toString();
    }
    private static void field(StringBuilder out, String name, String encoded) {
        out.append(',').append(quote(name)).append(':').append(encoded);
    }
    private static void omission(List<String> omissions, String field, String reason) {
        omissions.add("{\"field\":" + quote(field) + ",\"reason\":" + quote(reason) + "}");
    }
    private static String text(String source, String field, List<String> omissions) {
        if (source == null) return "null";
        if (source.length() > MAX_TEXT_BYTES) {
            omission(omissions, field, "oversized");
            return "null";
        }
        // Malformed UTF-16 cannot have a faithful UTF-8 projection; refuse the sample.
        for (int i = 0; i < source.length(); i++) {
            char c = source.charAt(i);
            if (Character.isHighSurrogate(c)) {
                if (i + 1 == source.length() || !Character.isLowSurrogate(source.charAt(++i))) throw new IllegalStateException();
            } else if (Character.isLowSurrogate(c)) throw new IllegalStateException();
        }
        if (source.getBytes(StandardCharsets.UTF_8).length > MAX_TEXT_BYTES) {
            omission(omissions, field, "oversized");
            return "null";
        }
        String cleaned = redactUrls(source);
        if (!cleaned.equals(source)) omission(omissions, field, "credential-redacted");
        if (cleaned.length() > MAX_TEXT_BYTES || cleaned.getBytes(StandardCharsets.UTF_8).length > MAX_TEXT_BYTES) {
            omission(omissions, field, "oversized");
            return "null";
        }
        return quote(cleaned);
    }
    private static String metadata(Object metadata, List<String> omissions) throws Exception {
        if (metadata == null) return "null";
        Method string = method("android.media.MediaMetadata", "getString", String.class);
        StringBuilder out = new StringBuilder("{");
        for (int i = 0; i < KEYS.length; i++) {
            Object value = string.invoke(metadata, PREFIX + KEYS[i]);
            if (value != null && !(value instanceof String)) throw new IllegalStateException();
            if (i > 0) out.append(',');
            out.append(quote(FIELDS[i])).append(':').append(text((String) value, FIELDS[i], omissions));
        }
        Object present = method("android.media.MediaMetadata", "containsKey", String.class).invoke(metadata, PREFIX + "DURATION");
        if (!(present instanceof Boolean)) throw new IllegalStateException();
        String duration = "null";
        if ((Boolean) present) {
            duration = Long.toString(integer(method("android.media.MediaMetadata", "getLong", String.class).invoke(metadata, PREFIX + "DURATION"), 0, SAFE));
        }
        field(out, "durationMs", duration);
        return out.append('}').toString();
    }
    private static String playback(Object playback) throws Exception {
        if (playback == null) return "null";
        String type = "android.media.session.PlaybackState";
        long state = integer(call(type, playback, "getState"), 0, 11);
        long position = integer(call(type, playback, "getPosition"), -1, SAFE);
        long updated = integer(call(type, playback, "getLastPositionUpdateTime"), 0, SAFE);
        Object rawSpeed = call(type, playback, "getPlaybackSpeed");
        if (!(rawSpeed instanceof Float) && !(rawSpeed instanceof Double)) throw new IllegalStateException();
        double speed = ((Number) rawSpeed).doubleValue();
        if (Double.isNaN(speed) || Double.isInfinite(speed)) throw new IllegalStateException();
        return "{\"state\":" + state + ",\"positionMs\":" + position + ",\"speed\":" + Double.toString(speed) + ",\"positionUpdatedElapsedMs\":" + updated + "}";
    }
    private static String app(String packageName) {
        if ("com.google.android.youtube.tv".equals(packageName)) return "youtube";
        if ("com.stremio.one".equals(packageName)) return "stremio";
        return null;
    }
    private static String collect() throws Exception {
        if (method("android.os.Looper", "myLooper").invoke(null) == null) {
            method("android.os.Looper", "prepareMainLooper").invoke(null);
        }
        Object thread = method("android.app.ActivityThread", "systemMain").invoke(null);
        Object context = call("android.app.ActivityThread", thread, "getSystemContext");
        Object manager = method("android.content.Context", "getSystemService", String.class).invoke(context, "media_session");
        Object raw = method("android.media.session.MediaSessionManager", "getActiveSessions", Class.forName("android.content.ComponentName")).invoke(manager, new Object[] {null});
        if (!(raw instanceof List)) throw new IllegalStateException();
        List<?> controllers = (List<?>) raw;
        if (controllers.size() > MAX_CONTROLLERS) throw new IllegalStateException();
        List<Object> selected = new ArrayList<Object>();
        List<String> apps = new ArrayList<String>();
        // Complete package selection and all count checks before reading selected content.
        for (int i = 0; i < controllers.size(); i++) {
            Object controller = controllers.get(i);
            Object packageName = call("android.media.session.MediaController", controller, "getPackageName");
            if (packageName != null && !(packageName instanceof String)) throw new IllegalStateException();
            String app = app((String) packageName);
            if (app != null) {
                if (selected.size() == MAX_SESSIONS) throw new IllegalStateException();
                selected.add(controller);
                apps.add(app);
            }
        }
        long elapsed = integer(call("android.os.SystemClock", null, "elapsedRealtime"), 0, SAFE);
        StringBuilder out = new StringBuilder("{\"schema\":" + quote(SCHEMA) + ",\"deviceElapsedMs\":" + elapsed + ",\"sessions\":[");
        for (int i = 0; i < selected.size(); i++) {
            if (i > 0) out.append(',');
            Object controller = selected.get(i);
            List<String> omissions = new ArrayList<String>();
            out.append("{\"app\":").append(quote(apps.get(i)));
            field(out, "metadata", metadata(call("android.media.session.MediaController", controller, "getMetadata"), omissions));
            field(out, "playback", playback(call("android.media.session.MediaController", controller, "getPlaybackState")));
            out.append(",\"omissions\":[");
            for (int n = 0; n < omissions.size(); n++) {
                if (n > 0) out.append(',');
                out.append(omissions.get(n));
            }
            out.append("]}");
        }
        out.append("]}\n");
        String wire = out.toString();
        if (wire.getBytes(StandardCharsets.UTF_8).length > MAX_OUTPUT_BYTES) throw new IllegalStateException();
        return wire;
    }
    private static final class Sink {
        private final FileOutputStream stream;
        private final AtomicBoolean done = new AtomicBoolean();
        Sink(FileOutputStream stream) { this.stream = stream; }
        boolean emit(String wire) {
            if (!done.compareAndSet(false, true)) return false;
            try {
                stream.write(wire.getBytes(StandardCharsets.UTF_8));
                stream.flush();
                return true;
            } catch (Throwable ignored) { return false; }
        }
    }
    public static void main(String[] args) {
        int exit = 2;
        try {
            // Missing inherited fd3 can be reused by the VM for a regular file.
            // Refuse it before opening; never truncate a descriptor target.
            String target = Files.readSymbolicLink(Paths.get("/proc/self/fd/3")).toString();
            if (!target.matches("pipe:\\[[0-9]+\\]")) throw new IllegalStateException();
            final Sink sink = new Sink(new FileOutputStream("/proc/self/fd/3", true));
            Thread watchdog = new Thread(new Runnable() {
                public void run() {
                    try { Thread.sleep(DEADLINE_MS); } catch (InterruptedException ignored) { return; }
                    // A blocked result pipe must never prevent the deadline exit.
                    Thread failureWriter = new Thread(new Runnable() {
                        public void run() { sink.emit(FAILURE); }
                    }, "onn-metadata-deadline-reply");
                    failureWriter.setDaemon(true);
                    failureWriter.start();
                    try { failureWriter.join(100); } catch (InterruptedException ignored) { }
                    Runtime.getRuntime().halt(2);
                }
            }, "onn-metadata-deadline");
            watchdog.setDaemon(true);
            watchdog.start();
            try {
                if (args == null || args.length != 0) throw new IllegalArgumentException();
                if (sink.emit(collect())) exit = 0;
            } catch (Throwable ignored) {
                // No message, stack, stage, package, or original value enters the failure reply.
                sink.emit(FAILURE);
            }
        } catch (Throwable ignored) { }
        Runtime.getRuntime().halt(exit);
    }
}
