import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { scanRepository } from './repoScanner.js';

const MOCK_DIR = path.join(process.cwd(), 'temp_mock_repo_test');

describe('Repository Complexity Scanner', () => {
  beforeAll(async () => {
    // Setup mock repository structure
    await fs.mkdir(MOCK_DIR, { recursive: true });
    
    // Write some mock source files
    await fs.writeFile(
      path.join(MOCK_DIR, 'index.ts'),
      `import { foo } from './foo';\nimport { bar } from './bar';\nconsole.log(foo, bar);`
    );

    await fs.writeFile(
      path.join(MOCK_DIR, 'foo.ts'),
      `export const foo = 'foo';\n// Line 2\n// Line 3`
    );

    // Create ignored folder and a file in it
    await fs.mkdir(path.join(MOCK_DIR, 'node_modules'), { recursive: true });
    await fs.writeFile(
      path.join(MOCK_DIR, 'node_modules', 'dep.ts'),
      `export const dep = 'dep';`
    );
  });

  afterAll(async () => {
    // Cleanup mock repo
    await fs.rm(MOCK_DIR, { recursive: true, force: true });
  });

  it('should scan files correctly while ignoring node_modules', async () => {
    const summary = await scanRepository(MOCK_DIR);

    // Assert only index.ts and foo.ts were scanned (not node_modules/dep.ts)
    expect(summary.fileCount).toBe(2);

    // index.ts: 3 lines, foo.ts: 3 lines -> total 6 LOC
    expect(summary.totalLinesOfCode).toBe(6);

    // Two imports in index.ts
    expect(summary.importCount).toBe(2);
    expect(summary.godFiles).toEqual([]);
    expect(summary.avgFileLines).toBe(3);
  });
});
