import type { SiteAuditOptions } from './audit.js'

/** Reusable audit configuration. The CLI may supply directory separately with --site. */
export type AuditConfig = Omit<SiteAuditOptions, 'directory'> & { directory?: string }

/** Define a reusable, strongly typed built-site audit configuration. */
export const defineAuditConfig = <T extends AuditConfig>(config: T): T => config
