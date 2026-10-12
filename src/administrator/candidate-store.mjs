// The Candidates file: announcements the server proposed for Team Shared, waiting for an
// approver. It lives next to the state and is shared by the receiver (which adds
// Candidates) and `candidates` (which decides them), so every change re-reads the file
// just before writing it and writes it atomically; one process never undoes another's
// change. The ids of the deliveries already handled are kept here too, so a restarted
// receiver does not create duplicates.
import path from 'node:path';
import { readJson, writeJsonWithBackup } from '../shared/fsx.mjs';

const VERSION = 1;
const HANDLED_LIMIT = 2000;

const emptyDocument = () => ({ version: VERSION, nextNumber: 1, handledEvents: [], candidates: [] });

export class CandidateStore {
  constructor({ workdir }) {
    this.file = path.join(workdir, 'state', 'candidates.json');
  }

  read() {
    return readJson(this.file, { label: 'candidates' }) ?? emptyDocument();
  }

  // Runs `change` on a fresh copy of the document, saves it and returns what `change` returns.
  update(change) {
    const document = this.read();
    const result = change(document);
    document.handledEvents = document.handledEvents.slice(-HANDLED_LIMIT);
    writeJsonWithBackup(this.file, document);
    return result;
  }

  find(id) {
    return this.read().candidates.find((candidate) => candidate.id === id) ?? null;
  }

  hasHandled(eventId) {
    return this.read().handledEvents.includes(eventId);
  }

  // Records a handled delivery and the Candidates it produced in one write.
  recordDelivery({ eventId, candidates }) {
    return this.update((document) => {
      document.handledEvents.push(eventId);
      return candidates.map((fields) => {
        const candidate = {
          id: `c${document.nextNumber}`,
          status: 'pending',
          ...fields,
          decidedAt: null,
          memoryId: null,
        };
        document.nextNumber += 1;
        document.candidates.push(candidate);
        return candidate;
      });
    });
  }

  // Changes one Candidate if it is still pending; returns the Candidate, or null when it
  // is gone or has already been decided.
  decide(id, changes) {
    return this.update((document) => {
      const candidate = document.candidates.find((entry) => entry.id === id);
      if (!candidate || candidate.status !== 'pending') return null;
      Object.assign(candidate, changes, { decidedAt: new Date().toISOString() });
      return candidate;
    });
  }
}
