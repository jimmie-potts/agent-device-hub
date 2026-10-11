/** Fixed release identity; no runtime or client-supplied path, class, or arguments. */
export const READER_CLASS = 'OnnMetadataReader';
export const READER_SCHEMA = 'onn-metadata/2.0';
export const READER_SHA256 = 'c948826d04a4476f7a86d353e798d5a60d0e78adbf1a019604a8fbe46ab0ca76';
export const READER_SOURCE_SHA256 = '5a81e28f0cc05b9e76b7bf267892dc9beb876f226ac7db7dbefe93ece9a5fef2';
export const READER_SOURCE_VERSION = 'onn-metadata/2.0-native-1';
export const READER_PACKAGED_PATH = 'native/artifact/reader.dex';
export const READER_DEVICE_PATH = `/data/local/tmp/bunny-onn-metadata/${READER_SHA256}.dex`;
export const READER_CHECK = `test ! -L /data/local/tmp/bunny-onn-metadata && test -d /data/local/tmp/bunny-onn-metadata && test ! -L ${READER_DEVICE_PATH} && test -f ${READER_DEVICE_PATH} && sha256sum ${READER_DEVICE_PATH}`;
export const READER_INVOCATION = `CLASSPATH=${READER_DEVICE_PATH} app_process /system/bin ${READER_CLASS} 3>&1 1>/dev/null 2>/dev/null`;
