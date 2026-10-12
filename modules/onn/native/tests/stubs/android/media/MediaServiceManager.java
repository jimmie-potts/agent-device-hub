package android.media;

public class MediaServiceManager {
    public MediaServiceManager() {
        if ("manager-unavailable".equals(System.getProperty("scenario"))) {
            throw new IllegalStateException("PRIVATE bootstrap failure");
        }
    }
}
