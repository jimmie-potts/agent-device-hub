/** Fixed release identity; no runtime or client-supplied path, class, or arguments. */
export const READER_CLASS = 'OnnMetadataReader';
export const READER_SCHEMA = 'onn-metadata/2.0';
export const READER_SHA256 = '3edaac607809711e0eb3ce72a1be86800e60cac3e4840eb23b39fed6f56132f0';
export const READER_SOURCE_SHA256 = '2109727cb3045ed534abb84feba34e5ec999cdea33f3b17a48f5add364e1d3f3';
export const READER_SOURCE_VERSION = 'onn-metadata/2.0-native-2';
export const READER_PACKAGED_PATH = 'native/artifact/reader.dex';
export const READER_DEVICE_PATH = `/data/local/tmp/bunny-onn-metadata/${READER_SHA256}.dex`;
export const READER_CHECK = `test ! -L /data/local/tmp/bunny-onn-metadata && test -d /data/local/tmp/bunny-onn-metadata && test ! -L ${READER_DEVICE_PATH} && test -f ${READER_DEVICE_PATH} && sha256sum ${READER_DEVICE_PATH}`;
export const READER_INVOCATION = `CLASSPATH=${READER_DEVICE_PATH} app_process /system/bin ${READER_CLASS} 3>&1 1>/dev/null 2>/dev/null`;
