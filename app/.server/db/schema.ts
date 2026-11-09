// Row types for Kysely. Column names are snake_case, exactly as in the database.
// Portability rules (CLAUDE.md): text UUIDv7 ids, text ISO dates/timestamps,
// integer 0/1 booleans, integer money in minor units, JSON stored as text.
//
// Exception: Better Auth's tables (user, session, account, verification) use the
// column types Better Auth expects per dialect (boolean/timestamptz on Postgres).
// We only declare the user columns we read ourselves.

/** `YYYY-MM-DD` */
export type DateString = string;
/** ISO-8601 UTC timestamp, e.g. `2026-11-09T12:00:00.000Z` */
export type Timestamp = string;
/** 0 | 1 */
export type IntBool = number;

export interface UserTable {
  id: string;
  name: string;
  email: string;
}

export interface DomainTable {
  id: string;
  user_id: string;
  /** lowercase punycode */
  name: string;
  source: "manual" | "registrar";
  registrar_connection_id: string | null;
  registrar_name: string | null;
  registered_at: DateString | null;
  expires_at: DateString | null;
  auto_renew: IntBool | null;
  renewal_price_minor: number | null;
  currency: string | null;
  /** JSON string[] */
  nameservers: string;
  /** JSON string[] */
  statuses: string;
  notes: string | null;
  rdap_checked_at: Timestamp | null;
  rdap_error: string | null;
  registrar_missing_since: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TagTable {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  created_at: Timestamp;
}

export interface DomainTagTable {
  domain_id: string;
  tag_id: string;
}

export interface RegistrarConnectionTable {
  id: string;
  user_id: string;
  provider: "cloudflare" | "porkbun" | "godaddy";
  label: string;
  /** AES-256-GCM, see app/.server/crypto.ts */
  credentials_enc: string;
  last_sync_at: Timestamp | null;
  last_sync_error: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface NotificationSettingsTable {
  user_id: string;
  email_enabled: IntBool;
  /** JSON number[] */
  days_before: string;
  /** IANA timezone name */
  timezone: string;
  updated_at: Timestamp;
}

export interface NotificationLogTable {
  id: string;
  domain_id: string;
  expires_at: DateString;
  days_before: number;
  sent_at: Timestamp;
}

export interface Database {
  user: UserTable;
  domain: DomainTable;
  tag: TagTable;
  domain_tag: DomainTagTable;
  registrar_connection: RegistrarConnectionTable;
  notification_settings: NotificationSettingsTable;
  notification_log: NotificationLogTable;
}
