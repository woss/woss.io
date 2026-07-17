-- =============================================================================
-- SurrealDB Schema — Idempotent schema definitions for woss.io
-- =============================================================================
-- Applied on every app startup. Contains ONLY DEFINE TABLE / FIELD / INDEX.
-- Data migrations live in migrate.surql (run once per schema change).
-- All DEFINE statements are idempotent in SurrealDB v3 — safe to re-apply.
-- =============================================================================

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

-- =============================================================================
-- 1b. has_chunk — Edge table connecting page_posts/page_experience → chunks
-- =============================================================================
DEFINE TABLE has_chunk TYPE RELATION IN page_posts | page_experience OUT chunks SCHEMAFULL;

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

DEFINE FIELD user_id      ON TABLE messages TYPE record<users> ASSERT $value != NONE;
DEFINE FIELD role         ON TABLE messages TYPE string ASSERT $value != NONE;
DEFINE FIELD content      ON TABLE messages TYPE string ASSERT $value != NONE;
DEFINE FIELD sources      ON TABLE messages TYPE string DEFAULT '[]';
DEFINE FIELD reasoning    ON TABLE messages TYPE string DEFAULT '';
DEFINE FIELD error        ON TABLE messages TYPE option<string> | null;
DEFINE FIELD irrecoverable ON TABLE messages TYPE bool DEFAULT false;
DEFINE FIELD created_at   ON TABLE messages TYPE datetime DEFAULT time::now();
DEFINE FIELD tokens_in    ON TABLE messages TYPE int DEFAULT 0;
DEFINE FIELD tokens_out   ON TABLE messages TYPE int DEFAULT 0;
DEFINE FIELD duration_ms  ON TABLE messages TYPE int DEFAULT 0;
DEFINE FIELD max_tokens   ON TABLE messages TYPE int DEFAULT 0;
DEFINE FIELD query_type   ON TABLE messages TYPE option<string> | null;
DEFINE FIELD deleted_at   ON TABLE messages TYPE option<datetime> | null;
DEFINE FIELD user_agent_id ON TABLE messages TYPE option<record<user_agents>>;
DEFINE FIELD trace_id     ON TABLE messages TYPE option<string> | null;
DEFINE FIELD from_cache   ON TABLE messages TYPE bool DEFAULT false;

DEFINE INDEX idx_messages_user ON TABLE messages FIELDS user_id;

-- 3b. used_model — Graph edge from message to model
DEFINE TABLE used_model TYPE RELATION SCHEMAFULL;
DEFINE FIELD created_at ON TABLE used_model TYPE datetime DEFAULT time::now();

-- 3c. has_message — Graph edge from chat to message
DEFINE TABLE has_message TYPE RELATION IN chats OUT messages SCHEMAFULL;
DEFINE FIELD created_at ON TABLE has_message TYPE datetime DEFAULT time::now();

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
DEFINE FIELD part_of_series  ON TABLE page_posts TYPE option<record<page_posts>>;
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
DEFINE FIELD message_id          ON TABLE llm_cache TYPE option<record<messages>>;
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

DEFINE FIELD user_id       ON TABLE reactions TYPE option<record<users>>;
DEFINE FIELD reaction_type ON TABLE reactions TYPE option<string> | null;
DEFINE FIELD reason        ON TABLE reactions TYPE string DEFAULT '';
DEFINE FIELD created_at    ON TABLE reactions TYPE datetime DEFAULT time::now();

-- has_reaction edge: messages → reactions
DEFINE TABLE has_reaction SCHEMAFULL TYPE RELATION IN messages OUT reactions;
DEFINE FIELD created_at ON TABLE has_reaction TYPE datetime DEFAULT time::now();

-- =============================================================================
-- 9. chats — Conversation threads
-- =============================================================================
DEFINE TABLE chats SCHEMAFULL;

DEFINE FIELD title            ON TABLE chats TYPE string DEFAULT 'New Chat';
DEFINE FIELD created_at       ON TABLE chats TYPE datetime DEFAULT time::now();
DEFINE FIELD deleted_at       ON TABLE chats TYPE option<datetime> | null;
DEFINE FIELD locked           ON TABLE chats TYPE bool DEFAULT false;
DEFINE FIELD off_topic_count  ON TABLE chats TYPE int DEFAULT 0;
DEFINE FIELD user_agent_id    ON TABLE chats TYPE option<record<user_agents>>;
DEFINE FIELD trace_id         ON TABLE chats TYPE option<string> | null;

-- has_chat edge: users → chats
DEFINE TABLE has_chat SCHEMAFULL TYPE RELATION IN users OUT chats;
DEFINE FIELD created_at ON TABLE has_chat TYPE datetime DEFAULT time::now();

-- =============================================================================
-- 10. chat_events — Event log scoped to a chat
-- =============================================================================
DEFINE TABLE chat_events SCHEMAFULL;

DEFINE FIELD type       ON TABLE chat_events TYPE option<string> | null;
DEFINE FIELD data       ON TABLE chat_events TYPE option<string> | null;
DEFINE FIELD created_at ON TABLE chat_events TYPE datetime DEFAULT time::now();

-- has_event edge: chats → chat_events
DEFINE TABLE has_event SCHEMAFULL TYPE RELATION IN chats OUT chat_events;
DEFINE FIELD created_at ON TABLE has_event TYPE datetime DEFAULT time::now();

-- =============================================================================
-- 11. leads — Sales/marketing lead capture
-- =============================================================================
DEFINE TABLE leads SCHEMAFULL;

DEFINE FIELD user_id       ON TABLE leads TYPE option<record<users>>;
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

DEFINE FIELD user_id    ON TABLE contact_intents TYPE option<record<users>>;
DEFINE FIELD chat_id    ON TABLE contact_intents TYPE option<record<chats>>;
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

DEFINE FIELD name         ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD server_id    ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD tool_input   ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD tool_output  ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD result_size  ON TABLE tool_calls TYPE int DEFAULT 0;
DEFINE FIELD started_at   ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD finished_at  ON TABLE tool_calls TYPE option<string> | null;

-- has_tool_call edge: messages → tool_calls
DEFINE TABLE has_tool_call SCHEMAFULL TYPE RELATION IN messages OUT tool_calls;
DEFINE FIELD created_at ON TABLE has_tool_call TYPE datetime DEFAULT time::now();

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

DEFINE FIELD feature_id   ON TABLE feature_tours TYPE string ASSERT $value != NONE;
DEFINE FIELD dismissed_at ON TABLE feature_tours TYPE datetime DEFAULT time::now();

-- has_tour edge: users → feature_tours
DEFINE TABLE has_tour SCHEMAFULL TYPE RELATION IN users OUT feature_tours;
DEFINE FIELD created_at ON TABLE has_tour TYPE datetime DEFAULT time::now();

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
