-- Survey content schema (scales, scale options, rounds, sections, statements)
-- plus Round 1's data, seeded verbatim from .planning/SURVEY-CONTENT.md.
--
-- No BEGIN/COMMIT: the Supabase CLI wraps each migration file in its own
-- transaction already. All data inserts use `on conflict ... do nothing` so
-- this migration can be replayed safely against a database that already has
-- it applied (idempotent, per FND-03).
--
-- Once this migration has been applied to the hosted project, NEVER edit it
-- again — fixes are forward migrations (see plan 01-03 Task 2, step (d)).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.scales (
  key text primary key,
  name text not null,
  constraint scales_key_shape check (key ~ '^[a-z][a-z0-9_]*$')
);

create table if not exists public.scale_options (
  scale_key text not null references public.scales(key) on delete cascade,
  value smallint not null,
  label text not null,
  constraint scale_options_value_range check (value between 1 and 10),
  primary key (scale_key, value)
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  round_number integer not null,
  title text not null,
  opens_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  constraint rounds_round_number_unique unique (round_number),
  constraint rounds_round_number_positive check (round_number > 0),
  constraint rounds_title_not_blank check (length(btrim(title)) > 0),
  constraint rounds_dates_ordered check (
    opens_at is null or closes_at is null or closes_at > opens_at
  )
);

create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  sort_order smallint not null,
  title text not null,
  prompt text not null,
  scale_key text not null references public.scales(key),
  constraint sections_sort_order_positive check (sort_order > 0),
  constraint sections_round_sort_order_unique unique (round_id, sort_order),
  constraint sections_id_round_id_unique unique (id, round_id)
);

