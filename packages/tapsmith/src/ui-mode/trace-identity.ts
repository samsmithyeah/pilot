import type { TestTreeNode } from './ui-protocol.js';

/** Test names are local to a file; JSON preserves separators in paths/names. */
export function traceKey(projectName: string | undefined, fullName: string, filePath?: string): string {
  return JSON.stringify([projectName ?? '', filePath ?? '', fullName]);
}

export function parseTraceKey(key: string): { projectName: string; filePath: string } {
  const [projectName, filePath] = JSON.parse(key) as [string, string, string];
  return { projectName, filePath };
}

/** Resolve older messages without file identity only when the name is unambiguous. */
export class TraceIdentityRegistry {
  private files = new Map<string, Set<string>>();

  register(projectName: string | undefined, fullName: string, filePath: string): string {
    const name = traceKey(projectName, fullName);
    let files = this.files.get(name);
    if (!files) { files = new Set(); this.files.set(name, files); }
    files.add(filePath);
    return traceKey(projectName, fullName, filePath);
  }

  setTree(nodes: readonly TestTreeNode[]): void {
    this.files.clear();
    const visit = (nodes: readonly TestTreeNode[], projectName?: string): void => {
      for (const node of nodes) {
        const project = node.type === 'project' ? node.name : projectName;
        if (node.type === 'test') this.register(project, node.fullName, node.filePath);
        if (node.children) visit(node.children, project);
      }
    };
    visit(nodes);
  }

  resolve(projectName: string | undefined, fullName: string, filePath?: string): string | undefined {
    if (filePath) return traceKey(projectName, fullName, filePath);
    const files = this.files.get(traceKey(projectName, fullName));
    if (files?.size !== 1) return undefined;
    return traceKey(projectName, fullName, files.values().next().value);
  }
}
