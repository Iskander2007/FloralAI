export const requestTimeoutMessage = "The request timed out. Please try again.";

// Keep the deadline signal alive while consumers read the response body too.
export async function fetchWithTimeout(
    input: RequestInfo | URL,
    init?: RequestInit,
    timeoutMs = 15_000,
) {
    const deadline = AbortSignal.timeout(timeoutMs);
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
    try {
        return await fetch(input, { ...init, signal });
    } catch (error) {
        if (deadline.aborted && !callerSignal?.aborted) throw new Error(requestTimeoutMessage);
        throw error;
    }
}
