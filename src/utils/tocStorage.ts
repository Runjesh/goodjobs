// Theory-of-Change storage accessors shared by the builder and downstream
// consumers (e.g. Insights). Keys must stay in sync with TheoryOfChangeBuilder.

export interface ToCNode {
  id: string;
  type: 'input' | 'activity' | 'output' | 'outcome' | 'impact';
  content: string;
  metric?: string;
}

export const TOC_GENERAL_KEY = '__general__';
export const TOC_LEGACY_KEY = 'goodjobs.toc.v1';

export function tocProgramKey(p: string): string {
  return p && p.trim() ? p.trim() : TOC_GENERAL_KEY;
}

export function tocStorageKey(p: string): string {
  return `goodjobs.toc.${tocProgramKey(p)}.v2`;
}

export function readToCForProgram(program: string): ToCNode[] {
  try {
    const raw = localStorage.getItem(tocStorageKey(program));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as ToCNode[];
    }
    if (tocProgramKey(program) === TOC_GENERAL_KEY) {
      const legacy = localStorage.getItem(TOC_LEGACY_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed)) return parsed as ToCNode[];
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}

// Returns programs that have an authored ToC (any node persisted).
// Used by Insights to skip programs the operator hasn't filled in yet.
export function listProgramsWithToC(programs: string[]): string[] {
  return programs.filter(p => readToCForProgram(p).length > 0);
}
