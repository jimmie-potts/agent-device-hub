import { encodeKeyboardInputs, INPUT_SIZE, type KeyboardApi, type KeyEvent } from './keyboard.js';
import { encodeWheelInput, type ScreenPoint, type ScreenRect } from './mouse.js';

export interface ProcessIdentity {
  /** Package family name, or null when the process has no package identity. */
  packageFamily: string | null;
  /** Full image path, or null when Windows does not report it. */
  imagePath: string | null;
}

/** The Win32 calls the adapter uses. Handles are plain numbers (`uintptr_t`); 0 means none. */
export interface Win32Api extends KeyboardApi {
  foregroundWindow(): number;
  /** `GetAncestor(GA_ROOTOWNER)`: the top-level owner of a popup or the window itself. */
  rootOwner(hwnd: number): number;
  /** The window's process ID, or 0 when the window is gone. */
  windowProcessId(hwnd: number): number;
  /** Package and image of a process, or null when it cannot be opened for limited query. */
  processIdentity(pid: number): ProcessIdentity | null;
  /**
   * `ShellExecuteW` with the `open` verb on a libuv worker thread, so a slow protocol activation cannot block the
   * event loop; a result above 32 means the request was handed off.
   */
  shellOpen(uri: string): Promise<number>;
  /** `GetCursorPos`, or null when Windows does not report it (for example on a secure desktop). */
  cursorPosition(): ScreenPoint | null;
  /** `GetWindowRect`, or null when the window is gone. */
  windowRect(hwnd: number): ScreenRect | null;
  /** One `SendInput` wheel event with this signed delta; the pointer does not move. */
  sendWheel(delta: number): { inserted: number; error: number };
}

