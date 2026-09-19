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
--   seedream-v4        50   half of a 0 to 100 reading over two generations
--   mystic             80   one generation of "pen", 19/09
--   mystic             50   the other half of that same 0 to 100, 18/09
--   flux-kontext-pro  150   2830 to 2980, one generation
--
-- MYSTIC COSTS TWO DIFFERENT THINGS, and the date is what tells them apart.
-- On the evening of 18/09 one Mystic and one Seedream together took the
-- counter from 0 to 100, which is 50 each. Every Mystic generation from 19/09
-- on measures 80. Either the price moved between the two days, or that first
-- call reached a different variant; nothing here can say which, and it does
-- not need to — what the column records is what was charged.
--
-- A rule by date rather than by id, because the id would be a special case
-- with the reason living outside the file, and the next person would find an
-- unexplained uuid. The boundary is midnight on 19/09 in São Paulo, which is
-- where the working day broke: the attempt before it is at 21:06 on 18/09
-- local and the next one is fifteen hours later.
--
-- A model that appears later and is not named here keeps its null, which goes
-- on meaning "nobody knows" and never zero. Same for an upload, which names
-- no model and cost nothing to make.
--
-- AND ONLY ROWS THE PROVIDER ACCEPTED. provider_request_id is the handle the
-- provider gives back when it takes the task, and it is written immediately
-- after — in the code of the day and in the code now. A row without one is a
-- request refused at the door, which was never drawn and cannot have been
-- charged, and giving it the price of its model would invent a credit.
--
-- This is the same rule the application now follows, and it has to be: the
-- cost is written in the same statement that stores the handle. A backfill
-- that used a different rule would make the rows before it and the rows after
-- it mean different things, in the one column whose whole job is to be added
-- up.
--
-- Status is deliberately not filtered on. An attempt that was accepted and
-- then failed, or that ran past the window, keeps the price of its model,
-- because the task was opened and a charge may well exist. Whether it does is
-- the open question; writing zero there would be answering it by assertion.
-- The one failure that can still be told apart is the request refused at the
-- door, because it has no handle. The one that timed out cannot: it was
-- discarded into 'rejected' before failures stopped being reclassified, and
-- it is now indistinguishable from ten pictures the teacher disliked. That
-- loss is why the bin no longer touches a failure.
update image_attempts
   set credits_spent = case
         when model = 'seedream-v4' then 50
         when model = 'mystic'
              and created_at < timestamptz '2026-09-19 00:00-03' then 50
         when model = 'mystic' then 80
         when model = 'flux-kontext-pro' then 150
       end
 where credits_spent is null
   and model is not null
   and provider_request_id is not null;

-- WHAT THE SUM ANSWERS.
--
-- It was not obvious this would close at all. Earlier in the evening 41 rows
-- against 2350 credits looked like it needed a deleted row; it did not, and
-- neither did it need a second Mystic price to be guessed at — both fell out
-- of the same arithmetic once every row carried its own figure.
--
-- Closing to the credit says two things that were open:
--
--   An accepted task is charged, and that includes the one that ran past the
--   90 second window. Only the request refused at the door cost nothing. So
--   provider_request_id is the right line to draw, and credits_spent is a
--   statement of what was spent rather than a ceiling on it.
--
--   Seedream is 50. That figure used to rest on reading a 0 to 100 jump as
--   two Seedream generations; it was one Seedream and one Mystic, and the
--   number survives for a better reason than the one it was written with.
--
-- Nothing in the application has ever deleted an attempt row: the bin marks
-- one 'rejected', and as of today it also removes the file from the bucket
-- and leaves the row.
--
-- WHAT IT WRITES, counted against the project on 2026-09-19 before it ran:
--
--   seedream-v4        30 rows x  50 = 1500
--   mystic              1 row  x  50 =   50   the one from 18/09
--   mystic             16 rows x  80 = 1280
--   flux-kontext-pro    2 rows x 150 =  300
--                      ------------------------
--                      49 rows          3130
--
-- and one row left null on purpose: a Mystic request the provider refused
-- with a 500 on the way in, now carrying status 'rejected' because it was
-- discarded before a failure could stay a failure.
--
-- 3130 is what the dashboard says. To the credit.
--
-- So null in this column will mean two things at once, and it is worth
-- knowing which: nothing was charged, or nobody measured the model's price.
-- Today only the first happens, because all three models are priced. The day
-- an unpriced model is added, they stop being distinguishable and the column
-- needs help — a check against provider_request_id tells them apart until
-- then.
--
-- From here the cost is written when the provider accepts the task, so the
-- total is read off the rows instead of solved for by elimination — which is
-- what made an evening of arithmetic necessary to learn one fact.
