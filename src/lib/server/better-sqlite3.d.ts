// NOTE: Module augmentation doesn't work cleanly with @types/better-sqlite3's
// `export = Database` — any `export default` in the augmentation breaks the
// namespace merge (Database.Database, Database.Statement).
//
// Fixed via `verbatimModuleSyntax: false` override in root tsconfig.json,
// which lets esModuleInterop handle the export= → default import conversion.
