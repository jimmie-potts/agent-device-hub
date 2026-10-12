package android.media;

public class MediaFrameworkPlatformInitializer {
    private static MediaServiceManager manager = standalone()
        ? null : new MediaServiceManager();

    private static boolean standalone() {
        String scenario = System.getProperty("scenario");
        return "standalone-manager".equals(scenario)
            || "manager-unavailable".equals(scenario);
    }

    public static MediaServiceManager getMediaServiceManager() { return manager; }

    public static void setMediaServiceManager(MediaServiceManager value) {
        if (manager != null || value == null) {
            throw new IllegalStateException("Existing manager must be preserved");
        }
        manager = value;
    }
}
