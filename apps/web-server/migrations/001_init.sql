-- Prototype Studio 网页端元数据数据库（仅元数据；项目文件在磁盘空间，不以数据库为事实源）
create table if not exists users (
  id uuid primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists invite_codes (
  code text primary key,
  consumed_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  user_id uuid not null references users(id),
  expires_at timestamptz not null
);

create table if not exists api_tokens (
  token text primary key,
  user_id uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key,
  owner_id uuid not null references users(id),
  name text not null,
  description text,
  status text not null default 'active',
  space_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_members (
  project_id uuid not null references projects(id),
  user_id uuid not null references users(id),
  role text not null,
  primary key (project_id, user_id)
);

create table if not exists share_links (
  id uuid primary key,
  project_id uuid not null references projects(id),
  token text not null unique,
  mode text not null,
  created_by uuid references users(id),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- 兼容旧库：早期版本没有 created_at 列
alter table share_links add column if not exists created_at timestamptz not null default now();

create table if not exists audit_index (
  id bigserial primary key,
  project_id uuid not null references projects(id),
  object_type text not null,
  revision_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_index_project_created on audit_index (project_id, created_at);
