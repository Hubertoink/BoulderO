-- Die anfänglichen zehn Beispielhallen waren ausschließlich für den Prototyp.
-- Archivieren statt löschen erhält eventuelle Fremdschlüssel (z. B. Besuche),
-- nimmt sie aber vollständig aus Karte, Suche und Hallenauswahl.
UPDATE spots
   SET status = 'archived', updated_at = NOW()
 WHERE source = 'seed'
   AND status = 'active';
