CREATE TABLE users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspaces (
 owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 preferences_json jsonb NOT NULL DEFAULT '{"theme":"light","motion":true}'::jsonb
);
CREATE TABLE notes (
 owner_id uuid NOT NULL REFERENCES workspaces(owner_id) ON DELETE CASCADE,
 id text NOT NULL CHECK(length(id) BETWEEN 1 AND 200), summary text NOT NULL CHECK(length(trim(summary))>0), body text NOT NULL,
 kind text CHECK(kind IN ('story','thought')), created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 deleted boolean NOT NULL DEFAULT false, sort_order integer NOT NULL,
 PRIMARY KEY(owner_id,id)
);
CREATE TABLE tags (
 owner_id uuid NOT NULL REFERENCES workspaces(owner_id) ON DELETE CASCADE,
 normalized_name text NOT NULL, name text NOT NULL, sort_order integer NOT NULL,
 PRIMARY KEY(owner_id,normalized_name)
);
CREATE TABLE note_tags (
 owner_id uuid NOT NULL,note_id text NOT NULL,tag_name text NOT NULL,sort_order integer NOT NULL,
 PRIMARY KEY(owner_id,note_id,tag_name),
 FOREIGN KEY(owner_id,note_id) REFERENCES notes(owner_id,id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(owner_id,tag_name) REFERENCES tags(owner_id,normalized_name) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE knowledge_maps (
 owner_id uuid NOT NULL REFERENCES workspaces(owner_id) ON DELETE CASCADE,
 id text NOT NULL CHECK(length(id) BETWEEN 1 AND 200), name text NOT NULL,summary text NOT NULL,description text NOT NULL,
 updated_at timestamptz NOT NULL,created_at timestamptz,deleted boolean NOT NULL DEFAULT false,
 saved_revision_number bigint, sort_order integer NOT NULL, preferences_json jsonb NOT NULL DEFAULT '{}'::jsonb,
 PRIMARY KEY(owner_id,id)
);
CREATE TABLE canvas_nodes (
 owner_id uuid NOT NULL,map_id text NOT NULL,id text NOT NULL CHECK(length(id) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK(kind IN ('note','group','annotation','shape')),
 note_id text,parent_id text,x double precision NOT NULL,y double precision NOT NULL,
 rendering_json jsonb NOT NULL DEFAULT '{}'::jsonb,sort_order integer NOT NULL,
 PRIMARY KEY(owner_id,map_id,id),
 UNIQUE(owner_id,map_id,id,kind),
 CHECK((kind='note' AND note_id IS NOT NULL) OR (kind<>'note' AND note_id IS NULL)),
 CHECK(x BETWEEN -100000000 AND 100000000 AND y BETWEEN -100000000 AND 100000000),
 CHECK(parent_id IS NULL OR parent_id<>id),
 FOREIGN KEY(owner_id,map_id) REFERENCES knowledge_maps(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,note_id) REFERENCES notes(owner_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(owner_id,map_id,parent_id) REFERENCES canvas_nodes(owner_id,map_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE canvas_edges (
 owner_id uuid NOT NULL,map_id text NOT NULL,id text NOT NULL CHECK(length(id) BETWEEN 1 AND 200),
 source_id text NOT NULL,target_id text NOT NULL,
 endpoint_kind text NOT NULL DEFAULT 'note' CHECK(endpoint_kind='note'),
 rendering_json jsonb NOT NULL DEFAULT '{}'::jsonb,sort_order integer NOT NULL,
 PRIMARY KEY(owner_id,map_id,id),
 FOREIGN KEY(owner_id,map_id) REFERENCES knowledge_maps(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,map_id,source_id,endpoint_kind) REFERENCES canvas_nodes(owner_id,map_id,id,kind) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(owner_id,map_id,target_id,endpoint_kind) REFERENCES canvas_nodes(owner_id,map_id,id,kind) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE map_tag_settings (
 owner_id uuid NOT NULL,map_id text NOT NULL,tag_name text NOT NULL,sort_order integer NOT NULL,
 PRIMARY KEY(owner_id,map_id,tag_name),
 FOREIGN KEY(owner_id,map_id) REFERENCES knowledge_maps(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,tag_name) REFERENCES tags(owner_id,normalized_name) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE map_revisions (
 owner_id uuid NOT NULL,map_id text NOT NULL,number bigint NOT NULL CHECK(number>0),
 label text,structure_json jsonb NOT NULL,sort_order integer NOT NULL,
 PRIMARY KEY(owner_id,map_id,number),
 FOREIGN KEY(owner_id,map_id) REFERENCES knowledge_maps(owner_id,id) ON DELETE CASCADE
);
ALTER TABLE knowledge_maps ADD CONSTRAINT selected_revision_exists
 FOREIGN KEY(owner_id,id,saved_revision_number) REFERENCES map_revisions(owner_id,map_id,number) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE map_revision_notes (
 owner_id uuid NOT NULL,map_id text NOT NULL,revision_number bigint NOT NULL,note_id text NOT NULL,
 frozen_json jsonb NOT NULL,sort_order integer NOT NULL,
 PRIMARY KEY(owner_id,map_id,revision_number,note_id),
 FOREIGN KEY(owner_id,map_id,revision_number) REFERENCES map_revisions(owner_id,map_id,number) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,note_id) REFERENCES notes(owner_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiration ON sessions(expires_at);
CREATE TABLE api_connections (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL,token_hash text NOT NULL UNIQUE,scopes text[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),last_used_at timestamptz,revoked_at timestamptz,
 CHECK(scopes <@ ARRAY['read','write','purge']::text[])
);
CREATE TABLE activity_events (
 id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source text NOT NULL,action text NOT NULL,object_type text,object_id text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_events_owner_time ON activity_events(owner_id,created_at DESC);
CREATE TABLE idempotency_records (
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,key text NOT NULL,
 request_hash text NOT NULL,response_json jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,key)
);
CREATE INDEX canvas_node_notes ON canvas_nodes(owner_id,note_id);
CREATE INDEX revision_source_notes ON map_revision_notes(owner_id,note_id);
