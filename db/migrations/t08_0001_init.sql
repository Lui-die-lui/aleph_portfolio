-- Task t08: passkey-protected PRIVATE ARCHIVE
-- All new tables use the t08_ prefix so they cannot collide with existing tables.
-- Run with `npm run t08:migrate` (uses SUPABASE_CONNECTION_KEY).

create extension if not exists pgcrypto;

-- Accounts. No email/phone/real personal data — a username and a display
-- name only, per the task's "no real personal info in this table" rule.
create table if not exists t08_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- WebAuthn public keys. Never a private key or password hash.
-- One user can register many passkeys (multi-device support).
create table if not exists t08_passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references t08_users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  transports text,
  device_type text,
  backed_up boolean not null default false,
  device_name text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists t08_passkeys_user_id_idx on t08_passkeys (user_id);

-- WebAuthn challenges. Only a hash of the challenge is stored (never the
-- plaintext) so a DB read alone can't be replayed into a valid response.
-- user_id is nullable because authentication challenges are usernameless
-- (discoverable credentials) until the browser picks a credential.
create table if not exists t08_auth_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references t08_users(id) on delete cascade,
  challenge_hash text not null,
  purpose text not null check (purpose in ('registration', 'authentication')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists t08_auth_challenges_hash_idx on t08_auth_challenges (challenge_hash);

-- Server-issued opaque sessions. Only the HMAC hash of the session token is
-- stored; the raw token only ever lives in the HttpOnly cookie.
create table if not exists t08_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references t08_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists t08_sessions_user_id_idx on t08_sessions (user_id);

-- Fictional private records shown only after a verified passkey login.
create table if not exists t08_private_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references t08_users(id) on delete cascade,
  title text not null,
  content text not null,
  category text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists t08_private_items_user_id_idx on t08_private_items (user_id);

-- Extra table beyond the task's baseline five, needed because passwords,
-- email and OAuth are all disallowed: this is how a *second* account (for
-- the ownership-isolation test) or an operator's own first passkey get
-- created without an open, guessable signup endpoint. Only the SHA-256/HMAC
-- hash of the invite token is stored; the plaintext token is shown once at
-- creation time (CLI output) and never persisted.
create table if not exists t08_invite_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  purpose text not null default 'registration',
  intended_username text not null,
  intended_display_name text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Row Level Security is enabled for defense in depth, but the API connects
-- with the Postgres connection string's role (a superuser-equivalent via
-- the Supabase pooler), which bypasses RLS entirely. No policies are
-- defined for anon/authenticated roles, so nothing here is reachable
-- through PostgREST or a Supabase client key. Real ownership enforcement
-- happens in the t08 API layer using the session's user_id — see
-- docs/t08/AUTH_IMPLEMENTATION.md.
alter table t08_users enable row level security;
alter table t08_passkeys enable row level security;
alter table t08_auth_challenges enable row level security;
alter table t08_sessions enable row level security;
alter table t08_private_items enable row level security;
alter table t08_invite_tokens enable row level security;
