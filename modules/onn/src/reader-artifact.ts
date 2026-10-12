/** Fixed release identity; no runtime or client-supplied path, class, or arguments. */
export const READER_CLASS = 'OnnMetadataReader';
export const READER_SCHEMA = 'onn-metadata/2.0';
export const READER_SHA256 = 'ac2db0440ad01c7db9a7e1c8588d8d1502872d66c55d365dd5e746e57d097052';
export const READER_SOURCE_SHA256 = 'cd29c55b48841b742ab41f847f7bb29d0e07f1e44d268482abe5a47f545ef372';
export const READER_SOURCE_VERSION = 'onn-metadata/2.0-native-4';
export const READER_PACKAGED_PATH = 'native/artifact/reader.dex';
export const READER_DEVICE_PATH = `/data/local/tmp/bunny-onn-metadata/${READER_SHA256}.dex`;
export const READER_CHECK = `test ! -L /data/local/tmp/bunny-onn-metadata && test -d /data/local/tmp/bunny-onn-metadata && test ! -L ${READER_DEVICE_PATH} && test -f ${READER_DEVICE_PATH} && sha256sum ${READER_DEVICE_PATH}`;
// adbd uses a socket pair for raw stdout. Supply the reader's required pipe;
// pipefail preserves a failed reader when the forwarding command succeeds.
export const READER_INVOCATION = `set -o pipefail; CLASSPATH=${READER_DEVICE_PATH} app_process /system/bin ${READER_CLASS} 3>&1 1>/dev/null 2>/dev/null | cat`;
