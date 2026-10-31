import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export function loadTypeScript(relativePath, dependencies = {}) {
  const filename = path.resolve(process.cwd(), relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText.replace(/\brequire\s*\(/g, "loadDependency(");
  const compiledModule = { exports: {} };
  const loadDependency = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(dependencies, specifier)) return dependencies[specifier];
    if (specifier.endsWith(".json")) return JSON.parse(fs.readFileSync(path.resolve(path.dirname(filename), specifier), "utf8"));
    throw new Error(`Unexpected runtime dependency in test harness: ${specifier}`);
  };
  new Function("loadDependency", "moduleRecord", "exports", output)(loadDependency, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
