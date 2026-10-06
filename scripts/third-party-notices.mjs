import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const output = resolve('build/third-party-licenses');
await mkdir(output, { recursive: true });
const rows = ['# 运行时第三方依赖', '', '本清单从锁文件生成；完整许可证随本目录分发。Electron 和 Chromium 的许可另见程序目录。', '', '| 包 | 版本 | 许可 |', '| --- | --- | --- |'];
for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location || metadata.dev) continue;
  const dir = resolve(location);
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  rows.push(`| ${pkg.name} | ${pkg.version} | ${typeof pkg.license === 'string' ? pkg.license : '见包内文件'} |`);
  const target = join(output, location.replaceAll('/', '__'));
  await mkdir(target, {recursive:true});
  for (const filename of await readdir(dir)) {
    if (/^(license|licence|copying|notice)(\.|$|-)/i.test(filename)) {
      await copyFile(join(dir, filename), join(target, filename));
    }
  }
}
await writeFile(join(output, 'README.md'), rows.join('\n')+'\n', 'utf8');
console.log('Third-party notices prepared.');
