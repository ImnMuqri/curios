-- Whether the chat could answer this ask: the owner's answer or the facts (true), or "not sure" (false). Null before this was recorded, and for the month's fixed reply.
ALTER TABLE "QuestionAsk" ADD COLUMN "answered" BOOLEAN;
