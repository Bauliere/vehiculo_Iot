import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const docs = resolve(source, '../..');
const output = join(docs, 'assets', 'vendor');
const result = await build({
  absWorkingDir: docs,
  entryPoints: [join(source, 'entry.js')],
  outfile: join(output, 'iot-effects.js'),
  bundle: true,
  jsx: 'automatic',
  format: 'esm',
  target: ['es2022'],
  minify: true,
  metafile: true,
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: {
    js: '/*! React Bits integration. See iot-effects.LICENSE.txt. */',
    css: '/*! React Bits integration. See iot-effects.LICENSE.txt. */'
  }
});

// Recoge las licencias de los paquetes que entran en el archivo compilado.
const packages = new Set();
for (const name of Object.keys(result.metafile.inputs)) {
  const packagePath = name.match(/(?:^|\/)node_modules\/(?!\.pnpm\/)(?:@[^/]+\/)?[^/]+/g)?.at(-1);
  if (!packagePath) continue;
  const start = name.lastIndexOf(packagePath);
  packages.add(name.slice(0, start + packagePath.length));
}
const notices = [await readFile(join(source, 'LICENSE.md'), 'utf8')];
for (const folder of [...packages].sort()) {
  const { name, version, license } = JSON.parse(await readFile(resolve(docs, folder, 'package.json'), 'utf8'));
  let terms = '';
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try {
      terms = await readFile(resolve(docs, folder, file), 'utf8');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (name === 'ogl' && !terms) terms = await readFile(join(source, 'OGL-LICENSE.txt'), 'utf8');
  if (!terms) throw new Error(`Falta el texto de la licencia de ${name}.`);
  notices.push(`${name} ${version} — ${license}\n\n${terms.trim()}`);
}
await writeFile(join(output, 'iot-effects.LICENSE.txt'), notices.join('\n\n---\n\n') + '\n');
