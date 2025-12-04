-- DropForeignKey
ALTER TABLE "public"."Membership" DROP CONSTRAINT "Membership_memberId_fkey";

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
