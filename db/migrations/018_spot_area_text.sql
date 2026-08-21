-- Hallen veröffentlichen Größe sehr unterschiedlich (m², Boulder, Wände usw.).
-- Das Feld bleibt deshalb eine freie Angabe statt einer ausschließlich numerischen Fläche.
ALTER TABLE spots
  ALTER COLUMN area_sqm TYPE TEXT
  USING NULLIF(area_sqm::text, '0');
