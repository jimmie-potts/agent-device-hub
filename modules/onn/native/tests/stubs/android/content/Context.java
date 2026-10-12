package android.content;

public class Context {
    public Object getSystemService(String name) {
        if (!name.equals("media_session")) throw new AssertionError();
        if (android.media.MediaFrameworkPlatformInitializer.getMediaServiceManager() == null) {
            throw new IllegalStateException("Media service manager is not initialized");
        }
        return new android.media.session.MediaSessionManager();
    }
}
