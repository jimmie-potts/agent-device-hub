import { win32 as winPath } from 'node:path';

// Name_Version_Architecture_ResourceId_PublisherId, the folder name of an installed package.
const FULL_NAME = /^([A-Za-z0-9.-]{3,50})_(\d+\.\d+\.\d+\.\d+)_(x86|x64|arm|arm64|neutral|x86a64)_([A-Za-z0-9.-]{0,30})_([a-z0-9]{13})$/;

/**
 * The package family of a process image that lies inside an installed package's folder under
 * `<Program Files>\WindowsApps`, or null. Only the package installer can write there, so the folder
 * name is a trustworthy identity for a process that runs without package identity, as Codex
 * Desktop's window process does (#743 trial). The root must be the system's Program Files on a drive
 * letter; same-user tampering with the environment is out of scope, since that user can alter the bridge
 * itself. Never used to override a real package identity.
 */
export function packageFamilyFromImagePath(imagePath: string | null, programFiles: string | undefined): string | null {
  // A drive-letter root only: a root such as `C:\` or a network share would make a writable folder look like WindowsApps.
  if (!imagePath || !programFiles || !/^[A-Za-z]:\\[^\\]/.test(programFiles)) return null;
  const root = `${winPath.join(programFiles, 'WindowsApps')}\\`;
  if (imagePath.length <= root.length || imagePath.slice(0, root.length).toLowerCase() !== root.toLowerCase()) return null;
  const segments = imagePath.slice(root.length).split('\\');
  if (segments.length < 2 || segments.some(segment => segment === '..' || segment === '.' || segment === '')) return null;
  const match = FULL_NAME.exec(segments[0]!);
  return match ? `${match[1]}_${match[5]}` : null;
}
