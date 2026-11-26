import { v7 } from 'uuid'

/** UUIDv7: time-ordered, so ordering by id matches creation order within a process. */
export const newId = (): string => v7()
