import assert from 'node:assert/strict';
import test from 'node:test';
import { packageFamilyFromImagePath } from '../dist/windows/index.js';

const PF = 'C:\\Program Files';

test('a process image inside an installed package folder yields that package family', () => {
  assert.equal(packageFamilyFromImagePath('C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.930.3930.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe', PF), 'OpenAI.Codex_2p2nqsd0c76g0');
  assert.equal(packageFamilyFromImagePath('C:\\Program Files\\WindowsApps\\Claude_2.19675.0.0_x64__pzs8sxrjxfjjc\\app\\Claude.exe', PF), 'Claude_pzs8sxrjxfjjc');
  assert.equal(packageFamilyFromImagePath('c:\\program files\\windowsapps\\Claude_2.19675.0.0_x64__pzs8sxrjxfjjc\\Claude.exe', PF), 'Claude_pzs8sxrjxfjjc', 'case-insensitive root');
  assert.equal(packageFamilyFromImagePath('C:\\Program Files\\WindowsApps\\Vendor.App_1.2.3.4_neutral_split.scale-100_abcdefghijklm\\x.exe', PF), 'Vendor.App_abcdefghijklm');
});

test('anything else yields no family', () => {
  for (const path of [
    null,
    '',
    'C:\\Users\\me\\AppData\\Local\\OpenAI.Codex_26.930.3930.0_x64__2p2nqsd0c76g0\\ChatGPT.exe', // outside WindowsApps
    'C:\\Program Files\\WindowsAppsX\\OpenAI.Codex_26.930.3930.0_x64__2p2nqsd0c76g0\\ChatGPT.exe', // look-alike root
    'D:\\Program Files\\WindowsApps\\OpenAI.Codex_26.930.3930.0_x64__2p2nqsd0c76g0\\ChatGPT.exe', // other drive
    'C:\\Program Files\\WindowsApps\\ChatGPT.exe', // no package folder
    'C:\\Program Files\\WindowsApps\\..\\Evil_1.0.0.0_x64__2p2nqsd0c76g0\\x.exe', // traversal
    'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.930_x64__2p2nqsd0c76g0\\ChatGPT.exe', // bad version
    'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.930.3930.0_sparc__2p2nqsd0c76g0\\ChatGPT.exe', // bad architecture
    'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.930.3930.0_x64__2P2NQSD0C76G0\\ChatGPT.exe', // publisher ID case
    'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.930.3930.0_x64__2p2nqsd0c76\\ChatGPT.exe', // short publisher ID
  ]) assert.equal(packageFamilyFromImagePath(path, PF), null, String(path));
  assert.equal(packageFamilyFromImagePath('C:\\Program Files\\WindowsApps\\Claude_2.19675.0.0_x64__pzs8sxrjxfjjc\\Claude.exe', undefined), null, 'no Program Files');
  assert.equal(packageFamilyFromImagePath('C:\\Program Files\\WindowsApps\\Claude_2.19675.0.0_x64__pzs8sxrjxfjjc\\Claude.exe', 'relative\\path'), null, 'relative root');
  assert.equal(packageFamilyFromImagePath('C:\\WindowsApps\\Claude_2.19675.0.0_x64__pzs8sxrjxfjjc\\Claude.exe', 'C:\\'), null, 'a drive root is not Program Files');
  assert.equal(packageFamilyFromImagePath('\\\\server\\share\\WindowsApps\\Claude_2.19675.0.0_x64__pzs8sxrjxfjjc\\Claude.exe', '\\\\server\\share'), null, 'a network root is refused');
});
