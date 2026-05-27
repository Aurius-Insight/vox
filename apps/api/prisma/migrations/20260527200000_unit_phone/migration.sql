-- Telefone/WhatsApp da unidade (opcional). Operacao da Vox usa WhatsApp
-- pra contato direto da unidade — antes a info ficava fora do app.
ALTER TABLE "Unit" ADD COLUMN "phone" TEXT;
