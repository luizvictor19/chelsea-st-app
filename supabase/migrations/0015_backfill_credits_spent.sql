-- What the fifty attempts that already exist cost, written down at last.
--
-- credits_spent has been a column since 0008 and null on every row ever
-- written, because it was only ever going to be filled from the provider's
-- response and the provider does not report a charge. So the table, which is
-- the record of what this phase spends, could not answer the one question it
-- exists for.
--
-- From here the application writes it at generation time, from its own model
-- table, the moment the provider accepts the task. This fills in the past the
-- same way: the price of the model each row names.
--
-- The prices are a SNAPSHOT of IMAGE_MODELS in src/lib/images/provider.ts as
-- it stood on 2026-09-19, not a mirror of it. Each was read off the Freepik
-- dashboard, immediately before and after an isolated generation:
--
--   seedream-v4        50   the counter went 0 to 100 over two generations
--   mystic             80   one generation of "pen"
--   flux-kontext-pro  150   2830 to 2980, one generation
--
-- A model that appears later and is not named here keeps its null, which goes
-- on meaning "nobody knows" and never zero. Same for an upload, which names
-- no model and cost nothing to make.
update image_attempts
   set credits_spent = case model
         when 'seedream-v4' then 50
         when 'mystic' then 80
         when 'flux-kontext-pro' then 150
       end
 where credits_spent is null
   and model is not null;

-- WHAT THE SUM WILL NOT MATCH, recorded once instead of chased.
--
-- At 21:00 on 2026-09-19 the table held 41 attempts and the dashboard showed
-- 2350 credits spent. 31 Seedream and 10 Mystic fit that exactly, and it
-- looked like the only fit, which made a missing row look certain. It is not
-- the only fit: it is the only one in which every attempt was charged, and
-- whether a failed attempt is charged is the open question this column exists
-- to answer.
--
-- Letting k be the attempts that cost nothing, 50a + 80b = 2350 with
-- a + b = 41 - k gives b = 10 + 5k/3, so k has to be a multiple of three.
-- k = 0 is 31 and 10, k = 3 is 23 and 15, k = 6 is 15 and 20. All of them
-- need no row to be missing. k = 4 has no whole-number answer at all, so if
-- exactly four generations really went uncharged, then either one of the four
-- was charged after all, or one of them came after 21:00, or something is
-- missing — and none of those can be told apart from here.
--
-- Nothing in the application has ever deleted an attempt row: the bin marks
-- one 'rejected', and as of today it also removes the file from the bucket
-- and leaves the row. So the arithmetic above is where the doubt lives, not
-- the code.
--
-- The sum of this column may therefore read below the dashboard, and that
-- gap is a measurement rather than a defect. It stops growing here: from now
-- on the cost is written when the provider accepts the task, and the total
-- is read off the rows instead of solved for by elimination.
