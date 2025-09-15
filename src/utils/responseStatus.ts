export const ResponseStatus = {
  ACCEPTED: 'ACCEPTED',
  QUEUED: 'QUEUED',
  UPDATED: 'UPDATED'
} as const;

export type ResponseStatusKey = keyof typeof ResponseStatus;
export type ResponseStatusValue = typeof ResponseStatus[ResponseStatusKey];
