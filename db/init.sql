CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT UNIQUE,
  "emailVerified" TIMESTAMPTZ,
  image TEXT,
  username TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  UNIQUE(provider, "providerAccountId")
);

INSERT INTO users (id, name, email, username)
VALUES ('3b9a8c88-779d-4cb9-a950-23c8f4559011', 'Mira Keller', 'mira@bouldero.local', 'miraklettert')
ON CONFLICT (email) DO NOTHING;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  "sessionToken" TEXT NOT NULL UNIQUE,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS spots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  district TEXT NOT NULL,
  address TEXT NOT NULL,
  website TEXT,
  opening_hours TEXT,
  area_sqm INTEGER,
  coordinates GEOGRAPHY(POINT, 4326) NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed',
  source_external_id TEXT,
  source_license TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source, source_external_id)
);

CREATE INDEX IF NOT EXISTS spots_coordinates_idx ON spots USING GIST (coordinates);

CREATE TABLE IF NOT EXISTS visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spot_id UUID NOT NULL REFERENCES spots(id) ON DELETE RESTRICT,
  visited_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS visits_user_date_idx ON visits (user_id, visited_at DESC);

CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visit_id UUID NOT NULL UNIQUE REFERENCES visits(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'friends', 'followers', 'public')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS badges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  threshold INTEGER NOT NULL UNIQUE CHECK (threshold > 0)
);

INSERT INTO badges (id, name, threshold) VALUES
  ('first-grip', 'Erster Griff', 1),
  ('hall-hopper', 'Hallen-Hopper', 5),
  ('boulder-scout', 'Boulder-Scout', 10),
  ('deutschland-crusher', 'Deutschland-Crusher', 25),
  ('boulder-veteran', 'Boulder-Veteran', 50)
ON CONFLICT (id) DO NOTHING;

INSERT INTO spots (id, name, district, address, opening_hours, area_sqm, coordinates, source, source_external_id) VALUES
  ('419ca859-f9a5-4b5e-87f3-a4f2da0ad201', 'Neckarblock', 'Jungbusch', 'Hafenstraße 18, Mannheim', '07:00–23:00', 1150, ST_SetSRID(ST_MakePoint(8.4548, 49.4964), 4326)::geography, 'seed', 'neckarblock'),
  ('ee258faf-7be1-4b65-aeb8-af0ed41a2d02', 'Griffwerk Mannheim', 'Innenstadt', 'Rheinstraße 42, Mannheim', '08:00–22:30', 870, ST_SetSRID(ST_MakePoint(8.4699, 49.4865), 4326)::geography, 'seed', 'griffwerk'),
  ('a78b6ecb-5a5f-4ea4-a44b-af4553a3e303', 'Blockraum Lindenhof', 'Lindenhof', 'Meerfeldstraße 9, Mannheim', '09:00–22:00', 620, ST_SetSRID(ST_MakePoint(8.4787, 49.4694), 4326)::geography, 'seed', 'blockraum'),
  ('d247196a-fa2c-4bde-ae89-5d739cd6b404', 'Kantenwerk', 'Neckarstadt', 'Lange Rötterstraße 76, Mannheim', '06:30–23:00', 1340, ST_SetSRID(ST_MakePoint(8.4754, 49.5092), 4326)::geography, 'seed', 'kantenwerk'),
  ('408c62e5-9fd9-4a9e-9c42-083b14db6505', 'Felsfrei', 'Schwetzingerstadt', 'Seckenheimer Straße 88, Mannheim', '08:00–23:00', 980, ST_SetSRID(ST_MakePoint(8.4878, 49.4786), 4326)::geography, 'seed', 'felsfrei'),
  ('08a85e22-2b66-46e7-b698-8f9ce3487506', 'Route Sieben', 'Käfertal', 'Wasserwerkstraße 7, Mannheim', '10:00–22:00', 540, ST_SetSRID(ST_MakePoint(8.5042, 49.5246), 4326)::geography, 'seed', 'route7'),
  ('1a4e8043-4b2e-4a13-b9ea-0d423f7a4607', 'Beton & Boulder', 'Sandhofen', 'Kalthorstraße 31, Mannheim', '09:00–22:30', 760, ST_SetSRID(ST_MakePoint(8.4579, 49.5424), 4326)::geography, 'seed', 'betonboulder'),
  ('b2d1ab78-3388-4e63-a343-4d9758f16708', 'Rheinhold', 'Neckarau', 'Moritzenstraße 21, Mannheim', '07:00–22:00', 690, ST_SetSRID(ST_MakePoint(8.4941, 49.4548), 4326)::geography, 'seed', 'rheinhold'),
  ('90556ec4-974d-4c56-a0a9-1da8ae71c409', 'Boulderbase Süd', 'Rheinau', 'Relaisstraße 104, Mannheim', '08:00–22:00', 1020, ST_SetSRID(ST_MakePoint(8.5245, 49.4303), 4326)::geography, 'seed', 'boulderbase'),
  ('c01119f6-65a8-45a7-aa37-6261eac8ea10', 'Boulderhof', 'Vogelstang', 'Freiberger Ring 14, Mannheim', '09:00–22:30', 810, ST_SetSRID(ST_MakePoint(8.5352, 49.5341), 4326)::geography, 'seed', 'boulderhof')
ON CONFLICT (source, source_external_id) DO NOTHING;
