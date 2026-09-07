#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 从 Git 标签提取符合 SemVer（语义化版本）规则的应用版本。
 *
 * @param {string | undefined} tag 形如 v0.1.7 或 v0.1.7-rc.1 的发布标签。
 * @returns {string} 去掉 v 前缀后的版本号。
 * @throws {Error} 标签缺失或不符合语义化版本时抛出，阻止错误版本进入发布流程。
 */
function versionFromTag(tag) {
  const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(tag ?? '');
  if (!match) {
    throw new Error(`发布标签必须是 vX.Y.Z 形式，实际值为: ${tag ?? '(缺失)'}`);
  }
  return match[1];
}

/**
 * 读取、更新并格式化写回 JSON（JavaScript 对象表示法）文件。
 *
 * @param {string} path 文件绝对路径。
 * @param {(value: Record<string, unknown>) => void} update 对解析后对象执行原地更新的函数。
 * @returns {void} 写入结束后的文件内容已带单个换行符，保持仓库 JSON 格式一致。
 */
function updateJson(path, update) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  update(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * 在文本文件中替换恰好一个受控版本字段。
 *
 * TOML（Tom's Obvious Minimal Language）和 Cargo.lock（Cargo 锁文件）没有项目内可复用
 * 的解析器。这里严格限定包名与字段位置，并验证匹配次数，避免宽泛替换依赖版本号。
 *
 * @param {string} path 文件绝对路径。
 * @param {RegExp} pattern 必须带全局标记、且精确匹配目标字段的正则表达式。
 * @param {string} replacement 替换后的完整文本。
 * @returns {void} 匹配次数不是一时抛错，防止构建出版本不一致的安装包。
 */
function replaceExactlyOnce(path, pattern, replacement) {
  const source = readFileSync(path, 'utf8');
  const matches = source.match(pattern) ?? [];
  if (matches.length !== 1) {
    throw new Error(`${path} 的目标版本字段应匹配一次，实际匹配 ${matches.length} 次`);
  }
  writeFileSync(path, source.replace(pattern, replacement));
}

/**
 * 将当前 `frontend`（前端）工作目录的全部发布版本字段同步为 Git 标签版本。
 *
 * 此脚本只运行在 GitHub Actions 的临时检出目录，绝不提交或推送版本文件。因此日常开发
 * 版本可以保持不变，而每个 vX.Y.Z 标签构建出的 Android、Windows 与 macOS 包都准确带有
 * 对应版本号。
 *
 * @returns {void} 版本同步完成后输出可审计的构建日志。
 */
function main() {
  const version = versionFromTag(process.argv[2]);
  const frontendDirectory = process.cwd();
  const packageJsonPath = resolve(frontendDirectory, 'package.json');
  const packageLockPath = resolve(frontendDirectory, 'package-lock.json');
  const tauriConfigPath = resolve(frontendDirectory, 'src-tauri', 'tauri.conf.json');
  const cargoTomlPath = resolve(frontendDirectory, 'src-tauri', 'Cargo.toml');
  const cargoLockPath = resolve(frontendDirectory, 'src-tauri', 'Cargo.lock');

  updateJson(packageJsonPath, (packageJson) => {
    packageJson.version = version;
  });
  updateJson(packageLockPath, (packageLock) => {
    packageLock.version = version;
    const rootPackage = packageLock.packages?.[''];
    if (!rootPackage || typeof rootPackage !== 'object') {
      throw new Error('package-lock.json 缺少根包版本字段');
    }
    rootPackage.version = version;
  });
  updateJson(tauriConfigPath, (tauriConfig) => {
    tauriConfig.version = version;
  });
  replaceExactlyOnce(
    cargoTomlPath,
    /(^\[package\]\r?\nname = "rime"\r?\nversion = ")[^"]+(")/gm,
    `$1${version}$2`,
  );
  replaceExactlyOnce(
    cargoLockPath,
    /(^\[\[package\]\]\r?\nname = "rime"\r?\nversion = ")[^"]+(")/gm,
    `$1${version}$2`,
  );
  console.log(`已将构建工作区版本同步为 ${version}`);
}

main();
