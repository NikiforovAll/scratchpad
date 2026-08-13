// Code files get syntax highlighting via highlight.js.
// This is the actual shape of a scratchpad.json entry (schema version 1).

export interface FileEntry {
  /** Path relative to the pad dir — keeps the pad portable. */
  path: string;
  /** Linked external source: content lives here, `path` is just the label. */
  src?: string;
  title?: string;
  description?: string;
  tags?: string[];
  type?: "note" | "snippet" | "output" | "artifact" | "reference";
  /** Files sharing a group are listed together under a header. */
  group?: string;
  /** Quote-anchored inline comments left in the viewer. */
  comments?: Comment[];
}

export interface Comment {
  id: string;
  body: string;
  anchor: { quote: string; prefix: string; suffix: string };
  created: string;
  updated: string;
}

// Unknown keys are tolerated on read — the format evolves forward-compatibly.
