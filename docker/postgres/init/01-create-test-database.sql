-- Runs once, when the Docker Compose data volume is first created.
-- maqady_dev comes from POSTGRES_DB; the integration tests use maqady_test.
CREATE DATABASE maqady_test;
