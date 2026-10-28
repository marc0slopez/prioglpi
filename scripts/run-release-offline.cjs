// Explicit offline allowlist. No arbitrary entrypoint or native connections allowed.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith('@/')) request = path.join(__dirname, '..', request.slice(2));
  return originalResolve.call(this, request, parent, ...rest);
};
const allowed = [
  'test-ranking-production-guard-offline.ts',
  'test-operational-ranking-mutation-service-offline.ts',
  'test-operational-ranking-read-repository-offline.ts',
  'test-operational-ranking-write-repository-offline.ts',
  'test-operational-ranking-mutation-routes-offline.ts',
  'test-operational-ranking-mutation-routes-functional-offline.ts',
  'test-logger-offline.ts',
  'sql-server/run-ranking-migration.test.ts'
];
const file = process.argv[2];
if (process.argv.length !== 3 || !allowed.includes(file)) throw new Error('Offline allowlisted suite required');
const filename = path.join(__dirname, file);
require.extensions['.ts'] = (module, name) => {
  const output = ts.transpileModule(fs.readFileSync(name, 'utf8'), {
    fileName: name, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  });
  module._compile(output.outputText, name);
};
const entry = new Module(filename);
entry.filename = filename;
entry.paths = Module._nodeModulePaths(path.dirname(filename));
process.mainModule = entry;
entry.load(filename);
