-- CreateEnum
CREATE TYPE "StudentType" AS ENUM ('experimental', 'matriculado');

-- AlterTable
ALTER TABLE "Student"
  ADD COLUMN "type" "StudentType" NOT NULL DEFAULT 'matriculado',
  ALTER COLUMN "packageName" DROP NOT NULL;
