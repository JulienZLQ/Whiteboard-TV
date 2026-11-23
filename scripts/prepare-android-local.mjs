import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, access, readdir, rm }  from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const nodeHome = process.env.LOCAL_NODE_HOME, ndk = process.env.ANDROID_NDK_HOME;
if (!nodeHome || !ndk) throw new Error('Set LOCAL_NODE_HOME to extracted nodejs-mobile 18.20.4 and ANDROID_NDK_HOME to NDK r27c');
const toolchain = join(ndk, 'toolchains/llvm/prebuilt', process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64');
const app = join(root, 'apps/android-tv/app');
const runtime = join(app, 'src/main/assets/local-runtime');
await access(join(root, 'apps/web/dist/index.html'));
await rm(runtime, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
await cp(join(root, 'apps/web/dist'), join(runtime, 'web'), { recursive: true });
await build({ entryPoints: [join(root, 'apps/server/src/android.ts')], bundle: true, platform: 'node', target: 'node18', format: 'cjs', outfile: join(runtime, 'server.cjs'),
  // nodejs-mobile has no ICU. lib0's strict UTF-8 fallback handles Unicode correctly.
  define: { TextDecoder: 'undefined', 'process.env.WS_NO_BUFFER_UTIL': '"1"', 'process.env.WS_NO_UTF_8_VALIDATE': '"1"' }, external: ['bufferutil', 'utf-8-validate'], logLevel: 'info' });
for (const [abi, target, library] of [['armeabi-v7a', 'armv7a-linux-androideabi26', 'arm-linux-androideabi'], ['arm64-v8a', 'aarch64-linux-android26', 'aarch64-linux-android'], ['x86_64', 'x86_64-linux-android26', 'x86_64-linux-android']]) {
  const output = join(app, 'src/main/jniLibs', abi); await mkdir(output, { recursive: true });
  await cp(join(nodeHome, 'bin', abi, 'libnode.so'), join(output, 'libnode.so'));
  await cp(join(toolchain, 'sysroot/usr/lib', library, 'libc++_shared.so'), join(output, 'libc++_shared.so'));
  execFileSync(join(toolchain, 'bin', target + '-clang++'), ['-shared', '-fPIC', '-O2', '-std=c++17', '-Wl,-z,max-page-size=16384', '-Wl,-soname,libwhiteboard-node.so', '-I' + join(nodeHome, 'include/node'), join(app, 'src/main/cpp/local-node.cpp'), '-L' + output, '-lnode', '-llog', '-o', join(output, 'libwhiteboard-node.so')], { stdio: 'inherit' });
  console.log('Built local host:', abi);
}
// Include notices for the runtime and bundled JS dependencies in each APK.
const notices = ['Shared runtime: nodejs-mobile 18.20.4. See https://github.com/nodejs-mobile/nodejs-mobile/blob/v18.20.4/LICENSE'];
for (const name of ['yjs', 'lib0', 'ws', 'react', 'react-dom', 'konva', 'qrcode', 'lucide-react']) {
  let license;
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try { license = await readFile(join(root, 'node_modules', name, filename), 'utf8'); break; } catch {}
  }
  if (license) notices.push('\n' + name + '\n' + license);
}
notices.push(await readFile(join(root, 'assets/licenses/nodejs-mobile-LICENSE.txt'), 'utf8'));
await writeFile(join(runtime, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n'));

const digest = createHash('sha256');
async function hashTree(folder) {
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'id.txt') continue;
    digest.update(entry.name);
    if (entry.isDirectory()) await hashTree(join(folder, entry.name)); else digest.update(await readFile(join(folder, entry.name)));
  }
}
await hashTree(runtime); await writeFile(join(runtime, 'id.txt'), digest.digest('hex') + '\n');
