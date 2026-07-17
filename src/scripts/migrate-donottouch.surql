-- =============================================================================
-- SurrealDB Schema — 17 tables for woss.io (single-file, snake_case, SCHEMAFULL)
-- =============================================================================
-- Run: cat src/scripts/migrate.surql | docker exec -i dali-surrealdb-1 surreal sql --endpoint http://localhost:10101 --namespace woss --database woss --user admin --pass admin
-- Or:  surreal sql --endpoint <url> --namespace <ns> --database <db> < src/scripts/migrate.surql
-- =============================================================================
-- Usage:  DELETE the entire DB first to apply the full schema from scratch.
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
-- ANN vector search not supported in SurrealDB 3.0.5 (falls back to brute-force vector::distance::cosine)

-- =============================================================================
-- 1b. has_chunk — Edge table connecting page_posts/page_experience → chunks
-- =============================================================================
-- Schema: page_posts:xxx --has_chunk--> chunks:xxx_chunk_0
-- Parent slug/type derived via <-has_chunk.in traversal (no slug/type on chunks)
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

DEFINE FIELD user_id      ON TABLE messages TYPE record<users> REFERENCE ASSERT $value != NONE;
-- chat_id removed — replaced by edge table has_message
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

DEFINE INDEX idx_messages_user ON TABLE messages FIELDS user_id;

-- 3b. used_model — Graph edge from message to model (replaces messages.model_id)
DEFINE TABLE used_model TYPE RELATION SCHEMAFULL;
DEFINE FIELD created_at ON TABLE used_model TYPE datetime DEFAULT time::now();

-- 3c. has_message — Graph edge from chat to message (replaces messages.chat_id REFERENCE)
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

DEFINE FIELD user_id       ON TABLE reactions TYPE option<record<users>> REFERENCE;
DEFINE FIELD reaction_type ON TABLE reactions TYPE option<string> | null;
DEFINE FIELD reason        ON TABLE reactions TYPE string DEFAULT '';
DEFINE FIELD created_at    ON TABLE reactions TYPE datetime DEFAULT time::now();

-- has_reaction edge: messages → reactions (which messages have which reactions)
DEFINE TABLE has_reaction SCHEMAFULL TYPE RELATION IN messages OUT reactions;

-- Phase 7 data migration: Create has_reaction edges from existing reactions.message_id
LET $reactionsWithMessage = (SELECT id, message_id FROM reactions WHERE message_id IS NOT NONE);
FOR $reaction IN $reactionsWithMessage {
    RELATE $reaction.message_id->has_reaction->$reaction.id;
};

-- =============================================================================
-- 9. chats — Conversation threads
-- =============================================================================
DEFINE TABLE chats SCHEMAFULL;

DEFINE FIELD title            ON TABLE chats TYPE string DEFAULT 'New Chat';
DEFINE FIELD created_at       ON TABLE chats TYPE datetime DEFAULT time::now();
DEFINE FIELD deleted_at       ON TABLE chats TYPE option<datetime> | null;
DEFINE FIELD locked           ON TABLE chats TYPE bool DEFAULT false;
DEFINE FIELD off_topic_count  ON TABLE chats TYPE int DEFAULT 0;
DEFINE FIELD user_agent_id    ON TABLE chats TYPE option<record<user_agents>> REFERENCE;
DEFINE FIELD trace_id         ON TABLE chats TYPE option<string> | null;

-- has_chat edge: users → chats (which users own which chats)
DEFINE TABLE has_chat SCHEMAFULL TYPE RELATION IN users OUT chats;

-- Phase 6 data migration: Create has_chat edges from existing chats.user_id
LET $chatsWithUser = (SELECT id, user_id FROM chats WHERE user_id IS NOT NONE);
FOR $chat IN $chatsWithUser {
    RELATE $chat.user_id->has_chat->$chat.id;
};

-- =============================================================================
-- 10. chat_events — Event log scoped to a chat
-- =============================================================================
DEFINE TABLE chat_events SCHEMAFULL;

DEFINE FIELD type       ON TABLE chat_events TYPE option<string> | null;
DEFINE FIELD data       ON TABLE chat_events TYPE option<string> | null;
DEFINE FIELD created_at ON TABLE chat_events TYPE datetime DEFAULT time::now();

-- has_event edge: chats → chat_events (which chats have which events)
DEFINE TABLE has_event SCHEMAFULL TYPE RELATION IN chats OUT chat_events;

-- Phase 9 data migration: Create has_event edges from existing chat_events.chat_id
LET $eventsWithChat = (SELECT id, chat_id FROM chat_events WHERE chat_id IS NOT NONE);
FOR $event IN $eventsWithChat {
    RELATE $event.chat_id->has_event->$event.id;
};

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

DEFINE FIELD name         ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD server_id    ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD tool_input   ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD tool_output  ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD result_size  ON TABLE tool_calls TYPE int DEFAULT 0;
DEFINE FIELD started_at   ON TABLE tool_calls TYPE option<string> | null;
DEFINE FIELD finished_at  ON TABLE tool_calls TYPE option<string> | null;

-- has_tool_call edge: messages → tool_calls (which messages have which tool calls)
DEFINE TABLE has_tool_call SCHEMAFULL TYPE RELATION IN messages OUT tool_calls;

-- Phase 8 data migration: Create has_tool_call edges from existing tool_calls.message_id
LET $toolCallsWithMessage = (SELECT id, message_id FROM tool_calls WHERE message_id IS NOT NONE);
FOR $toolCall IN $toolCallsWithMessage {
    RELATE $toolCall.message_id->has_tool_call->$toolCall.id;
};

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

-- has_tour edge: users → feature_tours (which users have dismissed which tours)
DEFINE TABLE has_tour SCHEMAFULL TYPE RELATION IN users OUT feature_tours;
DEFINE FIELD created_at ON TABLE has_tour TYPE datetime DEFAULT time::now();

-- Phase 10 data migration: Create has_tour edges from existing feature_tours.user_id
LET $toursWithUser = (SELECT id, user_id FROM feature_tours WHERE user_id IS NOT NONE);
FOR $tour IN $toursWithUser {
    RELATE $tour.user_id->has_tour->$tour.id;
};

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

-- =============================================================================
-- Data Migration: Create has_message edges from existing chat_id values
-- =============================================================================
-- Verify chat_id data exists before migration
LET $before_count = (SELECT count() FROM messages WHERE chat_id IS NOT NONE);
INFO::"Messages with chat_id before migration: " + <string>$before_count;

-- Create has_message edges: chats:chat_id -> has_message -> messages:id
FOR $msg IN SELECT id, chat_id FROM messages WHERE chat_id IS NOT NONE {
    RELATE $msg.chat_id->has_message->$msg.id SET created_at = time::now();
};

-- Verify edge count matches original chat_id count
LET $after_count = (SELECT count() FROM has_message);
INFO::"has_message edges created: " + <string>$after_count;
