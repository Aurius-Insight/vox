-- DropIndex
DROP INDEX "ClassSession_unit_idx";

-- AlterTable: ClassSession.unit (texto) -> unitId (FK)
ALTER TABLE "ClassSession" DROP COLUMN "unit",
ADD COLUMN "unitId" TEXT;

-- AlterTable: Student.unit (texto) -> unitId (FK)
ALTER TABLE "Student" DROP COLUMN "unit",
ADD COLUMN "unitId" TEXT;

-- AlterTable: User ganha unitId (escopo de unidade)
ALTER TABLE "User" ADD COLUMN "unitId" TEXT;

-- CreateIndex
CREATE INDEX "ClassSession_unitId_idx" ON "ClassSession"("unitId");

-- CreateIndex
CREATE INDEX "Student_unitId_idx" ON "Student"("unitId");

-- CreateIndex
CREATE INDEX "User_unitId_idx" ON "User"("unitId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
