import { spawnSync } from 'node:child_process';

const [platform, ...buildArguments] = process.argv.slice(2);
if (platform !== 'android' && platform !== 'ios') {
  console.error('Usage: node scripts/build-mobile.mjs <android|ios> [build options]');
  process.exit(2);
}

const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(
  executable,
  ['tauri', platform, 'build', '--ci', ...buildArguments],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
