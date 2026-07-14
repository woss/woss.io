-- =============================================================================
-- SurrealDB Schema — 17 tables for woss.io (single-file, snake_case, SCHEMAFULL)
-- =============================================================================
-- Run: cat src/scripts/migrate.surql | docker exec -i dali-surrealdb-1 surreal sql --endpoint http://localhost:10101 --namespace woss --database woss --user admin --pass admin
-- Or:  surreal sql --endpoint <url> --namespace <ns> --database <db> < src/scripts/migrate.surql
-- =============================================================================
-- Usage:  DELETE the entire DB first to apply the full schema from scratch.
-- =============================================================================

-- =============================================================================
-- Drop all 17 tables first (idempotent — no-op if already removed)
-- =============================================================================
REMOVE TABLE chunks;
REMOVE TABLE has_chunks;
REMOVE TABLE users;
REMOVE TABLE messages;
REMOVE TABLE page_posts;
REMOVE TABLE page_experience;
REMOVE TABLE llm_cache;
REMOVE TABLE models;
REMOVE TABLE reactions;
REMOVE TABLE chats;
REMOVE TABLE chat_events;
REMOVE TABLE leads;
REMOVE TABLE contact_intents;
REMOVE TABLE user_agents;
REMOVE TABLE used_model;
REMOVE TABLE tool_calls;
REMOVE TABLE rate_limits;
REMOVE TABLE feature_tours;
REMOVE TABLE centroids;

-- =============================================================================
-- 1. chunks — Document chunks with text embeddings for semantic search
-- =============================================================================
DEFINE TABLE chunks SCHEMAFULL;

DEFINE FIELD chunk_id  ON TABLE chunks TYPE string;
DEFINE FIELD text      ON TABLE chunks TYPE string;
DEFINE FIELD title     ON TABLE chunks TYPE string;
DEFINE FIELD date      ON TABLE chunks TYPE string;
DEFINE FIELD tags      ON TABLE chunks TYPE array<string>;
DEFINE FIELD section   ON TABLE chunks TYPE string;
DEFINE FIELD embedding ON TABLE chunks TYPE array<float>;

DEFINE INDEX idx_chunks_chunk_id ON TABLE chunks FIELDS chunk_id UNIQUE;
-- ANN vector search not supported in SurrealDB 3.0.5 (falls back to brute-force vector::distance::cosine)

-- =============================================================================
-- 1b. has_chunks — Edge table connecting page_posts/page_experience → chunks
-- =============================================================================
-- Schema: page_posts:xxx --has_chunks--> chunks:xxx_chunk_0
-- Parent slug/type derived via <-has_chunks.in traversal (no slug/type on chunks)
DEFINE TABLE has_chunks TYPE RELATION FROM page_posts, page_experience TO chunks SCHEMAFULL;

-- =============================================================================
-- 2. users — Platform users
-- =============================================================================
DEFINE TABLE users SCHEMAFULL;

DEFINE FIELD email      ON TABLE users TYPE option<string> | null;
DEFINE FIELD name       ON TABLE users TYPE option<string> | null;
DEFINE FIELD created_at ON TABLE users TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_users_email ON TABLE users FIELDS email UNIQUE;

-- =============================================================================
-- 3. messages — Chat messages with metadata, reasoning, errors
-- =============================================================================
DEFINE TABLE messages SCHEMAFULL;

DEFINE FIELD user_id      ON TABLE messages TYPE record<users> REFERENCE ASSERT $value != NONE;
DEFINE FIELD chat_id      ON TABLE messages TYPE option<record<chats>> REFERENCE;
DEFINE FIELD role         ON TABLE messages TYPE string ASSERT $value != NONE;
DEFINE FIELD content      ON TABLE messages TYPE string ASSERT $value != NONE;
DEFINE FIELD sources      ON TABLE messages TYPE string DEFAULT '[]';
DEFINE FIELD reasoning    ON TABLE messages TYPE string DEFAULT '';
DEFINE FIELD error        ON TABLE messages TYPE option<string> | null;
DEFINE FIELD irrecoverable ON TABLE messages TYPE bool DEFAULT false;
DEFINE FIELD created_at   ON TABLE messages TYPE datetime DEFAULT time::now();
-- model_id removed — replaced by edge table used_model
DEFINE FIELD tokens_in    ON TABLE messages TYPE int DEFAULT 0;
DEFINE FIELD tokens_out   ON TABLE messages TYPE int DEFAULT 0;
DEFINE FIELD duration_ms  ON TABLE messages TYPE int DEFAULT 0;
DEFINE FIELD max_tokens   ON TABLE messages TYPE int DEFAULT 0;
DEFINE FIELD query_type   ON TABLE messages TYPE option<string> | null;
DEFINE FIELD deleted_at   ON TABLE messages TYPE option<datetime> | null;
DEFINE FIELD user_agent_id ON TABLE messages TYPE option<record<user_agents>> REFERENCE;
DEFINE FIELD trace_id     ON TABLE messages TYPE option<string> | null;
DEFINE FIELD from_cache   ON TABLE messages TYPE bool DEFAULT false;

