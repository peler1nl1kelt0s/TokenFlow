import fs from 'fs/promises';
import path from 'path';

export interface RepoComplexitySummary {
  fileCount: number;
  totalLinesOfCode: number;
  godFiles: string[];
  importCount: number;
  avgFileLines: number;
}

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'bin']);
const SUPPORTED_EXTS = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h']);

export async function scanRepository(dirPath: string): Promise<RepoComplexitySummary> {
  let fileCount = 0;
  let totalLinesOfCode = 0;
  let importCount = 0;
  const godFiles: string[] = [];

  async function walk(currentDir: string) {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(currentDir);
    } catch {
      return; // Skip folders we can't read
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);
      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (IGNORE_DIRS.has(entry)) {
          continue;
        }
        await walk(fullPath);
      } else if (stat.isFile()) {
        const ext = path.extname(entry).toLowerCase();
        if (!SUPPORTED_EXTS.has(ext)) {
          continue;
        }

        fileCount++;
        let content = '';
        try {
          content = await fs.readFile(fullPath, 'utf-8');
        } catch {
          continue; // Skip files we can't read
        }

        // Count lines of code
        const lines = content.split('\n');
        const loc = lines.length;
        totalLinesOfCode += loc;

        if (loc > 500) {
          godFiles.push(path.relative(dirPath, fullPath));
        }

        // Count imports simply by looking at common import patterns:
        // 'import ...', 'require(...)', 'from ... import ...'
        for (const line of lines) {
          const trimmed = line.trim();
          if (
            trimmed.startsWith('import ') ||
            trimmed.startsWith('import {') ||
            trimmed.includes('require(') ||
            trimmed.startsWith('from ')
          ) {
            importCount++;
          }
        }
      }
    }
  }

  await walk(dirPath);

  return {
    fileCount,
    totalLinesOfCode,
    godFiles,
    importCount,
    avgFileLines: fileCount > 0 ? Math.round(totalLinesOfCode / fileCount) : 0,
  };
}
