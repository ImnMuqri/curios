-- CreateIndex
CREATE INDEX "Conversation_pendingOrderId_idx" ON "Conversation"("pendingOrderId");

-- CreateIndex
CREATE INDEX "OrderLine_itemId_idx" ON "OrderLine"("itemId");
