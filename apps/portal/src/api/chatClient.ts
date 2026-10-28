import { config } from '../config';
import type { ChatResponse } from '../types';
import { authedFetch, continueTrace, newTraceparent } from './httpClient';
import { browserSessionId } from './session';

export interface ElicitationAnswer {
  key: string;
  action: 'accept' | 'decline';
  content?: Record<string, unknown>;
}

/** The trace of the question currently being answered.
 *
 * A consent prompt splits one question into several /chat requests -- the
 * question, then each answer. Answers continue the question's trace rather
 * than starting their own, so the agent can hang every round under the one
 * span the question opened, and the question reads as one trace in AMP. */
let questionTraceId: string | undefined;

export function sendChatMessage(
  token: string,
  sessionId: string | undefined,
  message: string,
  elicitationResponse?: ElicitationAnswer,
): Promise<ChatResponse> {
  return authedFetch<ChatResponse>(
    config.agent.chatUrl,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        message,
        elicitation_response: elicitationResponse,
      }),
    },
    // One question, one trace. The session id is the browser's own, not the
    // agent's conversation id -- it exists from the first request and spans
    // the whole sitting, and it rides baggage so it reaches services the
    // browser never calls.
    { traceparent: traceFor(elicitationResponse), sessionId: browserSessionId() },
  );
}

function traceFor(elicitationResponse: ElicitationAnswer | undefined): string {
  if (elicitationResponse && questionTraceId) {
    return continueTrace(questionTraceId);
  }
  const traceparent = newTraceparent();
  questionTraceId = traceparent.split('-')[1];
  return traceparent;
}
