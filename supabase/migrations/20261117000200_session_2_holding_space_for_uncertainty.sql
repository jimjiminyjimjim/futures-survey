-- Quick task 261117-eak (Session 2: Holding space for uncertainty) --
-- migration 2 of 2, CONTENT. Replaces the unopened Session 2 placeholder
-- round (id dc9e20b9-ce48-4046-9100-b6b7c5dca6a0, "Session 2: Values,
-- grades and not knowing", 5 sections / 47 statements, no responses) with
-- the client's Session 2 content: 9 sections / 38 statements, the new
-- importance_change scale, a new title and the Session 1 style intro.
--
-- DEPENDS ON 20261117000100_ranking_kind_and_round_consent.sql (the
-- 'ranking' statement kind). The whole file is ONE DO block, so it is
-- atomic whatever the runner does, and it refuses to run unless the guards
-- below all hold.
--
-- It NEVER touches Sessions 1 or 3, responses, answers, results consent,
-- allowed domains or admins: a before/after fingerprint over all of those
-- is compared inside the block and the block raises if it differs.
--
-- The content-lock triggers sections_before_write / statements_before_write
-- fire on INSERT and UPDATE only, NEVER on DELETE, so nothing would stop a
-- mis-scoped delete. That is why the single DELETE below is scoped by the
-- guarded round id and its row count is checked. The triggers are not
-- disabled: round 2 is an unopened draft (opens_at is null), so they allow
-- these inserts.
--
-- The round is NOT opened here and no dates are written. Open it later with
-- the admin "Open now" button.
--
-- Forward-only: no BEGIN/COMMIT (the Supabase CLI/MCP wraps each migration
-- file in its own transaction), and $t$...$t$ dollar quoting for every text
-- literal. The version prefix of this file is a working name and may be
-- renamed to the version Supabase records.
--
-- Once this migration has been applied to the hosted project, NEVER edit it
-- again -- fixes are forward migrations.

do $$
declare
  v_round_id uuid;
  v_s1 uuid;
  v_s3 uuid;
  v_opens timestamptz;
  v_closes timestamptz;
  v_title text;
  v_n int;
  v_n2 int;
  v_def text;
  v_fp_before text;
  v_fp_after text;
  v_check text;
  v_sec_a uuid;
  v_sec_b1 uuid;
  v_sec_b2 uuid;
  v_sec_c uuid;
  v_sec_d uuid;
  v_sec_e uuid;
  v_sec_f uuid;
  v_sec_g uuid;
  v_sec_h uuid;
begin
  -- -------------------------------------------------------------------------
  -- Guards: refuse (and change nothing) unless round 2 is the untouched draft.
  -- -------------------------------------------------------------------------

  select r.id into v_round_id
  from public.rounds r
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$
    and r.session_number = 2;

  if v_round_id is distinct from 'dc9e20b9-ce48-4046-9100-b6b7c5dca6a0'::uuid then
    raise exception 'session_2_content: Session 2 round is not dc9e20b9-ce48-4046-9100-b6b7c5dca6a0 (got %)', v_round_id;
  end if;

  select r.id into v_s1
  from public.rounds r
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$
    and r.session_number = 1;

  select r.id into v_s3
  from public.rounds r
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$
    and r.session_number = 3;

  if v_s1 is distinct from '6bf90e9e-c628-4592-8e39-cc9c16440ea3'::uuid then
    raise exception 'session_2_content: Session 1 round is not 6bf90e9e-c628-4592-8e39-cc9c16440ea3 (got %)', v_s1;
  end if;

  if v_s3 is distinct from '4091c2db-539a-4a35-8e73-93322be5bd0a'::uuid then
    raise exception 'session_2_content: Session 3 round is not 4091c2db-539a-4a35-8e73-93322be5bd0a (got %)', v_s3;
  end if;

  select r.opens_at, r.closes_at, r.title into v_opens, v_closes, v_title
  from public.rounds r
  where r.id = v_round_id;

  if v_opens is not null or v_closes is not null then
    raise exception 'session_2_content: Session 2 already has an open or close date';
  end if;

  if v_title is distinct from $t$Session 2: Values, grades and not knowing$t$ then
    raise exception 'session_2_content: Session 2 title is not the untouched placeholder (got %)', v_title;
  end if;

  select count(*) into v_n from public.responses where round_id = v_round_id;
  select count(*) into v_n2 from public.answers where round_id = v_round_id;

  if v_n <> 0 or v_n2 <> 0 then
    raise exception 'session_2_content: Session 2 already has responses/answers (%/%) -- refusing', v_n, v_n2;
  end if;

  select count(*) into v_n from public.sections where round_id = v_round_id;
  select count(*) into v_n2 from public.statements where round_id = v_round_id;

  if v_n <> 5 or v_n2 <> 47 then
    raise exception 'session_2_content: expected 5 sections / 47 statements in Session 2, found %/%', v_n, v_n2;
  end if;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conname = 'statements_kind_valid'
    and c.conrelid = 'public.statements'::regclass;

  if v_def is null or position('ranking' in v_def) = 0 then
    raise exception 'session_2_content: the ranking kind is missing -- apply 20261117000100 first';
  end if;

  if exists (select 1 from public.scales where key = $t$importance_change$t$) then
    raise exception 'session_2_content: scale importance_change already exists';
  end if;

  -- -------------------------------------------------------------------------
  -- Fingerprint (before): everything this file must NOT change.
  -- -------------------------------------------------------------------------

  v_fp_before := (
    -- fingerprint:begin
    select md5(concat_ws('|',
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.id), '') from public.surveys x),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.id), '') from public.rounds x where x.id <> v_round_id),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.id), '') from public.sections x where x.round_id <> v_round_id),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.id), '') from public.statements x where x.round_id <> v_round_id),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.key), '') from public.scales x where x.key <> $t$importance_change$t$),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.scale_key, x.value), '') from public.scale_options x where x.scale_key <> $t$importance_change$t$),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.id), '') from public.responses x),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.id), '') from public.answers x),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.user_id), '') from public.results_consent x),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.domain), '') from public.allowed_domains x),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.email), '') from public.admin_emails x)
    ))
    -- fingerprint:end
  );

  -- -------------------------------------------------------------------------
  -- 1. Delete ONLY round 2's sections (its statements cascade). This is the
  --    file's only DELETE.
  -- -------------------------------------------------------------------------

  delete from public.sections
  where round_id = v_round_id;

  get diagnostics v_n = row_count;

  if v_n <> 5 then
    raise exception 'session_2_content: expected to delete 5 Session 2 sections, deleted %', v_n;
  end if;

  select count(*) into v_n from public.statements where round_id = v_round_id;

  if v_n <> 0 then
    raise exception 'session_2_content: % Session 2 statements survived the section delete', v_n;
  end if;

  -- -------------------------------------------------------------------------
  -- 2. The importance_change scale (B2). The shared agreement scale and every
  --    other scale row stay exactly as they are.
  -- -------------------------------------------------------------------------

  insert into public.scales (key, name)
  values ($t$importance_change$t$, $t$Importance compared with today$t$);

  insert into public.scale_options (scale_key, value, label)
  values
    ($t$importance_change$t$, 1, $t$Much less important$t$),
    ($t$importance_change$t$, 2, $t$Less important$t$),
    ($t$importance_change$t$, 3, $t$About the same$t$),
    ($t$importance_change$t$, 4, $t$More important$t$),
    ($t$importance_change$t$, 5, $t$Much more important than today$t$);

  -- -------------------------------------------------------------------------
  -- 3. Sections A, B1, B2, C-H (sort_order 1-9, none grouped). B1 and B2 are
  --    two parts of ONE question; both are shown as "B." with no parent line
  --    (parent_title stays null: it would only repeat B1's own title).
  -- -------------------------------------------------------------------------

  insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, grouped, show_overview)
  values (v_round_id, 1, $t$A$t$, null,
    $t$What do employers value?$t$,
    $t$Which capabilities do you believe employers value most in graduate designers? Rank from most to least important.$t$,
    $t$agreement$t$, false, false)
  returning id into v_sec_a;

  insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, grouped, show_overview)
  values (v_round_id, 2, $t$B1$t$, null,
    $t$In a world of AI, what will matter most for designers?$t$,
    $t$Rank from most to least important.$t$,
    $t$agreement$t$, false, false)
  returning id into v_sec_b1;

  insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, grouped, show_overview)
  values (v_round_id, 3, $t$B2$t$, null,
    $t$Learning for a world with AI$t$,
    $t$Jeanette Winterson argues that AI is “much more than a tool”. If AI can take on much of the work designers do today, how important will it be to learn each of these?$t$,
    $t$importance_change$t$, false, false)
  returning id into v_sec_b2;

  insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, grouped, show_overview)
  values (v_round_id, 4, $t$C$t$, null,
    $t$What do I most want to learn while at CSM?$t$,
    $t$Rank from most to least important to you.$t$,
    $t$agreement$t$, false, false)
  returning id into v_sec_c;

  insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, grouped, show_overview)
  values (v_round_id, 5, $t$D$t$, null,
    $t$What makes it hard to focus on the learning?$t$,
    $t$What makes it hard to focus on the learning?$t$,
    $t$agreement$t$, false, true)
  returning id into v_sec_d;

  insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, grouped, show_overview)
  values (v_round_id, 6, $t$E$t$, null,
    $t$Grades, learning and me$t$,
    $t$Thinking about your experience of grades and assessment, how much do you agree?$t$,
    $t$agreement$t$, false, false)
  returning id into v_sec_e;

  insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, grouped, show_overview)
  values (v_round_id, 7, $t$F$t$, null,
    $t$When I don’t know what to do$t$,
    $t$You’re working on a project, the hand-in is three weeks away and you still don’t have a clear direction… How do you usually respond?$t$,
    $t$agreement$t$, false, true)
  returning id into v_sec_f;

  insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, grouped, show_overview)
  values (v_round_id, 8, $t$G$t$, null,
    $t$AI, my mind and me$t$,
    $t$How much do you agree?$t$,
    $t$agreement$t$, false, false)
  returning id into v_sec_g;

  insert into public.sections (round_id, sort_order, label, parent_title, title, prompt, scale_key, grouped, show_overview)
  values (v_round_id, 9, $t$H$t$, null,
    $t$What can we agree on as a room?$t$,
    $t$Rank from most to least important.$t$,
    $t$agreement$t$, false, true)
  returning id into v_sec_h;

  -- -------------------------------------------------------------------------
  -- 4. Statements (38). Ranking sections hold ONE ranking statement whose
  --    text is the section prompt and whose options are the items in the
  --    client's order.
  -- -------------------------------------------------------------------------

  -- A: ranking, 8 items
  insert into public.statements (round_id, section_id, sort_order, key, text, kind, options)
  values (v_round_id, v_sec_a, 1, $t$s2_a_01$t$,
    $t$Which capabilities do you believe employers value most in graduate designers? Rank from most to least important.$t$,
    $t$ranking$t$,
    jsonb_build_array(
      jsonb_build_object('value', 1, 'label', $t$Analytical thinking: examining evidence and questioning assumptions$t$),
      jsonb_build_object('value', 2, 'label', $t$Resilience and adaptability: responding constructively to setbacks and change$t$),
      jsonb_build_object('value', 3, 'label', $t$Complex problem-solving: navigating unfamiliar, interconnected challenges$t$),
      jsonb_build_object('value', 4, 'label', $t$Creative thinking: developing original ideas and alternative approaches$t$),
      jsonb_build_object('value', 5, 'label', $t$Technical competence: sketching, CAD, materials, manufacturing and making$t$),
      jsonb_build_object('value', 6, 'label', $t$Curiosity and lifelong learning: asking questions and developing new knowledge$t$),
      jsonb_build_object('value', 7, 'label', $t$Collaboration and communication: working with others and sharing ideas effectively$t$),
      jsonb_build_object('value', 8, 'label', $t$Reliability and professionalism: meeting commitments and delivering work$t$)
    ));

  -- B1: ranking, 6 items
  insert into public.statements (round_id, section_id, sort_order, key, text, kind, options)
  values (v_round_id, v_sec_b1, 1, $t$s2_b1_01$t$,
    $t$Rank from most to least important.$t$,
    $t$ranking$t$,
    jsonb_build_array(
      jsonb_build_object('value', 1, 'label', $t$Knowing how to use AI tools well$t$),
      jsonb_build_object('value', 2, 'label', $t$Judgement and taste: knowing when something is right, not just good enough$t$),
      jsonb_build_object('value', 3, 'label', $t$Craft and making: understanding materials, form and how things are actually made$t$),
      jsonb_build_object('value', 4, 'label', $t$Framing the right problem before solving it$t$),
      jsonb_build_object('value', 5, 'label', $t$Responsibility: weighing the consequences of what we design$t$),
      jsonb_build_object('value', 6, 'label', $t$Curiosity and the ability to keep learning as everything changes$t$)
    ));

  -- B2: importance_change scale, 6 statements
  insert into public.statements (round_id, section_id, sort_order, key, text, kind)
  values
    (v_round_id, v_sec_b2, 1, $t$s2_b2_01$t$, $t$Critical judgement: deciding which questions are worth asking, and questioning what AI gives back, including the assumptions and biases built into it$t$, $t$scale$t$),
    (v_round_id, v_sec_b2, 2, $t$s2_b2_02$t$, $t$Imagination: picturing what doesn’t exist yet, rather than recombining what already does$t$, $t$scale$t$),
    (v_round_id, v_sec_b2, 3, $t$s2_b2_03$t$, $t$Feeling and empathy: understanding what people feel and need, something machines don’t experience$t$, $t$scale$t$),
    (v_round_id, v_sec_b2, 4, $t$s2_b2_04$t$, $t$Making and materials: knowing how things are physically made, used and repaired$t$, $t$scale$t$),
    (v_round_id, v_sec_b2, 5, $t$s2_b2_05$t$, $t$Working with AI: directing it towards human purposes, not just using it$t$, $t$scale$t$),
    (v_round_id, v_sec_b2, 6, $t$s2_b2_06$t$, $t$Responsibility: deciding what should be made, who benefits, and who might be left behind$t$, $t$scale$t$);

  -- C: ranking, 6 items
  insert into public.statements (round_id, section_id, sort_order, key, text, kind, options)
  values (v_round_id, v_sec_c, 1, $t$s2_c_01$t$,
    $t$Rank from most to least important to you.$t$,
    $t$ranking$t$,
    jsonb_build_array(
      jsonb_build_object('value', 1, 'label', $t$Design and make things really well: practical skills I can rely on$t$),
      jsonb_build_object('value', 2, 'label', $t$Dive into complex projects without knowing where they’ll end up, and find my way through$t$),
      jsonb_build_object('value', 3, 'label', $t$Resist easy answers: dig into research, history and evidence until I find real insight$t$),
      jsonb_build_object('value', 4, 'label', $t$Follow bold ideas and make mistakes without fear, because that’s where the best learning happens$t$),
      jsonb_build_object('value', 5, 'label', $t$Trust my own judgement and stand up for what I believe, even with a client or industry partner$t$),
      jsonb_build_object('value', 6, 'label', $t$Discover what I care about and the kind of designer I want to become$t$)
    ));

  -- D: rating 0-10, 8 statements
  insert into public.statements (round_id, section_id, sort_order, key, text, kind, left_label, right_label)
  values
    (v_round_id, v_sec_d, 1, $t$s2_d_01$t$, $t$Chasing the grade: wanting to know what gets marked well$t$, $t$rating$t$, $t$Does not affect me$t$, $t$Affects me$t$),
    (v_round_id, v_sec_d, 2, $t$s2_d_02$t$, $t$Building a portfolio that looks impressive$t$, $t$rating$t$, $t$Does not affect me$t$, $t$Affects me$t$),
    (v_round_id, v_sec_d, 3, $t$s2_d_03$t$, $t$Wondering whether there’ll be a job for me at the end of all this$t$, $t$rating$t$, $t$Does not affect me$t$, $t$Affects me$t$),
    (v_round_id, v_sec_d, 4, $t$s2_d_04$t$, $t$Money: paid work, materials and the cost of studying eating into my time$t$, $t$rating$t$, $t$Does not affect me$t$, $t$Affects me$t$),
    (v_round_id, v_sec_d, 5, $t$s2_d_05$t$, $t$Feeling every project has to look professional and polished$t$, $t$rating$t$, $t$Does not affect me$t$, $t$Affects me$t$),
    (v_round_id, v_sec_d, 6, $t$s2_d_06$t$, $t$Comparing myself with others who seem further ahead$t$, $t$rating$t$, $t$Does not affect me$t$, $t$Affects me$t$),
    (v_round_id, v_sec_d, 7, $t$s2_d_07$t$, $t$Not knowing what employers actually want from me$t$, $t$rating$t$, $t$Does not affect me$t$, $t$Affects me$t$),
    (v_round_id, v_sec_d, 8, $t$s2_d_08$t$, $t$The industry and AI changing faster than I can keep up with$t$, $t$rating$t$, $t$Does not affect me$t$, $t$Affects me$t$);

  -- E: agreement scale, 6 statements
  insert into public.statements (round_id, section_id, sort_order, key, text, kind)
  values
    (v_round_id, v_sec_e, 1, $t$s2_e_01$t$, $t$Getting a good grade makes me feel safe.$t$, $t$scale$t$),
    (v_round_id, v_sec_e, 2, $t$s2_e_02$t$, $t$A disappointing grade can make me feel that I’m not good enough.$t$, $t$scale$t$),
    (v_round_id, v_sec_e, 3, $t$s2_e_03$t$, $t$Sometimes I focus more on what will get a good grade than on what I might discover.$t$, $t$scale$t$),
    (v_round_id, v_sec_e, 4, $t$s2_e_04$t$, $t$I admire people who take creative risks more easily than I do.$t$, $t$scale$t$),
    (v_round_id, v_sec_e, 5, $t$s2_e_05$t$, $t$Some of the work I’m most proud of began with not knowing whether it would work.$t$, $t$scale$t$),
    (v_round_id, v_sec_e, 6, $t$s2_e_06$t$, $t$I sometimes wish my work could be assessed without a grade.$t$, $t$scale$t$);

  -- F: rating 0-10, 8 statements
  insert into public.statements (round_id, section_id, sort_order, key, text, kind, left_label, right_label)
  values
    (v_round_id, v_sec_f, 1, $t$s2_f_01$t$, $t$Not knowing what to do makes me question my abilities.$t$, $t$rating$t$, $t$I tend not to do this$t$, $t$I tend to do this$t$),
    (v_round_id, v_sec_f, 2, $t$s2_f_02$t$, $t$I settle on the first workable idea because having a direction feels better than having none.$t$, $t$rating$t$, $t$I tend not to do this$t$, $t$I tend to do this$t$),
    (v_round_id, v_sec_f, 3, $t$s2_f_03$t$, $t$I seek guidance from a tutor to help me figure it out.$t$, $t$rating$t$, $t$I tend not to do this$t$, $t$I tend to do this$t$),
    (v_round_id, v_sec_f, 4, $t$s2_f_04$t$, $t$I return to familiar approaches because I know they work.$t$, $t$rating$t$, $t$I tend not to do this$t$, $t$I tend to do this$t$),
    (v_round_id, v_sec_f, 5, $t$s2_f_05$t$, $t$I keep researching, hoping I’ll find a direction I feel excited about.$t$, $t$rating$t$, $t$I tend not to do this$t$, $t$I tend to do this$t$),
    (v_round_id, v_sec_f, 6, $t$s2_f_06$t$, $t$I put the work off or distract myself to escape the discomfort.$t$, $t$rating$t$, $t$I tend not to do this$t$, $t$I tend to do this$t$),
    (v_round_id, v_sec_f, 7, $t$s2_f_07$t$, $t$I choose safer ideas that I believe will earn good grades or strengthen my portfolio.$t$, $t$rating$t$, $t$I tend not to do this$t$, $t$I tend to do this$t$),
    (v_round_id, v_sec_f, 8, $t$s2_f_08$t$, $t$I keep experimenting, trusting that I’ll find a way forward even when I don’t know what the outcome will be.$t$, $t$rating$t$, $t$I tend not to do this$t$, $t$I tend to do this$t$);

  -- G: agreement scale, 6 statements
  insert into public.statements (round_id, section_id, sort_order, key, text, kind)
  values
    (v_round_id, v_sec_g, 1, $t$s2_g_01$t$, $t$If AI resolves my uncertainty for me, I might miss what I’d learn by working it out myself.$t$, $t$scale$t$),
    (v_round_id, v_sec_g, 2, $t$s2_g_02$t$, $t$There are parts of my work where I want to protect my own thinking.$t$, $t$scale$t$),
    (v_round_id, v_sec_g, 3, $t$s2_g_03$t$, $t$AI lets me imagine and attempt things I couldn’t on my own.$t$, $t$scale$t$),
    (v_round_id, v_sec_g, 4, $t$s2_g_04$t$, $t$I worry AI will make the jobs I’m training for disappear.$t$, $t$scale$t$),
    (v_round_id, v_sec_g, 5, $t$s2_g_05$t$, $t$Design will evolve with AI, we don’t know where this will take us but the destination will be human made.$t$, $t$scale$t$),
    (v_round_id, v_sec_g, 6, $t$s2_g_06$t$, $t$My education should help me become someone who can think freely, not only someone who’s employable.$t$, $t$scale$t$);

  -- H: ranking, 6 items (shown as a list in presentation mode)
  insert into public.statements (round_id, section_id, sort_order, key, text, kind, options)
  values (v_round_id, v_sec_h, 1, $t$s2_h_01$t$,
    $t$Rank from most to least important.$t$,
    $t$ranking$t$,
    jsonb_build_array(
      jsonb_build_object('value', 1, 'label', $t$Not knowing and uncertainty is a normal part of designing that should feel safe and supported.$t$),
      jsonb_build_object('value', 2, 'label', $t$We share rough, unfinished work early, without needing to defend it.$t$),
      jsonb_build_object('value', 3, 'label', $t$After something doesn’t work, we ask “what did it show us?” before “did it work?”$t$),
      jsonb_build_object('value', 4, 'label', $t$Tutors share their own uncertainty, not just their answers.$t$),
      jsonb_build_object('value', 5, 'label', $t$When someone is stuck, we give them time and help them stay with the question.$t$),
      jsonb_build_object('value', 6, 'label', $t$We value the process and the learning, not only the polished outcome.$t$)
    ));

  -- -------------------------------------------------------------------------
  -- 5. Title and intro (dates are never written).
  -- -------------------------------------------------------------------------

  update public.rounds
  set
    title = $t$Session 2: Holding space for uncertainty$t$,
    intro = $t$8 quick questions, about 10 minutes. All answers will be anonymous. There are no right answers we are interested in your honest response throughout. This is not a test.$t$
  where id = v_round_id;

  get diagnostics v_n = row_count;

  if v_n <> 1 then
    raise exception 'session_2_content: expected to update 1 round row, updated %', v_n;
  end if;

  -- -------------------------------------------------------------------------
  -- Sanity: refuse to commit unless the content matches the Session 2 map and
  -- nothing else moved.
  -- -------------------------------------------------------------------------

  select string_agg(
    format('%s:%s/%s', r.session_number, (select count(*) from public.sections x where x.round_id = r.id),
      (select count(*) from public.statements x where x.round_id = r.id)),
    ' ' order by r.session_number
  )
  into v_check
  from public.rounds r
  join public.surveys s on s.id = r.survey_id
  where s.title = $t$Becoming a Designer Questionnaire$t$;

  if v_check is distinct from $t$1:6/32 2:9/38 3:5/61$t$ then
    raise exception 'session_2_content: section/statement counts got %', v_check;
  end if;

  select string_agg(format('%s:%s', sec.label, (select count(*) from public.statements x where x.section_id = sec.id)), ' ' order by sec.sort_order)
  into v_check
  from public.sections sec
  where sec.round_id = v_round_id;

  if v_check is distinct from $t$A:1 B1:1 B2:6 C:1 D:8 E:6 F:8 G:6 H:1$t$ then
    raise exception 'session_2_content: Session 2 section order/statement counts got %', v_check;
  end if;

  select count(*) into v_n
  from public.sections
  where round_id = v_round_id
    and parent_title is not null;

  if v_n <> 0 then
    raise exception 'session_2_content: expected no parent titles in Session 2, found %', v_n;
  end if;

  select string_agg(st.key || '=' || st.kind || '/' || jsonb_array_length(st.options)::text, ' ' order by sec.sort_order, st.sort_order)
  into v_check
  from public.statements st
  join public.sections sec on sec.id = st.section_id and sec.round_id = st.round_id
  where st.round_id = v_round_id
    and st.kind = 'ranking';

  if v_check is distinct from $t$s2_a_01=ranking/8 s2_b1_01=ranking/6 s2_c_01=ranking/6 s2_h_01=ranking/6$t$ then
    raise exception 'session_2_content: ranking statements/option counts got %', v_check;
  end if;

  select string_agg(so.value::text || '=' || so.label, '|' order by so.value)
  into v_check
  from public.scale_options so
  where so.scale_key = $t$importance_change$t$;

  if v_check is distinct from $t$1=Much less important|2=Less important|3=About the same|4=More important|5=Much more important than today$t$ then
    raise exception 'session_2_content: importance_change options got %', v_check;
  end if;

  select count(*) into v_n from public.scales;
  select count(*) into v_n2 from public.scale_options;

  if v_n <> 3 or v_n2 <> 14 then
    raise exception 'session_2_content: scales/scale_options totals got %/%', v_n, v_n2;
  end if;

  select count(*) into v_n from public.responses;
  select count(*) into v_n2 from public.responses where round_id = v_s1;

  if v_n <> 100 or v_n2 <> 100 then
    raise exception 'session_2_content: responses total/Session 1 got %/%', v_n, v_n2;
  end if;

  select count(*) into v_n from public.answers;
  select count(*) into v_n2 from public.answers where round_id = v_s1;

  if v_n <> 3198 or v_n2 <> 3198 then
    raise exception 'session_2_content: answers total/Session 1 got %/%', v_n, v_n2;
  end if;

  select r.opens_at, r.closes_at, r.title into v_opens, v_closes, v_title
  from public.rounds r
  where r.id = v_round_id;

  if v_opens is not null or v_closes is not null then
    raise exception 'session_2_content: Session 2 dates must still be null';
  end if;

  if v_title is distinct from $t$Session 2: Holding space for uncertainty$t$ then
    raise exception 'session_2_content: Session 2 title got %', v_title;
  end if;

  if not exists (
    select 1 from public.rounds r
    where r.id = v_round_id
      and r.intro = $t$8 quick questions, about 10 minutes. All answers will be anonymous. There are no right answers we are interested in your honest response throughout. This is not a test.$t$
  ) then
    raise exception 'session_2_content: Session 2 intro is not the expected text';
  end if;

  -- -------------------------------------------------------------------------
  -- Fingerprint (after): byte-identical query, must match the one above.
  -- -------------------------------------------------------------------------

  v_fp_after := (
    -- fingerprint:begin
    select md5(concat_ws('|',
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.id), '') from public.surveys x),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.id), '') from public.rounds x where x.id <> v_round_id),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.id), '') from public.sections x where x.round_id <> v_round_id),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.id), '') from public.statements x where x.round_id <> v_round_id),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.key), '') from public.scales x where x.key <> $t$importance_change$t$),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.scale_key, x.value), '') from public.scale_options x where x.scale_key <> $t$importance_change$t$),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.id), '') from public.responses x),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.id), '') from public.answers x),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.user_id), '') from public.results_consent x),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.domain), '') from public.allowed_domains x),
      (select coalesce(string_agg(row_to_json(x)::text, ',' order by x.email), '') from public.admin_emails x)
    ))
    -- fingerprint:end
  );

  if v_fp_before is distinct from v_fp_after then
    raise exception 'session_2_content: fingerprint of Sessions 1/3, responses, answers, consent, domains or admins changed (% vs %)', v_fp_before, v_fp_after;
  end if;
end;
$$;
