import type { GitRuntimeOptions } from '../git-runtime-options'
import { gitOptionsForWorktree } from '../git-runtime-options'
import { gitExecFileAsync } from '../runner'
import { invalidateGitReadCaches } from './git-read-cache-invalidation'

export async function commitChanges(
  worktreePath: string,
  message: string,
  options: GitRuntimeOptions = {}
): Promise<{ success: boolean; error?: string }> {
  invalidateGitReadCaches()
  try {
    await gitExecFileAsync(['commit', '-m', message], gitOptionsForWorktree(worktreePath, options))
    return { success: true }
  } catch (error) {
    // Why: useful message may be on stderr (hook/GPG failures) or stdout ("nothing to commit"), so try both then message.
    const readStringField = (field: string): string | null => {
      if (typeof error === 'object' && error && field in error) {
        const v = (error as Record<string, unknown>)[field]
        if (typeof v === 'string' && v.length > 0) {
          return v
        }
      }
      return null
    }
    const stdout = readStringField('stdout')
    const stderr = readStringField('stderr')
    // Why: leftover hook banners land on stderr even when git already wrote
    // "nothing to commit" on stdout. Prefer that git message so the UI is truthful.
    const errorMessage =
      stdout && /nothing to commit|working tree clean/i.test(stdout)
        ? stdout
        : (stderr ?? stdout ?? (error instanceof Error ? error.message : 'Commit failed'))
    return { success: false, error: errorMessage }
  } finally {
    invalidateGitReadCaches()
  }
}
