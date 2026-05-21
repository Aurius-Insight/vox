-- Remove o conceito de "sala" do sistema:
--   - Unit.rooms        (quantidade de salas da unidade)
--   - ClassSession.room (nome da sala onde a aula acontece)
ALTER TABLE "Unit" DROP COLUMN "rooms";
ALTER TABLE "ClassSession" DROP COLUMN "room";
