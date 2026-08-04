# Mermaid diagrams in a scratchpad

Read this before writing a ` ```mermaid ` block. Label formatting is the whole
difference between a readable diagram and an unreadable one, and a few characters
need escaping to parse at all.

    ```mermaid
    flowchart TD
      A["Request"] --> B{"Cache hit?"}
      B -->|"yes"| C["Return cached"]
      B -->|"no"| D["Fetch<br/>+ store"]
    ```

## Label rules (write labels this way)

**Break every label with `<br/>`.** One long single-line label is the main way a
diagram comes out unreadable: mermaid sizes each box from its label, so one long run
makes a single node as wide as the whole diagram. Keep each line short — a name on
the first line, the detail on the second:

    ```mermaid
    flowchart TD
      A["StorageBlobService<br/>GetBlobSnapshotAsync"] --> B["MaterializeAsync<br/>one DownloadStreamingAsync"]
    ```

**Budget: ≤ 24 characters per line, hard ceiling 26.** This is a layout budget, not a
hard limit — the viewer renders labels as SVG text, so an over-long line wraps and the
box grows rather than clipping. But a box that grows past ~26 characters pushes every
other node around and the diagram stops being readable. Count each `<br/>`-separated
line separately — the *longest* line drives the box width, not the total.

At most 2–3 lines per node. If a label won't fit in ~24 × 3, it isn't a label:
split it into several nodes, or move the sentence into the prose around the diagram.

    ```mermaid
    flowchart TD
      %% 21 and 24 chars — fits
      A["MaterializeAsync<br/>one DownloadStreaming"] --> B["> 5 MB<br/>temp file + reservation"]
      %% BAD: 58 chars on one line — one node ends up as wide as the diagram
      C["MaterializeAsync runs one DownloadStreamingAsync per blob"]
    ```

Inside a quoted `["…"]` label (verified against mermaid 11):

- `()`, `,`, `{}`, `/`, `→`, `.` — all fine, so write real signatures:
  `["snapshot.OpenReadAsync()"]`, `["IFileHandler.CreateAsync(snapshot, name)"]`.
- `<` and `>` need HTML entities: `["Task&lt;IBlobSnapshot&gt;"]`. Written raw they are
  **silently dropped** — no parse error, the characters just don't paint, so
  `["size > 5 MB?"]` renders as `size 5 MB?`.
- `#` starts an entity escape — a literal `#1` must be written `#35;1`.
- Backticks/`**bold**` only work in a *markdown string*, where the backticks wrap the
  **whole** label: ``["`**bold** and OpenReadAsync()`"]``. Backticks mid-label are a
  lexical error, and the unquoted `` [`…`] `` form can't contain `()`.
- Don't hardcode colors; the viewer themes light/dark.
