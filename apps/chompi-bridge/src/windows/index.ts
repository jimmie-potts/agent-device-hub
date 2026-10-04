export { createWindowsAdapter, type WindowsAdapterOptions } from './adapter.js';
export { createOsAdapter, createUnsupportedAdapter } from './unsupported.js';
export { CLAUDE_PACKAGE_FAMILY, CODEX_PACKAGE_FAMILY, PACKAGE_FAMILIES } from './constants.js';
export { HeldModifierError, KeyboardError, OpenUriError, type KeyboardErrorCode, type OpenUriErrorCode } from './errors.js';
export { encodeKeyboardInputs, INPUT_SIZE, Keyboard, VIRTUAL_KEYS, virtualKeyCode, type KeyboardApi, type KeyEvent } from './keyboard.js';
export { encodeWheelInput, MAX_SCROLL_NOTCHES, WHEEL_DELTA, type ScreenPoint, type ScreenRect } from './mouse.js';
export { parseDeepLink, type DeepLink } from './uri.js';
export { claudeSessions, codexArchived } from './client-files.js';
export {
  defaultSpawnHelper, encodeHelperCommand, helperScriptPath, UIA_HELPER_PROTOCOL, UiaHelper,
  type HelperChild, type HelperReply, type SpawnHelper, type UiaHelperLike, type UiaHelperOptions,
} from './uia-helper.js';
export { loadWin32Api, type ProcessIdentity, type Win32Api } from './win32.js';
