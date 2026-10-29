import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * 以部署基路径 /nav 运行「构建 + 浏览器契约测试」。
 *
 * 生产通过 GitHub Pages 项目站点部署在 /nav 子路径下，而默认
 * `check:browser` 在根路径运行，无法覆盖子路径路由（stripBasePath、
 * 目录 302、带前缀的 buildRoutePath）等关键分支。本脚本为子路径场景提供
 * 一键入口，同时保证跨平台（不依赖 shell 前缀赋值）。
 */

const repoRoot = path.resolve(__dirname, '..');
const registerScript = path.join(__dirname, 'register-ts.cjs');
const BASE_PATH = '/nav';

function runEntry(entry: string): number {
  const result = spawnSync(process.execPath, ['-r', registerScript, entry], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, MENAV_BASE_PATH: BASE_PATH },
  });
  return Number.isFinite(result.status) ? Number(result.status) : 1;
}

function main() {
  const buildCode = runEntry(path.join(repoRoot, 'scripts', 'build.ts'));
  if (buildCode !== 0) process.exit(buildCode);

  const testCode = runEntry(path.join(repoRoot, 'scripts', 'test-browser.ts'));
  process.exit(testCode);
}

if (require.main === module) {
  main();
}