create table if not exists public.statements (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null,
  section_id uuid not null,
  sort_order smallint not null,
  key text not null,
  text text not null,
  constraint statements_section_round_fk
    foreign key (section_id, round_id)
    references public.sections(id, round_id)
    on delete cascade,
  constraint statements_sort_order_positive check (sort_order > 0),
  constraint statements_key_shape check (key ~ '^[a-z][a-z0-9_]*$'),
  constraint statements_text_not_blank check (length(btrim(text)) > 0),
  constraint statements_section_sort_order_unique unique (section_id, sort_order),
  constraint statements_round_key_unique unique (round_id, key)
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.scales enable row level security;
alter table public.scale_options enable row level security;
alter table public.rounds enable row level security;
alter table public.sections enable row level security;
alter table public.statements enable row level security;

create policy scales_select_signed_in
  on public.scales
  for select
  to authenticated
  using (true);

create policy scale_options_select_signed_in
  on public.scale_options
  for select
  to authenticated
  using (true);

create policy rounds_select_admins
  on public.rounds
  for select
  to authenticated
  using (public.is_admin());

create policy sections_select_admins
  on public.sections
  for select
  to authenticated
  using (public.is_admin());

create policy statements_select_admins
  on public.statements
  for select
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Data: scales + scale_options (labels verbatim from SURVEY-CONTENT.md)
-- ---------------------------------------------------------------------------

insert into public.scales (key, name)
values
  ('familiarity', 'Familiarity'),
  ('agreement', 'Agreement')
on conflict (key) do nothing;

insert into public.scale_options (scale_key, value, label)
values
  ('familiarity', 1, $t$I've never heard of it$t$),
  ('familiarity', 2, $t$I've heard of it but couldn't explain it$t$),
  ('familiarity', 3, $t$I could explain it simply$t$),
  ('familiarity', 4, $t$I understand it well and could use it in my work$t$),
  ('agreement', 1, $t$Strongly disagree$t$),
  ('agreement', 2, $t$Disagree$t$),
  ('agreement', 3, $t$Neither$t$),
  ('agreement', 4, $t$Agree$t$),
  ('agreement', 5, $t$Strongly agree$t$)
on conflict (scale_key, value) do nothing;

-- ---------------------------------------------------------------------------
-- Data: Round 1 (draft, no dates)
-- ---------------------------------------------------------------------------

insert into public.rounds (round_number, title)
values (1, 'Round 1')
on conflict (round_number) do nothing;

-- ---------------------------------------------------------------------------
-- Data: Round 1 sections + statements, generated mechanically from
-- .planning/SURVEY-CONTENT.md by a throwaway script (never committed to the
-- repo — see plan 01-03 Task 2 step (b)). DO NOT hand-edit the value lists
-- below; regenerate from SURVEY-CONTENT.md if a correction is ever needed in
-- a NEW forward migration.
-- ---------------------------------------------------------------------------

insert into public.sections (round_id, sort_order, title, prompt, scale_key)
select r.id, v.sort_order, v.title, v.prompt, v.scale_key
from public.rounds r
join (
  values
    (1, $t$The language of design and change$t$, $t$How familiar are you with the following ideas?$t$, 'familiarity'),
    (2, $t$Sustainability, scepticism and possibility$t$, $t$Thinking about sustainability in products and design, how much do you agree with the following?$t$, 'agreement'),
    (3, $t$What might design be for?$t$, $t$Thinking about what design is and what it could be, how much do you agree with the following?$t$, 'agreement'),
    (4, $t$Values, security and my future$t$, $t$Thinking about your future as a designer, how much do you agree with the following?$t$, 'agreement'),
    (5, $t$Grades, recognition and risk$t$, $t$Thinking about grades and assessment, how much do you agree with the following?$t$, 'agreement'),
    (6, $t$Not knowing, effort and learning$t$, $t$Thinking about what happens when learning becomes difficult, how much do you agree with the following?$t$, 'agreement'),
    (7, $t$AI, possibility and becoming a designer$t$, $t$Thinking about AI and the designer you are becoming, how much do you agree with the following?$t$, 'agreement'),
    (0, $t$__sentinel__$t$, $t$__sentinel__$t$, 'agreement')
) as v(sort_order, title, prompt, scale_key)
  on true
where r.round_number = 1
  and v.sort_order > 0
on conflict (round_id, sort_order) do nothing;

insert into public.statements (round_id, section_id, sort_order, key, text)
select r.id, s.id, v.stmt_sort_order, v.key, v.text
from public.rounds r
join public.sections s on s.round_id = r.id
join (
  values
    (1, 1, 's1_01', $t$Sustainability$t$),
    (1, 2, 's1_02', $t$Greenwashing$t$),
    (1, 3, 's1_03', $t$Carbon footprint$t$),
    (1, 4, 's1_04', $t$Life Cycle Assessment (LCA)$t$),
    (1, 5, 's1_05', $t$Eco-design$t$),
    (1, 6, 's1_06', $t$Design for disassembly$t$),
    (1, 7, 's1_07', $t$Circular economy$t$),
    (1, 8, 's1_08', $t$Cradle to Cradle$t$),
    (1, 9, 's1_09', $t$Regenerative design$t$),
    (1, 10, 's1_10', $t$Design activism$t$),
    (1, 11, 's1_11', $t$Inclusive design$t$),
    (1, 12, 's1_12', $t$More-than-human design$t$),
    (1, 13, 's1_13', $t$Systemic design$t$),
    (1, 14, 's1_14', $t$Design for Planet$t$),
    (1, 15, 's1_15', $t$Three Horizons$t$),
    (1, 16, 's1_16', $t$Digital Product Passport$t$),
    (2, 1, 's2_01', $t$Sustainability is an important part of good design.$t$),
    (2, 2, 's2_02', $t$I actively look for information about the environmental impact of products.$t$),
    (2, 3, 's2_03', $t$I am sceptical when brands describe a product as sustainable.$t$),
    (2, 4, 's2_04', $t$I trust environmental claims when they are supported by clear evidence.$t$),
    (2, 5, 's2_05', $t$Sustainability claims often feel more like marketing than meaningful change.$t$),
    (2, 6, 's2_06', $t$Designers have a responsibility to understand the wider consequences of what they create.$t$),
    (2, 7, 's2_07', $t$Making individual products more sustainable can feel inadequate when the wider systems that produce them remain unchanged.$t$),
    (2, 8, 's2_08', $t$I believe design can move beyond doing less harm towards helping people and the living world thrive.$t$),
    (3, 1, 's3_01', $t$A designer creates interesting work through their own creativity.$t$),
    (3, 2, 's3_02', $t$Design should create beautiful, desirable and useful things.$t$),
    (3, 3, 's3_03', $t$Design should contribute to successful businesses and livelihoods.$t$),
    (3, 4, 's3_04', $t$Designers should be able to bring their values and beliefs into their work.$t$),
    (3, 5, 's3_05', $t$Design can challenge the systems and assumptions that shape how we live.$t$),
    (3, 6, 's3_06', $t$Design gives us a way to imagine futures that don't exist yet.$t$),
    (3, 7, 's3_07', $t$The most interesting work can emerge when designers work with people who know things they don't.$t$),
    (3, 8, 's3_08', $t$I am excited by the idea of working with different disciplines, cultures and communities.$t$),
    (3, 9, 's3_09', $t$Working with other people can make design slower, messier and more difficult.$t$),
    (3, 10, 's3_10', $t$I would like to make things with other people that none of us could have imagined or realised alone.$t$),
    (3, 11, 's3_11', $t$I want my work to be recognised and for people to know who made it.$t$),
    (3, 12, 's3_12', $t$I believe design can contribute to meaningful social and environmental change.$t$),
    (4, 1, 's4_01', $t$I feel able to bring my values into my design practice.$t$),
    (4, 2, 's4_02', $t$I expect my beliefs and values to change through the work I do.$t$),
    (4, 3, 's4_03', $t$I believe I can find work that aligns with my values.$t$),
    (4, 4, 's4_04', $t$I feel I may have to compromise some of my values to find secure employment.$t$),
    (4, 5, 's4_05', $t$Finding secure work feels more important than finding work that reflects my values.$t$),
    (4, 6, 's4_06', $t$I want to do work that feels important to me.$t$),
    (4, 7, 's4_07', $t$I want to be recognised for doing exceptional work.$t$),
    (4, 8, 's4_08', $t$I feel hopeful about the contribution I could make through my work.$t$),
    (4, 9, 's4_09', $t$I worry that the kind of work I want to do may not be the kind of work employers want.$t$),
    (4, 10, 's4_10', $t$I don't really know yet what kind of designer I want to become.$t$),
    (5, 1, 's5_01', $t$Getting a good grade makes me feel safe.$t$),
    (5, 2, 's5_02', $t$I feel relieved when I get a good grade.$t$),
    (5, 3, 's5_03', $t$When I work really hard, I feel I deserve a good grade.$t$),
    (5, 4, 's5_04', $t$A disappointing grade can make me feel that I am not good enough.$t$),
    (5, 5, 's5_05', $t$I want to know exactly what is expected of me so I know how to succeed.$t$),
    (5, 6, 's5_06', $t$Sometimes I focus more on what will get a good grade than on what I might discover.$t$),
    (5, 7, 's5_07', $t$Knowing my work will be graded can make me less willing to try something that might fail.$t$),
    (5, 8, 's5_08', $t$I compare my grades with other people's, even when I don't want to.$t$),
    (5, 9, 's5_09', $t$Sometimes I look for the “right” answer when I don't know what to do.$t$),
    (5, 10, 's5_10', $t$I admire people who take creative risks more easily than I take them myself.$t$),
    (5, 11, 's5_11', $t$The work that excites me most often does something I wasn't expecting.$t$),
    (5, 12, 's5_12', $t$Some of the work I am most proud of began with not knowing whether it would work.$t$),
    (5, 13, 's5_13', $t$I sometimes wish my work could be assessed without being given a grade.$t$),
    (5, 14, 's5_14', $t$I sometimes wonder whether I would work as hard if nobody was going to assess or recognise the work.$t$),
    (6, 1, 's6_01', $t$Not understanding something can make me angry or frustrated.$t$),
    (6, 2, 's6_02', $t$When I don't understand something, I sometimes wonder whether I'm good enough.$t$),
    (6, 3, 's6_03', $t$I find it difficult to put effort into something when I can't see the point of doing it.$t$),
    (6, 4, 's6_04', $t$I find it easier to commit to something when I know what the outcome will be.$t$),
    (6, 5, 's6_05', $t$I hate spending time on research or ideas that don't end up in my final work.$t$),
    (6, 6, 's6_06', $t$I like to feel that I am using my time efficiently.$t$),
    (6, 7, 's6_07', $t$I don't mind exploring an idea that ultimately leads nowhere.$t$),
    (6, 8, 's6_08', $t$Sometimes I need to trust that something might become valuable before I understand why I'm doing it.$t$),
    (6, 9, 's6_09', $t$When I'm stuck, I want an answer quickly.$t$),
    (6, 10, 's6_10', $t$I sometimes look for an answer before I've really understood the question.$t$),
    (6, 11, 's6_11', $t$I sometimes avoid work when I can't see how it will be recognised, rewarded or used.$t$),
    (6, 12, 's6_12', $t$I can stay with confusion long enough for something unexpected to emerge.$t$),
    (6, 13, 's6_13', $t$I sometimes discover the value of something only after I've done it.$t$),
    (7, 1, 's7_01', $t$Sometimes I wonder why I should struggle with something when AI can do it for me.$t$),
    (7, 2, 's7_02', $t$AI can make it tempting to skip parts of the work that feel difficult.$t$),
    (7, 3, 's7_03', $t$Sometimes I use AI because I don't want to struggle with something.$t$),
    (7, 4, 's7_04', $t$AI allows me to attempt things I couldn't achieve on my own.$t$),
    (7, 5, 's7_05', $t$I am excited by how much more ambitious AI could allow my work to become.$t$),
    (7, 6, 's7_06', $t$Sometimes an answer from AI feels convincing enough that I stop asking questions.$t$),
    (7, 7, 's7_07', $t$I wonder what I might fail to learn if AI always helps me when I get stuck.$t$),
    (7, 8, 's7_08', $t$I worry about whether there will still be a place for designers like me as AI becomes more capable.$t$),
    (7, 9, 's7_09', $t$I think the things that make a designer valuable will change during my career.$t$),
    (7, 10, 's7_10', $t$I don't yet know what abilities I will need to become the designer I want to be.$t$),
    (7, 11, 's7_11', $t$The more I learn about design, the more I realise there is that I don't know.$t$),
    (7, 12, 's7_12', $t$I am excited by the possibility that my understanding of design might be very different in three years' time.$t$),
    (0, 0, '__sentinel__', $t$__sentinel__$t$)
) as v(section_sort_order, stmt_sort_order, key, text)
  on v.section_sort_order = s.sort_order
where r.round_number = 1
  and v.section_sort_order > 0
on conflict (round_id, key) do nothing;
