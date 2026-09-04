-- Which upload wrote each block.
--
-- A point's content can come from more than one page: a spread opens it and the
-- continuation page that follows adds to it. Confirming used to mean "replace
-- everything on this point" for the page carrying the number and "append" for
-- the continuation, and neither is idempotent across the pair. Re-confirming
-- the numbered page erased what the continuation had added, and re-confirming
-- the continuation added its blocks a second time.
--
-- With the writer recorded, both become the same rule: a confirmation replaces
-- what that page wrote and leaves the rest of the point alone. Re-confirming
-- any page any number of times then lands the same content.
--
-- Nullable because it is unknown for anything written before this, and the
-- file name of an upload is not something the product can promise to have.
alter table blocks add column source_page text;

create index blocks_source_page_idx on blocks (point_id, source_page);