DEFINE INDEX idx_messages_chat_role_deleted ON TABLE messages FIELDS chat_id, role, deleted_at;
DEFINE INDEX idx_messages_chat_created ON TABLE messages FIELDS chat_id, created_at;
DEFINE INDEX idx_messages_user ON TABLE messages FIELDS user_id;

-- 3b. used_model — Graph edge from message to model (replaces messages.model_id)
DEFINE TABLE used_model TYPE RELATION SCHEMAFULL;
DEFINE FIELD created_at ON TABLE used_model TYPE datetime DEFAULT time::now();

-- =============================================================================
-- 4. page_posts — Blog posts and pages with content, series support
-- =============================================================================
DEFINE TABLE page_posts SCHEMAFULL;

DEFINE FIELD slug            ON TABLE page_posts TYPE string ASSERT $value != NONE;
DEFINE FIELD hash            ON TABLE page_posts TYPE option<string> | null;
DEFINE FIELD content         ON TABLE page_posts TYPE option<string> | null;
DEFINE FIELD toc             ON TABLE page_posts TYPE option<string> | null;
DEFINE FIELD title           ON TABLE page_posts TYPE option<string> | null;
DEFINE FIELD description     ON TABLE page_posts TYPE option<string> | null;
DEFINE FIELD date            ON TABLE page_posts TYPE option<string> | null;
DEFINE FIELD tags            ON TABLE page_posts TYPE option<array<string>> | null;
DEFINE FIELD status          ON TABLE page_posts TYPE string DEFAULT 'draft';
DEFINE FIELD excerpt         ON TABLE page_posts TYPE option<string> | null;
DEFINE FIELD header_image    ON TABLE page_posts TYPE option<string> | null;
DEFINE FIELD featured        ON TABLE page_posts TYPE bool DEFAULT false;
DEFINE FIELD position        ON TABLE page_posts TYPE option<int> | null;
DEFINE FIELD part_of_series  ON TABLE page_posts TYPE option<record<page_posts>> REFERENCE;
DEFINE FIELD workflow_files  ON TABLE page_posts TYPE option<string> | null;
DEFINE FIELD updated_at      ON TABLE page_posts TYPE option<string> | null;

DEFINE INDEX idx_page_posts_slug ON TABLE page_posts FIELDS slug UNIQUE;

-- =============================================================================
-- 5. page_experience — Work experience entries
-- =============================================================================
DEFINE TABLE page_experience SCHEMAFULL;

DEFINE FIELD slug        ON TABLE page_experience TYPE option<string> | null;
DEFINE FIELD hash        ON TABLE page_experience TYPE option<string> | null;
DEFINE FIELD content     ON TABLE page_experience TYPE option<string> | null;
DEFINE FIELD company     ON TABLE page_experience TYPE option<string> | null;
DEFINE FIELD role        ON TABLE page_experience TYPE option<string> | null;
DEFINE FIELD start_date  ON TABLE page_experience TYPE option<string> | null;
DEFINE FIELD end_date    ON TABLE page_experience TYPE option<string> | null;
DEFINE FIELD duration    ON TABLE page_experience TYPE option<string> | null;
DEFINE FIELD skills      ON TABLE page_experience TYPE option<array<string>> | null;
DEFINE FIELD description ON TABLE page_experience TYPE option<string> | null;
DEFINE FIELD published   ON TABLE page_experience TYPE bool DEFAULT true;
DEFINE FIELD updated_at  ON TABLE page_experience TYPE option<string> | null;
DEFINE FIELD job_role    ON TABLE page_experience TYPE option<string> | null;

