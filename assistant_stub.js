(function (root) {
  'use strict';

  const AssistantStub = {
    describeFutureBehavior() {
      return {
        mode: 'prototype-scaffold',
        note: 'This stub is intentionally non-operative. A server-side LLM layer should receive prompts, plan structured filters, optionally fetch official webpages, and return grounded recommendations.'
      };
    }
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = AssistantStub;
  }
  root.C2A2CommunityExplorerAssistantStub = AssistantStub;
}(typeof globalThis !== 'undefined' ? globalThis : this));
