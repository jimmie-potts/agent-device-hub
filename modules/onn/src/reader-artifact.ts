/** Fixed release identity; no runtime or client-supplied path, class, or arguments. */
export const READER_CLASS = 'OnnMetadataReader';
export const READER_SCHEMA = 'onn-metadata/2.0';
export const READER_SHA256 = '460cee4c930d9fba5f2665f70c2da49e60dd7bab2cd682b80e58fc4701137d52';
export const READER_SOURCE_SHA256 = 'a46d4112e84674d3fccaa616787903e93f6800da37cf8d33b82091b994e64e33';
export const READER_SOURCE_VERSION = 'onn-metadata/2.0-native-3';
export const READER_PACKAGED_PATH = 'native/artifact/reader.dex';
export const READER_DEVICE_PATH = `/data/local/tmp/bunny-onn-metadata/${READER_SHA256}.dex`;
export const READER_CHECK = `test ! -L /data/local/tmp/bunny-onn-metadata && test -d /data/local/tmp/bunny-onn-metadata && test ! -L ${READER_DEVICE_PATH} && test -f ${READER_DEVICE_PATH} && sha256sum ${READER_DEVICE_PATH}`;
// adbd uses a socket pair for raw stdout. Supply the reader's required pipe;
// pipefail preserves a failed reader when the forwarding command succeeds.
export const READER_INVOCATION = `set -o pipefail; CLASSPATH=${READER_DEVICE_PATH} app_process /system/bin ${READER_CLASS} 3>&1 1>/dev/null 2>/dev/null | cat`;
