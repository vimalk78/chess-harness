// Minimal templates: {{name}} is replaced by a value. No conditionals, no loops.
// Unknown names are left in the text as-is (the editor highlights them).

const VAR = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/g;

export type VariableSources = Record<string, () => string>;

export function renderTemplate(template: string, sources: VariableSources): string {
  const cache = new Map<string, string>();
  return template.replace(VAR, (whole, name: string) => {
    const source = sources[name];
    if (!source) return whole;
    if (!cache.has(name)) cache.set(name, source());
    return cache.get(name)!;
  });
}

export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(VAR)].map((m) => m[1]))];
}
