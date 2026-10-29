-- What the chat said to an ask, so the Questions screen can show it and tell a
-- topic the chat answered from the facts from one that needs the owner.
ALTER TABLE "QuestionAsk" ADD COLUMN "reply" TEXT;
