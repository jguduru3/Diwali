-- Influencer link visits (/r/DXI-...): a counter for the influencer's stats only; no money depends on it.
alter table influencers add column link_visits integer not null default 0;
