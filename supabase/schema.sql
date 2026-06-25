create table if not exists performing_projects (
  id uuid primary key default gen_random_uuid(),
  week text not null default to_char(now(), 'IYYY-"W"IW'),
  status text not null check (status in ('개찰', '진행중')),
  name text not null default '',
  director text not null default '',
  submit_date date,
  interview_date date,
  result_date date,
  fee numeric(10,2),
  note text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists expected_projects (
  id uuid primary key default gen_random_uuid(),
  week text not null default to_char(now(), 'IYYY-"W"IW'),
  name text not null default '',
  client text not null default '',
  director text not null default '',
  project_cost numeric(10,2),
  order_month text not null default '',
  fee numeric(10,2),
  note text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists weekly_meta (
  id uuid primary key default gen_random_uuid(),
  week text not null unique,
  education_note text not null default '',
  other_note text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
