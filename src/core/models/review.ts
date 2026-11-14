/**
 * HUMAN REVIEW STATUS shared by BQ rows and claim records.
 * Every change of status is kept in `history` (who, when, note), newest last.
 */
export type ReviewStatus = 'pending_review' | 'needs_changes' | 'approved' | 'rejected';

export interface ReviewEvent {
  readonly status: ReviewStatus;
  readonly by: string;
  readonly at: string;
  readonly note?: string;
}

export interface ReviewState {
  readonly status: ReviewStatus;
  readonly history: readonly ReviewEvent[];
}

export const PENDING_REVIEW: ReviewState = { status: 'pending_review', history: [] };

export class ReviewError extends Error {
  override name = 'ReviewError';
}