/** The subset of koffi 3.x used here, typed locally so builds and Linux tests never need the native module. */
type KoffiFunction = ((...args: unknown[]) => unknown) & { async(...args: unknown[]): void };
interface KoffiModule {
  load(path: string): { func(definition: string): KoffiFunction };
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const GA_ROOTOWNER = 3;
const ERROR_SUCCESS = 0;
const APPMODEL_ERROR_NO_PACKAGE = 15700;
const SW_SHOWNORMAL = 1;
const COINIT_MULTITHREADED = 0x0;
const FAMILY_CHARS = 256;
const PATH_CHARS = 1024;

/** Loads koffi lazily; it is an optional dependency, so its absence is an ordinary error here. */
async function loadKoffi(): Promise<KoffiModule> {
  const specifier = 'koffi';
  try {
    const loaded = await import(specifier) as { default?: KoffiModule } & KoffiModule;
    return loaded.default ?? loaded;
  } catch (cause) {
    throw new Error('koffi-unavailable', { cause });
  }
}

const decode = (buffer: Buffer, chars: number) => buffer.toString('utf16le', 0, Math.max(0, chars) * 2);

/** Binds the Win32 surface through koffi. Windows on a 64-bit Node only. */
export async function loadWin32Api(load: () => Promise<KoffiModule> = loadKoffi): Promise<Win32Api> {
  if (process.platform !== 'win32') throw new Error('win32-only');
  if (process.arch !== 'x64' && process.arch !== 'arm64') throw new Error('win32-64-bit-only');
  const koffi = await load();
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const shell32 = koffi.load('shell32.dll');
  const ole32 = koffi.load('ole32.dll');

  const GetForegroundWindow = user32.func('uintptr_t __stdcall GetForegroundWindow()');
  const GetAncestor = user32.func('uintptr_t __stdcall GetAncestor(uintptr_t hwnd, uint32_t flags)');
  const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32_t *pid)');
  const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vk)');
  const SendInput = user32.func('uint32_t __stdcall SendInput(uint32_t count, const void *inputs, int size)');
  const GetCursorPos = user32.func('int __stdcall GetCursorPos(void *point)');
  const GetWindowRect = user32.func('int __stdcall GetWindowRect(uintptr_t hwnd, void *rect)');
  const OpenProcess = kernel32.func('uintptr_t __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)');
  const CloseHandle = kernel32.func('int __stdcall CloseHandle(uintptr_t handle)');
  const GetLastError = kernel32.func('uint32_t __stdcall GetLastError()');
  const GetPackageFamilyName = kernel32.func('int32_t __stdcall GetPackageFamilyName(uintptr_t process, _Inout_ uint32_t *length, void *name)');
  const QueryFullProcessImageNameW = kernel32.func('int __stdcall QueryFullProcessImageNameW(uintptr_t process, uint32_t flags, void *name, _Inout_ uint32_t *size)');
  const ShellExecuteW = shell32.func('uintptr_t __stdcall ShellExecuteW(uintptr_t hwnd, str16 verb, str16 file, str16 parameters, str16 directory, int show)');
  const CoInitializeEx = ole32.func('int32_t __stdcall CoInitializeEx(void *reserved, uint32_t flags)');

  let comReady = false;

  return {
    foregroundWindow: () => Number(GetForegroundWindow()),
    rootOwner: hwnd => Number(GetAncestor(hwnd, GA_ROOTOWNER)),
    windowProcessId(hwnd) {
      const pid = [0];
      return GetWindowThreadProcessId(hwnd, pid) ? Number(pid[0]) : 0;
    },
    processIdentity(pid) {
      const handle = Number(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid));
      if (!handle) return null;
      try {
        const familyLength = [FAMILY_CHARS];
        const family = Buffer.alloc(FAMILY_CHARS * 2);
        const status = Number(GetPackageFamilyName(handle, familyLength, family));
        let packageFamily: string | null;
        if (status === ERROR_SUCCESS) packageFamily = decode(family, Number(familyLength[0]) - 1);
        else if (status === APPMODEL_ERROR_NO_PACKAGE) packageFamily = null;
        else return null;
        const pathLength = [PATH_CHARS];
        const path = Buffer.alloc(PATH_CHARS * 2);
        const imagePath = QueryFullProcessImageNameW(handle, 0, path, pathLength) ? decode(path, Number(pathLength[0])) : null;
        return { packageFamily, imagePath };
      } finally {
        CloseHandle(handle);
      }
    },
    isKeyDown: vk => (Number(GetAsyncKeyState(vk)) & 0x8000) !== 0,
    sendInput(events: readonly KeyEvent[]) {
      if (events.length === 0) return { inserted: 0, error: 0 };
      const inserted = Number(SendInput(events.length, encodeKeyboardInputs(events), INPUT_SIZE));
      return { inserted, error: inserted === events.length ? 0 : Number(GetLastError()) };
    },
    cursorPosition() {
      const point = Buffer.alloc(8);
      return GetCursorPos(point) ? { x: point.readInt32LE(0), y: point.readInt32LE(4) } : null;
    },
    windowRect(hwnd) {
      const rect = Buffer.alloc(16);
      if (!GetWindowRect(hwnd, rect)) return null;
      return { left: rect.readInt32LE(0), top: rect.readInt32LE(4), right: rect.readInt32LE(8), bottom: rect.readInt32LE(12) };
    },
    sendWheel(delta) {
      const inserted = Number(SendInput(1, encodeWheelInput(delta), INPUT_SIZE));
      return { inserted, error: inserted === 1 ? 0 : Number(GetLastError()) };
    },
    shellOpen(uri) {
      if (!comReady) {
        // ShellExecute may activate the protocol handler through COM. Joining the main thread to the process MTA keeps
        // that apartment alive, so the worker thread below runs in the implicit MTA without its own initialization.
        // S_FALSE and RPC_E_CHANGED_MODE (already initialized) are both acceptable.
        CoInitializeEx(null, COINIT_MULTITHREADED);
        comReady = true;
      }
      return new Promise<number>((resolve, reject) => {
        ShellExecuteW.async(0, 'open', uri, null, null, SW_SHOWNORMAL, (error: unknown, result: unknown) => {
          if (error) reject(error); else resolve(Number(result));
        });
      });
    },
  };
}