DEFINE INDEX idx_page_experience_slug ON TABLE page_experience FIELDS slug UNIQUE;

-- =============================================================================
-- 6. llm_cache — Cached LLM responses with embeddings for similarity lookup
-- =============================================================================
DEFINE TABLE llm_cache SCHEMAFULL;

DEFINE FIELD question            ON TABLE llm_cache TYPE option<string> | null;
DEFINE FIELD question_embedding  ON TABLE llm_cache TYPE option<array<float>> | null;
DEFINE FIELD answer              ON TABLE llm_cache TYPE option<string> | null;
DEFINE FIELD sources             ON TABLE llm_cache TYPE option<array<string>> | null;
DEFINE FIELD tool_calls          ON TABLE llm_cache TYPE array<string> DEFAULT [];
DEFINE FIELD message_id          ON TABLE llm_cache TYPE option<record<messages>> REFERENCE;
DEFINE FIELD created_at          ON TABLE llm_cache TYPE datetime DEFAULT time::now();

-- =============================================================================
-- 7. models — AI model registry with provider + name uniqueness
-- =============================================================================
DEFINE TABLE models SCHEMAFULL;

DEFINE FIELD provider            ON TABLE models TYPE option<string> | null;
DEFINE FIELD model_name          ON TABLE models TYPE option<string> | null;
DEFINE FIELD actual_model_name   ON TABLE models TYPE option<string> | null;
DEFINE FIELD max_tokens          ON TABLE models TYPE option<int> | null;

DEFINE INDEX idx_models_unique ON TABLE models FIELDS provider, model_name, actual_model_name UNIQUE;
DEFINE INDEX idx_models_provider_name ON TABLE models FIELDS provider, model_name;

-- =============================================================================
-- 8. reactions — User reactions to messages
-- =============================================================================
DEFINE TABLE reactions SCHEMAFULL;

DEFINE FIELD message_id    ON TABLE reactions TYPE option<record<messages>> REFERENCE;
DEFINE FIELD user_id       ON TABLE reactions TYPE option<record<users>> REFERENCE;
DEFINE FIELD reaction_type ON TABLE reactions TYPE option<string> | null;
DEFINE FIELD reason        ON TABLE reactions TYPE string DEFAULT '';
DEFINE FIELD created_at    ON TABLE reactions TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_reactions_unique ON TABLE reactions FIELDS message_id, user_id UNIQUE;

-- =============================================================================
-- 9. chats — Conversation threads
-- =============================================================================
DEFINE TABLE chats SCHEMAFULL;

DEFINE FIELD user_id          ON TABLE chats TYPE option<record<users>> REFERENCE;
DEFINE FIELD title            ON TABLE chats TYPE string DEFAULT 'New Chat';
DEFINE FIELD created_at       ON TABLE chats TYPE datetime DEFAULT time::now();
DEFINE FIELD deleted_at       ON TABLE chats TYPE option<datetime> | null;
DEFINE FIELD locked           ON TABLE chats TYPE bool DEFAULT false;
DEFINE FIELD off_topic_count  ON TABLE chats TYPE int DEFAULT 0;
DEFINE FIELD user_agent_id    ON TABLE chats TYPE option<record<user_agents>> REFERENCE;
DEFINE FIELD trace_id         ON TABLE chats TYPE option<string> | null;

DEFINE INDEX idx_chats_user_deleted ON TABLE chats FIELDS user_id, deleted_at;

-- =============================================================================
-- 10. chat_events — Event log scoped to a chat
-- =============================================================================
DEFINE TABLE chat_events SCHEMAFULL;

DEFINE FIELD chat_id    ON TABLE chat_events TYPE option<record<chats>> REFERENCE;
DEFINE FIELD type       ON TABLE chat_events TYPE option<string> | null;
DEFINE FIELD data       ON TABLE chat_events TYPE option<string> | null;
DEFINE FIELD created_at ON TABLE chat_events TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_chat_events_chat ON TABLE chat_events FIELDS chat_id;

-- =============================================================================
-- 11. leads — Sales/marketing lead capture
-- =============================================================================
DEFINE TABLE leads SCHEMAFULL;

