-- WhatsApp passa a ser opcional em Lead e Student. Necessario pra ETL das
-- planilhas legadas (Catete/Niteroi/Tijuca), que so trazem nome+presencas
-- — operador completa o whatsapp depois pela ficha do aluno.
--
-- Os indices @@index([whatsapp]) continuam validos com nulos.

ALTER TABLE "Lead"    ALTER COLUMN "whatsapp" DROP NOT NULL;
ALTER TABLE "Student" ALTER COLUMN "whatsapp" DROP NOT NULL;
