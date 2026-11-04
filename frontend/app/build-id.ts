import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Build identifier (help page, diagnostics, header X-App-Build; set in vite.config.ts):
// a short hash over the files the bundle is made of.
// Depends on content only – no git, no build time – so a deploy without an app change builds byte-identical output
// and does not trigger an app update on the phones.
// Left out on purpose, as they never reach the production bundle: node_modules (everywhere), __tests__ (in src and
// shared), shared/fixtures (only the fake API of the E2E build imports them). The E2E build is not meant to be deployed.
export function appBuild(): string {
  const appDir = fileURLToPath(new URL('.', import.meta.url))
  const sharedDir = fileURLToPath(new URL('../shared', import.meta.url))
  const lockFile = fileURLToPath(new URL('../package-lock.json', import.meta.url))
  const configFiles =
    /^(index\.html|env\.d\.ts|package\.json|vite\.config\.ts|build-id\.ts|tsconfig(\.app|\.node)?\.json|\.env(\.production)?)$/

  const files: string[] = [lockFile]
  const walk = (dir: string, skip: string[] = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (['.DS_Store', 'node_modules', ...skip].includes(entry.name)) continue
      if (entry.isDirectory()) walk(path, skip)
      else files.push(path)
    }
  }
  walk(join(appDir, 'src'), ['__tests__'])
  walk(join(appDir, 'public'))
  walk(sharedDir, ['__tests__', 'fixtures'])
  for (const name of readdirSync(appDir)) if (configFiles.test(name)) files.push(join(appDir, name))

  // Relative paths and sorted: the same hash on every machine and in every directory order.
  const hash = createHash('sha256')
  for (const file of files.map((f) => relative(appDir, f).split(sep).join('/')).sort()) {
    hash.update(`${file}\0`).update(readFileSync(join(appDir, file))).update('\0')
  }
  return hash.digest('hex').slice(0, 8)
}

// `node build-id.ts` prints it (deploy workflow)
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(appBuild())