DEFINE FIELD user_id       ON TABLE leads TYPE option<record<users>> REFERENCE;
DEFINE FIELD name          ON TABLE leads TYPE option<string> | null;
DEFINE FIELD email         ON TABLE leads TYPE option<string> | null;
DEFINE FIELD company_name  ON TABLE leads TYPE option<string> | null;
DEFINE FIELD role          ON TABLE leads TYPE option<string> | null;
DEFINE FIELD message       ON TABLE leads TYPE option<string> | null;
DEFINE FIELD ip_address    ON TABLE leads TYPE option<string> | null;
DEFINE FIELD created_at    ON TABLE leads TYPE datetime DEFAULT time::now();

-- =============================================================================
-- 12. contact_intents — User intent signals from chat interactions
-- =============================================================================
DEFINE TABLE contact_intents SCHEMAFULL;

DEFINE FIELD user_id    ON TABLE contact_intents TYPE option<record<users>> REFERENCE;
DEFINE FIELD chat_id    ON TABLE contact_intents TYPE option<record<chats>> REFERENCE;
DEFINE FIELD text       ON TABLE contact_intents TYPE option<string> | null;
DEFINE FIELD created_at ON TABLE contact_intents TYPE datetime DEFAULT time::now();

-- =============================================================================
-- 13. user_agents — Browser/device fingerprints
-- =============================================================================
DEFINE TABLE user_agents SCHEMAFULL;

DEFINE FIELD ua           ON TABLE user_agents TYPE option<string> | null;
DEFINE FIELD ip           ON TABLE user_agents TYPE option<string> | null;
DEFINE FIELD device_type  ON TABLE user_agents TYPE option<string> | null;
DEFINE FIELD created_at   ON TABLE user_agents TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_user_agents_ua ON TABLE user_agents FIELDS ua UNIQUE;

-- =============================================================================
-- 14. tool_calls — LLM tool invocation records
-- =============================================================================
DEFINE TABLE tool_calls SCHEMAFULL;

DEFINE FIELD message_id   ON TABLE tool_calls TYPE option<record<messages>> REFERENCE;
DEFINE FIELD name         ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD server_id    ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD tool_input   ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD tool_output  ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD result_size  ON TABLE tool_calls TYPE int DEFAULT 0;
DEFINE FIELD started_at   ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD finished_at  ON TABLE tool_calls TYPE option<string> | null;

DEFINE INDEX idx_tool_calls_message ON TABLE tool_calls FIELDS message_id;

-- =============================================================================
-- 15. rate_limits — IP-based rate limiting
-- =============================================================================
DEFINE TABLE rate_limits SCHEMAFULL;

DEFINE FIELD ip        ON TABLE rate_limits TYPE option<string> | null;
DEFINE FIELD timestamp ON TABLE rate_limits TYPE option<datetime> | null;

DEFINE INDEX idx_rate_limits_ip ON TABLE rate_limits FIELDS ip;
DEFINE INDEX idx_rate_limits_ip_timestamp ON TABLE rate_limits FIELDS ip, timestamp;

-- =============================================================================
-- 16. feature_tours — Dismissed feature tours per user
-- =============================================================================
DEFINE TABLE feature_tours SCHEMAFULL;

DEFINE FIELD user_id      ON TABLE feature_tours TYPE record<users> ASSERT $value != NONE;
DEFINE FIELD feature_id   ON TABLE feature_tours TYPE string ASSERT $value != NONE;
DEFINE FIELD dismissed_at ON TABLE feature_tours TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_feature_tours_unique ON TABLE feature_tours FIELDS user_id, feature_id UNIQUE;

-- =============================================================================
-- 17. centroids — Query classifier centroid vectors (tool, rag, meta)
-- =============================================================================
DEFINE TABLE centroids SCHEMAFULL;

DEFINE FIELD class  ON TABLE centroids TYPE string ASSERT $value != NONE;
DEFINE FIELD vector ON TABLE centroids TYPE array<float> ASSERT $value != NONE;
DEFINE FIELD model  ON TABLE centroids TYPE string;
DEFINE FIELD dims   ON TABLE centroids TYPE int;
DEFINE FIELD hash   ON TABLE centroids TYPE string;
DEFINE FIELD updated ON TABLE centroids TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_centroids_class ON TABLE centroids FIELDS class UNIQUE;
