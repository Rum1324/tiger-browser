import postgres from 'postgres'

export type Sql = postgres.Sql
export type TxSql = postgres.TransactionSql
/** A query fragment, e.g. a WHERE clause built with sql`...` and spliced into another query. */
export type Fragment = postgres.Fragment

export interface SqlOptions {
  max?: number
  /** Postgres search_path; tests point it at a per-file schema. */
  searchPath?: string
  onNotice?: (message: string) => void
}

export function createSql(url: string, opts: SqlOptions = {}): Sql {
  return postgres(url, {
    max: opts.max ?? 10,
    onnotice: (n) => opts.onNotice?.(String(n.message)),
    connection: {
      application_name: 'tiger-server',
      ...(opts.searchPath ? { search_path: opts.searchPath } : {}),
    },
  })
}
