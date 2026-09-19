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

-- WHAT THIS DOES NOT FIX, recorded once instead of chased.
--
-- At 21:00 on 2026-09-19 the table held 41 attempts and the dashboard showed
-- 2350 credits spent, which 31 Seedream and 10 Mystic fit exactly and
-- uniquely. By 21:40 the table held 50 attempts of which 30 were Seedream:
-- one row that existed is gone, and with it the only record of a credit that
-- was really spent.
--
-- Nothing in the application deletes an attempt row — the bin marks a row
-- 'rejected' and always has — so it was removed from outside, by hand. It is
-- not recoverable: the row carried its own id, its model and its prompt, and
-- no other table references it.
--
-- So the sum of this column will read below the dashboard by at least one
-- Seedream, 50 credits, and pretending otherwise would mean inventing a row.
-- The gap is the measurement of what was lost, and it is better left visible
-- than closed with a guess.
